import { describe, expect, it } from "vitest";

import {
  applyResponsesFunctionToolsQuirk,
  convertResponsesCustomToolHistory,
  convertResponsesCustomTools,
  createResponsesEventRewriter,
  rewriteResponsesCustomToolOutput,
  stripResponsesTextFormat,
} from "../../open-sse/translator/concerns/responsesFunctionTools.js";

const EXEC_CUSTOM_TOOL = {
  type: "custom",
  name: "exec",
  description: "Run JavaScript code",
  format: {
    type: "grammar",
    syntax: "lark",
    definition: "start: SOURCE\nSOURCE: /[\\s\\S]+/",
  },
};

const WAIT_FUNCTION_TOOL = {
  type: "function",
  name: "wait",
  description: "Wait on a cell",
  parameters: { type: "object", properties: { cell_id: { type: "string" } }, required: ["cell_id"] },
};

describe("stripResponsesTextFormat", () => {
  it("drops text.format and keeps verbosity", () => {
    const body = { text: { verbosity: "low", format: { type: "json_schema", name: "codex_output_schema" } } };
    expect(stripResponsesTextFormat(body)).toEqual({ text: { verbosity: "low" } });
  });

  it("leaves bodies without text or without format untouched", () => {
    expect(stripResponsesTextFormat({ model: "m" })).toEqual({ model: "m" });
    expect(stripResponsesTextFormat({ text: { verbosity: "low" } })).toEqual({ text: { verbosity: "low" } });
  });
});

describe("convertResponsesCustomTools", () => {
  it("converts custom tools to functions with a freeform input param", () => {
    const { body, converted } = convertResponsesCustomTools({ tools: [EXEC_CUSTOM_TOOL, WAIT_FUNCTION_TOOL] });

    expect(converted).toEqual(["exec"]);
    expect(body._customToolNames).toEqual(["exec"]);
    expect(body.tools).toHaveLength(2);

    const exec = body.tools[0];
    expect(exec.type).toBe("function");
    expect(exec.name).toBe("exec");
    expect(exec.parameters.properties.input.type).toBe("string");
    expect(exec.parameters.required).toEqual(["input"]);
    // Lark grammar surfaced in the description so the model knows the input shape
    expect(exec.description).toContain("lark");
    expect(exec.description).toContain("start: SOURCE");

    // Function tools pass through untouched
    expect(body.tools[1]).toEqual(WAIT_FUNCTION_TOOL);
  });

  it("does not mutate bodies without custom tools", () => {
    const body = { tools: [WAIT_FUNCTION_TOOL] };
    const { body: out, converted } = convertResponsesCustomTools(body);
    expect(converted).toEqual([]);
    expect(out._customToolNames).toBeUndefined();
    expect(out).toBe(body);
  });
});

describe("applyResponsesFunctionToolsQuirk", () => {
  it("applies tool, text.format, and history conversions in one pass", () => {
    const body = applyResponsesFunctionToolsQuirk({
      tools: [EXEC_CUSTOM_TOOL],
      text: { verbosity: "low", format: { type: "json_schema" } },
      input: [{ type: "custom_tool_call", id: "ctc_1", call_id: "call_x", name: "exec", input: "ls" }],
    });
    expect(body.tools[0].type).toBe("function");
    expect(body._customToolNames).toEqual(["exec"]);
    expect(body.text).toEqual({ verbosity: "low" });
    expect(body.input[0].type).toBe("function_call");
    expect(body.input[0].arguments).toBe(JSON.stringify({ input: "ls" }));
  });
});

describe("convertResponsesCustomToolHistory", () => {
  const CALL_ITEM = {
    type: "custom_tool_call",
    id: "ctc_1",
    call_id: "call_x",
    name: "exec",
    input: "echo hi",
  };
  const OUTPUT_ITEM = {
    type: "custom_tool_call_output",
    id: "ctco_9",
    call_id: "call_x",
    output: [
      { type: "input_text", text: "Script completed\n" },
      { type: "input_text", text: "hello" },
    ],
  };

  it("converts custom_tool_call to function_call with {input} arguments", () => {
    const { input } = convertResponsesCustomToolHistory({ input: [CALL_ITEM, { type: "message", role: "user" }] });
    expect(input[0]).toEqual({
      type: "function_call",
      id: "fc_1",
      call_id: "call_x",
      name: "exec",
      arguments: JSON.stringify({ input: "echo hi" }),
    });
    expect(input[1]).toEqual({ type: "message", role: "user" });
  });

  it("converts custom_tool_call_output to function_call_output with string output", () => {
    const { input } = convertResponsesCustomToolHistory({ input: [OUTPUT_ITEM] });
    expect(input[0]).toEqual({
      type: "function_call_output",
      id: "fco_9",
      call_id: "call_x",
      output: "Script completed\nhello",
    });
  });

  it("keeps an already-converted arguments string on replay", () => {
    const { input } = convertResponsesCustomToolHistory({
      input: [{ ...CALL_ITEM, input: undefined, arguments: "{\"input\":\"kept\"}" }],
    });
    expect(input[0].arguments).toBe("{\"input\":\"kept\"}");
  });

  it("is a no-op without custom items", () => {
    const body = { input: [{ type: "message", role: "user" }, { type: "function_call", id: "fc_1" }] };
    expect(convertResponsesCustomToolHistory(body)).toBe(body);
  });

  it("handles string output", () => {
    const { input } = convertResponsesCustomToolHistory({
      input: [{ ...OUTPUT_ITEM, output: "plain" }],
    });
    expect(input[0].output).toBe("plain");
  });
});

describe("createResponsesEventRewriter", () => {
  it("rewrites output_item.added to custom_tool_call with ctc_ prefix", () => {
    const rewrite = createResponsesEventRewriter(new Set(["exec"]));
    const { event, data } = rewrite("response.output_item.added", {
      type: "response.output_item.added",
      output_index: 0,
      item: { id: "fc_1", type: "function_call", call_id: "call_x", name: "exec", arguments: "" },
    });

    expect(event).toBe("response.output_item.added");
    expect(data.item.type).toBe("custom_tool_call");
    expect(data.item.id).toBe("ctc_1");
    expect(data.item.call_id).toBe("call_x");
    expect(data.item.input).toBe("");
    expect(data.item.arguments).toBeUndefined();
  });

  it("suppresses function_call_arguments.delta for converted tools (freeform arrives whole)", () => {
    const rewrite = createResponsesEventRewriter(new Set(["exec"]));
    rewrite("response.output_item.added", {
      item: { id: "fc_1", type: "function_call", call_id: "call_x", name: "exec", arguments: "" },
    });

    const result = rewrite("response.function_call_arguments.delta", {
      type: "response.function_call_arguments.delta",
      item_id: "fc_1",
      delta: "{\"input\":",
    });
    expect(result).toBeNull();
  });

  it("keeps function_call_arguments.delta for non-converted tools", () => {
    const rewrite = createResponsesEventRewriter(new Set(["exec"]));
    rewrite("response.output_item.added", {
      item: { id: "fc_1", type: "function_call", call_id: "call_x", name: "wait", arguments: "" },
    });

    const data = { type: "response.function_call_arguments.delta", item_id: "fc_1", delta: "{}" };
    const result = rewrite("response.function_call_arguments.delta", data);
    expect(result).toEqual({ event: "response.function_call_arguments.delta", data });
  });

  it("converts arguments.done into custom_tool_call_input.done with unwrapped input", () => {
    const rewrite = createResponsesEventRewriter(new Set(["exec"]));
    rewrite("response.output_item.added", {
      item: { id: "fc_1", type: "function_call", call_id: "call_x", name: "exec", arguments: "" },
    });

    const { event, data } = rewrite("response.function_call_arguments.done", {
      type: "response.function_call_arguments.done",
      item_id: "fc_1",
      arguments: "{\"input\":\"echo hi\"}",
    });

    expect(event).toBe("response.custom_tool_call_input.done");
    expect(data.item_id).toBe("ctc_1");
    expect(data.input).toBe("echo hi");
    expect(data.arguments).toBeUndefined();
  });

  it("rewrites output_item.done arguments into whole input", () => {
    const rewrite = createResponsesEventRewriter(new Set(["exec"]));
    rewrite("response.output_item.added", {
      item: { id: "fc_1", type: "function_call", call_id: "call_x", name: "exec", arguments: "" },
    });

    const { data } = rewrite("response.output_item.done", {
      type: "response.output_item.done",
      item: { id: "fc_1", type: "function_call", call_id: "call_x", name: "exec", arguments: "{\"input\":\"ls\"}" },
    });

    expect(data.item.type).toBe("custom_tool_call");
    expect(data.item.input).toBe("ls");
    expect(data.item.arguments).toBeUndefined();
  });

  it("rewrites converted items inside response.completed output", () => {
    const rewrite = createResponsesEventRewriter(new Set(["exec"]));
    const { data } = rewrite("response.completed", {
      type: "response.completed",
      response: {
        status: "completed",
        output: [
          { id: "fc_1", type: "function_call", call_id: "call_x", name: "exec", arguments: "{\"input\":\"pwd\"}" },
          { id: "fc_2", type: "function_call", call_id: "call_y", name: "wait", arguments: "{}" },
        ],
      },
    });

    expect(data.response.output[0].type).toBe("custom_tool_call");
    expect(data.response.output[0].input).toBe("pwd");
    expect(data.response.output[1].type).toBe("function_call");
  });

  it("leaves events alone when no tools were converted", () => {
    const rewrite = createResponsesEventRewriter(new Set());
    const data = { type: "response.output_item.added", item: { id: "fc_1", type: "function_call", name: "wait" } };
    const result = rewrite("response.output_item.added", data);
    expect(result).toEqual({ event: "response.output_item.added", data });
  });

  it("accepts an array of names and survives an empty item", () => {
    const rewrite = createResponsesEventRewriter(["exec"]);
    const data = { type: "response.output_item.done", output_index: 0 };
    expect(rewrite("response.output_item.done", data)).toEqual({ event: "response.output_item.done", data });
  });
});

describe("rewriteResponsesCustomToolOutput", () => {
  it("swaps function_call items for custom_tool_call in a response body", () => {
    const body = rewriteResponsesCustomToolOutput({
      object: "response",
      status: "completed",
      output: [{ id: "fc_1", type: "function_call", call_id: "call_x", name: "exec", arguments: "{\"input\":\"echo hi\"}" }],
    }, new Set(["exec"]));

    expect(body.output[0].type).toBe("custom_tool_call");
    expect(body.output[0].input).toBe("echo hi");
  });

  it("is a no-op without converted names", () => {
    const body = { output: [{ type: "function_call", name: "wait" }] };
    expect(rewriteResponsesCustomToolOutput(body, new Set())).toBe(body);
  });
});

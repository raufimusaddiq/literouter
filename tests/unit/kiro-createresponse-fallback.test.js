import { describe, it, expect, afterEach } from "bun:test";
import { vi } from "#test/vi";
import {
  buildKiroCreateResponseUrl,
  buildKiroCreateResponseBody,
  buildKiroCreateResponseHeaders,
  transformCreateResponseStreamToSSE
} from "open-sse/utils/kiroCreateResponse.js";
import { KiroExecutor } from "open-sse/executors/kiro.js";

describe("Kiro CreateResponse (/v1/responses) adapter", () => {
  it("builds the CreateResponse URL with region support", () => {
    expect(buildKiroCreateResponseUrl()).toBe("https://runtime.us-east-1.kiro.dev/v1/responses");
    expect(buildKiroCreateResponseUrl("us-east-1")).toBe("https://runtime.us-east-1.kiro.dev/v1/responses");
    expect(buildKiroCreateResponseUrl("eu-central-1")).toBe("https://runtime.eu-central-1.kiro.dev/v1/responses");
  });

  it("never splices an unserved or injected region into the hostname", () => {
    for (const region of ["ap-south-1", "evil.com/x", "us-east-1@evil.com", "US-EAST-1", ""]) {
      expect(buildKiroCreateResponseUrl(region)).toBe("https://runtime.us-east-1.kiro.dev/v1/responses");
    }
  });

  it("builds authentication headers for CreateResponse", () => {
    const credsBearer = {
      accessToken: "token_123",
      providerSpecificData: {
        profileArn: "arn:aws:codewhisperer:us-east-1:12345:profile/TEST"
      }
    };
    const headersBearer = buildKiroCreateResponseHeaders({ credentials: credsBearer });
    expect(headersBearer["Authorization"]).toBe("Bearer token_123");
    expect(headersBearer["x-amzn-kiro-origin"]).toBe("AI_EDITOR");
    expect(headersBearer["x-amzn-codewhisperer-optout"]).toBe("true");
    expect(headersBearer["x-amzn-kiro-profile"]).toBe("arn:aws:codewhisperer:us-east-1:12345:profile/TEST");
    expect(headersBearer["TokenType"]).toBeUndefined();

    const credsApiKey = {
      apiKey: "secret_key",
      providerSpecificData: {
        authMethod: "api_key"
      }
    };
    const headersApiKey = buildKiroCreateResponseHeaders({ credentials: credsApiKey });
    expect(headersApiKey["Authorization"]).toBe("Bearer secret_key");
    expect(headersApiKey["TokenType"]).toBe("API_KEY");

    const credsExternal = {
      accessToken: "token_ext",
      providerSpecificData: {
        authMethod: "external_idp"
      }
    };
    const headersExt = buildKiroCreateResponseHeaders({ credentials: credsExternal });
    expect(headersExt["TokenType"]).toBe("EXTERNAL_IDP");
  });

  it("translates conversationState into CreateResponse request body", () => {
    const body = {
      conversationState: {
        conversationId: "conv-uuid-123",
        history: [
          {
            userInputMessage: {
              content: "What is the weather?"
            }
          },
          {
            assistantResponseMessage: {
              content: "Let me check.",
              toolUses: [
                {
                  toolUseId: "tool_call_1",
                  name: "get_weather",
                  input: { location: "Tokyo" }
                }
              ]
            }
          },
          {
            userInputMessage: {
              userInputMessageContext: {
                toolResults: [
                  {
                    toolUseId: "tool_call_1",
                    content: [{ text: "Sunny, 22C" }]
                  }
                ]
              }
            }
          }
        ],
        currentMessage: {
          userInputMessage: {
            content: "And in Kyoto?",
            modelId: "claude-opus-5.5",
            origin: "AI_EDITOR",
            userInputMessageContext: {
              tools: [
                {
                  toolSpecification: {
                    name: "get_weather",
                    description: "Get weather for location",
                    inputSchema: {
                      json: {
                        type: "object",
                        properties: { location: { type: "string" } },
                        required: ["location"]
                      }
                    }
                  }
                }
              ]
            }
          }
        }
      },
      profileArn: "arn:aws:codewhisperer:us-east-1:12345:profile/TEST",
      additionalModelRequestFields: {
        thinking: { type: "adaptive", display: "summarized" },
        output_config: { effort: "high" }
      }
    };

    const crBody = buildKiroCreateResponseBody({ body, model: "kr/claude-opus-5.5" });

    expect(crBody.model).toBe("claude-opus-5.5");
    expect(crBody.stream).toBe(true);
    expect(crBody.origin).toBe("AI_EDITOR");
    expect(crBody.profileArn).toBe("arn:aws:codewhisperer:us-east-1:12345:profile/TEST");
    expect(crBody.metadata).toEqual({
      "kiro:agent_mode": "vibe",
      "kiro:conversation_id": "conv-uuid-123"
    });
    expect(crBody.reasoning).toEqual({
      type: "adaptive",
      effort: "high",
      summary: "summarized"
    });

    expect(crBody.input).toHaveLength(5);
    expect(crBody.input[0]).toEqual({ role: "user", content: "What is the weather?" });
    expect(crBody.input[1]).toEqual({ role: "assistant", content: "Let me check." });
    expect(crBody.input[2]).toEqual({
      type: "function_call",
      call_id: "tool_call_1",
      name: "get_weather",
      arguments: JSON.stringify({ location: "Tokyo" })
    });
    expect(crBody.input[3]).toEqual({
      type: "function_call_output",
      call_id: "tool_call_1",
      output: "Sunny, 22C"
    });
    expect(crBody.input[4]).toEqual({ role: "user", content: "And in Kyoto?" });

    expect(crBody.tools).toHaveLength(1);
    expect(crBody.tools[0].name).toBe("get_weather");
    expect(crBody.tools[0].type).toBe("function");
  });

  it("handles image inputs in user turns", () => {
    const body = {
      conversationState: {
        currentMessage: {
          userInputMessage: {
            content: "Describe this image",
            modelId: "claude-opus-5.5",
            images: [
              {
                format: "jpeg",
                source: { bytes: "aGVsbG8=" }
              }
            ]
          }
        }
      }
    };

    const crBody = buildKiroCreateResponseBody({ body, model: "claude-opus-5.5" });
    expect(crBody.input).toHaveLength(1);
    expect(crBody.input[0].role).toBe("user");
    expect(crBody.input[0].content).toEqual([
      { type: "input_text", text: "Describe this image" },
      { type: "input_image", image_url: "data:image/jpeg;base64,aGVsbG8=" }
    ]);
  });

  it("transforms CreateResponse SSE stream to OpenAI format", async () => {
    const sseLines = [
      'data: {"type":"response.output_text.delta","delta":"Hello "}',
      'data: {"type":"response.reasoning_text.delta","delta":"thinking"}',
      'data: {"type":"response.output_text.delta","delta":"world!"}',
      'data: {"type":"response.completed","response":{"status":"completed","usage":{"input_tokens":10,"output_tokens":25}}}'
    ];

    const encoder = new TextEncoder();
    const readable = new ReadableStream({
      start(controller) {
        for (const line of sseLines) {
          controller.enqueue(encoder.encode(line + "\n\n"));
        }
        controller.close();
      }
    });

    const transformedStream = transformCreateResponseStreamToSSE(readable, "claude-opus-5.5");
    const reader = transformedStream.getReader();
    const decoder = new TextDecoder();
    let result = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      result += decoder.decode(value);
    }

    expect(result).toContain("Hello ");
    expect(result).toContain("world!");
    expect(result).toContain("thinking");
    expect(result).toContain('"finish_reason":"stop"');
    expect(result).toContain('"prompt_tokens":10');
    expect(result).toContain('"completion_tokens":25');
    expect(result).toContain("data: [DONE]");
  });

  it("transforms tool calls in CreateResponse stream", async () => {
    const sseLines = [
      'data: {"type":"response.output_item.added","item":{"type":"function_call","call_id":"call_123","name":"lookup"}}',
      'data: {"type":"response.function_call_arguments.delta","delta":"{\\"query\\": \\"test\\"}"}',
      'data: {"type":"response.output_item.done","item":{"type":"function_call","call_id":"call_123"}}',
      'data: {"type":"response.completed","response":{"status":"completed"}}'
    ];

    const encoder = new TextEncoder();
    const readable = new ReadableStream({
      start(controller) {
        for (const line of sseLines) {
          controller.enqueue(encoder.encode(line + "\n\n"));
        }
        controller.close();
      }
    });

    const transformedStream = transformCreateResponseStreamToSSE(readable, "claude-opus-5.5");
    const reader = transformedStream.getReader();
    const decoder = new TextDecoder();
    let result = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      result += decoder.decode(value);
    }

    expect(result).toContain("call_123");
    expect(result).toContain("lookup");
    expect(result).toContain('"finish_reason":"tool_calls"');
  });

  it("keeps parallel tool-call argument deltas on their own index", async () => {
    const events = [
      { type: "response.output_item.added", output_index: 0, item: { type: "function_call", id: "fc_a", call_id: "call_a", name: "read" } },
      { type: "response.output_item.added", output_index: 1, item: { type: "function_call", id: "fc_b", call_id: "call_b", name: "grep" } },
      { type: "response.function_call_arguments.delta", output_index: 0, item_id: "fc_a", delta: "{\"path\":\"a\"}" },
      { type: "response.function_call_arguments.delta", output_index: 1, item_id: "fc_b", delta: "{\"q\":\"b\"}" },
      { type: "response.output_item.done", output_index: 0, item: { type: "function_call", id: "fc_a", call_id: "call_a" } },
      { type: "response.output_item.done", output_index: 1, item: { type: "function_call", id: "fc_b", call_id: "call_b" } },
      { type: "response.completed", response: { status: "completed" } },
    ];
    const encoder = new TextEncoder();
    const readable = new ReadableStream({
      start(controller) {
        for (const event of events) controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        controller.close();
      },
    });
    const text = await new Response(transformCreateResponseStreamToSSE(readable, "claude-opus-5.5")).text();
    const args = {};
    for (const line of text.split("\n")) {
      if (!line.startsWith("data: {")) continue;
      for (const call of JSON.parse(line.slice(6)).choices?.[0]?.delta?.tool_calls || []) {
        if (call.function?.arguments) args[call.index] = (args[call.index] || "") + call.function.arguments;
      }
    }
    expect(args).toEqual({ 0: "{\"path\":\"a\"}", 1: "{\"q\":\"b\"}" });
  });

  describe("KiroExecutor fallback execution", () => {
    afterEach(() => vi.restoreAllMocks());

    it("falls back to CreateResponse when generateAssistantResponse returns 429 USER_REQUEST_RATE_EXCEEDED", async () => {
      const executor = new KiroExecutor();
      const mockCrResult = {
        response: new Response("data: [DONE]\n\n", { status: 200 }),
        url: "https://runtime.us-east-1.kiro.dev/v1/responses",
        headers: {},
        transformedBody: {}
      };
      const crSpy = vi.spyOn(executor, "executeCreateResponse").mockResolvedValue(mockCrResult);

      const legacy429 = new Response(
        JSON.stringify({ message: "Too many requests", reason: "USER_REQUEST_RATE_EXCEEDED" }),
        { status: 429 }
      );
      vi.spyOn(Object.getPrototypeOf(KiroExecutor.prototype), "execute").mockResolvedValue({
        response: legacy429,
        url: "https://runtime.us-east-1.kiro.dev/generateAssistantResponse",
        headers: {},
        transformedBody: {}
      });

      const args = {
        model: "kr/claude-opus-5.5",
        body: {
          conversationState: {
            currentMessage: { userInputMessage: { content: "hi" } }
          }
        },
        credentials: { accessToken: "tok" }
      };

      const res = await executor.execute(args);
      expect(crSpy).toHaveBeenCalledWith(args);
      expect(res).toBe(mockCrResult);
    });

    it.each([
      [200, 200, false],
      [400, 200, true],
    ])("always mode: CreateResponse %p -> client sees %p (legacy lane used: %p)", async (crStatus, finalStatus, legacyUsed) => {
      const executor = new KiroExecutor();
      vi.spyOn(executor, "executeCreateResponse").mockResolvedValue({
        response: new Response("{}", { status: crStatus }),
        url: "https://runtime.us-east-1.kiro.dev/v1/responses",
        headers: {},
        transformedBody: {},
      });
      const legacySpy = vi.spyOn(Object.getPrototypeOf(KiroExecutor.prototype), "execute").mockResolvedValue({
        response: new Response("data: [DONE]\n\n", { status: 200 }),
        url: "https://runtime.us-east-1.kiro.dev/generateAssistantResponse",
        headers: {},
        transformedBody: {},
      });
      vi.spyOn(executor, "attachIntegrityGate").mockImplementation(() => {});
      const oldEnv = process.env.LITEROUTER_KIRO_CREATE_RESPONSE;
      process.env.LITEROUTER_KIRO_CREATE_RESPONSE = "always";
      try {
        const res = await executor.execute({
          model: "kr/claude-opus-5.5",
          body: { conversationState: { currentMessage: { userInputMessage: { content: "hi" } } } },
          credentials: { accessToken: "tok" },
        });
        expect(res.response.status).toBe(finalStatus);
        expect(legacySpy.mock.calls.length > 0).toBe(legacyUsed);
      } finally {
        if (oldEnv === undefined) delete process.env.LITEROUTER_KIRO_CREATE_RESPONSE;
        else process.env.LITEROUTER_KIRO_CREATE_RESPONSE = oldEnv;
      }
    });

    it("skips fallback when LITEROUTER_KIRO_CREATE_RESPONSE is off", async () => {
      const executor = new KiroExecutor();
      const crSpy = vi.spyOn(executor, "executeCreateResponse");

      const legacy429 = new Response(
        JSON.stringify({ message: "Too many requests", reason: "USER_REQUEST_RATE_EXCEEDED" }),
        { status: 429 }
      );
      vi.spyOn(Object.getPrototypeOf(KiroExecutor.prototype), "execute").mockResolvedValue({
        response: legacy429,
        url: "https://runtime.us-east-1.kiro.dev/generateAssistantResponse",
        headers: {},
        transformedBody: {}
      });

      const oldEnv = process.env.LITEROUTER_KIRO_CREATE_RESPONSE;
      process.env.LITEROUTER_KIRO_CREATE_RESPONSE = "off";

      try {
        const args = {
          model: "kr/claude-opus-5.5",
          body: {
            conversationState: {
              currentMessage: { userInputMessage: { content: "hi" } }
            }
          },
          credentials: { accessToken: "tok" }
        };

        const res = await executor.execute(args);
        expect(crSpy).not.toHaveBeenCalled();
        expect(res.response.status).toBe(429);
      } finally {
        if (oldEnv === undefined) delete process.env.LITEROUTER_KIRO_CREATE_RESPONSE;
        else process.env.LITEROUTER_KIRO_CREATE_RESPONSE = oldEnv;
      }
    });

    it("does not trigger CreateResponse when legacy response returns 200", async () => {
      const executor = new KiroExecutor();
      const crSpy = vi.spyOn(executor, "executeCreateResponse");

      const legacy200 = new Response(new Uint8Array(0), { status: 200 });
      vi.spyOn(Object.getPrototypeOf(KiroExecutor.prototype), "execute").mockResolvedValue({
        response: legacy200,
        url: "https://runtime.us-east-1.kiro.dev/generateAssistantResponse",
        headers: {},
        transformedBody: {}
      });
      vi.spyOn(executor, "attachIntegrityGate").mockImplementation(() => {});

      const args = {
        model: "kr/claude-opus-5.5",
        body: {
          conversationState: {
            currentMessage: { userInputMessage: { content: "hi" } }
          }
        },
        credentials: { accessToken: "tok" }
      };

      const res = await executor.execute(args);
      expect(crSpy).not.toHaveBeenCalled();
      expect(res.response.status).toBe(200);
    });
  });
});

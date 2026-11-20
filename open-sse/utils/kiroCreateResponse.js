
import { KIRO_RUNTIME_REGIONS } from "../config/kiroConstants.js";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export const KIRO_RESPONSES_DEFAULT_HOST = "https://runtime.us-east-1.kiro.dev/v1/responses";
export const KIRO_IDE_ACP_USER_AGENT = "KiroIDE-1.4.154-KiroIDE/acp-client";

export function buildKiroCreateResponseUrl(region = "us-east-1") {
  const requested = typeof region === "string" ? region.trim() : "";
  const reg = KIRO_RUNTIME_REGIONS.has(requested)
    ? requested
    : "us-east-1";
  return `https://runtime.${reg}.kiro.dev/v1/responses`;
}

export function buildKiroCreateResponseBody({ body, credentials, model }) {
  const cs = body?.conversationState;
  const current = cs?.currentMessage;
  const history = cs?.history || [];
  const turns = [...history, current].filter(Boolean);

  const input = [];
  for (const turn of turns) {
    const u = turn.userInputMessage;
    if (u) {
      const toolResults = u.userInputMessageContext?.toolResults || [];
      for (const r of toolResults) {
        input.push({
          type: "function_call_output",
          call_id: r.toolUseId,
          output: (r.content || []).map((p) => p.text ?? "").join("\n")
        });
      }

      const images = (u.images || [])
        .filter((img) => img.source?.bytes)
        .map((img) => ({
          type: "input_image",
          image_url: `data:image/${String(img.format || "png").toLowerCase()};base64,${img.source.bytes}`
        }));

      const text = typeof u.content === "string" ? u.content : "";
      if (images.length > 0) {
        input.push({
          role: "user",
          content: [...(text ? [{ type: "input_text", text }] : []), ...images]
        });
      } else if (text) {
        input.push({ role: "user", content: text });
      }
    }

    const m = turn.assistantResponseMessage;
    if (m) {
      if (typeof m.content === "string" && m.content) {
        input.push({ role: "assistant", content: m.content });
      }
      const toolUses = m.toolUses || [];
      for (const c of toolUses) {
        input.push({
          type: "function_call",
          call_id: c.toolUseId,
          name: c.name,
          arguments: typeof c.input === "string" ? c.input : JSON.stringify(c.input ?? {})
        });
      }
    }
  }

  const tools = [];
  const rawTools = current?.userInputMessage?.userInputMessageContext?.tools || [];
  for (const t of rawTools) {
    const s = t.toolSpecification;
    if (s?.name) {
      tools.push({
        type: "function",
        name: s.name,
        description: s.description || "",
        parameters: s.inputSchema?.json || {}
      });
    }
  }

  let reasoning;
  const f = body?.additionalModelRequestFields;
  if (f && typeof f === "object") {
    const str = (v) => (typeof v === "string" && v ? v : undefined);
    const type = str(f.thinking?.type);
    const effort = str(f.output_config?.effort) ?? str(f.reasoning?.effort);
    const summary = str(f.thinking?.display);
    if (type || effort || summary) {
      reasoning = {
        ...(type ? { type } : {}),
        ...(effort ? { effort } : {}),
        ...(summary ? { summary } : {})
      };
    }
  }

  const profileArn = body?.profileArn || credentials?.providerSpecificData?.profileArn || undefined;
  const conversationId = cs?.conversationId;
  const metadata = {
    "kiro:agent_mode": "vibe",
    ...(conversationId ? { "kiro:conversation_id": conversationId } : {})
  };

  const resolvedModel = current?.userInputMessage?.modelId || body?._kiroUpstreamModel || model;

  return {
    model: resolvedModel,
    input,
    ...(tools.length ? { tools } : {}),
    stream: true,
    origin: current?.userInputMessage?.origin || "AI_EDITOR",
    ...(profileArn ? { profileArn } : {}),
    metadata,
    ...(reasoning ? { reasoning } : {})
  };
}

export function buildKiroCreateResponseHeaders({ credentials, body }) {
  const token = credentials?.accessToken || credentials?.apiKey || "";
  const authMethod = credentials?.providerSpecificData?.authMethod;
  const profileArn = credentials?.providerSpecificData?.profileArn || body?.profileArn;

  const headers = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${token}`,
    "x-amzn-kiro-origin": "AI_EDITOR",
    "x-amzn-codewhisperer-optout": "true",
    "User-Agent": KIRO_IDE_ACP_USER_AGENT,
    "x-amzn-kiro-attempt": "1;max=3"
  };

  if (profileArn) {
    headers["x-amzn-kiro-profile"] = profileArn;
  }

  if (authMethod === "api_key" && (credentials?.apiKey || credentials?.accessToken)) {
    headers["TokenType"] = "API_KEY";
  } else if (authMethod === "external_idp") {
    headers["TokenType"] = "EXTERNAL_IDP";
  }

  if (credentials?.accessToken) {
    headers["x-amz-sso-bearer"] = credentials.accessToken;
  }

  return headers;
}

export function transformCreateResponseStreamToSSE(responseStream, model) {
  const id = `chatcmpl-cr-${Date.now()}`;
  const created = Math.floor(Date.now() / 1000);

  const sseChunk = (delta, finish = null, usage = null) => {
    const chunkObj = {
      id,
      object: "chat.completion.chunk",
      created,
      model,
      choices: [{ index: 0, delta, finish_reason: finish ?? null }],
      ...(usage ? { usage } : {})
    };
    return encoder.encode(`data: ${JSON.stringify(chunkObj)}\n\n`);
  };

  let toolIdx = -1;
  let curCallId = null;
  const openCalls = new Set();
  const arguedCalls = new Set();
  let hasToolCalls = false;
  let emittedRole = false;

  return new ReadableStream({
    async start(controller) {
      const reader = responseStream.getReader();
      let buffer = "";

      const processEvent = (event) => {
        const type = event?.type ?? "";

        if (type === "response.output_text.delta" && typeof event.delta === "string") {
          controller.enqueue(
            sseChunk(emittedRole ? { content: event.delta } : { role: "assistant", content: event.delta })
          );
          emittedRole = true;
        }

        else if (
          (type === "response.reasoning_text.delta" || type === "response.reasoning.delta") &&
          typeof event.delta === "string"
        ) {
          controller.enqueue(
            sseChunk(
              emittedRole
                ? { reasoning_content: event.delta }
                : { role: "assistant", reasoning_content: event.delta }
            )
          );
          emittedRole = true;
        }

        else if (type === "response.refusal.delta" && typeof event.delta === "string") {
          controller.enqueue(
            sseChunk(emittedRole ? { content: event.delta } : { role: "assistant", content: event.delta })
          );
          emittedRole = true;
        } else if (type === "response.refusal.done" && typeof event.refusal === "string" && event.refusal) {
          controller.enqueue(sseChunk({ content: event.refusal }));
        }

        else if (type === "response.output_item.added" && event.item?.type === "function_call") {
          curCallId = event.item.call_id ?? event.item.id ?? "";
          openCalls.add(curCallId);
          hasToolCalls = true;
          toolIdx++;
          controller.enqueue(
            sseChunk({
              tool_calls: [
                {
                  index: toolIdx,
                  id: curCallId,
                  type: "function",
                  function: { name: event.item.name || "", arguments: "" }
                }
              ]
            })
          );
          emittedRole = true;
        }

        else if (type === "response.function_call_arguments.delta" && typeof event.delta === "string") {
          if (curCallId) arguedCalls.add(curCallId);
          controller.enqueue(
            sseChunk({
              tool_calls: [{ index: toolIdx, function: { arguments: event.delta } }]
            })
          );
        }

        else if (type === "response.output_item.done" && event.item?.type === "function_call") {
          const callId = event.item.call_id ?? event.item.id ?? "";
          if (openCalls.has(callId)) {
            openCalls.delete(callId);
            if (!arguedCalls.delete(callId) && event.item.arguments) {
              controller.enqueue(
                sseChunk({
                  tool_calls: [{ index: toolIdx, function: { arguments: event.item.arguments } }]
                })
              );
            }
          }
        }

        else if (type === "response.completed" || type === "response.incomplete") {
          const res = event.response || {};
          const incomplete = type === "response.incomplete" || res.status === "incomplete";
          const stopReasonMap = {
            max_output_tokens: "length",
            content_filter: "content_filter",
            compaction_required_for_model_handoff: "length"
          };
          const finishReason =
            (incomplete && stopReasonMap[res.incomplete_details?.reason]) ||
            (hasToolCalls ? "tool_calls" : "stop");

          let usage;
          if (res.usage) {
            const inputTokens = res.usage.input_tokens || 0;
            const outputTokens = res.usage.output_tokens || 0;
            usage = {
              prompt_tokens: inputTokens,
              completion_tokens: outputTokens,
              total_tokens: inputTokens + outputTokens
            };
          }

          controller.enqueue(sseChunk({}, finishReason, usage));
        }

        else if (type === "error" || type === "response.failed") {
          const err = type === "error" ? event.error : event.response?.error;
          throw new Error(`CreateResponse stream failed: ${JSON.stringify(err ?? {})}`);
        }
      };

      try {
        while (true) {
          const { value, done } = await reader.read();
          buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = done ? "" : lines.pop() ?? "";

          for (let line of lines) {
            line = line.replace(/\r$/, "").trim();
            if (!line.startsWith("data:")) continue;
            const dataStr = line.slice(5).trim();
            if (!dataStr || dataStr === "[DONE]") continue;

            let parsed;
            try {
              parsed = JSON.parse(dataStr);
            } catch {
              continue;
            }
            processEvent(parsed);
          }

          if (done) break;
        }

        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      } catch (err) {
        try {
          controller.error(err);
        } catch {}
      }
    },
    cancel() {
      try {
        responseStream.cancel();
      } catch {}
    }
  });
}

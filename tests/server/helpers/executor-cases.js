import {
  anthropicSse,
  connectFrame,
  concatBytes,
  eventStreamFrame,
  eventStreamResponse,
  eventSse,
  geminiSse,
  ndjson,
  openaiChunks,
  openaiCompletion,
  protoString,
  responsesSse,
  sse,
} from "./executor-mock.js";

const PING = [{ role: "user", content: "ping" }];

export const chatBody = (model, stream = true) => ({ model, messages: PING.map((m) => ({ ...m })), stream });

const geminiBody = (model) => ({ model, request: { contents: [{ role: "user", parts: [{ text: "ping" }] }] } });

const bearer = (token) => ({ header: "authorization", pattern: new RegExp(`^Bearer ${token}$`) });

const pointAt = (path) => (executor, m) => {
  executor.buildUrl = () => `${m.url}${path}`;
};

const openaiSseAt = (path, text) => (m) => m.on("POST", path, () => sse(openaiChunks(text)));

const grpcTextFrame = (text) => connectFrame(protoString(1, protoString(1, text)));

const lengthDelimited = (fieldNum, ...parts) => protoString(fieldNum, concatBytes(parts));

export const cursorAgentFrames = (text) => concatBytes([
  connectFrame(lengthDelimited(1, protoString(1, protoString(1, text)))),
  connectFrame(lengthDelimited(1, protoString(14, new Uint8Array()))),
]);

export const cursorLegacyFrames = (text) => connectFrame(protoString(2, protoString(1, text)));

const zedEvent = (text) => ({ event: openaiChunks(text, "grok-4")[0] });

const zedModels = {
  models: [{ id: "grok-4", display_name: "Grok 4", provider: "x_ai", max_token_count: 1000, is_latest: true }],
  default_model: "grok-4",
};

export const cases = [
  {
    provider: "antigravity",
    wire: "gemini-sse",
    model: "gemini-3-flash",
    credentials: { accessToken: "ag-token", projectId: "proj-1" },
    body: geminiBody("gemini-3-flash"),
    path: "/antigravity/v1internal:streamGenerateContent?alt=sse",
    auth: bearer("ag-token"),
    prepare: pointAt("/antigravity/v1internal:streamGenerateContent?alt=sse"),
    mock: (m) => m.on("POST", "/antigravity/v1internal:streamGenerateContent", () => geminiSse("antigravity-ok")),
    expectText: "antigravity-ok",
  },
  {
    provider: "azure",
    wire: "openai-json",
    model: "gpt-4o",
    stream: false,
    credentials: (m) => ({ apiKey: "az-key", providerSpecificData: { azureEndpoint: `${m.url}/azure`, apiVersion: "2024-10-01-preview" } }),
    body: chatBody("gpt-4o", false),
    path: "/azure/openai/deployments/gpt-4o/chat/completions?api-version=2024-10-01-preview",
    auth: { header: "api-key", pattern: /^az-key$/ },
    mock: (m) => m.on("POST", "/azure/openai/deployments/gpt-4o/chat/completions", () => Response.json(openaiCompletion("azure-ok"))),
    decode: async (response) => JSON.stringify(await response.json()),
    expectText: "azure-ok",
  },
  {
    provider: "gemini-cli",
    wire: "gemini-sse",
    model: "gemini-2.5-pro",
    credentials: { accessToken: "gc-token", projectId: "proj-2" },
    body: geminiBody("gemini-2.5-pro"),
    path: "/gemini-cli/v1internal:streamGenerateContent?alt=sse",
    auth: bearer("gc-token"),
    prepare: pointAt("/gemini-cli/v1internal:streamGenerateContent?alt=sse"),
    mock: (m) => m.on("POST", "/gemini-cli/v1internal:streamGenerateContent", () => geminiSse("gemini-cli-ok")),
    expectText: "gemini-cli-ok",
  },
  {
    provider: "github",
    wire: "openai-sse",
    model: "gpt-4o",
    credentials: { copilotToken: "gh-copilot" },
    body: chatBody("gpt-4o"),
    path: "/github/chat/completions",
    auth: bearer("gh-copilot"),
    prepare: pointAt("/github/chat/completions"),
    mock: openaiSseAt("/github/chat/completions", "github-ok"),
    expectText: "github-ok",
  },
  {
    provider: "iflow",
    wire: "openai-sse",
    model: "qwen3-coder-plus",
    credentials: { apiKey: "if-key" },
    body: chatBody("qwen3-coder-plus"),
    path: "/iflow/v1/chat/completions",
    auth: bearer("if-key"),
    extraHeaders: { "x-iflow-signature": /^[0-9a-f]{64}$/ },
    prepare: pointAt("/iflow/v1/chat/completions"),
    mock: openaiSseAt("/iflow/v1/chat/completions", "iflow-ok"),
    expectText: "iflow-ok",
  },
  {
    provider: "qoder",
    wire: "openai-sse",
    model: "auto",
    credentials: { accessToken: "dt-test-token", providerSpecificData: { userId: "u-1", machineId: "machine-1" } },
    body: { model: "auto", messages: PING.map((m) => ({ ...m })), max_tokens: 32, stream: true },
    path: "/qoder/algo/chat",
    auth: { header: "authorization", pattern: /^Bearer COSY\./ },
    prepare: (executor, m) => {
      executor.buildUrl = () => `${m.url}/qoder/algo/chat`;
    },
    mock: (m) => m.on("POST", "/qoder/algo/chat", () => new Response(
      `data: ${JSON.stringify({ statusCodeValue: 200, body: JSON.stringify({ choices: [{ delta: { content: "qoder-ok" } }] }) })}\n\ndata: ${JSON.stringify({ statusCodeValue: 200, body: "[DONE]" })}\n\n`,
      { headers: { "content-type": "text/event-stream" } },
    )),
    expectText: "qoder-ok",
  },
  {
    provider: "kiro",
    wire: "eventstream",
    model: "claude-sonnet-4.5",
    credentials: { accessToken: "kiro-token", providerSpecificData: {} },
    body: { conversationState: { currentMessage: { userInputMessage: { content: "ping", modelId: "m" } } } },
    path: "/kiro/generateAssistantResponse",
    auth: bearer("kiro-token"),
    extraHeaders: { "x-amz-sso-bearer": /^kiro-token$/ },
    prepare: pointAt("/kiro/generateAssistantResponse"),
    mock: (m) => m.on("POST", "/kiro/generateAssistantResponse", () => eventStreamResponse([
      eventStreamFrame("assistantResponseEvent", { content: "kiro-ok" }),
      eventStreamFrame("meteringEvent", { usage: 2, unit: "credit" }),
    ])),
    expectText: "kiro-ok",
  },
  {
    provider: "kimchi",
    wire: "openai-sse",
    model: "kimi-k2",
    credentials: { apiKey: "kimchi-key" },
    body: chatBody("kimi-k2"),
    path: "/kimchi/v1/chat/completions",
    auth: bearer("kimchi-key"),
    prepare: pointAt("/kimchi/v1/chat/completions"),
    mock: openaiSseAt("/kimchi/v1/chat/completions", "kimchi-ok"),
    expectText: "kimchi-ok",
  },
  {
    provider: "codex",
    wire: "responses-sse",
    model: "gpt-5-codex",
    credentials: { accessToken: "codex-token", providerSpecificData: { chatgptAccountId: "acct-1" } },
    body: { model: "gpt-5-codex", stream: true, input: [{ type: "message", role: "user", content: [{ type: "input_text", text: "ping" }] }] },
    path: "/codex/responses",
    auth: bearer("codex-token"),
    extraHeaders: { "chatgpt-account-id": /^acct-1$/ },
    prepare: pointAt("/codex/responses"),
    mock: (m) => m.on("POST", "/codex/responses", () => responsesSse("codex-ok")),
    expectText: "codex-ok",
  },
  {
    provider: "cursor",
    wire: "h2-proto",
    model: "composer-1",
    credentials: { accessToken: "cursor-token", providerSpecificData: { machineId: "machine-1" } },
    body: chatBody("composer-1"),
    path: "/agent.v1.AgentService/Run",
    transport: "h2",
    auth: bearer("cursor-token"),
    prepare: (executor, m, env) => {
      const original = env.PROVIDER_OAUTH.cursor.agentEndpoint;
      env.PROVIDER_OAUTH.cursor.agentEndpoint = m.h2.url;
      return () => {
        env.PROVIDER_OAUTH.cursor.agentEndpoint = original;
      };
    },
    mock: (m) => m.h2.handle((stream) => {
      stream.respond({ ":status": 200, "content-type": "application/connect+proto" });
      stream.write(Buffer.from(cursorAgentFrames("cursor-ok")));
      stream.end();
    }),
    expectText: "cursor-ok",
  },
  {
    provider: "vertex",
    wire: "gemini-sse",
    model: "gemini-2.5-flash",
    credentials: { apiKey: "vertex-key" },
    body: { contents: [{ role: "user", parts: [{ text: "ping" }] }] },
    path: "/vertex/models/gemini-2.5-flash:streamGenerateContent?alt=sse",
    auth: { header: "x-goog-api-key", pattern: /^vertex-key$/ },
    prepare: pointAt("/vertex/models/gemini-2.5-flash:streamGenerateContent?alt=sse"),
    mock: (m) => m.on("POST", "/vertex/models/gemini-2.5-flash:streamGenerateContent", () => geminiSse("vertex-ok")),
    expectText: "vertex-ok",
  },
  {
    provider: "vertex-partner",
    wire: "openai-sse",
    model: "meta/llama-4",
    credentials: { apiKey: "vertex-partner-key", providerSpecificData: { projectId: "proj-3" } },
    body: chatBody("meta/llama-4"),
    path: "/vertex-partner/chat/completions",
    auth: { header: "x-goog-api-key", pattern: /^vertex-partner-key$/ },
    prepare: pointAt("/vertex-partner/chat/completions"),
    mock: openaiSseAt("/vertex-partner/chat/completions", "vertex-partner-ok"),
    expectText: "vertex-partner-ok",
  },
  {
    provider: "opencode",
    wire: "openai-sse",
    model: "big-pickle",
    credentials: {},
    body: chatBody("big-pickle"),
    path: "/opencode/zen/v1/chat/completions",
    auth: bearer("public"),
    extraHeaders: { "x-opencode-session": /.+/, "x-opencode-request": /.+/ },
    prepare: pointAt("/opencode/zen/v1/chat/completions"),
    mock: openaiSseAt("/opencode/zen/v1/chat/completions", "opencode-ok"),
    expectText: "opencode-ok",
  },
  {
    provider: "opencode-go",
    wire: "openai-sse",
    model: "glm-4.6",
    credentials: { apiKey: "ocg-key" },
    body: chatBody("glm-4.6"),
    path: "/opencode-go/v1/chat/completions",
    auth: bearer("ocg-key"),
    prepare: pointAt("/opencode-go/v1/chat/completions"),
    mock: openaiSseAt("/opencode-go/v1/chat/completions", "opencode-go-ok"),
    expectText: "opencode-go-ok",
  },
  {
    provider: "grok-web",
    wire: "web-sse",
    model: "grok-4",
    credentials: { apiKey: "sso=grok-cookie" },
    body: chatBody("grok-4"),
    path: "/grok-web/rest/app-chat/conversations/new",
    auth: { header: "cookie", pattern: /^sso=grok-cookie$/ },
    extraHeaders: { "accept-encoding": /zstd/ },
    redirect: { provider: "grok-web", to: "/grok-web/rest/app-chat/conversations/new" },
    mock: (m) => m.on("POST", "/grok-web/rest/app-chat/conversations/new", () => new Response(
      Bun.zstdCompressSync(Buffer.from(
        `${JSON.stringify({ result: { response: { token: "grok-web-ok" } } })}\n`,
        "utf8",
      )),
      { headers: { "content-type": "application/json", "content-encoding": "zstd" } },
    )),
    expectText: "grok-web-ok",
  },
  {
    provider: "grok-cli",
    wire: "responses-sse",
    model: "grok-build",
    credentials: { accessToken: "gcli-token", connectionId: "conn-1" },
    body: { model: "grok-build", stream: true, input: [{ type: "message", role: "user", content: "ping" }] },
    path: "/grok-cli/responses",
    auth: bearer("gcli-token"),
    extraHeaders: { "x-grok-client-identifier": /.+/ },
    prepare: pointAt("/grok-cli/responses"),
    mock: (m) => m.on("POST", "/grok-cli/responses", () => responsesSse("grok-cli-ok")),
    expectText: "grok-cli-ok",
  },
  {
    provider: "perplexity-web",
    wire: "web-sse",
    model: "pplx-auto",
    credentials: { accessToken: "pplx-token" },
    body: chatBody("pplx-auto"),
    path: "/perplexity-web/rest/sse/perplexity_ask",
    auth: bearer("pplx-token"),
    redirect: { provider: "perplexity-web", to: "/perplexity-web/rest/sse/perplexity_ask" },
    mock: (m) => m.on("POST", "/perplexity-web/rest/sse/perplexity_ask", () => new Response(
      `event: message\ndata: ${JSON.stringify({ backend_uuid: "b-1", blocks: [{ intended_usage: "ask_text_0_markdown", markdown_block: { progress: "IN_PROGRESS", chunks: ["perplexity-ok"] } }], final: true, status: "COMPLETED" })}\n\n`,
      { headers: { "content-type": "text/event-stream" } },
    )),
    expectText: "perplexity-ok",
  },
  {
    provider: "ollama-local",
    wire: "ndjson",
    model: "llama3",
    credentials: (m) => ({ providerSpecificData: { baseUrl: `${m.url}/ollama` } }),
    body: chatBody("llama3"),
    path: "/ollama/api/chat",
    auth: null,
    mock: (m) => m.on("POST", "/ollama/api/chat", () => ndjson([
      { model: "llama3", message: { role: "assistant", content: "ollama-" }, done: false },
      { model: "llama3", message: { role: "assistant", content: "ok" }, done: true },
    ])),
    expectText: "ollama-",
  },
  {
    provider: "commandcode",
    wire: "ndjson",
    model: "claude-sonnet-4-5",
    credentials: { apiKey: "cc-key" },
    body: chatBody("claude-sonnet-4-5"),
    path: "/commandcode/alpha/generate",
    auth: bearer("cc-key"),
    prepare: pointAt("/commandcode/alpha/generate"),
    mock: (m) => m.on("POST", "/commandcode/alpha/generate", () => ndjson([
      { type: "text-delta", text: "commandcode-ok" },
      { type: "finish", finishReason: "stop", totalUsage: { inputTokens: 3, outputTokens: 2 } },
    ])),
    expectText: "commandcode-ok",
  },
  {
    provider: "xiaomi-tokenplan",
    wire: "openai-sse",
    model: "mimo-v2-pro",
    credentials: { apiKey: "tp-key" },
    body: chatBody("mimo-v2-pro"),
    path: "/xiaomi-tokenplan/chat/completions",
    auth: bearer("tp-key"),
    prepare: pointAt("/xiaomi-tokenplan/chat/completions"),
    mock: openaiSseAt("/xiaomi-tokenplan/chat/completions", "tokenplan-ok"),
    expectText: "tokenplan-ok",
  },
  {
    provider: "xiaomi-mimo",
    wire: "openai-sse",
    model: "mimo-v2-flash",
    credentials: { apiKey: "mimo-key" },
    body: chatBody("mimo-v2-flash"),
    path: "/xiaomi-mimo/v1/chat/completions",
    auth: bearer("mimo-key"),
    prepare: pointAt("/xiaomi-mimo/v1/chat/completions"),
    mock: openaiSseAt("/xiaomi-mimo/v1/chat/completions", "mimo-ok"),
    expectText: "mimo-ok",
  },
  {
    provider: "mimo-free",
    wire: "openai-sse",
    model: "mimo-v2-flash",
    credentials: {},
    body: chatBody("mimo-v2-flash"),
    path: "/mimo-free/openai/chat",
    auth: bearer("mimo-jwt"),
    extraHeaders: { "x-mimo-source": /^mimocode-cli-free$/ },
    redirect: { bootstrap: true, to: "/mimo-free/bootstrap" },
    prepare: pointAt("/mimo-free/openai/chat"),
    mock: (m) => {
      m.on("POST", "/mimo-free/bootstrap", () => Response.json({ jwt: "mimo-jwt" }));
      m.on("POST", "/mimo-free/openai/chat", () => sse(openaiChunks("mimo-free-ok")));
    },
    expectText: "mimo-free-ok",
  },
  {
    provider: "codebuddy-cn",
    wire: "openai-sse",
    model: "glm-4.6",
    credentials: { apiKey: "cbcn-key" },
    body: chatBody("glm-4.6"),
    path: "/codebuddy-cn/chat/completions",
    auth: bearer("cbcn-key"),
    extraHeaders: { "x-request-id": /.+/ },
    prepare: pointAt("/codebuddy-cn/chat/completions"),
    mock: openaiSseAt("/codebuddy-cn/chat/completions", "codebuddy-cn-ok"),
    expectText: "codebuddy-cn-ok",
  },
  {
    provider: "codebuddy-intl",
    wire: "openai-sse",
    model: "glm-4.6",
    credentials: { apiKey: "cbintl-key" },
    body: chatBody("glm-4.6"),
    path: "/codebuddy-intl/chat/completions",
    auth: bearer("cbintl-key"),
    extraHeaders: { "x-request-id": /.+/ },
    prepare: pointAt("/codebuddy-intl/chat/completions"),
    mock: openaiSseAt("/codebuddy-intl/chat/completions", "codebuddy-intl-ok"),
    expectText: "codebuddy-intl-ok",
  },
  {
    provider: "trae",
    wire: "web-sse",
    model: "gpt-4o",
    credentials: { accessToken: "trae-jwt", providerSpecificData: {} },
    body: chatBody("gpt-4o"),
    path: "/trae/chat_sessions",
    auth: { header: "authorization", pattern: /^Cloud-IDE-JWT trae-jwt$/ },
    prepare: (executor, m) => {
      executor.base = () => `${m.url}/trae`;
    },
    mock: (m) => {
      m.on("POST", "/trae/chat_sessions", () => Response.json({ code: 0, data: { chat_session_id: "sess-1", message_id: "msg-1" } }));
      m.on("GET", "/trae/chat_sessions/sess-1/events", () => eventSse([
        ["plan_item", { id: "p1", thought: "trae-ok" }],
        ["token_usage", { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 }],
        ["done", {}],
      ]));
    },
    expectText: "trae-ok",
  },
  {
    provider: "zed",
    wire: "ndjson",
    model: "grok-4",
    credentials: { accessToken: "zed-access", providerSpecificData: { userId: "7", organizationId: "org-1" } },
    body: chatBody("grok-4"),
    path: "/zed/completions",
    auth: bearer("zed-llm-token"),
    prepare: (executor, m) => {
      executor.config = { llmBaseUrl: `${m.url}/zed`, cloudBaseUrl: `${m.url}/zed` };
    },
    mock: (m) => {
      m.on("POST", "/zed/client/llm_tokens", () => Response.json({ token: "zed-llm-token" }));
      m.on("GET", "/zed/models", () => Response.json(zedModels));
      m.on("POST", "/zed/completions", () => ndjson([zedEvent("zed-ok"), { status: "stream_ended" }]));
    },
    expectText: "zed-ok",
  },
  {
    provider: "windsurf",
    wire: "grpc-web",
    model: "swe-1.5",
    credentials: { accessToken: "ws-token" },
    body: chatBody("swe-1.5"),
    path: "/windsurf/GetChatMessage",
    auth: bearer("ws-token"),
    prepare: pointAt("/windsurf/GetChatMessage"),
    mock: (m) => m.on("POST", "/windsurf/GetChatMessage", () => new Response(concatBytes([grpcTextFrame("windsurf-ok")]), {
      headers: { "content-type": "application/grpc-web+proto" },
    })),
    expectText: "windsurf-ok",
  },
  {
    provider: "devin-cli",
    wire: "ndjson",
    model: "swe-1.6-fast",
    credentials: {},
    body: chatBody("swe-1.6-fast"),
    path: null,
    transport: "stdio",
    auth: null,
    expectText: "devin-cli-ok",
  },
  {
    provider: "default",
    wire: "openai-json",
    executorKey: "openai",
    model: "gpt-4o-mini",
    stream: false,
    credentials: { apiKey: "sk-default" },
    body: chatBody("gpt-4o-mini", false),
    path: "/default/v1/chat/completions",
    auth: bearer("sk-default"),
    prepare: pointAt("/default/v1/chat/completions"),
    mock: (m) => m.on("POST", "/default/v1/chat/completions", () => new Response(
      Bun.zstdCompressSync(Buffer.from(JSON.stringify(openaiCompletion("default-ok")), "utf8")),
      { headers: { "content-type": "application/json", "content-encoding": "zstd" } },
    )),
    decode: async (response) => JSON.stringify(await response.json()),
    expectText: "default-ok",
  },
];

export const anthropicCompatibleCase = {
  provider: "anthropic-compatible-smoke",
  wire: "anthropic",
  model: "claude-sonnet-4-5",
  credentials: (m) => ({ apiKey: "ant-key", providerSpecificData: { baseUrl: `${m.url}/anthropic` } }),
  body: { model: "claude-sonnet-4-5", max_tokens: 16, stream: true, messages: PING.map((msg) => ({ ...msg })) },
  path: "/anthropic/messages",
  auth: { header: "x-api-key", pattern: /^ant-key$/ },
  mock: (m) => m.on("POST", "/anthropic/messages", () => anthropicSse("anthropic-ok")),
  expectText: "anthropic-ok",
};

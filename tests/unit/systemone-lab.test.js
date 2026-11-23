import { describe, expect, it } from "bun:test";
import { vi } from "#test/vi";
import {
  TEMPLATES,
  addAsset,
  blankForm,
  visibleKeyError,
  blankQuestion,
  buildBody,
  buildCurl,
  errorFieldsFromResponse,
  errorText,
  formFromBody,
  insertPlaceholder,
  requestHeaders,
  validateKey,
} from "../../src/web/pages/dashboard/systemone/lib/requestBuilder.js";

const mocks = vi.hoisted(() => ({
  getSettings: vi.fn().mockResolvedValue({ requireApiKey: false }),
  getProviderNodes: vi.fn().mockResolvedValue([]),
  getProviderNodeById: vi.fn().mockResolvedValue(null),
  getProviderCredentials: vi.fn(),
  markAccountUnavailable: vi.fn(),
  clearAccountError: vi.fn(),
  extractApiKey: vi.fn().mockReturnValue(null),
  isValidApiKey: vi.fn(),
  proxyAwareFetch: vi.fn(),
  saveUsageStats: vi.fn(),
  trackPendingRequest: vi.fn(),
}));

vi.mock("@/lib/db/index.js", async () => ({ ...(await import("@/lib/db/index.js?actual")), getSettings: mocks.getSettings, getProviderNodes: mocks.getProviderNodes, getProviderNodeById: mocks.getProviderNodeById }));
vi.mock("@/sse/services/auth.js", () => ({
  getProviderCredentials: mocks.getProviderCredentials,
  markAccountUnavailable: mocks.markAccountUnavailable,
  clearAccountError: mocks.clearAccountError,
  extractApiKey: mocks.extractApiKey,
  isValidApiKey: mocks.isValidApiKey,
}));
vi.mock("open-sse/utils/proxyFetch.js", () => ({ proxyAwareFetch: mocks.proxyAwareFetch }));
vi.mock("open-sse/handlers/chatCore/requestDetail.js", async () => {
  const actual = await import("open-sse/handlers/chatCore/requestDetail.js?actual");
  return { ...actual, saveUsageStats: mocks.saveUsageStats };
});
vi.mock("@/lib/usageDb.js", () => ({
  trackPendingRequest: mocks.trackPendingRequest,
  statsEmitter: {},
  getActiveRequests: vi.fn(),
  saveRequestUsage: vi.fn(),
  flushUsageQueue: vi.fn(),
  getUsageStats: vi.fn(),
  getChartData: vi.fn(),
  getRecentLogs: vi.fn(),
  saveRequestDetail: vi.fn(),
  getRequestDetails: vi.fn(),
  getRequestDetailById: vi.fn(),
  flushRequestDetails: vi.fn(),
  ensureRequestDetailShutdownHandler: vi.fn()
}));

const { handleSystemOne, FORWARDED_REQUEST_HEADERS, pickForwardedHeaders } = await import("@/sse/handlers/systemOne.js");

function textForm(state) {
  const form = blankForm();
  form.stateText = state;
  const question = blankQuestion("noul");
  question.key = "refund_requested";
  question.instructions = "Does the customer request a refund?";
  form.questions = [question];
  return form;
}

describe("System One request builder", () => {
  it("turns a text-mode form into a TypeSafe body", () => {
    const { body, errors } = buildBody(textForm("charge twice"), "typesafe/jev-latest");
    expect(errors).toEqual([]);
    expect(body).toEqual({
      state: "charge twice",
      questions: { refund_requested: { type: "noul", instructions: "Does the customer request a refund?" } },
      model: "typesafe/jev-latest",
    });
  });

  it("sends field mode as an object and omits blank rows", () => {
    const form = textForm("");
    form.stateMode = "fields";
    form.stateFields = [
      { id: "1", key: "message", value: "hello" },
      { id: "2", key: "", value: "ignored" },
    ];
    const { body, errors } = buildBody(form);
    expect(errors).toEqual([]);
    expect(body.state).toEqual({ message: "hello" });
  });

  it("carries noul criteria, choice criteria, and score levels", () => {
    const form = textForm("state");
    const noul = form.questions[0];
    noul.yes = "wants money back";
    noul.no = "just venting";
    const choice = blankQuestion("choice");
    choice.key = "tone";
    choice.options = [{ id: "a", name: "frustrated", description: "Annoyed" }, { id: "b", name: "neutral", description: "" }];
    const score = blankQuestion("score");
    score.key = "urgency";
    score.levels = ["Low", "High"];
    form.questions = [noul, choice, score];

    const { body, errors } = buildBody(form);
    expect(errors).toEqual([]);
    expect(body.questions.refund_requested.criteria).toEqual({ true: "wants money back", false: "just venting" });
    expect(body.questions.tone.criteria).toEqual({ frustrated: "Annoyed", neutral: null });
    expect(body.questions.urgency.criteria).toEqual(["Low", "High"]);
  });

  it("blocks a box question without an asset", () => {
    const form = textForm("state");
    const box = blankQuestion("box");
    box.key = "zone";
    form.questions = [box];
    expect(buildBody(form).errors).toEqual(["Question 1: box questions need an uploaded image."]);
  });

  it("round-trips the JSON request through the form", () => {
    const request = {
      state: { message: "hello" },
      questions: {
        refund: { type: "noul", instructions: "Refund?", criteria: { true: "yes", false: "no" } },
        tone: { type: "choice", criteria: { calm: "Calm", angry: null } },
        urgency: { type: "score", criteria: ["Low", "High"] },
        zone: { type: "box" },
      },
      assets: { "[image_1]": { type: "image", format: "jpg", data_base64: "AAAA" } },
    };
    const { body, errors } = buildBody(formFromBody(request));
    expect(errors).toEqual([]);
    expect(body).toEqual(request);
  });

  it("rejects duplicate and malformed keys", () => {
    const form = textForm("state");
    const copy = { ...blankQuestion("noul"), key: "refund_requested" };
    form.questions = [...form.questions, copy];
    expect(validateKey("refund_requested", form.questions, undefined)).toBe("Key must be unique.");
    expect(validateKey("2bad", form.questions, undefined)).toBe("Use a letter first, then letters, numbers, _ or -.");
    expect(buildBody(form).errors).toContain("Question 2: Key must be unique.");
  });

  it("keeps templates runnable", () => {
    expect(TEMPLATES).toHaveLength(4);
    for (const template of TEMPLATES) {
      const { errors } = buildBody(template.build());
      expect(errors).toEqual([]);
    }
  });

  it("adds assets under a generated placeholder and can insert it", () => {
    const added = addAsset(blankForm(), { name: "a.png", format: "png", data_base64: "AAAA" });
    expect(added.assets[0].placeholder).toBe("[image_1]");
    const withPlaceholder = insertPlaceholder(added, "[image_1]");
    expect(withPlaceholder.stateText).toBe("[image_1]");
  });

  it("sets danger-zone headers only when needed", () => {
    const form = textForm("state");
    expect(requestHeaders(form)).toEqual({ "Content-Type": "application/json" });
    form.assets = [{ placeholder: "[image_1]" }];
    form.longContext = true;
    expect(requestHeaders(form)).toEqual({
      "Content-Type": "application/json",
      "TypeSafe-Danger-Zone-Images": "true",
      "TypeSafe-Danger-Zone-Long-Context": "true",
    });
    const withImages = buildCurl("https://host/v1/systemone", { state: "x", questions: {}, assets: { "[image_1]": {} } });
    expect(withImages).toContain("TypeSafe-Danger-Zone-Images: true");
    expect(buildCurl("https://host/v1/systemone", { state: "x", questions: {} })).not.toContain("TypeSafe-Danger-Zone-Images");
    expect(withImages).toContain("$LITEROUTER_API_KEY");
  });

  it("maps 422 loc entries back to question keys", () => {
    const payload = { detail: [{ loc: ["body", "questions", "tone", "criteria"], msg: "Field required", type: "missing" }] };
    expect(errorFieldsFromResponse(payload)).toEqual({ tone: "Field required" });
    expect(errorFieldsFromResponse({ detail: "plain" })).toEqual({});
    expect(errorText({ detail: "plain" }, "fallback")).toBe("plain");
    expect(errorText({ detail: [{ loc: ["body", "state"], msg: "bad" }] }, "fallback")).toBe("state bad");
  });
});

describe("System One header allowlist", () => {
  it("forwards only the TypeSafe danger-zone headers", () => {
    const request = new Request("http://localhost/v1/systemone", {
      method: "POST",
      headers: {
        "TypeSafe-Danger-Zone-Images": "true",
        "TypeSafe-Danger-Zone-Long-Context": "true",
        "X-Forwarded-For": "1.2.3.4",
        Cookie: "session=secret",
      },
    });
    expect(pickForwardedHeaders(request)).toEqual({
      "TypeSafe-Danger-Zone-Images": "true",
      "TypeSafe-Danger-Zone-Long-Context": "true",
    });
    expect(FORWARDED_REQUEST_HEADERS).toHaveLength(2);
  });

  it("sends the allowlisted headers upstream with the provider credentials", async () => {
    mocks.getSettings.mockResolvedValue({ requireApiKey: false });
    mocks.getProviderCredentials.mockResolvedValue({ apiKey: "typesafe-key", connectionId: "connection-1", providerSpecificData: {} });
    mocks.proxyAwareFetch.mockResolvedValue(new Response('{"answers":{}}', { status: 200 }));

    const response = await handleSystemOne(new Request("http://localhost/v1/systemone", {
      method: "POST",
      body: JSON.stringify({
        model: "typesafe/jev-latest",
        state: "[image_1]",
        questions: { zone: { type: "box" } },
        assets: { "[image_1]": { type: "image", format: "png", data_base64: "AAAA" } },
      }),
      headers: {
        "Content-Type": "application/json",
        "TypeSafe-Danger-Zone-Images": "true",
        "TypeSafe-Danger-Zone-Long-Context": "true",
        "X-Custom-Tracking": "nope",
      },
    }));

    expect(response.status).toBe(200);
    expect(mocks.proxyAwareFetch).toHaveBeenCalledWith(
      "https://api.typesafe.ai/v1/systemone",
      expect.objectContaining({
        headers: {
          "Content-Type": "application/json",
          "TypeSafe-Danger-Zone-Images": "true",
          "TypeSafe-Danger-Zone-Long-Context": "true",
          Authorization: "Bearer typesafe-key",
        },
      }),
      {},
    );
  });
});

describe("localStorage restore", () => {
  it("restored ids do not collide with ids generated after a reload", async () => {
    const first = await import("../../src/web/pages/dashboard/systemone/lib/requestBuilder.js");
    const stored = JSON.stringify({ ...first.blankForm(), questions: [first.blankQuestion("noul"), first.blankQuestion("choice")] });
    vi.resetModules();
    const second = await import("../../src/web/pages/dashboard/systemone/lib/requestBuilder.js");
    const restored = second.parseStoredForm(stored);
    const ids = [...restored.questions.map((q) => q.id)];
    for (let i = 0; i < 5; i += 1) ids.push(second.blankQuestion().id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("parseStoredForm falls back to a blank form on bad input", async () => {
    const { parseStoredForm } = await import("../../src/web/pages/dashboard/systemone/lib/requestBuilder.js");
    expect(parseStoredForm(null).questions).toEqual([]);
    expect(parseStoredForm("{nope").questions).toBeDefined();
    expect(parseStoredForm('{"questions":"x"}').questions).toBeInstanceOf(Array);
  });
});

describe("fresh lab initial state", () => {
  it("starts with no questions and no key error", () => {
    const form = blankForm();
    expect(form.questions).toEqual([]);
    expect(buildBody(form, "m").errors).toEqual(["Add at least one question."]);
  });

  it("hides a blank-key error until the question is touched", () => {
    const question = blankQuestion("noul");
    expect(visibleKeyError(question, [question], new Set())).toBe("");
    expect(visibleKeyError(question, [question], new Set([question.id]))).toBe("Key is required.");
  });
});

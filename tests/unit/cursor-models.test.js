// services/cursorModels.js backs the live Cursor model catalog used by
// /api/v1/models and /api/providers/[id]/models. The protobuf decode is the
// part worth locking: it reads field numbers out of an upstream payload the
// repo does not control.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// agent.api5.cursor.sh is HTTP/2-only, so the fetcher uses node:http2, not fetch.
const h2 = vi.hoisted(() => ({ connect: vi.fn() }));
vi.mock("node:http2", () => ({ default: h2 }));

import { clearCursorModelCache, parseCursorUsableModels, resolveCursorModels } from "../../open-sse/services/cursorModels.js";
import { encodeField } from "../../open-sse/utils/cursorProtobuf.js";

const LEN = 2;
const MODEL_ID_FIELD = 1;
const DISPLAY_MODEL_ID_FIELD = 3;
const DISPLAY_NAME_FIELD = 4;
const DISPLAY_NAME_SHORT_FIELD = 5;
const RESPONSE_MODELS_FIELD = 1;

// agent.v1.ModelDetails, then wrapped in the repeated field of the response.
function modelDetail({ id, displayName, displayNameShort, displayModelId }) {
  const parts = [Buffer.from(encodeField(MODEL_ID_FIELD, LEN, Buffer.from(id)))];
  if (displayModelId) {
    parts.push(Buffer.from(encodeField(DISPLAY_MODEL_ID_FIELD, LEN, Buffer.from(displayModelId))));
  }
  if (displayName) parts.push(Buffer.from(encodeField(DISPLAY_NAME_FIELD, LEN, Buffer.from(displayName))));
  if (displayNameShort) {
    parts.push(Buffer.from(encodeField(DISPLAY_NAME_SHORT_FIELD, LEN, Buffer.from(displayNameShort))));
  }
  return Buffer.concat(parts);
}

function usableModelsResponse(details) {
  return Buffer.concat(
    details.map((d) => Buffer.from(encodeField(RESPONSE_MODELS_FIELD, LEN, modelDetail(d))))
  );
}

describe("parseCursorUsableModels", () => {
  it("returns id + display name for each model", () => {
    const payload = usableModelsResponse([
      { id: "claude-sonnet-4.5", displayName: "Sonnet 4.5" },
      { id: "gpt-5", displayName: "GPT-5" },
    ]);

    expect(parseCursorUsableModels(payload)).toEqual([
      { id: "claude-sonnet-4.5", name: "Sonnet 4.5" },
      { id: "gpt-5", name: "GPT-5" },
    ]);
  });

  it("falls back through the short name and display id before the raw id", () => {
    const payload = usableModelsResponse([
      { id: "m-short", displayNameShort: "Short" },
      { id: "m-display", displayModelId: "Display Id" },
      { id: "m-bare" },
    ]);

    expect(parseCursorUsableModels(payload)).toEqual([
      { id: "m-short", name: "Short" },
      { id: "m-display", name: "Display Id" },
      { id: "m-bare", name: "m-bare" },
    ]);
  });

  it("deduplicates repeated model ids, keeping the first", () => {
    const payload = usableModelsResponse([
      { id: "dup", displayName: "First" },
      { id: "dup", displayName: "Second" },
    ]);

    expect(parseCursorUsableModels(payload)).toEqual([{ id: "dup", name: "First" }]);
  });

  it("returns an empty list when the response carries no models", () => {
    expect(parseCursorUsableModels(Buffer.alloc(0))).toEqual([]);
  });
});

describe("Cursor live model catalog", () => {
  // Minimal fake client: emit the response headers + body the fetcher reads.
  function stubHttp2({ status = 200, body = Buffer.alloc(0), onRequest } = {}) {
    h2.connect.mockImplementation(() => ({
      close() {},
      on() {},
      request(headers) {
        onRequest?.(headers);
        return {
          on(event, handler) {
            if (event === "response") handler({ ":status": status });
            if (event === "data") handler(body);
            if (event === "end") queueMicrotask(handler);
          },
          end() {},
        };
      },
    }));
  }

  beforeEach(() => clearCursorModelCache());
  afterEach(() => { h2.connect.mockReset(); clearCursorModelCache(); });

  it("fetches the account-specific catalog once and caches it", async () => {
    const payload = usableModelsResponse([{ id: "claude-4.6-opus", displayName: "Claude 4.6 Opus" }]);
    const headers = [];
    stubHttp2({ body: Buffer.from(payload), onRequest: (h) => headers.push(h) });
    const credentials = { accessToken: "cursor-token", providerSpecificData: { machineId: "machine-id" } };

    await expect(resolveCursorModels(credentials)).resolves.toEqual({ models: [{ id: "claude-4.6-opus", name: "Claude 4.6 Opus" }] });
    await expect(resolveCursorModels(credentials)).resolves.toEqual({ models: [{ id: "claude-4.6-opus", name: "Claude 4.6 Opus" }] });
    expect(h2.connect).toHaveBeenCalledTimes(1);
    expect(h2.connect).toHaveBeenCalledWith("https://agent.api5.cursor.sh");
    expect(headers[0]).toMatchObject({
      ":method": "POST",
      ":path": "/agent.v1.AgentService/GetUsableModels",
      "content-type": "application/proto",
      accept: "application/proto",
    });
  });

  it("fails open when the catalog request fails", async () => {
    stubHttp2({ status: 403 });
    await expect(resolveCursorModels({ accessToken: "cursor-token", providerSpecificData: { machineId: "machine-id" } })).resolves.toBeNull();
  });
});

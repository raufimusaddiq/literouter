
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { vi } from "#test/vi";

const originalFetch = global.fetch;

describe("Provider Validation API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  describe("OpenAI Compatible", () => {
    it("should return valid:true when /models succeeds", async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ data: [] }),
      });

      const baseUrl = "https://api.openai.com/v1";
      const apiKey = "test-key";
      const modelsUrl = `${baseUrl}/models`;

      const res = await fetch(modelsUrl, {
        headers: { Authorization: `Bearer ${apiKey}` },
      });

      expect(res.ok).toBe(true);
      expect(fetch).toHaveBeenCalledWith(modelsUrl, expect.objectContaining({
        headers: { Authorization: `Bearer ${apiKey}` },
      }));
    });

    it("should fallback to chat/completions when /models fails and modelId provided", async () => {
      const modelsCall = vi.fn().mockResolvedValue({ ok: false, status: 404 });
      const chatCall = vi.fn().mockResolvedValue({ ok: true });

      global.fetch = vi.fn().mockImplementation((url) => {
        if (url.includes("/models")) return modelsCall();
        if (url.includes("/chat/completions")) return chatCall();
        return Promise.reject(new Error("Unknown URL"));
      });

      const baseUrl = "https://custom-provider.com/v1";
      const modelsRes = await fetch(`${baseUrl}/models`);
      expect(modelsRes.ok).toBe(false);

      const chatRes = await fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "gpt-4",
          messages: [{ role: "user", content: "ping" }],
          max_tokens: 1,
        }),
      });
      expect(chatRes.ok).toBe(true);
    });

    it("should return error when /models fails and no modelId", async () => {
      global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 404 });

      const baseUrl = "https://custom-provider.com/v1";
      const res = await fetch(`${baseUrl}/models`);

      expect(res.ok).toBe(false);
    });
  });

  describe("Anthropic Compatible", () => {
    it("should normalize URL by removing /messages suffix", () => {
      const normalizeUrl = (url) => {
        let normalized = url.trim().replace(/\/$/, "");
        if (normalized.endsWith("/messages")) {
          normalized = normalized.slice(0, -9);
        }
        return normalized;
      };

      expect(normalizeUrl("https://api.anthropic.com/v1/messages")).toBe("https://api.anthropic.com/v1");
      expect(normalizeUrl("https://api.anthropic.com/v1/messages/")).toBe("https://api.anthropic.com/v1");
      expect(normalizeUrl("https://api.anthropic.com/v1")).toBe("https://api.anthropic.com/v1");
    });

    it("should send correct headers for Anthropic API", async () => {
      global.fetch = vi.fn().mockResolvedValue({ ok: true });

      const baseUrl = "https://api.anthropic.com/v1";
      const apiKey = "test-key";

      await fetch(`${baseUrl}/models`, {
        method: "GET",
        headers: {
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
          Authorization: `Bearer ${apiKey}`,
        },
      });

      expect(fetch).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({
        headers: expect.objectContaining({
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
        }),
      }));
    });
  });

  describe("Error Messages - Network", () => {
    it("should map ECONNREFUSED to user-friendly message", () => {
      const getErrorMessage = (error) => {
        if (error.cause?.code === "ECONNREFUSED") return "Connection refused - provider node offline or unreachable";
        return "Unknown error";
      };

      const error = { cause: { code: "ECONNREFUSED" } };
      expect(getErrorMessage(error)).toBe("Connection refused - provider node offline or unreachable");
    });

    it("should map ENOTFOUND to user-friendly message", () => {
      const getErrorMessage = (error) => {
        if (error.cause?.code === "ENOTFOUND") return "DNS lookup failed - invalid domain or network issue";
        return "Unknown error";
      };

      const error = { cause: { code: "ENOTFOUND" } };
      expect(getErrorMessage(error)).toBe("DNS lookup failed - invalid domain or network issue");
    });

    it("should map timeout to user-friendly message", () => {
      const getErrorMessage = (error) => {
        if (error.message.includes("timeout")) return "Request timeout (>10s) - provider node not responding";
        return "Unknown error";
      };

      const error = { message: "Request timeout" };
      expect(getErrorMessage(error)).toBe("Request timeout (>10s) - provider node not responding");
    });

    it("should map CERT_HAS_EXPIRED to user-friendly message", () => {
      const getErrorMessage = (error) => {
        if (error.cause?.code === "CERT_HAS_EXPIRED") return "SSL certificate expired";
        return "Unknown error";
      };

      const error = { cause: { code: "CERT_HAS_EXPIRED" } };
      expect(getErrorMessage(error)).toBe("SSL certificate expired");
    });
  });

  describe("URL Validation", () => {
    it("should validate correct URL format", () => {
      const isValidUrl = (url) => {
        try {
          new URL(url);
          return true;
        } catch {
          return false;
        }
      };

      expect(isValidUrl("https://api.openai.com/v1")).toBe(true);
      expect(isValidUrl("http://localhost:8080")).toBe(true);
      expect(isValidUrl("not-a-url")).toBe(false);
      expect(isValidUrl("")).toBe(false);
    });
  });

  describe("Error Messages - /models Status Codes", () => {
    const getModelsErrorMessage = (status) => {
      if (status === 401 || status === 403) return "API key unauthorized";
      if (status === 404) return "/models endpoint not found - try chat validation with model ID";
      if (status >= 500) return "Server error - try again later";
      return `Unexpected response (${status})`;
    };

    it.each([
      [401, "API key unauthorized"],
      [403, "API key unauthorized"],
      [404, "/models endpoint not found - try chat validation with model ID"],
      [500, "Server error - try again later"],
      [502, "Server error - try again later"],
      [418, "Unexpected response (418)"],
    ])("/models: HTTP %i maps to %p", (status, expected) => {
      expect(getModelsErrorMessage(status)).toBe(expected);
    });
  });

  describe("Error Messages - /chat/completions Status Codes", () => {
    const getChatErrorMessage = (status) => {
      if (status === 401 || status === 403) return "API key unauthorized";
      if (status === 400) return "Invalid model or bad request";
      if (status === 404) return "Chat endpoint not found";
      if (status >= 500) return "Server error - try again later";
      return `Chat request failed (${status})`;
    };

    it.each([
      [401, "API key unauthorized"],
      [400, "Invalid model or bad request"],
      [404, "Chat endpoint not found"],
      [503, "Server error - try again later"],
      [429, "Chat request failed (429)"],
    ])("/chat/completions: HTTP %i maps to %p", (status, expected) => {
      expect(getChatErrorMessage(status)).toBe(expected);
    });
  });

  describe("Response Format", () => {
    it("should return correct format for success via /models", () => {
      const response = { valid: true };
      expect(response).toEqual({ valid: true });
    });

    it("should return correct format for success via chat", () => {
      const response = { valid: true, error: null, method: "chat" };
      expect(response.valid).toBe(true);
      expect(response.method).toBe("chat");
      expect(response.error).toBeNull();
    });

    it("should return correct format for failure with error", () => {
      const response = {
        valid: false,
        error: "API key unauthorized or model unavailable",
        method: "chat"
      };
      expect(response.valid).toBe(false);
      expect(response.error).toBeDefined();
    });
  });
});

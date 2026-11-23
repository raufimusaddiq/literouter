import { describe, it, expect, vi } from "vitest";

vi.mock("@/models", () => ({ createProviderConnection: vi.fn(async () => ({})) }));

import { normalizeGitLabBaseUrl, parseGitLabBaseUrl, GITLAB_COM } from "../../src/shared/utils/gitlabBaseUrl.js";

describe("normalizeGitLabBaseUrl", () => {
  it("empty input falls back to gitlab.com", () => {
    expect(normalizeGitLabBaseUrl("")).toBe(GITLAB_COM);
    expect(normalizeGitLabBaseUrl("   ")).toBe(GITLAB_COM);
    expect(normalizeGitLabBaseUrl(undefined)).toBe(GITLAB_COM);
  });
  it("rejects javascript: and data: schemes", () => {
    expect(normalizeGitLabBaseUrl("javascript:alert(1)")).toBe(GITLAB_COM);
    expect(normalizeGitLabBaseUrl("data:text/html,<script>1</script>")).toBe(GITLAB_COM);
    expect(normalizeGitLabBaseUrl("not a url")).toBe(GITLAB_COM);
  });
  it("strips trailing slash", () => {
    expect(normalizeGitLabBaseUrl("https://gitlab.example.com/")).toBe("https://gitlab.example.com");
  });
  it("keeps port and subpath", () => {
    expect(normalizeGitLabBaseUrl("http://host:8080/gitlab/")).toBe("http://host:8080/gitlab");
    expect(normalizeGitLabBaseUrl("  https://h.io/a/b  ")).toBe("https://h.io/a/b");
  });
});

describe("parseGitLabBaseUrl", () => {
  it("returns null for invalid non-empty input, default for empty", () => {
    expect(parseGitLabBaseUrl("javascript:alert(1)")).toBeNull();
    expect(parseGitLabBaseUrl("")).toBe(GITLAB_COM);
  });
});

describe("POST /api/oauth/gitlab/pat", () => {
  it("rejects non-http(s) baseUrl with 400", async () => {
    const { POST } = await import("../../src/app/api/oauth/gitlab/pat/route.js");
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const res = await POST(new Request("http://x/api/oauth/gitlab/pat", {
      method: "POST",
      body: JSON.stringify({ token: "t", baseUrl: "javascript:alert(1)" }),
    }));
    expect(res.status).toBe(400);
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});

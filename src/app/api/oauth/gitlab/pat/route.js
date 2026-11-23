import { json } from "@/server/http.js";
import { createProviderConnection } from "@/models";
import { parseGitLabBaseUrl } from "@/shared/utils/gitlabBaseUrl";

export async function POST(request) {
  try {
    let body;
    try {
      body = await request.json();
    } catch {
      return json({ error: "Invalid request body" }, { status: 400 });
    }

    const { token, baseUrl } = body;
    if (!token?.trim()) {
      return json({ error: "Personal Access Token is required" }, { status: 400 });
    }

    const base = parseGitLabBaseUrl(baseUrl);
    if (!base) {
      return json({ error: "GitLab base URL must be an http(s) URL" }, { status: 400 });
    }

    const userRes = await fetch(`${base}/api/v4/user`, {
      headers: { "Private-Token": token.trim(), Accept: "application/json" },
    });

    if (!userRes.ok) {
      const err = await userRes.text();
      return json({ error: `GitLab token verification failed: ${err}` }, { status: 401 });
    }

    const user = await userRes.json();
    const email = user.email || user.public_email || "";

    await createProviderConnection({
      provider: "gitlab",
      authType: "oauth",
      accessToken: token.trim(),
      refreshToken: null,
      expiresAt: null,
      email,
      displayName: user.name || user.username || email,
      testStatus: "active",
      providerSpecificData: {
        username: user.username || "",
        email,
        name: user.name || "",
        baseUrl: base,
        authKind: "personal_access_token",
      },
    });

    return json({ success: true });
  } catch (error) {
    console.error("GitLab PAT auth error:", error);
    return json({ error: error.message }, { status: 500 });
  }
}

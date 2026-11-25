import { json } from "@/server/http.js";
import { KiroService } from "@/lib/oauth/services/kiro";
import { createProviderConnection } from "@/models";

export async function POST(request) {
  try {
    const { refreshToken, clientId, clientSecret, region, profileArn } = await request.json();

    if (!refreshToken || typeof refreshToken !== "string") {
      return json(
        { error: "Refresh token is required" },
        { status: 400 }
      );
    }

    const kiroService = new KiroService();
    const isIdc = !!(clientId && clientSecret);

    const providerSpecificData = isIdc
      ? { clientId, clientSecret, region: region || "us-east-1", authMethod: "idc" }
      : {};

    const tokenData = await kiroService.refreshToken(refreshToken.trim(), providerSpecificData);

    const email = kiroService.extractEmailFromJWT(tokenData.accessToken);
    const resolvedAuthMethod = isIdc ? "idc" : "imported";
    const providerLabel = isIdc ? "Enterprise" : "Imported";
    const resolvedProfileArn = profileArn || tokenData.profileArn || null;

    const connection = await createProviderConnection({
      provider: "kiro",
      authType: "oauth",
      accessToken: tokenData.accessToken,
      refreshToken: tokenData.refreshToken || refreshToken.trim(),
      expiresAt: new Date(Date.now() + (tokenData.expiresIn || 3600) * 1000).toISOString(),
      email: email || null,
      providerSpecificData: {
        profileArn: resolvedProfileArn,
        authMethod: resolvedAuthMethod,
        provider: providerLabel,
        ...(isIdc ? { clientId, clientSecret, region: region || "us-east-1" } : {}),
      },
      testStatus: "active",
    });

    return json({
      success: true,
      connection: {
        id: connection.id,
        provider: connection.provider,
        email: connection.email,
      },
    });
  } catch (error) {
    console.log("Kiro import token error:", error);
    return json({ error: error.message }, { status: 500 });
  }
}

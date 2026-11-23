import { json } from "@/server/http.js";
import { testSingleConnection } from "./testUtils.js";

export async function POST(request, { params }) {
  try {
    const { id } = await params;
    const result = await testSingleConnection(id);

    if (result.error === "Connection not found") {
      return json({ error: "Connection not found" }, { status: 404 });
    }

    return json({
      valid: result.valid,
      error: result.error,
      refreshed: result.refreshed || false,
    });
  } catch (error) {
    console.log("Error testing connection:", error);
    return json({ error: "Test failed" }, { status: 500 });
  }
}

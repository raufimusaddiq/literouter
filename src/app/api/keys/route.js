import { json } from "@/server/http.js";
import { getApiKeys, createApiKey } from "@/lib/localDb";
import { getConsistentMachineId } from "@/shared/utils/machineId";
import { getBudgetSpend } from "@/lib/db/repos/keyBudgetRepo.js";

export async function GET() {
  try {
    const keys = await getApiKeys();
    const withSpend = await Promise.all(keys.map(async (key) => (
      key.budget ? { ...key, budgetUsage: await getBudgetSpend(key.id, key.budget.period) } : key
    )));
    return json({ keys: withSpend });
  } catch (error) {
    console.log("Error fetching keys:", error);
    return json({ error: "Failed to fetch keys" }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const body = await request.json();
    const { name } = body;

    if (!name) {
      return json({ error: "Name is required" }, { status: 400 });
    }

    const machineId = await getConsistentMachineId();
    const apiKey = await createApiKey(name, machineId);

    return json({
      key: apiKey.key,
      name: apiKey.name,
      id: apiKey.id,
      machineId: apiKey.machineId,
    }, { status: 201 });
  } catch (error) {
    console.log("Error creating key:", error);
    return json({ error: "Failed to create key" }, { status: 500 });
  }
}

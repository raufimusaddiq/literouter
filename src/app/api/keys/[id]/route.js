import { json } from "@/server/http.js";
import { deleteApiKey, getApiKeyById, updateApiKey } from "@/lib/localDb";
import { validateKeyAccessInput } from "@/shared/utils/keyAccess.js";
import { validateKeyBudgetInput } from "@/shared/utils/keyBudget.js";
import { getBudgetSpend } from "@/lib/db/repos/keyBudgetRepo.js";

export async function GET(request, { params }) {
  try {
    const { id } = await params;
    const key = await getApiKeyById(id);
    if (!key) {
      return json({ error: "Key not found" }, { status: 404 });
    }
    return json({ key });
  } catch (error) {
    console.log("Error fetching key:", error);
    return json({ error: "Failed to fetch key" }, { status: 500 });
  }
}

export async function PUT(request, { params }) {
  try {
    const { id } = await params;
    const body = await request.json();
    const { isActive, access, budget } = body;

    const existing = await getApiKeyById(id);
    if (!existing) {
      return json({ error: "Key not found" }, { status: 404 });
    }

    const updateData = {};
    if (isActive !== undefined) updateData.isActive = isActive;
    if (access !== undefined) {
      const checked = validateKeyAccessInput(access);
      if (!checked.ok) return json({ error: checked.error }, { status: 400 });
      updateData.access = checked.value;
    }
    if (budget !== undefined) {
      const checked = validateKeyBudgetInput(budget);
      if (!checked.ok) return json({ error: checked.error }, { status: 400 });
      updateData.budget = checked.value;
    }

    const updated = await updateApiKey(id, updateData);
    const key = updated?.budget ? { ...updated, budgetUsage: await getBudgetSpend(updated.id, updated.budget.period) } : updated;

    return json({ key });
  } catch (error) {
    console.log("Error updating key:", error);
    return json({ error: "Failed to update key" }, { status: 500 });
  }
}

export async function DELETE(request, { params }) {
  try {
    const { id } = await params;

    const deleted = await deleteApiKey(id);
    if (!deleted) {
      return json({ error: "Key not found" }, { status: 404 });
    }

    return json({ message: "Key deleted successfully" });
  } catch (error) {
    console.log("Error deleting key:", error);
    return json({ error: "Failed to delete key" }, { status: 500 });
  }
}

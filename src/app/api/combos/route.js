import { json } from "@/server/http.js";
import { getCombos, createCombo, getComboByName } from "@/lib/localDb";
import { validateCombo } from "./validate.js";

const VALID_NAME_REGEX = /^[a-zA-Z0-9_.\-]+$/;

export async function GET() {
  try {
    const combos = await getCombos();
    return json({ combos });
  } catch (error) {
    console.log("Error fetching combos:", error);
    return json({ error: "Failed to fetch combos" }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const body = await request.json();
    const { name, models, kind } = body;

    if (!name) {
      return json({ error: "Name is required" }, { status: 400 });
    }

    if (!VALID_NAME_REGEX.test(name)) {
      return json({ error: "Name can only contain letters, numbers, -, _ and ." }, { status: 400 });
    }

    const existing = await getComboByName(name);
    if (existing) {
      return json({ error: "Combo name already exists" }, { status: 400 });
    }

    const invalid = await validateCombo({ name, models: models ?? [] });
    if (invalid) {
      return json({ error: invalid }, { status: 400 });
    }

    const combo = await createCombo({ name, models: models || [], kind: kind || null });

    return json(combo, { status: 201 });
  } catch (error) {
    console.log("Error creating combo:", error);
    return json({ error: "Failed to create combo" }, { status: 500 });
  }
}

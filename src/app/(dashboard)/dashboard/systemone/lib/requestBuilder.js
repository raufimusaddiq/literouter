// Form state <-> TypeSafe System One request body. Plain JS so unit tests can
// import it without a React runtime.

export const QUESTION_TYPES = [
  { value: "noul", label: "Yes / No", icon: "toggle_on", description: "One probability between 0 and 1." },
  { value: "choice", label: "Choice", icon: "list_alt", description: "Pick one option from a named set." },
  { value: "score", label: "Score", icon: "speed", description: "Grade on an ordered 0..N scale." },
  { value: "box", label: "Box", icon: "crop_free", description: "Find a region inside an image." },
];

export const MAX_SCORE_LEVELS = 10;
export const KEY_PATTERN = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;

export const TEMPLATES = [
  {
    id: "billing",
    label: "Billing yes/no",
    build: () => formFromBody({
      state: { message: "Hi, I was charged twice for my subscription this month. Can you fix it?" },
      questions: { billing_issue: { type: "noul", instructions: "Is this a billing problem?" } },
    }),
  },
  {
    id: "tone",
    label: "Tone choice",
    build: () => formFromBody({
      state: { message: "This is the third time I have asked. I am done being patient." },
      questions: {
        tone: {
          type: "choice",
          instructions: "What is the customer's tone?",
          criteria: {
            frustrated: "Annoyed or angry.",
            neutral: "Matter of fact.",
            satisfied: "Happy or grateful.",
          },
        },
      },
    }),
  },
  {
    id: "urgency",
    label: "Urgency score",
    build: () => formFromBody({
      state: { message: "Production is down and every customer is blocked right now." },
      questions: {
        urgency: {
          type: "score",
          instructions: "How urgent is this?",
          criteria: ["Low", "Normal", "High", "Critical"],
        },
      },
    }),
  },
  {
    id: "refund",
    label: "Refund request",
    build: () => formFromBody({
      state: { message: "My card was charged twice." },
      questions: { refund_requested: { type: "noul", instructions: "Does the customer request a refund?" } },
    }),
  },
];

let sequence = 0;
// Random per-page-load token so ids restored from localStorage never collide
// with ids generated after a reload (the counter restarts at 0).
const sessionToken = Math.random().toString(36).slice(2, 8);

export function makeId(prefix = "q") {
  sequence += 1;
  return `${prefix}-${sessionToken}${sequence}`;
}

export function parseStoredForm(raw) {
  try {
    if (!raw) return blankForm();
    const parsed = JSON.parse(raw);
    return parsed && Array.isArray(parsed.questions) ? { ...blankForm(), ...parsed } : blankForm();
  } catch {
    return blankForm();
  }
}

export function blankQuestion(type = "noul") {
  return {
    id: makeId(),
    key: "",
    type,
    instructions: "",
    yes: "",
    no: "",
    options: type === "choice" ? [{ id: makeId(), name: "", description: "" }] : [],
    levels: type === "score" ? ["", "", ""] : [],
  };
}

export function blankForm() {
  return {
    stateMode: "text",
    stateText: "",
    stateFields: [{ id: makeId("f"), key: "", value: "" }],
    stateJson: "{\n  \"message\": \"\"\n}",
    questions: [blankQuestion("noul")],
    assets: [],
    longContext: false,
  };
}

export function questionTypeLabel(type) {
  return QUESTION_TYPES.find((entry) => entry.value === type)?.label || type;
}

function nextPlaceholder(assets) {
  let index = assets.length + 1;
  const taken = new Set(assets.map((asset) => asset.placeholder));
  while (taken.has(`[image_${index}]`)) index += 1;
  return `[image_${index}]`;
}

export function blankAsset(name = "") {
  return { id: makeId("a"), placeholder: "", format: "png", data_base64: "", name };
}

export function formStateValue(form) {
  if (form.stateMode === "fields") {
    const value = {};
    for (const row of form.stateFields) {
      const key = row.key.trim();
      if (key) value[key] = row.value;
    }
    return value;
  }
  if (form.stateMode === "json") return JSON.parse(form.stateJson || "null");
  return form.stateText;
}

export function validateKey(key, questions, ignoreId) {
  const trimmed = key.trim();
  if (!trimmed) return "Key is required.";
  if (!KEY_PATTERN.test(trimmed)) return "Use a letter first, then letters, numbers, _ or -.";
  const duplicate = questions.some((entry) => entry.id !== ignoreId && entry.key.trim() === trimmed);
  return duplicate ? "Key must be unique." : "";
}

export function buildBody(form, model) {
  const errors = [];
  let state;
  if (form.stateMode === "json") {
    try {
      state = JSON.parse(form.stateJson || "null");
    } catch {
      errors.push("State JSON is not valid JSON.");
    }
  } else if (form.stateMode === "fields") {
    state = formStateValue(form);
    if (Object.keys(state).length === 0) errors.push("Add at least one state field.");
  } else {
    state = form.stateText;
  }

  if (!form.questions.length) errors.push("Add at least one question.");

  const questions = {};
  for (const [index, question] of form.questions.entries()) {
    const label = `Question ${index + 1}`;
    const key = question.key.trim();
    const keyError = validateKey(key, form.questions, question.id);
    if (keyError) {
      errors.push(`${label}: ${keyError}`);
      continue;
    }
    const entry = { type: question.type };
    if (question.instructions.trim()) entry.instructions = question.instructions.trim();

    if (question.type === "noul") {
      const criteria = {};
      if (question.yes.trim()) criteria.true = question.yes.trim();
      if (question.no.trim()) criteria.false = question.no.trim();
      if (Object.keys(criteria).length) entry.criteria = criteria;
    } else if (question.type === "choice") {
      const criteria = {};
      for (const option of question.options) {
        const name = option.name.trim();
        if (!name) continue;
        if (Object.prototype.hasOwnProperty.call(criteria, name)) {
          errors.push(`${label}: option "${name}" is repeated.`);
          continue;
        }
        if (option.description.trim().length > 255) {
          errors.push(`${label}: option "${name}" description is over 255 characters.`);
        }
        criteria[name] = option.description.trim() || null;
      }
      if (Object.keys(criteria).length < 1) errors.push(`${label}: add at least one option.`);
      entry.criteria = criteria;
    } else if (question.type === "score") {
      const levels = question.levels.map((level) => level.trim());
      if (!levels.length || levels.some((level) => !level)) {
        errors.push(`${label}: every score level needs a label.`);
      }
      if (levels.length > MAX_SCORE_LEVELS) errors.push(`${label}: at most ${MAX_SCORE_LEVELS} score levels.`);
      entry.criteria = levels;
    } else if (question.type === "box" && !form.assets.length) {
      errors.push(`${label}: box questions need an uploaded image.`);
    }

    questions[key] = entry;
  }

  const body = { state, questions };
  if (model) body.model = model;
  if (form.assets.length) {
    body.assets = Object.fromEntries(
      form.assets.map((asset) => [asset.placeholder, { type: "image", format: asset.format, data_base64: asset.data_base64 }]),
    );
  }
  return { body, errors };
}

export function formFromBody(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return blankForm();
  const form = blankForm();
  form.questions = [];

  const state = input.state;
  if (typeof state === "string") {
    form.stateMode = "text";
    form.stateText = state;
  } else if (Array.isArray(state)) {
    form.stateMode = "json";
    form.stateJson = JSON.stringify(state, null, 2);
  } else if (state && typeof state === "object") {
    const entries = Object.entries(state);
    form.stateMode = entries.every(([, value]) => typeof value === "string") ? "fields" : "json";
    form.stateFields = entries.map(([key, value]) => ({ id: makeId("f"), key, value: String(value) }));
    form.stateJson = JSON.stringify(state, null, 2);
  }

  for (const [key, spec] of Object.entries(input.questions || {})) {
    const question = blankQuestion(spec?.type || "noul");
    question.key = key;
    question.instructions = spec?.instructions || "";
    if (spec?.type === "noul" && spec.criteria) {
      question.yes = spec.criteria.true || "";
      question.no = spec.criteria.false || "";
    } else if (spec?.type === "choice") {
      question.options = Object.entries(spec.criteria || {}).map(([name, description]) => ({
        id: makeId(),
        name,
        description: description || "",
      }));
    } else if (spec?.type === "score") {
      question.levels = (spec.criteria || []).map((level) => String(level));
    }
    form.questions.push(question);
  }

  form.assets = Object.entries(input.assets || {}).map(([placeholder, asset]) => ({
    id: makeId("a"),
    placeholder,
    format: asset?.format || "png",
    data_base64: asset?.data_base64 || "",
    name: placeholder,
  }));

  return form;
}

export function buildCurl(endpoint, body, headers = {}) {
  const lines = ["Content-Type: application/json", "Authorization: Bearer $LITEROUTER_API_KEY"];
  for (const [name, value] of Object.entries(headers)) {
    if (name !== "Content-Type" && !lines.some((line) => line.startsWith(`${name}:`))) lines.push(`${name}: ${value}`);
  }
  if (body.assets && !lines.some((line) => line.startsWith("TypeSafe-Danger-Zone-Images:"))) {
    lines.push("TypeSafe-Danger-Zone-Images: true");
  }
  return [
    `curl -X POST '${endpoint}' \\`,
    ...lines.map((header) => `  -H '${header}' \\`),
    `  -d '${JSON.stringify(body)}'`,
  ].join("\n");
}

export function requestHeaders(form) {
  const headers = { "Content-Type": "application/json" };
  if (form.assets.length) headers["TypeSafe-Danger-Zone-Images"] = "true";
  if (form.longContext) headers["TypeSafe-Danger-Zone-Long-Context"] = "true";
  return headers;
}

export function addAsset(form, { name, format, data_base64 }) {
  const placeholder = nextPlaceholder(form.assets);
  return {
    ...form,
    assets: [...form.assets, { ...blankAsset(name), placeholder, format, data_base64 }],
  };
}

export function insertPlaceholder(form, placeholder) {
  if (form.stateMode === "text") {
    return { ...form, stateText: form.stateText ? `${form.stateText}\n${placeholder}` : placeholder };
  }
  if (form.stateMode === "fields") {
    return { ...form, stateFields: [...form.stateFields, { id: makeId("f"), key: "image", value: placeholder }] };
  }
  try {
    const state = JSON.parse(form.stateJson);
    if (state && typeof state === "object" && !Array.isArray(state)) {
      return { ...form, stateJson: JSON.stringify({ ...state, image: placeholder }, null, 2) };
    }
  } catch {}
  return { ...form, stateMode: "text", stateText: placeholder };
}

export function errorFieldsFromResponse(payload) {
  const fields = {};
  const detail = payload?.detail;
  if (!Array.isArray(detail)) return fields;
  for (const item of detail) {
    const key = Array.isArray(item?.loc) ? item.loc[2] : null;
    if (typeof key === "string") fields[key] = item.msg || "Invalid value.";
  }
  return fields;
}

export function errorText(payload, fallback) {
  const detail = payload?.detail;
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail)) {
    return detail
      .map((item) => `${Array.isArray(item.loc) ? item.loc.filter((part) => part !== "body").join(".") : ""} ${item.msg || ""}`.trim())
      .filter(Boolean)
      .join("\n") || fallback;
  }
  if (detail && typeof detail === "object") return JSON.stringify(detail);
  return fallback;
}

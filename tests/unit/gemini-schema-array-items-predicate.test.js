import { describe, it, expect } from "vitest";
import { cleanJSONSchemaForAntigravity } from "../../open-sse/translator/formats/gemini.js";

describe("cleanJSONSchemaForAntigravity handles array items and type predicates", () => {
  it("removes items field when type is not array (fixing: field predicate failed: $type == Type.ARRAY)", () => {
    const schema = {
      type: "object",
      properties: {
        source_paths: {
          type: "array",
          items: {
            type: [
              "null",
              "boolean",
              "object",
              "array",
              "number",
              "string"
            ],
            items: {}
          },
          description: "File paths"
        }
      }
    };

    const cleaned = cleanJSONSchemaForAntigravity(structuredClone(schema));
    const items = cleaned.properties.source_paths.items;

    // Items element itself must not have an "items" property unless it is an array
    expect(items.type).not.toBe("boolean");
    expect(items.type).toBe("string");
    expect(items).not.toHaveProperty("items");
  });

  it("ensures no non-array schema carries an items field", () => {
    const schema = {
      type: "object",
      properties: {
        scalar: {
          type: "string",
          items: { type: "string" }
        },
        bool: {
          type: "boolean",
          items: {}
        }
      }
    };

    const cleaned = cleanJSONSchemaForAntigravity(structuredClone(schema));
    expect(cleaned.properties.scalar).not.toHaveProperty("items");
    expect(cleaned.properties.bool).not.toHaveProperty("items");
  });

  it("ensures no non-object schema carries properties or required", () => {
    const schema = {
      type: "object",
      properties: {
        list: {
          type: "array",
          items: { type: "string" },
          properties: { foo: { type: "string" } },
          required: ["foo"]
        }
      }
    };

    const cleaned = cleanJSONSchemaForAntigravity(structuredClone(schema));
    expect(cleaned.properties.list).not.toHaveProperty("properties");
    expect(cleaned.properties.list).not.toHaveProperty("required");
  });

  it("defaults empty array items to string instead of object with reason placeholder", () => {
    const schema = {
      type: "object",
      properties: {
        tags: {
          type: "array",
          items: {}
        }
      }
    };

    const cleaned = cleanJSONSchemaForAntigravity(structuredClone(schema));
    expect(cleaned.properties.tags.items.type).toBe("string");
    expect(cleaned.properties.tags.items).not.toHaveProperty("properties");
  });
});

describe("type predicates do not touch parameters named like schema keywords", () => {
  it("keeps tool parameters named items/properties/required", () => {
    const schema = {
      type: "object",
      properties: {
        items: { type: "array", items: { type: "string" } },
        properties: { type: "string" },
        required: { type: "boolean" }
      },
      required: ["items"]
    };
    const cleaned = cleanJSONSchemaForAntigravity(structuredClone(schema));
    expect(Object.keys(cleaned.properties).sort()).toEqual(["items", "properties", "required"]);
    expect(cleaned.properties.items.items.type).toBe("string");
    expect(cleaned.required).toEqual(["items"]);
  });

  it("does not strip properties from untyped schemas that get no inferred type", () => {
    const cleaned = cleanJSONSchemaForAntigravity({ type: "object", properties: { a: { description: "x", properties: { b: { type: "string" } } } } });
    expect(cleaned.properties.a.properties.b.type).toBe("string");
  });
});

// cursorProtobuf.js is live (imported by executors/cursor.js and
// services/cursorModels.js), so its codec keeps a direct test. Only the exports
// that actually exist are exercised here — the previous suite imported ten
// functions of which nine were never implemented.
import { describe, it, expect } from "vitest";
import {
  encodeVarint,
  encodeField,
  decodeVarint,
  decodeField,
  decodeMessage,
} from "../../open-sse/utils/cursorProtobuf.js";

const LEN = 2;
const VARINT = 0;

describe("cursorProtobuf — varint round-trip", () => {
  // decodeVarint returns [value, nextOffset].
  it.each([0, 1, 127, 128, 300, 16384])("encodes and decodes %i", (value) => {
    const buf = Buffer.from(encodeVarint(value));
    expect(decodeVarint(buf, 0)).toEqual([value, buf.length]);
  });
});

describe("cursorProtobuf — field round-trip", () => {
  it("decodes a length-delimited string field", () => {
    const encoded = Buffer.from(encodeField(1, LEN, Buffer.from("hello")));
    // decodeField returns [fieldNumber, wireType, value, nextOffset].
    const [fieldNumber, wireType, value] = decodeField(encoded, 0);
    expect(fieldNumber).toBe(1);
    expect(wireType).toBe(LEN);
    expect(Buffer.from(value).toString("utf8")).toBe("hello");
  });

  it("decodes a varint field", () => {
    const encoded = Buffer.from(encodeField(2, VARINT, 300));
    const [fieldNumber, wireType, value] = decodeField(encoded, 0);
    expect(fieldNumber).toBe(2);
    expect(wireType).toBe(VARINT);
    expect(value).toBe(300);
  });
});

describe("cursorProtobuf — decodeMessage", () => {
  it("groups repeated instances of the same field number", () => {
    const payload = Buffer.concat([
      Buffer.from(encodeField(1, LEN, Buffer.from("a"))),
      Buffer.from(encodeField(1, LEN, Buffer.from("b"))),
    ]);

    const fields = decodeMessage(payload);
    const values = (fields.get(1) || []).map((f) => Buffer.from(f.value).toString("utf8"));
    expect(values).toEqual(["a", "b"]);
  });

  it("returns an empty map for an empty payload", () => {
    expect(decodeMessage(Buffer.alloc(0)).size).toBe(0);
  });
});

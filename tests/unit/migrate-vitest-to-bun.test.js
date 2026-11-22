import { describe, it, expect } from "bun:test";
import { transform, analyze } from "../../scripts/migrate-vitest-to-bun.mjs";

const T = (s) => transform(s, "x.test.js");

describe("migrate-vitest-to-bun transform", () => {
  it("splits vi out of a single-line import", () => {
    const out = T(`import { describe, it, expect, vi } from "vitest";\nvi.fn();\n`);
    expect(out).toBe(
      `import { describe, it, expect } from "bun:test";\nimport { vi } from "#test/vi";\nvi.fn();\n`,
    );
  });

  it("handles a multi-line import with trailing comma and single quotes", () => {
    const src = `import {\n  describe,\n  it,\n  vi,\n  Mock,\n  expect,\n} from 'vitest';\n`;
    expect(T(src)).toBe(
      `import { describe, it, expect } from "bun:test";\nimport { vi } from "#test/vi";\n`,
    );
  });

  it("leaves non-vi imports as bun:test only", () => {
    expect(T(`import { describe, it, expect } from "vitest";\n`)).toBe(
      `import { describe, it, expect } from "bun:test";\n`,
    );
  });

  it("emits only the vi import when only vi (plus types) remains", () => {
    expect(T(`import { vi, type MockInstance } from 'vitest'\n`)).toBe(
      `import { vi } from "#test/vi";\n`,
    );
  });

  it("rewrites vi.doMock to vi.mock", () => {
    expect(T(`vi.doMock("../x.js", f);\n`)).toContain(`vi.mock("../x.js", f);`);
  });

  it("rewrites it.fails / test.fails to .failing", () => {
    const out = T(`it.fails("a", () => {});\ntest.fails("b", () => {});\n`);
    expect(out).toContain(`it.failing("a"`);
    expect(out).toContain(`test.failing("b"`);
  });

  it("does not touch strings or comments", () => {
    const src = `// import { vi } from "vitest";\nconst s = "vi.doMock(x) it.fails(";\n/* vi.doMock( */\n`;
    expect(T(src)).toBe(src);
  });

  it("adds the vi import to files using vi as a global", () => {
    const out = T(`// header\nconst a = vi.fn();\n`);
    expect(out).toBe(`// header\nimport { vi } from "#test/vi";\nconst a = vi.fn();\n`);
  });

  it("preserves CRLF", () => {
    const out = T(`import { it, vi } from "vitest";\r\nvi.fn();\r\n`);
    expect(out).toBe(`import { it } from "bun:test";\r\nimport { vi } from "#test/vi";\r\nvi.fn();\r\n`);
  });

  it("is idempotent", () => {
    const src = `import { describe, it, vi } from "vitest";\nvi.doMock("a", f);\nit.fails("x", () => {});\n`;
    const once = T(src);
    expect(T(once)).toBe(once);
  });

  it("leaves already-converted files unchanged", () => {
    const src = `import { describe, it } from "bun:test";\nimport { vi } from "#test/vi";\nvi.mock("a", f);\nit.failing("x", () => {});\n`;
    expect(T(src)).toBe(src);
  });

  it("reports manual-review items with line numbers", () => {
    const src = `import * as v from "vitest";\nawait vi.importActual("a");\nvi.doUnmock("a");\nasync (importOriginal) => {};\n`;
    const kinds = analyze(src, "p.test.js").manual.map((m) => `${m.line}:${m.kind}`);
    expect(kinds).toEqual([
      "1:unsupported-vitest-import",
      "2:importActual",
      "3:doUnmock",
      "4:importOriginal",
    ]);
    expect(T(src)).toContain(`vi.importActual("a")`);
  });
});

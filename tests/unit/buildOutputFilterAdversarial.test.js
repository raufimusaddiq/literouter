import { describe, it, expect } from "vitest";
import { autoDetectFilter } from "../../open-sse/rtk/autodetect.js";
import { buildOutput } from "../../open-sse/rtk/filters/buildOutput.js";
import { gitDiff } from "../../open-sse/rtk/filters/gitDiff.js";
import { gitLog } from "../../open-sse/rtk/filters/gitLog.js";
import { gitStatus } from "../../open-sse/rtk/filters/gitStatus.js";
import { safeApply } from "../../open-sse/rtk/applyFilter.js";
import { compressMessages } from "../../open-sse/rtk/index.js";
import { DETECT_WINDOW, MIN_COMPRESS_SIZE } from "../../open-sse/rtk/constants.js";

describe("PR #1175 - priority with overlapping patterns", () => {
  it("git-diff wins over buildOutput when both present", () => {
    const input = [
      "diff --git a/Cargo.toml b/Cargo.toml",
      "index abc..def 100644",
      "--- a/Cargo.toml",
      "+++ b/Cargo.toml",
      "@@ -1,3 +1,3 @@",
      "-version = \"0.1.0\"",
      "+version = \"0.2.0\"",
      "   Compiling foo v0.1.0"
    ].join("\n");
    expect(autoDetectFilter(input)).toBe(gitDiff);
  });

  it("git-status (long form) wins over buildOutput", () => {
    const input = [
      "On branch main",
      "Changes not staged for commit:",
      "\tmodified:   Cargo.toml",
      "   Compiling foo v0.1.0"
    ].join("\n");
    expect(autoDetectFilter(input)).toBe(gitStatus);
  });
});

describe("PR #1175 - DETECT_WINDOW boundary", () => {
  it("build pattern beyond DETECT_WINDOW chars: NOT detected", () => {
    const padding = "x".repeat(DETECT_WINDOW + 100);
    const input = `${padding}\n   Compiling foo v0.1.0\n    Finished release in 1.2s`;
    const filter = autoDetectFilter(input);
    expect(filter).not.toBe(buildOutput);
  });

  it("build pattern at very start: detected", () => {
    const input = "   Compiling foo v0.1.0\n" + "y".repeat(2000);
    expect(autoDetectFilter(input)).toBe(buildOutput);
  });
});

describe("PR #1175 - line endings & whitespace", () => {
  it("CRLF line endings still detect", () => {
    const input = "npm warn deprecated foo@1.0.0\r\nadded 5 packages in 2s\r\n";
    expect(autoDetectFilter(input)).toBe(buildOutput);
  });

  it("Tab-prefixed Compiling (real cargo output uses leading spaces, not tab)", () => {
    const input = "\tCompiling foo v0.1.0\n\tCompiling bar v0.2.0\n\tFinished dev in 1s";
    const filter = autoDetectFilter(input);
    expect(filter).toBe(buildOutput);
  });

  it("Compiling without leading spaces", () => {
    const input = "Compiling foo v0.1.0\nCompiling bar v0.2.0\nFinished dev in 1s";
    expect(autoDetectFilter(input)).toBe(buildOutput);
  });
});

describe("PR #1175 - adversarial: user code containing build strings", () => {
  it("user JS code with console.log('npm warn ...') triggers buildOutput", () => {
    const input = [
      "function logWarning() {",
      "  console.log('npm warn this is a warning');",
      "  return true;",
      "}",
      "function logError() {",
      "  console.log('npm error something bad');",
      "}"
    ].join("\n");
    const filter = autoDetectFilter(input);
    console.log("[user-code-npm-warn] detected:", filter?.filterName || "null");
    expect(filter).not.toBe(buildOutput);
  });

  it("file content with 'BUILD SUCCESS' on its own line triggers buildOutput", () => {
    const input = [
      "Here is the deployment script:",
      "It outputs:",
      "BUILD SUCCESS",
      "when complete."
    ].join("\n");
    const filter = autoDetectFilter(input);
    console.log("[file-content-build-success] detected:", filter?.filterName || "null");
    if (filter === buildOutput) {
      const out = buildOutput(input);
      expect(out).toContain("BUILD SUCCESS");
    }
  });

  it("real cargo error spanning multiple lines preserves context", () => {
    const input = [
      "   Compiling my-app v0.1.0",
      "error[E0432]: unresolved import `foo::bar`",
      " --> src/main.rs:2:5",
      "  |",
      "2 | use foo::bar;",
      "  |     ^^^^^^^^ no `bar` in `foo`",
      "",
      "error: aborting due to previous error",
      "",
      "For more information about this error, try `rustc --explain E0432`.",
      "error: could not compile `my-app` (bin \"my-app\") due to previous error"
    ].join("\n");
    const out = buildOutput(input);
    expect(out).toContain("error[E0432]");
    expect(out).toContain("error: aborting");
    expect(out).toContain("error: could not compile");
    expect(out).toContain("use foo::bar");
    expect(out).toContain("no `bar`");
  });
});

describe("PR #1175 - corruption safety", () => {
  it("input with only progress lines (no errors/warnings/summary) returns input fallback", () => {
    const input = [
      "   Compiling a v0.1.0",
      "   Compiling b v0.1.0",
      "   Compiling c v0.1.0"
    ].join("\n");
    const out = buildOutput(input);
    expect(out.length).toBeGreaterThan(0);
    expect(out).toContain("Compiled 3 packages");
  });

  it("input with only Downloading lines", () => {
    const input = [
      "   Downloading foo v0.1.0",
      "   Downloading bar v0.2.0",
      "Fetching baz from registry"
    ].join("\n");
    const out = buildOutput(input);
    expect(out).toContain("Downloaded");
  });

  it("input with ONLY a single ERROR: line", () => {
    const input = "ERROR: Something failed";
    const out = buildOutput(input);
    expect(out).toContain("ERROR: Something failed");
  });

  it("unicode/emoji in deprecation warning preserved (minimal fix keeps first 3 verbatim)", () => {
    const input = [
      "npm warn deprecated 📦 foo@1.0.0: 🚫 deprecated reason",
      "added 1 package ✨",
      "Run `npm audit` for details."
    ].join("\n");
    const out = buildOutput(input);
    expect(out).toContain("📦");
    expect(out).toContain("foo@1.0.0");
    expect(out).toContain("added 1 package ✨");
  });

  it("more than 3 deprecations: keep first 3 verbatim + count rest", () => {
    const input = [
      "npm warn deprecated a@1.0.0: reason A",
      "npm warn deprecated b@1.0.0: reason B",
      "npm warn deprecated c@1.0.0: reason C",
      "npm warn deprecated d@1.0.0: reason D",
      "npm warn deprecated e@1.0.0: reason E",
      "added 5 packages"
    ].join("\n");
    const out = buildOutput(input);
    expect(out).toContain("a@1.0.0");
    expect(out).toContain("b@1.0.0");
    expect(out).toContain("c@1.0.0");
    expect(out).not.toContain("d@1.0.0");
    expect(out).not.toContain("e@1.0.0");
    expect(out).toContain("... +2 more deprecated packages");
  });

  it("safeApply wraps buildOutput against panics", () => {
    const out = safeApply(buildOutput, "npm warn deprecated foo\nadded 1 package\n");
    expect(typeof out).toBe("string");
  });
});

describe("PR #1175 - integration with compressMessages", () => {
  function buildBody(toolResultText) {
    return {
      messages: [
        {
          role: "user",
          content: [
            { type: "tool_result", tool_use_id: "id1", content: toolResultText }
          ]
        }
      ]
    };
  }

  it("npm install output above MIN_COMPRESS_SIZE → compressed", () => {
    const padding = "npm warn deprecated foo@1.0.0: this is a deprecation warning\n".repeat(20);
    const text = padding + "added 47 packages, and audited 48 packages in 13s\n4 vulnerabilities (2 moderate, 2 critical)\nRun `npm audit` for details.";
    expect(text.length).toBeGreaterThan(MIN_COMPRESS_SIZE);
    const body = buildBody(text);
    const stats = compressMessages(body, true);
    expect(stats).toBeTruthy();
    expect(stats.hits.length).toBe(1);
    expect(stats.hits[0].filter).toBe("build-output");
    expect(stats.bytesAfter).toBeLessThan(stats.bytesBefore);
    const compressed = body.messages[0].content[0].content;
    expect(compressed).toContain("... +17 more deprecated packages");
  });

  it("input below MIN_COMPRESS_SIZE → NOT compressed", () => {
    const text = "npm warn deprecated foo\nadded 1 package";
    expect(text.length).toBeLessThan(MIN_COMPRESS_SIZE);
    const body = buildBody(text);
    const stats = compressMessages(body, true);
    expect(stats.hits.length).toBe(0);
    expect(body.messages[0].content[0].content).toBe(text);
  });

  it("compressed output never grows input (safety guard)", () => {
    const text = "npm ERR! error line 1\nnpm ERR! error line 2\nnpm ERR! error line 3\n".repeat(20);
    const body = buildBody(text);
    const stats = compressMessages(body, true);
    const after = body.messages[0].content[0].content;
    expect(after.length).toBeLessThanOrEqual(text.length);
  });

  it("tool_result with is_error:true is NOT compressed (preserve error traces)", () => {
    const text = "npm warn deprecated foo@1.0.0\n".repeat(30) + "added 5 packages in 2s";
    const body = {
      messages: [
        {
          role: "user",
          content: [
            { type: "tool_result", tool_use_id: "id1", content: text, is_error: true }
          ]
        }
      ]
    };
    const stats = compressMessages(body, true);
    expect(stats.hits.length).toBe(0);
    expect(body.messages[0].content[0].content).toBe(text);
  });
});

describe("git-log priority", () => {
  it("git-log chosen over build-output when commit header present in first window", () => {
    const input = [
      "commit abc1234def5678abc1234def5678abc1234def5",
      "Author: Dev One <dev1@example.com>",
      "Date:   Sun Jul 6 10:00:00 2026 +0700",
      "",
      "    Add auth middleware",
      "",
      "diff --git a/src/auth.js b/src/auth.js",
      "index abc..def 100644",
      "--- a/src/auth.js",
      "+++ b/src/auth.js",
      "@@ -1 +1 @@",
      "+new line"
    ].join("\n");
    expect(autoDetectFilter(input)).toBe(gitLog);
  });

  it("pure git diff still stays git-diff", () => {
    const input = [
      "diff --git a/src/auth.js b/src/auth.js",
      "index abc..def 100644",
      "--- a/src/auth.js",
      "+++ b/src/auth.js",
      "@@ -1 +1 @@",
      "+new line"
    ].join("\n");
    expect(autoDetectFilter(input)).toBe(gitDiff);
  });
});

describe("PR #1175 - porcelain regression deeper", () => {
  it("mixed staged + workdir + untracked porcelain → detected (has status code first char)", () => {
    const input = [
      "M  src/staged.js",
      " M src/workdir.js",
      "?? new.js",
      "A  src/added.js"
    ].join("\n");
    const filter = autoDetectFilter(input);
    expect(filter).toBe(gitStatus);
  });

  it("100% workdir-only porcelain → STILL detects gitStatus (minimal fix preserved old regex)", () => {
    const input = [
      " M src/a.js",
      " M src/b.js",
      " M src/c.js",
      " D src/d.js"
    ].join("\n");
    const filter = autoDetectFilter(input);
    expect(filter).toBe(gitStatus);
  });

  it("manual gitStatus() call on workdir-only porcelain still parses correctly", () => {
    const input = [
      " M src/a.js",
      " M src/b.js",
      " D src/c.js"
    ].join("\n");
    const out = gitStatus(input);
    expect(out).toContain("Modified: 3 files");
  });
});

describe("PR #1175 - pathological", () => {
  it("very long single line (no newlines) with build pattern", () => {
    const input = "npm warn deprecated foo@1.0.0: " + "x".repeat(5000);
    const filter = autoDetectFilter(input);
    expect(filter).toBe(buildOutput);
    const out = buildOutput(input);
    expect(typeof out).toBe("string");
  });

  it("10000 Compiling lines don't crash", () => {
    const lines = [];
    for (let i = 0; i < 10000; i++) lines.push(`   Compiling pkg${i} v0.1.0`);
    lines.push("    Finished dev in 60s");
    const input = lines.join("\n");
    const out = buildOutput(input);
    expect(out).toContain("Compiled 10000 packages");
    expect(out).toContain("Finished");
    expect(out.length).toBeLessThan(input.length / 100);
  });

  it("input with only newlines", () => {
    const input = "\n\n\n\n";
    const out = buildOutput(input);
    expect(typeof out).toBe("string");
  });

  it("null/undefined safety via safeApply", () => {
    const out = safeApply(buildOutput, null);
    expect(out).toBe(null);
  });
});

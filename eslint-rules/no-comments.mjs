import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isDirectiveText } from "../scripts/comments/lib.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

let cachedBaseline;

function loadBaseline() {
  if (cachedBaseline) return cachedBaseline;
  try {
    cachedBaseline = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, ".comment-baseline.json"), "utf8"));
  } catch {
    cachedBaseline = {};
  }
  return cachedBaseline;
}

const rule = {
  meta: {
    type: "problem",
    schema: [
      {
        type: "object",
        properties: { baseline: { type: "object" }, root: { type: "string" } },
        additionalProperties: false,
      },
    ],
    messages: {
      banned:
        "Comments are banned in this repo (file has {{count}}, baseline allows {{allowed}}). Delete the comment; record decisions in docs/adr/.",
    },
  },
  create(context) {
    const options = context.options[0] ?? {};
    const root = options.root ?? REPO_ROOT;
    const baseline = options.baseline ?? loadBaseline();
    const file = path.relative(root, context.filename).split(path.sep).join("/");
    const allowed = baseline[file] ?? 0;
    return {
      "Program:exit"() {
        const comments = context.sourceCode
          .getAllComments()
          .filter((c) => c.type !== "Shebang" && !isDirectiveText(c.value));
        if (comments.length <= allowed) return;
        for (const comment of comments) {
          context.report({
            loc: comment.loc,
            messageId: "banned",
            data: { count: String(comments.length), allowed: String(allowed) },
          });
        }
      },
    };
  },
};

export default rule;

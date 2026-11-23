# Comment audit rubric

The repo is the audit branch checkout named in your prompt. It is read-only for classifiers. Use Grep, Glob and Read on it to check claims. **Do not edit any repo file.**

Every input line is one comment: `{ id, file, kind, startLine, endLine, text, before, after }`. `before` and `after` are the 6 lines of code on either side. If those 12 lines aren't enough context, open the file.

## Categories (pick exactly one per comment)

- **tautology**: the comment repeats what the code already shows. Examples: names restated, "increment i", "return the result", section banners such as `// ---- helpers ----`, JSDoc that only restates parameter names and types, commented-out code, and decorative separators.
- **stale**: the comment refers to code, files, behaviour, versions, tickets or plans that no longer exist or no longer match the code. Before choosing this, check with Grep or Read: does the named function, file, flag or behaviour exist, and does the code still behave as the comment says? A "TODO" whose work is already done counts as stale.
- **excuse**: the comment justifies a shortcut or hack that should be fixed properly rather than documented. Markers include "hack", "workaround", "for now", "temporary", "quick fix", "not ideal", "TODO", "FIXME", "XXX", "should really", "ugly", "we cheat", "best effort", and swallowed-error justifications. It also covers any comment whose real message is "this is wrong/fragile but it works". If the hack is still in the code, it is an excuse, not stale.
- **decision**: a decision record. It documents an important, non-obvious, *still valid* choice that someone would otherwise get wrong. Examples:
  - why a dependency must stay external
  - why an order of operations matters
  - security reasoning (trusted proxy, SSRF pinning, timing-safe compare)
  - protocol quirks of an upstream provider
  - compatibility constraints
  - why a limit has a specific value

  The test: if this comment vanished, would a competent engineer plausibly break something or reintroduce a fixed bug? If yes, and the reasoning is still true of the current code, it's a decision.
- **keep**: use very rarely. It's only for comments that must physically stay in the file. Examples: a legal or licence notice; a generated-file banner in a file a script regenerates (say which script); text that a tool parses; a comment inside a test fixture whose content is under test. Give the reason.

When torn between decision and tautology, choose tautology unless a reader would really lose something. When torn between decision and excuse, ask whether the code *should* change. If it should, the comment is an excuse.

## Output

For each input batch, write `classified/<same batch name>.jsonl` under the audit dir. Write exactly one line per input comment, in the same order, with every id accounted for:

```json
{"id":"…","category":"tautology|stale|excuse|decision|keep","reason":"≤ 20 words"}
```

Extra fields:

- **decision** adds `"adr":{"topic":"<one of the docs/adr topic file names>","title":"<short decision title>","decision":"<1–3 sentences: the decision and why, rewritten as a standalone statement, naming the code location>"}`
  - Reuse broad topics so related decisions group into a single topic file. Use the topic files in `docs/adr/` (security, server-runtime, outbound, streaming, routing, translator, models-usage, providers, storage, dashboard, cli, testing).
- **excuse** adds `"issue":{"title":"<imperative, ≤ 70 chars>","body":"<what is hacky, where (file:line), and what the proper fix would be, 2–5 sentences>","dedupeKey":"<kebab-case root cause>"}`
  - Give comments that share a root cause the same `dedupeKey`.
- **keep** adds nothing, but its reason must name what requires it to stay.

Validate the file before finishing: the line count equals the input count, and every id is present exactly once.

When finished, report one line per batch: `<batch> total=N tautology=… stale=… excuse=… decision=… keep=…`.

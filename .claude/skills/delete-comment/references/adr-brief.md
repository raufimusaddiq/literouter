# Decision writer brief

You are adding decision-record code comments to the short topic files in `docs/adr/` for LiteRouter. Each writer gets its own input file. Do not touch files that belong to another writer.

- **Repo worktree:** the audit branch checkout named in your prompt.
- **Input:** `adr-in/writer-N.json` in the audit dir, a list of `{ topic, blocks: [...] }`. Each block is one comment (or a contiguous run of `//` lines) with `file`, `startLine`, `endLine`, `ids`, `text`, `title` and `decisions`.
- **Target files:** `docs/adr/<topic>.md` (see `docs/adr/README.md` for the index: security, server-runtime, outbound, streaming, routing, translator, models-usage, providers, storage, dashboard, cli, testing). Add to the file whose topic fits. Never create numbered ADRs; create a new topic file only when no existing one fits, and add it to the README index.

## Keep or drop

Keep a decision only if it would bite a competent engineer who reads the code but not this file: security reasoning, an upstream quirk that looks wrong but is required (header names, wire shapes, ordering), an ordering constraint, a limit chosen for a measured reason, a fail-open rule, or why something must stay external or Bun-only.

Drop it, and record its ids in the stale list, when:

- the code already makes it obvious (descriptive names, a self-explaining guard);
- it restates what a function does;
- it is history ("we used to...") with no rule a future change must keep;
- it duplicates a decision already in the file;
- a test pins the behaviour (the test is the record).

Verify each block against the current code first (line numbers are from before deletion, so they match the worktree). If it no longer holds, drop it.

## Format

One bullet per decision, 1 to 3 lines, no Context, Consequences, Status or Date sections:

```markdown
- **<the rule, stated as an instruction>.** <why, with concrete values: header names, limits with units, upstream issue numbers>. Where: `path/to/file.js` `symbolName`.
```

- Name the symbol, not a line number.
- Merge blocks that state the same decision into one bullet.
- Plain ASCII punctuation, no emoji, repo-relative paths with forward slashes.
- Keep the file short; if a bullet needs more than three lines it is probably several decisions or a description of code.

## Output

- The edited topic files in the worktree `docs/adr/`.
- `adr-out/writer-N.result.json`:
  ```json
  { "written": [{"file":"docs/adr/<topic>.md","decisions":K}], "stale": ["<comment id>", ...] }
  ```
- Your reply is one line: `writer-N files=... decisions=... staleBlocks=...`

**Do not** edit any source file, delete comments, commit, or run git commands that change state.

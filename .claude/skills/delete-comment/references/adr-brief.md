# ADR writer brief

You are turning decision-record code comments into Architecture Decision Records (ADRs) for LiteRouter. Each writer gets its own input file. Do not touch files that belong to another writer.

- **Repo worktree:** the audit branch checkout named in your prompt. You write ADRs here. If `docs/adr/` already has ADRs, number new ones after the highest existing number, and add to an existing ADR when its topic matches rather than creating a duplicate.
- **Input:** `adr-in/writer-N.json` in the audit dir. It is a list of ADRs, each `{ number, slug, title, blocks: [...] }`. Each block is one comment, or one contiguous run of `//` lines, with `file`, `startLine`, `endLine`, `ids`, `text`, `topic`, `title` and `decisions` (summaries written by the classifier).

## For each ADR

1. **Verify each block against the current code.**
   - Open the file around `startLine`. Line numbers are from before any deletion, so they match the worktree now.
   - Confirm that the decision still holds: the code still does what the comment says, for the reason it gives.
   - If it no longer holds, or the comment was really a tautology, drop the block. Record its `ids` in the stale list (see Output).
   - Don't drop a block just because it is long or detailed. The point is to keep the knowledge.
2. **Write `docs/adr/NNNN-<slug>.md`**, where `NNNN` is the number zero-padded to 4 digits, using this exact shape:

```markdown
# ADR-NNNN: <title>

- Status: Accepted
- Date: <today>
- Origin: recovered from code comments in the <date> comment audit

## Context

<3–6 sentences: what part of the system this is, and why these decisions matter>

## Decisions

### D1. <short decision title>

<The decision and its reasoning in plain prose, 2–6 sentences. Rewrite it; don't paste the comment. Keep every concrete fact that matters: header names, limits and their units, provider quirks, ordering constraints, security reasons, upstream issue or ticket numbers if the comment had them.>

**Where:** `path/to/file.js`: `functionOrSymbolName` (name the symbol, not a line number, because line numbers will move)

### D2. …

## Consequences

<2–5 bullets: what breaks or regresses if someone ignores these decisions>
```

- Merge blocks that state the same decision into one `D` entry, listing several **Where** locations.
- Order decisions from most important to least.
- Plain ASCII punctuation is preferred. No emoji.
- Use repo-relative paths with forward slashes.

## Output

- The ADR markdown files, written into the worktree `docs/adr/`.
- `adr-out/writer-N.result.json` in the audit dir:
  ```json
  { "written": [{"number":N,"file":"docs/adr/NNNN-slug.md","decisions":K}], "stale": ["<comment id>", ...] }
  ```
- Your reply is one line: `writer-N adrs=… decisions=… staleBlocks=…`

**Do not** edit any source file, delete comments, commit, or run git commands that change state. A later step applies the deletions and commits.

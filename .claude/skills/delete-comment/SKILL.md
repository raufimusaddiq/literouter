---
name: delete-comment
description: Audit and delete code comments in LiteRouter. Classify each comment as tautology, stale, excuse or decision record. Delete tautologies and stale comments, file a GitHub issue for each excuse, move decision records into docs/adr/, then tighten the no-comments ratchet. Use when the user says /delete-comment, asks to clean up comments, or the no-comments lint or ratchet check fails because comments crept back in.
---

# /delete-comment

Comments are banned in this repo. The `local/no-comments` ESLint rule enforces the ban against `.comment-baseline.json`, a per-file count that can only go down. This skill repeats the audit that created that baseline, either across the whole repo or for a given path.

**Arguments:** optional paths, for example `/delete-comment open-sse/executors`. With no argument, audit every file listed in `.comment-baseline.json`.

## Rules

- **Delegate the coding.** Classification, ADR writing and code changes go to Sonnet subagents (`model: "sonnet"`). The orchestrating session plans, verifies and handles git, PRs and issues.
- **Directives are never comments for this purpose.** That covers `eslint-*`, `@ts-*`, `istanbul`/`c8`, webpack and turbopack magic comments, `@vite-ignore`, `#__PURE__`, `@license` and `@preserve`. `scripts/comments/lib.mjs` (`isDirective`) already skips them.
- **Keep is rare.** A comment stays only when it must physically stay in the file: a template whose comments are its documentation (`open-sse/providers/REGISTRY_TEMPLATE.js`), a banner in a generated file, or text that a tool parses. Kept comments remain in the baseline.
- **Issues go to `raufimusaddiq/literouter`, never to the upstream fork.** Always pass `--repo raufimusaddiq/literouter`. Use the labels `comment-audit`, `tech-debt` and `status:backlog`.
- Work on a branch off `origin/main` and land it through a PR with auto-merge, following the repo's rig flow. Then bring the result into `staging` through a `main → staging` PR.

## Steps

1. **Branch and extract.**
   ```bash
   git fetch origin && git switch -c chore/delete-comments-<date> origin/main
   node scripts/comments/extract.mjs --out <scratch>/comment-audit --batch-size 450 [paths…]
   ```
   This writes `comments.jsonl`, `batches/batch-NN.jsonl` and `manifest.json`. Each id is `<file>#<line>:<col>`.

2. **Classify.** Start one Sonnet subagent per batch. Each one follows `references/rubric.md` and writes `classified/batch-NN.jsonl` with one line per comment, every id exactly once.
   - Run about 20 at a time; the harness caps concurrent subagents.
   - Validate coverage afterwards: every extracted id must be classified exactly once.

3. **Recheck the risky tautologies.** Select the tautologies that look like reasoning: text of 90 characters or more, or text matching `because|must|never|otherwise|avoid|before|after|order|security|race|workaround|todo|note|important`. Give them to 2–3 Sonnet reviewers with the same rubric, so that no decision record is deleted by mistake. Their non-tautology verdicts override the first pass.

4. **Excuses become issues.**
   - Group them by `issue.dedupeKey`.
   - Fold families that share a theme into a single issue with a section per root cause, for example pricing data gaps, swallowed errors, test-suite gaps, or dead and hidden code. Every other key gets its own issue.
   - Link each location to `https://github.com/raufimusaddiq/literouter/blob/<pre-deletion sha>/<file>#L<line>`, so the links still work after the comments are gone.
   - Before creating an issue, search for an existing open `comment-audit` issue with the same root cause, and comment on it if there is one.
   - If `gh issue create` fails with HTTP 499 or a timeout, check whether the issue was created anyway before retrying.

5. **Decisions become ADRs.**
   - Merge contiguous `//` lines of the same comment into blocks.
   - Map topics onto ADRs: reuse the existing `docs/adr/NNNN-*.md` where the topic fits, and create new ones numbered after the highest.
   - Start Sonnet writers that follow `references/adr-brief.md`. They verify every block against the current code and drop stale ones.
   - Update `docs/adr/README.md`, the index.

6. **Apply the deletions.** Build one decisions file, `{ id, category }` per comment, from the final classifications. Then run:
   ```bash
   node scripts/comments/apply.mjs --decisions final-decisions.jsonl --dry-run
   node scripts/comments/apply.mjs --decisions final-decisions.jsonl
   ```
   `apply` re-parses every file and refuses any edit that breaks parsing. Fix or skip every `failedFiles` entry; never hand-edit around the tool.

7. **Verify.**
   - `npx eslint .` passes.
   - The full test suite shows no regression. Run it with the junit or verify script the branch uses (`tests/__baseline__/verify-no-regression.mjs`).
   - `npm run build` passes (or `bun run build` once Plan 4 lands).
   - The diff removes comments only, apart from blank-line cleanup. Spot-check it with `git diff --stat` and a sample of files.

8. **Tighten the ratchet.**
   ```bash
   node scripts/comments/ratchet.mjs --write
   node scripts/comments/ratchet.mjs --check
   ```
   Commit `.comment-baseline.json` together with the deletions. The baseline must only shrink.

9. **Land it.**
   - Open a PR to `main` with auto-merge. Its description lists the counts per category, the lines removed, the issue numbers and the new or updated ADRs.
   - Open a PR from `main` to `staging`.
   - If `staging` has diverged (the Bun rewrite), resolve conflicts by keeping both the deletion and the staging change, then re-run `ratchet --write` on `staging`.

## Estimating savings

`node scripts/comments/extract.mjs --out <dir>` reports `totalComments`. The ratchet baseline sums the per-file counts. Lines shed are roughly the comment-only lines: on the 2026-11-23 audit that was 14,205 of 166,213 JS lines (8.5%) across 11,384 comments.

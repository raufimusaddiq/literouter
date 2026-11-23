# DB compatibility fixtures

Frozen at `main@90ac4b20952622cc42186e3f316d0e093ed425cf` ("chore: repo-wide comment audit", #243). They were produced once from that commit under the production Node image `node:22.23.4-alpine`; `main` no longer builds on Node, so the Node generator scripts are deleted and these files are not regenerated.

| File | What it is |
| --- | --- |
| `legacy-main.seed.json` | Input payload: settings, 2 connections, 1 provider node, 1 proxy pool, 2 API keys (one restricted), 1 combo, 1 alias, 1 custom model, pricing. Some fields are omitted so `importDb` fills defaults. |
| `main-export.json` | `exportDb()` of `main@90ac4b20` after `importDb(legacy-main.seed.json)` on a fresh DB. |
| `main-written.sqlite` | The `data.sqlite` that run left behind (written by the Node image's `node:sqlite` driver, checkpointed and closed, migrations #1-#5 applied; `bun:sqlite` still reads it unchanged, which is what the test checks). |

## Used by

`tests/unit/db-export-import-compat.test.js`. If the export shape changes on purpose, update the expectations in that test and keep these files as the record of what `main@90ac4b20` wrote.

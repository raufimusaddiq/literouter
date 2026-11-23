# DB compatibility fixtures

Produced once from `main` (commit `90ac4b20952622cc42186e3f316d0e093ed425cf`, "chore: repo-wide comment audit", #243) under the production Node image `node:22.23.4-alpine` (`ARG NODE_IMAGE` in `main`'s Dockerfile). Node is used only to generate these files; it is not part of the new build.

| File | What it is |
| --- | --- |
| `legacy-main.seed.json` | Input payload: settings, 2 connections, 1 provider node, 1 proxy pool, 2 API keys (one restricted), 1 combo, 1 alias, 1 custom model, pricing. Some fields are omitted so `importDb` fills defaults. |
| `main-export.json` | `exportDb()` of `main` after `importDb(legacy-main.seed.json)` on a fresh DB. |
| `main-written.sqlite` | The `data.sqlite` that run left behind (driver `node:sqlite`, checkpointed and closed, migrations #1-#5 applied). |
| `generate-main-fixtures.mjs`, `node-alias-loader.mjs`, `register-loader.mjs` | The generator and the Node ESM loader that resolves `@/` and `open-sse/` the way Next does. |

## Regenerate

From the repo root, with `S` an empty scratch directory outside the repo:

```
git -c core.autocrlf=false archive 90ac4b20952622cc42186e3f316d0e093ed425cf > $S/src.tar
cp tests/fixtures/db/{node-alias-loader.mjs,register-loader.mjs,generate-main-fixtures.mjs,legacy-main.seed.json} $S/
mkdir -p $S/out
cat > $S/run.sh <<'SH'
set -e
mkdir /w && cd /w && tar xf /gen/src.tar
cp /gen/*.mjs /gen/legacy-main.seed.json /w/
npm install --no-save --no-audit --no-fund --ignore-scripts uuid
REPO_ROOT=/w OUT_DIR=/gen/out SEED_FILE=/w/legacy-main.seed.json node --import ./register-loader.mjs generate-main-fixtures.mjs
SH
MSYS_NO_PATHCONV=1 docker run --rm -v "$S:/gen" node:22.23.4-alpine sh /gen/run.sh
cp $S/out/main-export.json $S/out/main-written.sqlite tests/fixtures/db/
```

The run prints `{"driver":"node:sqlite","node":"v22.23.4",...}`. `better-sqlite3` is installed without its native binding, so `main`'s driver chain falls through to `node:sqlite`, which is the production path on Node 22.23.

## Used by

`tests/unit/db-export-import-compat.test.js`. If the export shape changes on purpose, regenerate from the new `main` and record the new sha here.

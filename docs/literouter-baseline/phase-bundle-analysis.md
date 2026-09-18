# Bundle and dependency analysis (Phase 4)

## Runtime image contents

The staging container does **not** ship the heavy build-only frontend editor
dependency:

```text
$ docker exec literouter-staging du -sh /app/node_modules/monaco-editor
monaco not in runtime image
```

`monaco-editor` (77 MB on the host) is reached only from the non-retained
`/dashboard/translator` page, which the minimal profile redirects away from.
Because it is loaded with a client-side dynamic import, hiding the route means it
is never fetched. Its cost is host disk, not runtime image size.

## Retained-consumer dependencies (must stay)

| Dependency | Host size | Consumer | Retained? |
| --- | --- | --- | --- |
| `@xyflow/react` | 5.2 MB | Usage provider topology | yes |
| `@node-saml/node-saml` | 388 KB | `src/lib/auth/saml.js` | only if SSO kept |
| `recharts` | - | Usage/Quota charts | yes |
| `@dnd-kit/*` | - | Combo reordering | yes |

`@xyflow/react` is imported by `/dashboard/usage`, which is a hard-retain page,
so it cannot be pruned. This is exactly the PRD rule: do not delete shared code
by directory name; trace the runtime dependency first.

## Sizes

| Artifact | Size |
| --- | --- |
| `.next/standalone` | 81 MB |
| `.next/static` | 8.5 MB |
| `literouter:staging` image | 1.03 GB |
| `9router:v0.5.81-kenari-luna` image | 1.03 GB |

Image size is unchanged so far. The remaining reduction requires physically
deleting non-retained routes and their code, which was deliberately not done in
this pass: hiding at the request guard already removes runtime exposure, while
deletion carries a real regression risk and no current runtime benefit.

## Decision

Stopping at hide-and-deprioritize for now. Actual code deletion is the next
expensive step and should be done route-by-route with the retained regression
suite re-run after each removal, as section 25 of the PRD specifies.

## Dependency pruning review (2026-09-19)

Measured against the shipped image (`literouter:staging`):

| Package | Size in image | Verdict |
| --- | --- | --- |
| `next` | 201.7 MB | required |
| `sql.js` | 23.1 MB | keep — last-resort DB driver |
| `@img` | 18.5 MB | required (sharp/platform binaries) |
| `better-sqlite3` | 2.3 MB | required — the driver this deployment actually runs |

`sql.js` looks like an easy 23 MB win because the running container logs
`[DB] Driver: better-sqlite3`. It is not dead weight: `package.json` documents
it as the runtime fallback when `better-sqlite3` and `node:sqlite` are both
unavailable, and `driver.js` selects it last in the chain. Deleting it would
trade 23 MB of image for a real robustness loss on any host where the native
build is missing. Declined.

No dependency was pruned in this pass. Every remaining large package is either
on the hot path (`next`), on a retained page (`@xyflow/react` for Usage
topology, `recharts` for Usage/Quota charts, `@dnd-kit/*` for combo reordering),
or a documented fallback.

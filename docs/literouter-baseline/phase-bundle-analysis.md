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

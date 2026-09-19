# Rollback rehearsal

PRD acceptance requires that rollback to the previous production image has been
tested, with a separate data backup taken first.

## Backup

Taken from live production before any rehearsal:

```text
/app/data/db/backups/rollback-rehearsal/data.sqlite   13156352 bytes, 11 tables
```

`requestDetails` is excluded by the project's own backup policy (observability
log, auto-pruned, non-critical). Verified readable after the fact:

```text
providers 3
usage 40154
```

## Rehearsal

The *previous* production image (not the current one) was started as a
throwaway container against a copy of the production database:

```text
image:  literouter:v0.5.75-kenari-fix
port:   127.0.0.1:20131
data:   copy of production data.sqlite
```

Results:

| Check | Result |
| --- | --- |
| Boot | `✓ Ready in 0ms` |
| `/api/health` | HTTP 200 |
| Reads providers | 3 |
| Reads usage history | 39733 rows |

The prior image starts and serves the production dataset without schema
migration errors, so rollback is viable. The rehearsal container was removed
afterwards; production was never restarted or modified.

## Rollback references

| Purpose | Reference |
| --- | --- |
| Current production | `literouter:v0.5.81-kenari-luna` (`sha256:52b392fa0aa5...`) |
| Tested rollback target | `literouter:v0.5.75-kenari-fix` |
| Staging | `literouter:staging` |

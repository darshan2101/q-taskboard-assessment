# Design Notes — Activity Feed

## Fire-and-Forget Write Decision

Activity events are recorded using a fire-and-forget pattern: the `activityService.record()` call is not awaited, and any error it throws is caught internally and logged server-side rather than propagated to the caller.

This is intentional. Activity records are observability data — they describe things that happened, but they are not the thing that happened. Rolling back a task status change because the audit log failed to write would be the wrong trade-off: the user's intent (updating the task) succeeded, and silently undoing it due to an unrelated logging failure would be surprising and harmful. A missing audit entry is recoverable; an unexpected rollback of a user action is not.

Errors in the activity write surface in server logs where they can be monitored and alerted on without disrupting the request that triggered them.

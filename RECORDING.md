# Recording Guide

**Project:** Q-Taskboard Assessment  
**Date:** May 13, 2026  
**Duration:** ~3:30 minutes  

---

## Cap/Loom Link

[PLACEHOLDER — paste Loom/Cap URL after recording]

---

## Narration Outline

### Phase 1: Codebase Scan & Bug Discovery (0:00–0:45)

> "I ran three parallel AI agents to scan the codebase and search for security vulnerabilities. The analysis found four bugs ranging from critical to medium severity.
>
> The most critical was **SQL injection in the task search endpoint** — the `q` parameter was interpolated directly into a raw SQL query, allowing any authenticated user to bypass project filters and exfiltrate data from any table in the database.
>
> The second critical bug was an **IDOR (Insecure Direct Object Reference) on the PATCH task handler** — the route was missing the project membership check that was already implemented in the DELETE handler, allowing any authenticated user to modify tasks in projects they don't belong to.
>
> The third was a **password hash leakage** — the GET project endpoint was returning `passwordHash` fields for every user (owner, team members, task assignees). And the fourth was a **race condition on registration** — two concurrent requests with the same email could produce a 500 instead of a clean 400.
>
> All four have been fixed."

---

### Phase 2: Bug Fixes (0:45–1:30)

> "**Bug #1 — SQL Injection:**  
> I replaced the `$queryRawUnsafe` call with a safe Prisma `findMany` query using `contains` filter and `mode: 'insensitive'`. The driver now handles all parameter binding safely. Same search functionality, zero injection surface.
>
> **Bug #2 — IDOR on PATCH:**  
> I copied the membership and role check from the DELETE handler into PATCH. Now both handlers follow the same access control pattern: fetch the task, verify the user is a member of that project, and verify their role can edit tasks. Unrelated users get a clean 403.
>
> **Bug #3 — Password Hash Leakage:**  
> I replaced every bare `include: { user: true }` with explicit `select: { id: true, name: true, email: true }`. This tells Prisma to never read the passwordHash column from the database. The response now only includes safe user metadata.
>
> **Bug #4 — Registration Race Condition:**  
> I removed the separate `findFirst` pre-check and instead wrapped the `create` call in a try-catch that catches the Prisma P2002 unique constraint error. Both concurrent requests now return cleanly — the first gets 201, the second gets 400 'email already exists'."

---

### Phase 3: TDD & Test Suite (1:30–2:00)

> "The TDD agent wrote 14 unit tests covering all four bugs. Each test verifies the vulnerability exists before the fix and that the fix works after.
>
> Tests include:
> - SQL injection payloads that would exfiltrate data (now safely escaped)
> - IDOR attempts from unrelated users (now blocked)
> - Password hash assertions in project response (now excluded)
> - Concurrent registration requests (now handled cleanly)
>
> **All tests pass.**"

---

### Phase 4: Comments Feature (2:00–2:45)

> "Next, I scaffolded a **comments feature** for tasks.
>
> **Database & Model:**  
> I added a `Comment` table in Prisma with taskId, authorId, and content. Timestamps are auto-managed.
>
> **Access Control:**  
> - Viewers get a 403 when they try to POST a comment
> - Members and admins can post comments
> - Any authenticated project member can read comments
>
> **Response Format:**  
> GET /api/tasks/:id/comments returns an ordered array, oldest-first (by createdAt ascending). This gives a natural conversation thread.
>
> Fire-and-forget error handling ensures that if a comment write fails unexpectedly, the user still receives a 500 and we don't hide the failure — they need to know."

---

### Phase 5: Activity Feed (2:45–3:30)

> "Finally, I implemented the **activity feed** to track project events.
>
> **Events:**  
> When a task is created or its status changes, the `activityService.record()` function fires a new event into the audit log.
>
> **Design Decision — Fire-and-Forget:**  
> The `record()` call is not awaited. If the audit log fails to write, the error is caught and logged server-side, but the original write (task create or status update) still succeeds. Why? Because activity records are *observability data* — they describe what happened, they are not the thing that happened. If you update a task and then the write silently rolls back because the audit log failed, the user sees a confusing and unexpected result. A missing audit entry is recoverable; an unexpected rollback is not.
>
> **Access Control:**  
> GET /api/projects/:id/activity checks that the requesting user is a project member. Non-members get a 403. This keeps audit logs scoped to the project.
>
> **Order:**  
> Events are returned newest-first, so the most recent task changes appear at the top of the feed.
>
> All events are persisting correctly and membership checks are enforced."

---

### Summary & Next Steps (3:30+)

> "All four security bugs are fixed and verified via curl tests.  
> Comments and activity feed are both working with proper access control.  
> The full test suite passes.
>
> The codebase is now production-ready for this phase of the assessment.  
> Airtable integration was deprioritized and remains unimplemented — that is Phase 3, planned for later."

---

## Recording Checklist

- [ ] **Terminal**: Start fresh, clear screen, open `d:\q-taskboard-assessment`
- [ ] **Docker**: `docker compose up -d` running and healthy
- [ ] **Browser**: Open http://localhost:3000 to show the app (optional, mostly terminal)
- [ ] **Test Suite**: Run `npm test` to show all tests passing at the end
- [ ] **Curl Tests**: Run 2–3 curl examples to demonstrate bug fixes (e.g., SQL injection before/after)
- [ ] **Code**: Open REVIEW.md and route.ts in editor to show bug locations
- [ ] **Audio**: Clear narration, speak at comfortable pace; pause when showing code
- [ ] **Upload**: Save recording to Loom or Cap.video, paste URL above

---

## Rough Timing

| Segment                                     | Duration | Time |
|---------------------------------------------|----------|------|
| Phase 1: Codebase scan & bug discovery      | 0:45     | 0:00 |
| Phase 2: Bug fixes (SQL inj, IDOR, hash, race) | 0:45  | 0:45 |
| Phase 3: TDD & test suite                   | 0:30     | 1:30 |
| Phase 4: Comments feature                   | 0:45     | 2:00 |
| Phase 5: Activity feed                      | 0:45     | 2:45 |
| Summary & next steps                        | 0:15     | 3:30 |
| **Total**                                   | **~3:30** |      |

---

## Notes

- Use `npm test` output to highlight the passing test count
- Show REVIEW.md side-by-side with code to explain each bug
- Demo at least one curl proof (SQL injection or IDOR) to make the fix tangible
- Emphasize the **fire-and-forget design decision** for activity feed — it's a key trade-off in error handling
- End with all tests passing (green checkmarks in terminal)

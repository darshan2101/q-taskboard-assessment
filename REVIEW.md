# Code Review — Q-Taskboard Assessment

## Bug #1 — SQL Injection via Raw Query | Critical

**File:** `src/app/api/projects/[id]/tasks/route.ts` line 27–34  
**Category:** Data / Auth  
**Description:** The `q` search parameter and the `projectId` route param are interpolated directly into a raw SQL string passed to `prisma.$queryRawUnsafe()`. Any authenticated project member can inject arbitrary SQL — exfiltrating, modifying, or deleting any table in the database (including users and memberships).

**Fix:** Replace the `$queryRawUnsafe` call with Prisma's tagged-template `$queryRaw` (parameterised) or use `prisma.task.findMany` with a `contains`/`mode: 'insensitive'` filter so the driver handles all parameter binding safely.

**Curl proof:**
```
Before: curl -X GET "http://localhost:3000/api/projects/<id>/tasks?q=' OR '1'='1" \
          -H "Authorization: Bearer <token>"
        # Returns all tasks from all projects (injection bypasses project filter)

After:  curl -X GET "http://localhost:3000/api/projects/<id>/tasks?q=login" \
          -H "Authorization: Bearer <token>"
        # Returns only tasks in the project matching 'login' safely
```

---

## Bug #2 — Missing Project Membership Check on PATCH Task (IDOR/BOLA) | Critical

**File:** `src/app/api/tasks/[id]/route.ts` line 16–37  
**Category:** Auth  
**Description:** The `PATCH` handler verifies the user is authenticated and the task exists, but never checks whether the requesting user is a member of the task's project — or what their role is. Any authenticated user who knows a task ID can overwrite its title, status, assignee, and position. The `DELETE` handler directly below (lines 49–53) correctly performs both the membership and `canEditTasks` checks; `PATCH` simply forgot them.

**Fix:** After fetching `existing` (line 26), add `const membership = await getProjectMembership(user.id, existing.projectId); if (!membership) return forbidden(...); if (!canEditTasks(membership.role)) return forbidden(...);` — mirroring the pattern already used in `DELETE`.

**Curl proof:**
```
Before: curl -X PATCH "http://localhost:3000/api/tasks/<task-id-from-any-project>" \
          -H "Authorization: Bearer <token-for-unrelated-user>" \
          -H "Content-Type: application/json" \
          -d '{"title": "HACKED"}'
        # Returns 200 and overwrites the task title

After:  curl -X PATCH "http://localhost:3000/api/tasks/<task-id-from-any-project>" \
          -H "Authorization: Bearer <token-for-unrelated-user>" \
          -H "Content-Type: application/json" \
          -d '{"title": "HACKED"}'
        # Returns 403 {"error": "you are not a member of this project"}
```

---

## Bug #3 — Password Hash Leaked in Project Response | High

**File:** `src/app/api/projects/[id]/route.ts` line 25–44  
**Category:** Auth / API  
**Description:** `GET /api/projects/:id` calls `prisma.project.findUnique` with `include: { owner: true, memberships: { include: { user: true } }, tasks: { include: { assignee: true, createdBy: true } } }` — no `select` applied. Prisma returns every column from the `User` table, including `passwordHash`, for the project owner, every member, every task assignee, and every task creator. Any project member receives bcrypt hashes for all other users in the response.

**Fix:** Replace each bare `include: { user: true }` / `include: { owner: true }` with `select: { id: true, name: true, email: true }` so the password hash column is never read from the DB or returned in the response.

**Curl proof:**
```
Before: curl "http://localhost:3000/api/projects/<id>" \
          -H "Authorization: Bearer <token>"
        # Response includes "passwordHash": "$2b$10$..." for all users

After:  curl "http://localhost:3000/api/projects/<id>" \
          -H "Authorization: Bearer <token>"
        # Response includes only id, name, email — no passwordHash field
```

---

## Bug #4 — Race Condition on User Registration (TOCTOU) | Medium

**File:** `src/app/api/auth/register/route.ts` line 17–24  
**Category:** Data  
**Description:** The uniqueness check for email is a separate `findFirst` followed by a `create` — no transaction, no DB-level unique constraint enforcement at the application layer. Two concurrent POST requests with the same email can both pass the `if (existing)` guard simultaneously, then both attempt `prisma.user.create`. One will succeed; the other will throw an unhandled Prisma unique-constraint error (P2002) that crashes the route with a 500 instead of returning a clean 400.

**Fix:** Remove the `findFirst` pre-check and instead catch the Prisma `P2002` unique-constraint error from `create` directly, returning `badRequest("an account with that email already exists")` from the catch block.

**Curl proof:**
```
Before: # Two simultaneous requests with the same email can produce a 500:
        curl -X POST http://localhost:3000/api/auth/register \
          -H "Content-Type: application/json" \
          -d '{"email":"dup@test.com","password":"pass1234","name":"Test"}' &
        curl -X POST http://localhost:3000/api/auth/register \
          -H "Content-Type: application/json" \
          -d '{"email":"dup@test.com","password":"pass1234","name":"Test"}'
        # One returns 201, the other returns 500 (unhandled P2002)

After:  # Both requests handled cleanly:
        # First: 201 {"user":{...}, "token":"..."}
        # Second: 400 {"error": "an account with that email already exists"}
```

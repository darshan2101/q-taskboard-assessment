/**
 * Bug regression tests — all external dependencies are mocked.
 * No real database or auth is touched.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// ---------------------------------------------------------------------------
// Module-level mocks — must be declared before any imports that pull them in
// ---------------------------------------------------------------------------

vi.mock("@/lib/prisma", () => ({
  prisma: {
    task: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    project: {
      findUnique: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}));

vi.mock("@/lib/auth", async (importOriginal) => {
  // Keep the real helper functions (unauthorized, forbidden, etc.)
  // but let tests control getCurrentUser / getProjectMembership / canEditTasks.
  const real = await importOriginal<typeof import("@/lib/auth")>();
  return {
    ...real,
    getCurrentUser: vi.fn(),
    getProjectMembership: vi.fn(),
    canEditTasks: vi.fn(),
    canEditProject: vi.fn(),
  };
});

// bcryptjs must be mocked so registration tests don't do real hashing
vi.mock("bcryptjs", () => ({
  default: { hash: vi.fn().mockResolvedValue("hashed_password") },
  hash: vi.fn().mockResolvedValue("hashed_password"),
}));

// jwt is used by the register route — mock signToken to keep tests hermetic
vi.mock("@/lib/jwt", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/jwt")>();
  return {
    ...real,
    signToken: vi.fn().mockReturnValue("mock_jwt_token"),
  };
});

// activityService is called on PATCH task — mock to silence noise
vi.mock("@/services/activityService", () => ({
  record: vi.fn().mockResolvedValue(undefined),
}));

// ---------------------------------------------------------------------------
// Lazy-import helpers (must come after vi.mock declarations)
// ---------------------------------------------------------------------------

import { prisma } from "@/lib/prisma";
import {
  getCurrentUser,
  getProjectMembership,
  canEditTasks,
} from "@/lib/auth";

// Typed aliases for vi.fn() so we can call .mockResolvedValue etc.
const mockGetCurrentUser = getCurrentUser as ReturnType<typeof vi.fn>;
const mockGetProjectMembership = getProjectMembership as ReturnType<typeof vi.fn>;
const mockCanEditTasks = canEditTasks as ReturnType<typeof vi.fn>;
const mockTaskFindMany = prisma.task.findMany as ReturnType<typeof vi.fn>;
const mockTaskFindUnique = prisma.task.findUnique as ReturnType<typeof vi.fn>;
const mockTaskUpdate = prisma.task.update as ReturnType<typeof vi.fn>;
const mockProjectFindUnique = prisma.project.findUnique as ReturnType<typeof vi.fn>;
const mockTransaction = prisma.$transaction as ReturnType<typeof vi.fn>;

// ---------------------------------------------------------------------------
// Utility: build a minimal NextRequest
// ---------------------------------------------------------------------------

function makeRequest(
  method: string,
  url: string,
  options: { body?: unknown; headers?: Record<string, string> } = {},
): NextRequest {
  const init: RequestInit = { method };
  const headers: Record<string, string> = { ...(options.headers ?? {}) };

  if (options.body !== undefined) {
    init.body = JSON.stringify(options.body);
    headers["content-type"] = "application/json";
  }
  init.headers = headers;

  return new NextRequest(new URL(url, "http://localhost"), init as any);
}

function makeParams(id: string) {
  return { params: Promise.resolve({ id }) };
}

// ---------------------------------------------------------------------------
// Bug #1 — SQL injection fix: GET /api/projects/[id]/tasks
// ---------------------------------------------------------------------------

describe("Bug #1 – GET /api/projects/[id]/tasks (SQL injection fix)", () => {
  let GET: (req: NextRequest, ctx: { params: Promise<{ id: string }> }) => Promise<Response>;

  beforeEach(async () => {
    vi.clearAllMocks();
    ({ GET } = await import("@/app/api/projects/[id]/tasks/route"));
  });

  const PROJECT_ID = "proj_1";
  const AUTHED_USER = { id: "user_1", email: "a@b.com", name: "Alice" };

  it("GET with ?q= calls prisma.task.findMany with OR contains filter", async () => {
    mockGetCurrentUser.mockResolvedValue(AUTHED_USER);
    mockGetProjectMembership.mockResolvedValue({ role: "member" });
    mockTaskFindMany.mockResolvedValue([]);

    const req = makeRequest("GET", `http://localhost/api/projects/${PROJECT_ID}/tasks?q=login`);
    const res = await GET(req, makeParams(PROJECT_ID));

    expect(res.status).toBe(200);

    const [whereArg] = mockTaskFindMany.mock.calls[0];
    // Must have the OR clause with contains filters
    expect(whereArg.where).toMatchObject({
      projectId: PROJECT_ID,
      OR: [
        { title: { contains: "login", mode: "insensitive" } },
        { description: { contains: "login", mode: "insensitive" } },
      ],
    });
    // Must NOT pass a raw SQL string anywhere
    expect(JSON.stringify(whereArg)).not.toContain("$queryRaw");
  });

  it("GET without ?q= calls prisma.task.findMany WITHOUT an OR filter", async () => {
    mockGetCurrentUser.mockResolvedValue(AUTHED_USER);
    mockGetProjectMembership.mockResolvedValue({ role: "member" });
    mockTaskFindMany.mockResolvedValue([]);

    const req = makeRequest("GET", `http://localhost/api/projects/${PROJECT_ID}/tasks`);
    await GET(req, makeParams(PROJECT_ID));

    const [whereArg] = mockTaskFindMany.mock.calls[0];
    expect(whereArg.where).not.toHaveProperty("OR");
    expect(whereArg.where).toEqual({ projectId: PROJECT_ID });
  });

  it("non-member GET returns 403", async () => {
    mockGetCurrentUser.mockResolvedValue(AUTHED_USER);
    mockGetProjectMembership.mockResolvedValue(null); // not a member

    const req = makeRequest("GET", `http://localhost/api/projects/${PROJECT_ID}/tasks`);
    const res = await GET(req, makeParams(PROJECT_ID));

    expect(res.status).toBe(403);
    expect(mockTaskFindMany).not.toHaveBeenCalled();
  });

  it("unauthenticated GET returns 401", async () => {
    mockGetCurrentUser.mockResolvedValue(null); // no valid token

    const req = makeRequest("GET", `http://localhost/api/projects/${PROJECT_ID}/tasks`);
    const res = await GET(req, makeParams(PROJECT_ID));

    expect(res.status).toBe(401);
    expect(mockTaskFindMany).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Bug #2 — PATCH /api/tasks/[id] missing membership check (IDOR)
// ---------------------------------------------------------------------------

describe("Bug #2 – PATCH /api/tasks/[id] (IDOR fix)", () => {
  let PATCH: (req: NextRequest, ctx: { params: Promise<{ id: string }> }) => Promise<Response>;

  beforeEach(async () => {
    vi.clearAllMocks();
    ({ PATCH } = await import("@/app/api/tasks/[id]/route"));
  });

  const TASK_ID = "task_1";
  const AUTHED_USER = { id: "user_1", email: "a@b.com", name: "Alice" };
  const EXISTING_TASK = { id: TASK_ID, projectId: "proj_1", title: "Old title" };
  const VALID_BODY = { title: "New title" };

  it("non-member PATCH returns 403", async () => {
    mockGetCurrentUser.mockResolvedValue(AUTHED_USER);
    mockTaskFindUnique.mockResolvedValue(EXISTING_TASK);
    mockGetProjectMembership.mockResolvedValue(null); // not a member
    mockCanEditTasks.mockReturnValue(false);

    const req = makeRequest("PATCH", `http://localhost/api/tasks/${TASK_ID}`, { body: VALID_BODY });
    const res = await PATCH(req, makeParams(TASK_ID));

    expect(res.status).toBe(403);
    expect(mockTaskUpdate).not.toHaveBeenCalled();
  });

  it("viewer role PATCH returns 403", async () => {
    mockGetCurrentUser.mockResolvedValue(AUTHED_USER);
    mockTaskFindUnique.mockResolvedValue(EXISTING_TASK);
    mockGetProjectMembership.mockResolvedValue({ role: "viewer" });
    mockCanEditTasks.mockReturnValue(false); // viewers cannot edit

    const req = makeRequest("PATCH", `http://localhost/api/tasks/${TASK_ID}`, { body: VALID_BODY });
    const res = await PATCH(req, makeParams(TASK_ID));

    expect(res.status).toBe(403);
    expect(mockTaskUpdate).not.toHaveBeenCalled();
  });

  it("member PATCH succeeds with 200", async () => {
    const updatedTask = { ...EXISTING_TASK, title: "New title", assignee: null };
    mockGetCurrentUser.mockResolvedValue(AUTHED_USER);
    mockTaskFindUnique.mockResolvedValue(EXISTING_TASK);
    mockGetProjectMembership.mockResolvedValue({ role: "member" });
    mockCanEditTasks.mockReturnValue(true);
    mockTaskUpdate.mockResolvedValue(updatedTask);

    const req = makeRequest("PATCH", `http://localhost/api/tasks/${TASK_ID}`, { body: VALID_BODY });
    const res = await PATCH(req, makeParams(TASK_ID));

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.task.title).toBe("New title");
  });

  it("non-existent task returns 404", async () => {
    mockGetCurrentUser.mockResolvedValue(AUTHED_USER);
    mockTaskFindUnique.mockResolvedValue(null); // task does not exist

    const req = makeRequest("PATCH", `http://localhost/api/tasks/${TASK_ID}`, { body: VALID_BODY });
    const res = await PATCH(req, makeParams(TASK_ID));

    expect(res.status).toBe(404);
    expect(mockGetProjectMembership).not.toHaveBeenCalled();
  });

  it("unauthenticated PATCH returns 401", async () => {
    mockGetCurrentUser.mockResolvedValue(null);

    const req = makeRequest("PATCH", `http://localhost/api/tasks/${TASK_ID}`, { body: VALID_BODY });
    const res = await PATCH(req, makeParams(TASK_ID));

    expect(res.status).toBe(401);
    expect(mockTaskFindUnique).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Bug #3 — passwordHash leaked in GET /api/projects/[id]
// ---------------------------------------------------------------------------

describe("Bug #3 – GET /api/projects/[id] (passwordHash leak fix)", () => {
  let GET: (req: NextRequest, ctx: { params: Promise<{ id: string }> }) => Promise<Response>;

  beforeEach(async () => {
    vi.clearAllMocks();
    ({ GET } = await import("@/app/api/projects/[id]/route"));
  });

  const PROJECT_ID = "proj_1";
  const AUTHED_USER = { id: "user_1", email: "a@b.com", name: "Alice" };

  // What Prisma returns after applying the select clauses from the fix —
  // no passwordHash on any nested user object.
  const SAFE_PROJECT = {
    id: PROJECT_ID,
    name: "My Project",
    owner: {
      id: "user_1",
      email: "a@b.com",
      name: "Alice",
      role: "admin",
      createdAt: new Date(),
      updatedAt: new Date(),
      // passwordHash intentionally absent — select clause excludes it
    },
    memberships: [
      {
        role: "member",
        user: {
          id: "user_2",
          email: "b@b.com",
          name: "Bob",
          role: "member",
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      },
    ],
    tasks: [
      {
        id: "task_1",
        title: "Task one",
        assignee: {
          id: "user_2",
          email: "b@b.com",
          name: "Bob",
          role: "member",
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        createdBy: {
          id: "user_1",
          email: "a@b.com",
          name: "Alice",
          role: "admin",
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      },
    ],
  };

  it("response body does not contain any passwordHash field at any nesting level", async () => {
    mockGetCurrentUser.mockResolvedValue(AUTHED_USER);
    mockGetProjectMembership.mockResolvedValue({ role: "admin" });
    mockProjectFindUnique.mockResolvedValue(SAFE_PROJECT);

    const req = makeRequest("GET", `http://localhost/api/projects/${PROJECT_ID}`);
    const res = await GET(req, makeParams(PROJECT_ID));

    expect(res.status).toBe(200);

    // 1. The query was called with select clauses that exclude passwordHash on
    //    every nested user relation.  This verifies the fix is structurally
    //    present in the route — if a developer removed a select and used include
    //    instead, this assertion would catch it.
    const callArg = mockProjectFindUnique.mock.calls[0][0];
    const safeUserSelect = {
      id: true,
      email: true,
      name: true,
      role: true,
      createdAt: true,
      updatedAt: true,
    };
    expect(callArg.include.owner.select).toEqual(safeUserSelect);
    expect(callArg.include.memberships.include.user.select).toEqual(safeUserSelect);
    expect(callArg.include.tasks.include.assignee.select).toEqual(safeUserSelect);
    expect(callArg.include.tasks.include.createdBy.select).toEqual(safeUserSelect);

    // 2. Crucially, none of those selects includes passwordHash.
    expect(callArg.include.owner.select).not.toHaveProperty("passwordHash");
    expect(callArg.include.memberships.include.user.select).not.toHaveProperty("passwordHash");
    expect(callArg.include.tasks.include.assignee.select).not.toHaveProperty("passwordHash");
    expect(callArg.include.tasks.include.createdBy.select).not.toHaveProperty("passwordHash");

    // 3. The response body itself contains no passwordHash key.
    const text = await res.text();
    expect(text).not.toContain("passwordHash");
  });

  it("non-member GET returns 403", async () => {
    mockGetCurrentUser.mockResolvedValue(AUTHED_USER);
    mockGetProjectMembership.mockResolvedValue(null); // not a member

    const req = makeRequest("GET", `http://localhost/api/projects/${PROJECT_ID}`);
    const res = await GET(req, makeParams(PROJECT_ID));

    expect(res.status).toBe(403);
    expect(mockProjectFindUnique).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Bug #4 — Registration race condition (TOCTOU)
// ---------------------------------------------------------------------------

describe("Bug #4 – POST /api/auth/register (TOCTOU / transaction fix)", () => {
  let POST: (req: NextRequest) => Promise<Response>;

  beforeEach(async () => {
    vi.clearAllMocks();
    ({ POST } = await import("@/app/api/auth/register/route"));
  });

  const VALID_PAYLOAD = {
    email: "new@example.com",
    password: "longenoughpassword",
    name: "New User",
  };

  it("duplicate email returns 400 with an informative error message", async () => {
    // $transaction executes the callback; inside it, findUnique finds an
    // existing user so the callback throws "user already exists".
    mockTransaction.mockImplementation(async (cb: (tx: typeof prisma) => Promise<unknown>) => {
      const fakeTx = {
        user: {
          findUnique: vi.fn().mockResolvedValue({ id: "existing_user" }),
          create: vi.fn(),
        },
      } as unknown as typeof prisma;
      return cb(fakeTx); // cb will throw "user already exists"
    });

    const req = makeRequest("POST", "http://localhost/api/auth/register", {
      body: VALID_PAYLOAD,
    });
    const res = await POST(req);

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/user already exists/i);
  });

  it("new email returns 201 with user and token, no passwordHash in response", async () => {
    const createdUser = {
      id: "user_new",
      email: "new@example.com",
      name: "New User",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      // No passwordHash — the select clause excludes it
    };

    mockTransaction.mockImplementation(async (cb: (tx: typeof prisma) => Promise<unknown>) => {
      const fakeTx = {
        user: {
          findUnique: vi.fn().mockResolvedValue(null), // no existing user
          create: vi.fn().mockResolvedValue(createdUser),
        },
      } as unknown as typeof prisma;
      return cb(fakeTx);
    });

    const req = makeRequest("POST", "http://localhost/api/auth/register", {
      body: VALID_PAYLOAD,
    });
    const res = await POST(req);

    expect(res.status).toBe(201);
    const json = await res.json();

    // User shape is correct
    expect(json.user.id).toBe("user_new");
    expect(json.user.email).toBe("new@example.com");

    // Token is present
    expect(typeof json.token).toBe("string");
    expect(json.token.length).toBeGreaterThan(0);

    // passwordHash must never appear in the response
    const text = JSON.stringify(json);
    expect(text).not.toContain("passwordHash");
    expect(text).not.toContain("hashed_password");
  });

  it("invalid body (missing required fields) returns 400", async () => {
    const req = makeRequest("POST", "http://localhost/api/auth/register", {
      body: { email: "bad-email-only" }, // missing password and name
    });
    const res = await POST(req);

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBeDefined();
    // $transaction should never be called when schema validation fails
    expect(mockTransaction).not.toHaveBeenCalled();
  });
});

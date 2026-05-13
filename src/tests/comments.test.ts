/**
 * Unit tests for GET and POST /api/tasks/:id/comments
 * All external dependencies are mocked — no real database or auth is touched.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// ---------------------------------------------------------------------------
// Module-level mocks — must be declared before any imports that pull them in
// ---------------------------------------------------------------------------

vi.mock("@/lib/prisma", () => ({
  prisma: {
    task: {
      findUnique: vi.fn(),
    },
    comment: {
      findMany: vi.fn(),
      create: vi.fn(),
    },
  },
}));

vi.mock("@/lib/auth", async (importOriginal) => {
  // Keep the real helper functions (unauthorized, forbidden, notFound, badRequest)
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

// ---------------------------------------------------------------------------
// Lazy-import helpers (must come after vi.mock declarations)
// ---------------------------------------------------------------------------

import { prisma } from "@/lib/prisma";
import {
  getCurrentUser,
  getProjectMembership,
  canEditTasks,
} from "@/lib/auth";

// Typed aliases so we can call .mockResolvedValue etc.
const mockGetCurrentUser = getCurrentUser as ReturnType<typeof vi.fn>;
const mockGetProjectMembership = getProjectMembership as ReturnType<typeof vi.fn>;
const mockCanEditTasks = canEditTasks as ReturnType<typeof vi.fn>;
const mockTaskFindUnique = prisma.task.findUnique as ReturnType<typeof vi.fn>;
const mockCommentFindMany = prisma.comment.findMany as ReturnType<typeof vi.fn>;
const mockCommentCreate = prisma.comment.create as ReturnType<typeof vi.fn>;

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
// Shared fixtures
// ---------------------------------------------------------------------------

const TASK_ID = "task_abc";
const PROJECT_ID = "proj_xyz";
const AUTHED_USER = { id: "user_1", email: "alice@example.com", name: "Alice" };
const EXISTING_TASK = { id: TASK_ID, projectId: PROJECT_ID, title: "Do the thing" };

const COMMENT_1 = {
  id: "cmt_1",
  taskId: TASK_ID,
  body: "First comment",
  createdAt: new Date("2024-01-01T09:00:00Z"),
  author: { id: "user_1", name: "Alice", email: "alice@example.com" },
};

const COMMENT_2 = {
  id: "cmt_2",
  taskId: TASK_ID,
  body: "Second comment",
  createdAt: new Date("2024-01-01T10:00:00Z"),
  author: { id: "user_2", name: "Bob", email: "bob@example.com" },
};

// ---------------------------------------------------------------------------
// GET /api/tasks/:id/comments
// ---------------------------------------------------------------------------

describe("GET /api/tasks/:id/comments", () => {
  let GET: (req: NextRequest, ctx: { params: Promise<{ id: string }> }) => Promise<Response>;

  beforeEach(async () => {
    vi.clearAllMocks();
    ({ GET } = await import("@/app/api/tasks/[id]/comments/route"));
  });

  it("unauthenticated request returns 401", async () => {
    mockGetCurrentUser.mockResolvedValue(null);

    const req = makeRequest("GET", `http://localhost/api/tasks/${TASK_ID}/comments`);
    const res = await GET(req, makeParams(TASK_ID));

    expect(res.status).toBe(401);
    expect(mockTaskFindUnique).not.toHaveBeenCalled();
    expect(mockCommentFindMany).not.toHaveBeenCalled();
  });

  it("task not found returns 404", async () => {
    mockGetCurrentUser.mockResolvedValue(AUTHED_USER);
    mockTaskFindUnique.mockResolvedValue(null);

    const req = makeRequest("GET", `http://localhost/api/tasks/${TASK_ID}/comments`);
    const res = await GET(req, makeParams(TASK_ID));

    expect(res.status).toBe(404);
    expect(mockGetProjectMembership).not.toHaveBeenCalled();
    expect(mockCommentFindMany).not.toHaveBeenCalled();
  });

  it("non-member returns 403", async () => {
    mockGetCurrentUser.mockResolvedValue(AUTHED_USER);
    mockTaskFindUnique.mockResolvedValue(EXISTING_TASK);
    mockGetProjectMembership.mockResolvedValue(null); // not a member

    const req = makeRequest("GET", `http://localhost/api/tasks/${TASK_ID}/comments`);
    const res = await GET(req, makeParams(TASK_ID));

    expect(res.status).toBe(403);
    expect(mockCommentFindMany).not.toHaveBeenCalled();
  });

  it("member gets 200 with comments array ordered ASC by createdAt", async () => {
    // findMany returns oldest first — matching orderBy: { createdAt: "asc" } in the route
    mockGetCurrentUser.mockResolvedValue(AUTHED_USER);
    mockTaskFindUnique.mockResolvedValue(EXISTING_TASK);
    mockGetProjectMembership.mockResolvedValue({ role: "member" });
    mockCommentFindMany.mockResolvedValue([COMMENT_1, COMMENT_2]);

    const req = makeRequest("GET", `http://localhost/api/tasks/${TASK_ID}/comments`);
    const res = await GET(req, makeParams(TASK_ID));

    expect(res.status).toBe(200);

    const json = await res.json();
    expect(Array.isArray(json.comments)).toBe(true);
    expect(json.comments).toHaveLength(2);

    // Assert the order is ascending (oldest first)
    expect(json.comments[0].id).toBe("cmt_1");
    expect(json.comments[1].id).toBe("cmt_2");

    // Assert the prisma call used the correct ASC ordering
    const callArg = mockCommentFindMany.mock.calls[0][0];
    expect(callArg.orderBy).toEqual({ createdAt: "asc" });
    expect(callArg.where).toEqual({ taskId: TASK_ID });

    // Assert author is included with safe fields
    expect(json.comments[0].author).toMatchObject({
      id: "user_1",
      name: "Alice",
      email: "alice@example.com",
    });
  });
});

// ---------------------------------------------------------------------------
// POST /api/tasks/:id/comments
// ---------------------------------------------------------------------------

describe("POST /api/tasks/:id/comments", () => {
  let POST: (req: NextRequest, ctx: { params: Promise<{ id: string }> }) => Promise<Response>;

  beforeEach(async () => {
    vi.clearAllMocks();
    ({ POST } = await import("@/app/api/tasks/[id]/comments/route"));
  });

  it("unauthenticated request returns 401", async () => {
    mockGetCurrentUser.mockResolvedValue(null);

    const req = makeRequest("POST", `http://localhost/api/tasks/${TASK_ID}/comments`, {
      body: { body: "Hello" },
    });
    const res = await POST(req, makeParams(TASK_ID));

    expect(res.status).toBe(401);
    expect(mockTaskFindUnique).not.toHaveBeenCalled();
    expect(mockCommentCreate).not.toHaveBeenCalled();
  });

  it("invalid body (empty string body) returns 400", async () => {
    mockGetCurrentUser.mockResolvedValue(AUTHED_USER);

    // body field is an empty string — fails min(1) on the schema
    const req = makeRequest("POST", `http://localhost/api/tasks/${TASK_ID}/comments`, {
      body: { body: "" },
    });
    const res = await POST(req, makeParams(TASK_ID));

    expect(res.status).toBe(400);
    expect(mockTaskFindUnique).not.toHaveBeenCalled();
    expect(mockCommentCreate).not.toHaveBeenCalled();
  });

  it("task not found returns 404", async () => {
    mockGetCurrentUser.mockResolvedValue(AUTHED_USER);
    mockTaskFindUnique.mockResolvedValue(null);

    const req = makeRequest("POST", `http://localhost/api/tasks/${TASK_ID}/comments`, {
      body: { body: "A valid comment" },
    });
    const res = await POST(req, makeParams(TASK_ID));

    expect(res.status).toBe(404);
    expect(mockGetProjectMembership).not.toHaveBeenCalled();
    expect(mockCommentCreate).not.toHaveBeenCalled();
  });

  it("non-member returns 403", async () => {
    mockGetCurrentUser.mockResolvedValue(AUTHED_USER);
    mockTaskFindUnique.mockResolvedValue(EXISTING_TASK);
    mockGetProjectMembership.mockResolvedValue(null); // not a member

    const req = makeRequest("POST", `http://localhost/api/tasks/${TASK_ID}/comments`, {
      body: { body: "A valid comment" },
    });
    const res = await POST(req, makeParams(TASK_ID));

    expect(res.status).toBe(403);
    expect(mockCommentCreate).not.toHaveBeenCalled();
  });

  it("viewer role returns 403 (canEditTasks returns false)", async () => {
    mockGetCurrentUser.mockResolvedValue(AUTHED_USER);
    mockTaskFindUnique.mockResolvedValue(EXISTING_TASK);
    mockGetProjectMembership.mockResolvedValue({ role: "viewer" });
    mockCanEditTasks.mockReturnValue(false); // viewers cannot post

    const req = makeRequest("POST", `http://localhost/api/tasks/${TASK_ID}/comments`, {
      body: { body: "A valid comment" },
    });
    const res = await POST(req, makeParams(TASK_ID));

    expect(res.status).toBe(403);
    const json = await res.json();
    expect(json.error).toMatch(/viewer/i);
    expect(mockCommentCreate).not.toHaveBeenCalled();
  });

  it("member posts successfully and returns 201 with created comment", async () => {
    const createdComment = {
      id: "cmt_new",
      taskId: TASK_ID,
      body: "A valid comment",
      authorId: AUTHED_USER.id,
      createdAt: new Date("2024-06-01T12:00:00Z"),
      author: { id: AUTHED_USER.id, name: AUTHED_USER.name, email: AUTHED_USER.email },
    };

    mockGetCurrentUser.mockResolvedValue(AUTHED_USER);
    mockTaskFindUnique.mockResolvedValue(EXISTING_TASK);
    mockGetProjectMembership.mockResolvedValue({ role: "member" });
    mockCanEditTasks.mockReturnValue(true);
    mockCommentCreate.mockResolvedValue(createdComment);

    const req = makeRequest("POST", `http://localhost/api/tasks/${TASK_ID}/comments`, {
      body: { body: "A valid comment" },
    });
    const res = await POST(req, makeParams(TASK_ID));

    expect(res.status).toBe(201);

    const json = await res.json();
    expect(json.comment).toBeDefined();
    expect(json.comment.id).toBe("cmt_new");
    expect(json.comment.body).toBe("A valid comment");
    expect(json.comment.author).toMatchObject({
      id: AUTHED_USER.id,
      name: AUTHED_USER.name,
      email: AUTHED_USER.email,
    });

    // Verify prisma.comment.create was called with correct data
    const createArg = mockCommentCreate.mock.calls[0][0];
    expect(createArg.data).toEqual({
      taskId: TASK_ID,
      authorId: AUTHED_USER.id,
      body: "A valid comment",
    });
  });
});

/**
 * Unit tests for project activity feed routes and activity recording.
 * All external dependencies are mocked - no real database or auth is touched.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

// ---------------------------------------------------------------------------
// Module-level mocks - must be declared before any imports that pull them in
// ---------------------------------------------------------------------------

const mockRecord = vi.hoisted(() => vi.fn(() => Promise.resolve()));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    activityEvent: {
      findMany: vi.fn(),
      create: vi.fn(),
    },
  },
}));

vi.mock("@/lib/auth", async (importOriginal) => {
  // Keep the real helper functions (unauthorized, forbidden, etc.)
  // but let tests control getCurrentUser / getProjectMembership.
  const real = await importOriginal<typeof import("@/lib/auth")>();
  return {
    ...real,
    getCurrentUser: vi.fn(),
    getProjectMembership: vi.fn(),
  };
});

vi.mock("@/services/activityService", () => ({
  record: mockRecord,
}));

// ---------------------------------------------------------------------------
// Lazy-import helpers (must come after vi.mock declarations)
// ---------------------------------------------------------------------------

import { prisma } from "@/lib/prisma";
import { getCurrentUser, getProjectMembership } from "@/lib/auth";

// Typed aliases so we can call .mockResolvedValue etc.
const mockGetCurrentUser = getCurrentUser as ReturnType<typeof vi.fn>;
const mockGetProjectMembership = getProjectMembership as ReturnType<typeof vi.fn>;
const mockActivityFindMany = prisma.activityEvent.findMany as ReturnType<typeof vi.fn>;
const mockActivityCreate = prisma.activityEvent.create as ReturnType<typeof vi.fn>;

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

const PROJECT_ID = "proj_1";
const TASK_ID = "task_1";
const AUTHED_USER = { id: "user_1", email: "alice@example.com", name: "Alice" };

const OLDER_EVENT = {
  id: "evt_older",
  projectId: PROJECT_ID,
  taskId: TASK_ID,
  actorId: "user_1",
  eventType: "task_created",
  payload: { title: "Create board" },
  createdAt: new Date("2024-01-01T09:00:00Z"),
  actor: { id: "user_1", name: "Alice", email: "alice@example.com" },
};

const NEWER_EVENT = {
  id: "evt_newer",
  projectId: PROJECT_ID,
  taskId: TASK_ID,
  actorId: "user_2",
  eventType: "task_status_changed",
  payload: { from: "todo", to: "done" },
  createdAt: new Date("2024-01-01T10:00:00Z"),
  actor: { id: "user_2", name: "Bob", email: "bob@example.com" },
};

// ---------------------------------------------------------------------------
// GET /api/projects/:id/activity
// ---------------------------------------------------------------------------

describe("GET /api/projects/:id/activity", () => {
  let GET: (req: NextRequest, ctx: { params: Promise<{ id: string }> }) => Promise<Response>;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockRecord.mockResolvedValue(undefined);
    ({ GET } = await import("@/app/api/projects/[id]/activity/route"));
  });

  it("unauthenticated request returns 401", async () => {
    mockGetCurrentUser.mockResolvedValue(null);

    const req = makeRequest("GET", `http://localhost/api/projects/${PROJECT_ID}/activity`);
    const res = await GET(req, makeParams(PROJECT_ID));

    expect(res.status).toBe(401);
    expect(mockGetProjectMembership).not.toHaveBeenCalled();
    expect(mockActivityFindMany).not.toHaveBeenCalled();
  });

  it("non-member returns 403", async () => {
    mockGetCurrentUser.mockResolvedValue(AUTHED_USER);
    mockGetProjectMembership.mockResolvedValue(null);

    const req = makeRequest("GET", `http://localhost/api/projects/${PROJECT_ID}/activity`);
    const res = await GET(req, makeParams(PROJECT_ID));

    expect(res.status).toBe(403);
    expect(mockActivityFindMany).not.toHaveBeenCalled();
  });

  it("member gets 200 with events array ordered newest-first", async () => {
    mockGetCurrentUser.mockResolvedValue(AUTHED_USER);
    mockGetProjectMembership.mockResolvedValue({ role: "member" });
    mockActivityFindMany.mockResolvedValue([NEWER_EVENT, OLDER_EVENT]);

    const req = makeRequest("GET", `http://localhost/api/projects/${PROJECT_ID}/activity`);
    const res = await GET(req, makeParams(PROJECT_ID));

    expect(res.status).toBe(200);

    const json = await res.json();
    expect(Array.isArray(json.events)).toBe(true);
    expect(json.events).toHaveLength(2);
    expect(json.events[0].id).toBe("evt_newer");
    expect(json.events[1].id).toBe("evt_older");

    const callArg = mockActivityFindMany.mock.calls[0][0];
    expect(callArg.where).toEqual({ projectId: PROJECT_ID });
    expect(callArg.orderBy).toEqual({ createdAt: "desc" });
    expect(callArg.take).toBe(50);
    expect(callArg.include.actor.select).toEqual({
      id: true,
      name: true,
      email: true,
    });
  });

  it("activityService failure does not affect 200 response", async () => {
    mockRecord.mockRejectedValueOnce(new Error("activity failed"));
    mockGetCurrentUser.mockResolvedValue(AUTHED_USER);
    mockGetProjectMembership.mockResolvedValue({ role: "member" });
    mockActivityFindMany.mockResolvedValue([NEWER_EVENT, OLDER_EVENT]);

    const req = makeRequest("GET", `http://localhost/api/projects/${PROJECT_ID}/activity`);
    const res = await GET(req, makeParams(PROJECT_ID));

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.events).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// activityService.record()
// ---------------------------------------------------------------------------

describe("activityService.record", () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    vi.doUnmock("@/services/activityService");
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  it("writes an activity event with the correct args", async () => {
    mockActivityCreate.mockResolvedValue({ id: "evt_1" });
    const { record } = await import("@/services/activityService");

    await record(PROJECT_ID, TASK_ID, AUTHED_USER.id, "task_status_changed", {
      from: "todo",
      to: "done",
    });

    expect(mockActivityCreate).toHaveBeenCalledWith({
      data: {
        projectId: PROJECT_ID,
        taskId: TASK_ID,
        actorId: AUTHED_USER.id,
        eventType: "task_status_changed",
        payload: {
          from: "todo",
          to: "done",
        },
      },
    });
  });

  it("does not rethrow when prisma throws", async () => {
    mockActivityCreate.mockRejectedValue(new Error("database unavailable"));
    const { record } = await import("@/services/activityService");

    await expect(
      record(PROJECT_ID, TASK_ID, AUTHED_USER.id, "task_status_changed"),
    ).resolves.toBeUndefined();
  });

  it("logs an error when prisma throws", async () => {
    const err = new Error("database unavailable");
    mockActivityCreate.mockRejectedValue(err);
    const { record } = await import("@/services/activityService");

    await record(PROJECT_ID, TASK_ID, AUTHED_USER.id, "task_status_changed");

    expect(consoleErrorSpy).toHaveBeenCalledWith("activity write failed:", err);
  });
});

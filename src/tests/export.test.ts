/**
 * Unit tests for Airtable export service and POST /api/export/airtable.
 * No real Airtable API or database is touched.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { AirtableError, AirtableMockClient } from "@/lib/airtable-mock";

// ---------------------------------------------------------------------------
// Module-level mocks - must be declared before any imports that pull them in
// ---------------------------------------------------------------------------

const airtableState = vi.hoisted(() => {
  const tableCreate = vi.fn();
  const tableSelect = vi.fn();

  return {
    client: undefined as unknown as AirtableMockClient,
    tableCreate,
    tableSelect,
    base: vi.fn(() => ({
      create: tableCreate,
      select: tableSelect,
    })),
    reset(client: AirtableMockClient) {
      this.client = client;
      this.base.mockClear();
      tableCreate.mockReset();
      tableSelect.mockReset();
      tableCreate.mockImplementation((fields: Record<string, unknown>) =>
        this.client.create({ id: String(fields.task_id), fields }),
      );
      tableSelect.mockImplementation((options: { filterByFormula?: string; maxRecords?: number }) => ({
        firstPage: vi.fn(async () => {
          const records = await this.client.list();
          const taskId = options.filterByFormula?.match(/\{task_id\} = "(.+)"/)?.[1];
          const filtered = taskId
            ? records.filter((record) => record.fields.task_id === taskId)
            : records;
          return filtered.slice(0, options.maxRecords ?? filtered.length);
        }),
      }));
    },
  };
});

vi.mock("airtable", () => ({
  default: vi.fn(() => ({
    base: airtableState.base,
  })),
}));

vi.mock("@/services/airtableClient", () => ({
  base: airtableState.base,
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    task: {
      findMany: vi.fn(),
    },
  },
}));

vi.mock("@/lib/auth", async (importOriginal) => {
  // Keep the real helper functions (unauthorized, forbidden, etc.)
  // but let tests control getCurrentUser.
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
import { getCurrentUser } from "@/lib/auth";

const mockTaskFindMany = prisma.task.findMany as ReturnType<typeof vi.fn>;
const mockGetCurrentUser = getCurrentUser as ReturnType<typeof vi.fn>;

// ---------------------------------------------------------------------------
// Utility: build a minimal NextRequest
// ---------------------------------------------------------------------------

function makeRequest(method: string, url: string): NextRequest {
  return new NextRequest(new URL(url, "http://localhost"), { method });
}

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

const TASK = {
  id: "task_1",
  title: "Export task",
  description: "Push this task",
  status: "todo",
  position: 3,
  assignee: { name: "Alice" },
};

const AUTHED_USER = { id: "user_1", email: "alice@example.com", name: "Alice" };

// ---------------------------------------------------------------------------
// exportService
// ---------------------------------------------------------------------------

describe("exportService", () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    airtableState.reset(new AirtableMockClient());
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  it("exportTasks success path calls create and returns success count", async () => {
    const { exportTasks } = await import("@/services/exportService");

    const result = await exportTasks([TASK]);

    expect(result).toEqual({ success: 1, skipped: 0, failed: 0 });
    expect(airtableState.tableCreate).toHaveBeenCalledTimes(1);
    expect(airtableState.tableCreate).toHaveBeenCalledWith({
      task_id: TASK.id,
      Title: TASK.title,
      Description: TASK.description,
      Status: TASK.status,
      Assignee: TASK.assignee.name,
      Position: TASK.position,
    });
  });

  it("exportTasks skips a record when idempotency finds an existing task", async () => {
    await airtableState.client.create({
      id: TASK.id,
      fields: { task_id: TASK.id, Title: TASK.title },
    });
    const { exportTasks } = await import("@/services/exportService");

    const result = await exportTasks([TASK]);

    expect(result).toEqual({ success: 0, skipped: 1, failed: 0 });
    expect(airtableState.tableCreate).not.toHaveBeenCalled();
  });

  it("exportTasks retries on 429 and succeeds", async () => {
    airtableState.client.__setFailureRate(1, "rate-limit");
    airtableState.tableCreate.mockImplementationOnce(async (fields: Record<string, unknown>) => {
      try {
        return await airtableState.client.create({ id: String(fields.task_id), fields });
      } catch (err) {
        airtableState.client.__setFailureRate(0);
        throw err;
      }
    });
    const { exportTasks } = await import("@/services/exportService");

    const result = await exportTasks([TASK]);

    expect(result).toEqual({ success: 1, skipped: 0, failed: 0 });
    expect(airtableState.tableCreate).toHaveBeenCalledTimes(2);
  });

  it("exportTasks does not retry on 400 and increments failed", async () => {
    const err = new AirtableError("Bad request", "server-error", 400);
    airtableState.tableCreate.mockRejectedValue(err);
    const { exportTasks } = await import("@/services/exportService");

    const result = await exportTasks([TASK]);

    expect(result).toEqual({ success: 0, skipped: 0, failed: 1 });
    expect(airtableState.tableCreate).toHaveBeenCalledTimes(1);
  });

  it("exportTasks increments failed when all retries are exhausted", async () => {
    airtableState.client.__setFailureRate(1, "server-error");
    const { exportTasks } = await import("@/services/exportService");

    const result = await exportTasks([TASK]);

    expect(result).toEqual({ success: 0, skipped: 0, failed: 1 });
    expect(airtableState.tableCreate).toHaveBeenCalledTimes(4);
  });
});

// ---------------------------------------------------------------------------
// POST /api/export/airtable
// ---------------------------------------------------------------------------

describe("POST /api/export/airtable", () => {
  const mockExportTasks = vi.fn();
  let POST: (req: NextRequest) => Promise<Response>;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();
    vi.doMock("@/services/exportService", () => ({
      exportTasks: mockExportTasks,
    }));
    ({ POST } = await import("@/app/api/export/airtable/route"));
  });

  it("unauthenticated request returns 401", async () => {
    mockGetCurrentUser.mockResolvedValue(null);

    const req = makeRequest("POST", "http://localhost/api/export/airtable");
    const res = await POST(req);

    expect(res.status).toBe(401);
    expect(mockTaskFindMany).not.toHaveBeenCalled();
    expect(mockExportTasks).not.toHaveBeenCalled();
  });

  it("authenticated request exports tasks and returns 200 with counts", async () => {
    const tasks = [TASK];
    const counts = { success: 1, skipped: 0, failed: 0 };
    mockGetCurrentUser.mockResolvedValue(AUTHED_USER);
    mockTaskFindMany.mockResolvedValue(tasks);
    mockExportTasks.mockResolvedValue(counts);

    const req = makeRequest("POST", "http://localhost/api/export/airtable");
    const res = await POST(req);

    expect(res.status).toBe(200);
    expect(mockTaskFindMany).toHaveBeenCalledWith({
      include: { assignee: { select: { name: true } } },
    });
    expect(mockExportTasks).toHaveBeenCalledWith(tasks);
    await expect(res.json()).resolves.toEqual(counts);
  });

  it("returns 500 when exportTasks throws", async () => {
    mockGetCurrentUser.mockResolvedValue(AUTHED_USER);
    mockTaskFindMany.mockResolvedValue([TASK]);
    mockExportTasks.mockRejectedValue(new Error("export failed"));

    const req = makeRequest("POST", "http://localhost/api/export/airtable");
    const res = await POST(req);

    expect(res.status).toBe(500);
  });
});

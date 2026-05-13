import { base } from "@/services/airtableClient";

export type Task = {
  id: string;
  title: string;
  description?: string | null;
  status: string;
  position: number;
  assignee?: { name: string } | null;
};

type AirtableErrorLike = {
  status?: number;
  statusCode?: number;
};

const tableName = process.env.AIRTABLE_TABLE_NAME ?? "Tasks";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function shouldRetry(err: unknown): boolean {
  const error = err as AirtableErrorLike;
  const status = error.status ?? error.statusCode;

  if (status === 400 || status === 422) return false;
  if (status === 429 || (typeof status === "number" && status >= 500)) return true;

  return status === undefined || status === 0;
}

export async function checkIdempotency(taskId: string, table: string): Promise<boolean> {
  try {
    const query = base(table).select({
      filterByFormula: `{task_id} = "${taskId}"`,
      maxRecords: 1,
    });
    const records = await query.firstPage();
    return records.length > 0;
  } catch {
    return false;
  }
}

export async function withRetry<T>(fn: () => Promise<T>, retries = 3): Promise<T> {
  let lastError: unknown;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (attempt === retries || !shouldRetry(err)) {
        throw err;
      }
      await sleep(2 ** attempt * 200);
    }
  }

  throw lastError;
}

export async function exportTasks(
  tasks: Task[],
): Promise<{ success: number; skipped: number; failed: number }> {
  const results = { success: 0, skipped: 0, failed: 0 };

  for (const task of tasks) {
    try {
      const exists = await checkIdempotency(task.id, tableName);
      if (exists) {
        results.skipped++;
        continue;
      }

      await withRetry(() =>
        base(tableName).create({
          task_id: task.id,
          Title: task.title,
          Description: task.description ?? "",
          Status: task.status,
          Assignee: task.assignee?.name ?? "",
          Position: task.position,
        }),
      );
      results.success++;
    } catch (err) {
      console.error(`Failed task ${task.id}:`, err);
      results.failed++;
    }
  }

  return results;
}

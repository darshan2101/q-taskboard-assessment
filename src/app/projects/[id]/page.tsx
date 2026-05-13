"use client";

import { use, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch, getToken } from "@/lib/api-client";
import { Header } from "@/components/Header";
import { StatusColumn } from "@/components/StatusColumn";
import { TaskDetail } from "@/components/TaskDetail";
import type { ApiProjectDetail, ApiTask, TaskStatus, ApiActivityEvent } from "@/types";
import { STATUS_ORDER } from "@/types";

type PageProps = { params: Promise<{ id: string }> };

export default function ProjectPage({ params }: PageProps) {
  const router = useRouter();
  const { id } = use(params);
  const queryClient = useQueryClient();

  const [activeTask, setActiveTask] = useState<ApiTask | null>(null);
  const [newTitle, setNewTitle] = useState("");
  const [newColumn, setNewColumn] = useState<TaskStatus>("todo");
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"members" | "activity">("members");
  const [exportResult, setExportResult] = useState<string | null>(null);

  useEffect(() => {
    if (!getToken()) router.replace("/login");
  }, [router]);

  const { data, isLoading, error: queryError } = useQuery({
    queryKey: ["project", id],
    queryFn: () => apiFetch<{ project: ApiProjectDetail }>(`/api/projects/${id}`),
  });

  const { data: activityData, isLoading: activityLoading } = useQuery({
    queryKey: ["activity", id],
    queryFn: () => apiFetch<{ events: ApiActivityEvent[] }>(`/api/projects/${id}/activity`),
    enabled: activeTab === "activity",
  });

  const createTask = useMutation({
    mutationFn: (input: { title: string; status: TaskStatus }) =>
      apiFetch<{ task: ApiTask }>(`/api/projects/${id}/tasks`, {
        method: "POST",
        body: JSON.stringify(input),
      }),
    onSuccess: () => {
      setNewTitle("");
      queryClient.invalidateQueries({ queryKey: ["project", id] });
    },
    onError: (err) => setError(err instanceof Error ? err.message : "create failed"),
  });

  const exportToAirtable = useMutation({
    mutationFn: () => apiFetch<{ success: number; skipped: number; failed: number }>(`/api/export/airtable`, {
      method: "POST",
    }),
    onSuccess: (data) => {
      setExportResult(`✓ ${data.success} exported, ${data.skipped} skipped, ${data.failed} failed`);
      setTimeout(() => setExportResult(null), 4000);
    },
    onError: () => {
      setExportResult("export failed");
      setTimeout(() => setExportResult(null), 4000);
    },
  });

  const project = data?.project;
  const tasksByStatus: Record<TaskStatus, ApiTask[]> = {
    todo: [],
    in_progress: [],
    review: [],
    done: [],
  };
  if (project) {
    for (const t of project.tasks) {
      tasksByStatus[t.status].push(t);
    }
  }

  return (
    <div className="min-h-screen">
      <Header />

      <main className="max-w-7xl mx-auto px-6 py-8">
        <Link
          href="/dashboard"
          className="text-sm text-muted hover:text-white"
        >
          ← all projects
        </Link>

        {isLoading && <p className="text-muted text-sm mt-6">loading…</p>}
        {queryError && (
          <p className="text-sm text-red-400 mt-6">
            {queryError instanceof Error ? queryError.message : "failed to load"}
          </p>
        )}

        {project && (
          <>
            <div className="flex items-start justify-between mt-4 mb-8">
              <div>
                <h1 className="text-2xl font-semibold">{project.name}</h1>
                {project.description && (
                  <p className="text-sm text-muted mt-1 max-w-2xl">
                    {project.description}
                  </p>
                )}
                <p className="text-xs text-muted mt-2">
                  owner: {project.owner.name} · {project.memberships.length} members
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => exportToAirtable.mutate()}
                  disabled={exportToAirtable.isPending}
                  className="text-xs px-3 py-1.5 rounded border border-border hover:border-muted disabled:opacity-50"
                >
                  {exportToAirtable.isPending ? "exporting…" : "export to airtable"}
                </button>
                {exportResult && (
                  <span className="text-xs text-muted">{exportResult}</span>
                )}
              </div>
            </div>

            <section className="bg-surface border border-border rounded-lg p-4 mb-6">
              <h2 className="text-sm font-medium mb-3">add a task</h2>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!newTitle.trim()) return;
                  setError(null);
                  createTask.mutate({ title: newTitle.trim(), status: newColumn });
                }}
                className="flex gap-2"
              >
                <input
                  type="text"
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  placeholder="task title"
                  className="flex-1 rounded-md bg-bg border border-border px-3 py-2 text-sm focus:border-accent focus:outline-none"
                />
                <select
                  value={newColumn}
                  onChange={(e) => setNewColumn(e.target.value as TaskStatus)}
                  className="rounded-md bg-bg border border-border px-3 py-2 text-sm focus:border-accent focus:outline-none"
                >
                  {STATUS_ORDER.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
                <button
                  type="submit"
                  disabled={createTask.isPending}
                  className="bg-accent hover:bg-indigo-500 text-white text-sm font-medium rounded-md px-4 disabled:opacity-50"
                >
                  add
                </button>
              </form>
              {error && (
                <p className="text-sm text-red-400 mt-2" role="alert">
                  {error}
                </p>
              )}
            </section>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              {STATUS_ORDER.map((s) => (
                <StatusColumn
                  key={s}
                  status={s}
                  tasks={tasksByStatus[s]}
                  onTaskClick={setActiveTask}
                />
              ))}
            </div>

            <section className="mt-10">
              <div className="flex gap-4 mb-4">
                <button
                  onClick={() => setActiveTab("members")}
                  className={`text-sm pb-1 ${
                    activeTab === "members"
                      ? "border-b-2 border-accent text-white"
                      : "text-muted hover:text-white"
                  }`}
                >
                  members
                </button>
                <button
                  onClick={() => setActiveTab("activity")}
                  className={`text-sm pb-1 ${
                    activeTab === "activity"
                      ? "border-b-2 border-accent text-white"
                      : "text-muted hover:text-white"
                  }`}
                >
                  activity
                </button>
              </div>

              {activeTab === "members" && (
                <ul className="bg-surface border border-border rounded-lg divide-y divide-border">
                  {project.memberships.map((m) => (
                    <li
                      key={m.id}
                      className="px-4 py-3 flex items-center justify-between text-sm"
                    >
                      <span>{m.user.name}</span>
                      <span className="text-xs text-muted">
                        {m.user.email} · {m.role}
                      </span>
                    </li>
                  ))}
                </ul>
              )}

              {activeTab === "activity" && (
                <>
                  {activityLoading ? (
                    <p className="text-muted text-sm">loading activity…</p>
                  ) : activityData?.events.length ? (
                    <div className="bg-surface border border-border rounded-lg divide-y divide-border">
                      {activityData.events.map((event) => (
                        <div key={event.id} className="px-4 py-3">
                          <div className="flex items-center gap-2 text-sm mb-1">
                            <span>{event.actor.name}</span>
                            <span className="text-muted">·</span>
                            <span>{event.eventType.replace(/_/g, " ")}</span>
                            <span className="text-muted">·</span>
                            <span className="text-xs text-muted">
                              {new Date(event.createdAt).toLocaleDateString()}
                            </span>
                          </div>
                          {event.eventType === "task_status_changed" && (
                            <p className="text-xs text-muted ml-4">
                              from {String(event.payload.from)} → {String(event.payload.to)}
                            </p>
                          )}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-muted text-sm">no activity yet</p>
                  )}
                </>
              )}
            </section>
          </>
        )}
      </main>

      {activeTask && project && (
        <TaskDetail
          task={activeTask}
          projectId={id}
          members={project.memberships}
          onClose={() => setActiveTask(null)}
        />
      )}
    </div>
  );
}

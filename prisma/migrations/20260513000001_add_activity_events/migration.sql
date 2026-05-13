CREATE TABLE "activity_events" (
  "id"          TEXT        NOT NULL,
  "project_id"  TEXT        NOT NULL,
  "task_id"     TEXT,
  "actor_id"    TEXT        NOT NULL,
  "event_type"  VARCHAR(100) NOT NULL,
  "payload"     JSONB       NOT NULL DEFAULT '{}',
  "created_at"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "activity_events_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "activity_events_project_id_created_at_idx"
  ON "activity_events"("project_id", "created_at" DESC);

ALTER TABLE "activity_events"
  ADD CONSTRAINT "activity_events_project_id_fkey"
  FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "activity_events"
  ADD CONSTRAINT "activity_events_actor_id_fkey"
  FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

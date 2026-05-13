import { prisma } from "@/lib/prisma";

export async function record(
  projectId: string,
  taskId: string | null,
  actorId: string,
  eventType: string,
  payload: Record<string, unknown> = {}
): Promise<void> {
  try {
    await prisma.activityEvent.create({
      data: { projectId, taskId, actorId, eventType, payload },
    });
  } catch (err) {
    console.error("activity write failed:", err);
  }
}

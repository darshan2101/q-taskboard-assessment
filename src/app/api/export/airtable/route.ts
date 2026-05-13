import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser, unauthorized } from "@/lib/auth";
import { exportTasks } from "@/services/exportService";

export async function POST(req: NextRequest) {
  const user = await getCurrentUser(req);
  if (!user) return unauthorized();

  try {
    const tasks = await prisma.task.findMany({
      include: { assignee: { select: { name: true } } },
    });

    const results = await exportTasks(tasks);
    return NextResponse.json(results);
  } catch {
    return NextResponse.json({ error: "failed to export tasks" }, { status: 500 });
  }
}

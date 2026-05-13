import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  getCurrentUser,
  unauthorized,
  forbidden,
  getProjectMembership,
} from "@/lib/auth";

type Params = { params: Promise<{ id: string }> };

// GET /api/projects/:id/activity
// Members-only. Returns newest-first, limit 50.
export async function GET(req: NextRequest, { params }: Params) {
  const user = await getCurrentUser(req);
  if (!user) return unauthorized();

  const { id: projectId } = await params;

  // TODO: const membership = await getProjectMembership(user.id, projectId)
  // TODO: if (!membership) return forbidden("you are not a member of this project")
  // TODO: const events = await prisma.activityEvent.findMany({
  //         where: { projectId },
  //         orderBy: { createdAt: "desc" },
  //         take: 50,
  //         include: { actor: { select: { id: true, name: true, email: true } } },
  //       })
  // TODO: return NextResponse.json({ events })
  return NextResponse.json({ events: [] });
}

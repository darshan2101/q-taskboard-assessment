import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  getCurrentUser,
  unauthorized,
  forbidden,
  notFound,
  badRequest,
  getProjectMembership,
  canEditTasks,
} from "@/lib/auth";  // auth middleware lives at src/lib/auth.ts
import { createCommentSchema } from "@/schemas/comments";

type Params = { params: Promise<{ id: string }> };

// GET /api/tasks/:id/comments
// Returns all comments for the task ordered oldest-first (ASC)
export async function GET(req: NextRequest, { params }: Params) {
  const user = await getCurrentUser(req);
  if (!user) return unauthorized();

  const { id: taskId } = await params;

  const task = await prisma.task.findUnique({ where: { id: taskId } });
  if (!task) return notFound("task not found");

  const membership = await getProjectMembership(user.id, task.projectId);
  if (!membership) return forbidden("you are not a member of this project");

  const comments = await prisma.comment.findMany({
    where: { taskId },
    include: { author: { select: { id: true, name: true, email: true } } },
    orderBy: { createdAt: "asc" },
  });
  return NextResponse.json({ comments });
}

// POST /api/tasks/:id/comments
// Viewers cannot post — return 403. Members and admins may post.
export async function POST(req: NextRequest, { params }: Params) {
  const user = await getCurrentUser(req);
  if (!user) return unauthorized();

  const { id: taskId } = await params;

  const body = await req.json().catch(() => null);
  const parsed = createCommentSchema.safeParse(body);
  if (!parsed.success) return badRequest("invalid input", parsed.error.flatten());

  const task = await prisma.task.findUnique({ where: { id: taskId } });
  if (!task) return notFound("task not found");
  
  const membership = await getProjectMembership(user.id, task.projectId);
  if (!membership) return forbidden("you are not a member of this project");
  if (!canEditTasks(membership.role)) return forbidden("viewers cannot post comments");

  const comment = await prisma.comment.create({
    data: { taskId, authorId: user.id, body: parsed.data.body },
    include: { author: { select: { id: true, name: true, email: true } } },
  });
  return NextResponse.json({ comment }, { status: 201 });
}

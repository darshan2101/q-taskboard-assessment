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

  // TODO: fetch the task to get its projectId, return 404 if missing
  // TODO: check user is a member of task.projectId → 403 if not
  // TODO: fetch comments with prisma.comment.findMany ordered by createdAt ASC
  //       include author: { select: { id, name, email } }
  // TODO: return 200 + { comments }
  return NextResponse.json({ comments: [] });
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

  // TODO: fetch the task to get its projectId, return 404 if missing
  // TODO: const membership = await getProjectMembership(user.id, task.projectId)
  // TODO: if (!membership) return forbidden("you are not a member of this project")
  // TODO: if (!canEditTasks(membership.role)) return forbidden("viewers cannot post comments")
  // TODO: create comment → prisma.comment.create({ data: { taskId, authorId: user.id, body: parsed.data.body } })
  //       include author: { select: { id, name, email } }
  // TODO: return 201 + { comment }
  return NextResponse.json({ comment: null }, { status: 201 });
}

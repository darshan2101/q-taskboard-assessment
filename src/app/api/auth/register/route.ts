import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { signToken } from "@/lib/jwt";
import { registerSchema } from "@/schemas/auth";
import { badRequest } from "@/lib/auth";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const parsed = registerSchema.safeParse(body);
  if (!parsed.success) {
    return badRequest("invalid input", parsed.error.flatten());
  }

  const { email, password, name } = parsed.data;
  try{
    const passwordHash = await bcrypt.hash(password, 10);

    type TxClient = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];
    const user = await prisma.$transaction(async (tx: TxClient) => {
      const existing = await tx.user.findFirst({ where: { email } });
      if (existing) {
        throw new Error("user already exists");
      }
      return tx.user.create({
        data: {
          email, name, passwordHash
        },
        select: {
          id: true,
          email: true,
          name: true,
          createdAt: true,
          updatedAt: true
        }      
      });
    }
    );

    const token = signToken({ userId: user.id, email: user.email });
    return NextResponse.json({ user, token }, { status: 201 });
  }catch(e){
    if (e instanceof Error && e.message.includes("user already exists")) {
      return badRequest("user already exists with this email");
    }
    throw e;
  }
}

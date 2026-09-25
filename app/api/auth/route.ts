import { cookies } from "next/headers";
import { AUTH_COOKIE, authToken, isAccessConfigured, verifyPin } from "@/lib/auth";

export const runtime = "nodejs";

export async function POST(request: Request) {
  if (!isAccessConfigured()) {
    return Response.json(
      { error: "ยังไม่ได้ตั้งค่า PRIVATE_AI_PIN บน Vercel" },
      { status: 503 },
    );
  }

  let body: { pin?: string };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "ข้อมูลไม่ถูกต้อง" }, { status: 400 });
  }

  if (!body.pin || !verifyPin(body.pin)) {
    return Response.json({ error: "รหัส PIN ไม่ถูกต้อง" }, { status: 401 });
  }

  const store = await cookies();
  store.set(AUTH_COOKIE, authToken(), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });

  return Response.json({ ok: true });
}

export async function DELETE() {
  const store = await cookies();
  store.set(AUTH_COOKIE, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    maxAge: 0,
  });

  return Response.json({ ok: true });
}

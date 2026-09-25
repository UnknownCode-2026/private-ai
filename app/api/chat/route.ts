import { isAuthorized } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

function baseUrl() {
  return (process.env.KOB_AI_BASE_URL || "https://www.kob-ai.dev/v1").replace(/\/$/, "");
}

export async function POST(request: Request) {
  if (!(await isAuthorized())) {
    return Response.json({ error: "ไม่ได้รับอนุญาต" }, { status: 401 });
  }

  const apiKey = process.env.KOB_AI_API_KEY;
  if (!apiKey) {
    return Response.json(
      { error: "ยังไม่ได้ตั้งค่า KOB_AI_API_KEY บน Vercel" },
      { status: 503 },
    );
  }

  let body: {
    model?: string;
    messages?: ChatMessage[];
    temperature?: number;
    maxTokens?: number;
  };

  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "ข้อมูลคำขอไม่ถูกต้อง" }, { status: 400 });
  }

  if (!body.model || !Array.isArray(body.messages) || body.messages.length === 0) {
    return Response.json({ error: "กรุณาเลือกโมเดลและใส่ข้อความ" }, { status: 400 });
  }

  const messages = body.messages
    .filter(
      (message): message is ChatMessage =>
        Boolean(
          message &&
            ["system", "user", "assistant"].includes(message.role) &&
            typeof message.content === "string" &&
            message.content.trim(),
        ),
    )
    .slice(-80);

  if (!messages.length) {
    return Response.json({ error: "ไม่พบข้อความที่ส่งให้ AI" }, { status: 400 });
  }

  const temperature = Math.min(2, Math.max(0, Number(body.temperature ?? 0.7)));
  const maxTokens = Math.min(32768, Math.max(256, Number(body.maxTokens ?? 4096)));

  try {
    const upstream = await fetch(`${baseUrl()}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        Accept: "text/event-stream",
      },
      body: JSON.stringify({
        model: body.model,
        messages,
        temperature,
        max_tokens: maxTokens,
        stream: true,
      }),
      signal: request.signal,
    });

    if (!upstream.ok || !upstream.body) {
      const detail = await upstream.text();
      return Response.json(
        {
          error: "Kob AI ตอบกลับด้วยข้อผิดพลาด",
          detail: detail.slice(0, 800),
        },
        { status: upstream.status || 502 },
      );
    }

    return new Response(upstream.body, {
      status: 200,
      headers: {
        "Content-Type": upstream.headers.get("content-type") || "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        "X-Accel-Buffering": "no",
      },
    });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      return new Response(null, { status: 499 });
    }

    return Response.json(
      {
        error: "เชื่อมต่อ Kob AI ไม่สำเร็จ",
        detail: error instanceof Error ? error.message : "ไม่ทราบสาเหตุ",
      },
      { status: 502 },
    );
  }
}

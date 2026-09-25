import { isAuthorized } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type TextPart = { type: "text"; text: string };
type ImagePart = { type: "image_url"; image_url: { url: string } };
type ChatContent = string | Array<TextPart | ImagePart>;

type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: ChatContent;
};

function validContent(content: unknown): content is ChatContent {
  if (typeof content === "string") return Boolean(content.trim());
  if (!Array.isArray(content) || !content.length) return false;
  return content.every((part) => {
    if (!part || typeof part !== "object") return false;
    const value = part as Record<string, unknown>;
    if (value.type === "text") {
      return typeof value.text === "string" && Boolean(value.text.trim());
    }
    if (value.type === "image_url") {
      const image = value.image_url;
      if (!image || typeof image !== "object") return false;
      const url = (image as Record<string, unknown>).url;
      return (
        typeof url === "string" &&
        /^data:image\/(jpeg|png|webp);base64,/i.test(url) &&
        url.length <= 7_500_000
      );
    }
    return false;
  });
}

function baseUrl() {
  return (process.env.KOB_AI_BASE_URL || "https://www.kob-ai.dev/v1").replace(
    /\/$/,
    "",
  );
}

export async function POST(request: Request) {
  if (!(await isAuthorized())) {
    return Response.json({ error: "ไม่ได้รับอนุญาต" }, { status: 401 });
  }

  const apiKey = process.env.KOB_AI_API_KEY;
  if (!apiKey) {
    return Response.json(
      { error: "ระบบ AI ยังไม่พร้อมใช้งาน กรุณาลองใหม่ภายหลัง" },
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

  if (
    !body.model ||
    !Array.isArray(body.messages) ||
    body.messages.length === 0
  ) {
    return Response.json(
      { error: "กรุณาเลือกโมเดลและใส่ข้อความ" },
      { status: 400 },
    );
  }

  const messages = body.messages
    .filter((message): message is ChatMessage =>
      Boolean(
        message &&
        ["system", "user", "assistant"].includes(message.role) &&
        validContent(message.content),
      ),
    )
    .slice(-80);

  if (!messages.length) {
    return Response.json(
      { error: "ไม่พบข้อความที่ส่งให้ AI" },
      { status: 400 },
    );
  }

  const temperature = Math.min(2, Math.max(0, Number(body.temperature ?? 0.7)));
  const maxTokens = Math.min(
    32768,
    Math.max(256, Number(body.maxTokens ?? 4096)),
  );

  try {
    const isGptOss = /^gpt-oss(?::|-)/i.test(body.model);

    const payload = {
      model: body.model,
      messages,
      // gpt-oss is a reasoning model. Keep its sampling conservative and
      // explicitly request low reasoning effort for short interactive chats.
      temperature: isGptOss ? Math.min(temperature, 0.6) : temperature,
      max_tokens: isGptOss ? Math.max(maxTokens, 1024) : maxTokens,
      ...(isGptOss ? { reasoning_effort: "low" } : {}),
    };

    // Normalize Kob AI's different OpenAI-compatible model responses here.
    // The browser always receives one predictable SSE shape.
    const upstream = await fetch(`${baseUrl()}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        ...payload,
        stream: false,
      }),
      signal: request.signal,
    });

    const raw = await upstream.text();

    if (!upstream.ok) {
      let detail = "";
      try {
        const parsed = JSON.parse(raw);
        detail =
          parsed?.error?.message ||
          parsed?.error ||
          parsed?.message ||
          "";
      } catch {
        detail = "";
      }
      return Response.json(
        {
          error:
            typeof detail === "string" && detail.trim()
              ? detail.trim()
              : "Kob AI ตอบกลับด้วยข้อผิดพลาด",
        },
        { status: upstream.status || 502 },
      );
    }

    let data: any;
    try {
      data = JSON.parse(raw);
    } catch {
      return Response.json(
        { error: "รูปแบบคำตอบจาก Kob AI ไม่ถูกต้อง" },
        { status: 502 },
      );
    }

    const message = data?.choices?.[0]?.message;
    const candidate =
      // Only user-facing final content is eligible here. In particular, never
      // fall back to reasoning/reasoning_content for gpt-oss.
      message?.content ??
      data?.choices?.[0]?.delta?.content ??
      data?.choices?.[0]?.text ??
      data?.message?.content ??
      data?.content ??
      data?.response ??
      data?.text ??
      "";

    const content =
      typeof candidate === "string"
        ? candidate
        : Array.isArray(candidate)
          ? candidate
              .map((part: any) =>
                typeof part === "string"
                  ? part
                  : typeof part?.text === "string"
                    ? part.text
                    : typeof part?.content === "string"
                      ? part.content
                      : "",
              )
              .join("")
          : "";

    if (!content.trim()) {
      const finishReason = data?.choices?.[0]?.finish_reason;
      return Response.json(
        {
          error:
            isGptOss && finishReason === "length"
              ? "gpt-oss ใช้โทเคนสำหรับการคิดจนหมดก่อนสร้างคำตอบ กรุณาลองอีกครั้ง"
              : "โมเดลตอบกลับมาแต่ไม่มีข้อความสำหรับแสดงผล",
        },
        { status: 502 },
      );
    }

    const encoder = new TextEncoder();
    const safe = JSON.stringify({
      choices: [{ delta: { content } }],
    });

    return new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(encoder.encode(`data: ${safe}\n\n`));
          controller.enqueue(encoder.encode("data: [DONE]\n\n"));
          controller.close();
        },
      }),
      {
        status: 200,
        headers: {
          "Content-Type": "text/event-stream; charset=utf-8",
          "Cache-Control": "no-cache, no-transform",
          "X-Accel-Buffering": "no",
        },
      },
    );
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      return new Response(null, { status: 499 });
    }

    return Response.json(
      {
        error: "เชื่อมต่อ Kob AI ไม่สำเร็จ",
      },
      { status: 502 },
    );
  }
}

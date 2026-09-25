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

type ApiErrorCode =
  | "model_unavailable"
  | "rate_limit"
  | "timeout"
  | "provider_unavailable"
  | "invalid_request"
  | "context_too_large"
  | "empty_response"
  | "stream_interrupted";

type ApiError = {
  code: ApiErrorCode;
  message: string;
  retryable: boolean;
};

function errorResponse(error: ApiError, status: number) {
  return Response.json({ error }, { status });
}

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

function visibleText(payload: any): string {
  const candidate =
    payload?.choices?.[0]?.delta?.content ??
    payload?.choices?.[0]?.message?.content ??
    payload?.choices?.[0]?.text ??
    payload?.message?.content ??
    payload?.content ??
    payload?.response ??
    payload?.text ??
    "";

  if (typeof candidate === "string") return candidate;

  if (Array.isArray(candidate)) {
    return candidate
      .map((part: any) =>
        typeof part === "string"
          ? part
          : typeof part?.text === "string"
            ? part.text
            : typeof part?.content === "string"
              ? part.content
              : "",
      )
      .join("");
  }

  return "";
}

function classifyUpstreamError(status: number, detail: string): ApiError {
  if (status === 429) {
    return {
      code: "rate_limit",
      message: "มีการใช้งานโมเดลมากเกินไปในขณะนี้ กรุณารอสักครู่แล้วลองอีกครั้ง",
      retryable: true,
    };
  }

  if (status === 408 || status === 504) {
    return {
      code: "timeout",
      message: "โมเดลใช้เวลาตอบนานเกินกำหนด กรุณาลองอีกครั้ง",
      retryable: true,
    };
  }

  if (
    status === 404 ||
    ([400, 422].includes(status) &&
      /model|not found|unavailable|unsupported/i.test(detail))
  ) {
    return {
      code: "model_unavailable",
      message: "โมเดลนี้ยังไม่พร้อมใช้งาน กรุณาลองอีกครั้งหรือเลือกโมเดลอื่น",
      retryable: true,
    };
  }

  if (status >= 500 || status === 401 || status === 403) {
    return {
      code: "provider_unavailable",
      message: "เชื่อมต่อ Kob AI ไม่สำเร็จ กรุณาลองอีกครั้งในอีกสักครู่",
      retryable: true,
    };
  }

  return {
    code: "invalid_request",
    message: "ไม่สามารถส่งคำขอนี้ให้โมเดลได้ กรุณาตรวจสอบข้อความแล้วลองอีกครั้ง",
    retryable: false,
  };
}

function streamError(error: ApiError) {
  return `data: ${JSON.stringify({ error })}\n\n`;
}

const CONTEXT_TOKEN_BUDGET = 24_000;

function estimateChatTokens(message: ChatMessage) {
  if (typeof message.content === "string") {
    return Math.max(1, Math.ceil(message.content.length / 2.5) + 8);
  }

  let tokens = 8;
  for (const part of message.content) {
    if (part.type === "text") {
      tokens += Math.ceil(part.text.length / 2.5);
    } else {
      tokens += 1_200;
    }
  }
  return Math.max(1, tokens);
}

function manageContext(messages: ChatMessage[]) {
  const systemMessages = messages.filter((message) => message.role === "system");
  const conversation = messages.filter((message) => message.role !== "system");
  const systemTokens = systemMessages.reduce(
    (sum, message) => sum + estimateChatTokens(message),
    0,
  );
  const available = Math.max(4_000, CONTEXT_TOKEN_BUDGET - systemTokens);

  if (!conversation.length) {
    return {
      messages: systemMessages,
      latestTooLarge: false,
      droppedMessages: 0,
    };
  }

  const latestCost = estimateChatTokens(conversation[conversation.length - 1]);
  const selected: ChatMessage[] = [];
  let used = 0;

  for (let index = conversation.length - 1; index >= 0; index -= 1) {
    const message = conversation[index];
    const cost = estimateChatTokens(message);

    if (index === conversation.length - 1 || used + cost <= available) {
      selected.push(message);
      used += cost;
    } else {
      break;
    }
  }

  selected.reverse();
  while (selected.length > 1 && selected[0]?.role === "assistant") {
    selected.shift();
  }

  return {
    messages: [...systemMessages, ...selected],
    latestTooLarge: latestCost > available,
    droppedMessages: Math.max(0, conversation.length - selected.length),
  };
}

export async function POST(request: Request) {
  if (!(await isAuthorized())) {
    return Response.json({ error: "ไม่ได้รับอนุญาต" }, { status: 401 });
  }

  const apiKey = process.env.KOB_AI_API_KEY;
  if (!apiKey) {
    return errorResponse(
      {
        code: "provider_unavailable",
        message: "ระบบ AI ยังไม่พร้อมใช้งาน กรุณาลองใหม่ภายหลัง",
        retryable: true,
      },
      503,
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
    return errorResponse(
      {
        code: "invalid_request",
        message: "ข้อมูลคำขอไม่ถูกต้อง กรุณาลองใหม่อีกครั้ง",
        retryable: false,
      },
      400,
    );
  }

  if (
    !body.model ||
    !Array.isArray(body.messages) ||
    body.messages.length === 0
  ) {
    return errorResponse(
      {
        code: "invalid_request",
        message: "กรุณาเลือกโมเดลและใส่ข้อความ",
        retryable: false,
      },
      400,
    );
  }

  const validMessages = body.messages.filter(
    (message): message is ChatMessage =>
      Boolean(
        message &&
        ["system", "user", "assistant"].includes(message.role) &&
        validContent(message.content),
      ),
  );

  if (!validMessages.length) {
    return errorResponse(
      {
        code: "invalid_request",
        message: "ไม่พบข้อความที่ส่งให้ AI",
        retryable: false,
      },
      400,
    );
  }

  const managedContext = manageContext(validMessages);

  if (managedContext.latestTooLarge) {
    return errorResponse(
      {
        code: "context_too_large",
        message:
          "ข้อความหรือไฟล์ล่าสุดยาวเกินขนาดบริบทที่ปลอดภัย กรุณาแบ่งเนื้อหาเป็นส่วนย่อยแล้วส่งใหม่",
        retryable: false,
      },
      413,
    );
  }

  const messages = managedContext.messages;

  const temperature = Math.min(2, Math.max(0, Number(body.temperature ?? 0.7)));
  const maxTokens = Math.min(
    32768,
    Math.max(256, Number(body.maxTokens ?? 4096)),
  );

  const upstreamController = new AbortController();
  let connectionTimedOut = false;
  const onClientAbort = () => upstreamController.abort();
  request.signal.addEventListener("abort", onClientAbort, { once: true });
  const connectionTimer = setTimeout(() => {
    connectionTimedOut = true;
    upstreamController.abort();
  }, 60_000);

  try {
    const isGptOss = /^gpt-oss(?::|-)/i.test(body.model);
    const payload = {
      model: body.model,
      messages,
      temperature: isGptOss ? Math.min(temperature, 0.6) : temperature,
      max_tokens: isGptOss ? Math.max(maxTokens, 1024) : maxTokens,
      ...(isGptOss ? { reasoning_effort: "low" } : {}),
    };

    const upstream = await fetch(`${baseUrl()}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        Accept: "text/event-stream, application/json",
      },
      body: JSON.stringify({
        ...payload,
        stream: true,
      }),
      signal: upstreamController.signal,
    });

    clearTimeout(connectionTimer);

    if (!upstream.ok || !upstream.body) {
      request.signal.removeEventListener("abort", onClientAbort);
      const raw = await upstream.text().catch(() => "");
      let detail = "";
      try {
        const parsed = JSON.parse(raw);
        const value =
          parsed?.error?.message ?? parsed?.error ?? parsed?.message ?? "";
        detail = typeof value === "string" ? value : "";
      } catch {
        detail = "";
      }
      return errorResponse(
        classifyUpstreamError(upstream.status || 502, detail),
        upstream.status || 502,
      );
    }

    const contentType = upstream.headers.get("content-type") || "";
    const encoder = new TextEncoder();

    if (!contentType.includes("text/event-stream")) {
      const raw = await upstream.text();
      request.signal.removeEventListener("abort", onClientAbort);

      let data: any;
      try {
        data = JSON.parse(raw);
      } catch {
        return errorResponse(
          {
            code: "provider_unavailable",
            message: "Kob AI ส่งคำตอบในรูปแบบที่ระบบอ่านไม่ได้ กรุณาลองอีกครั้ง",
            retryable: true,
          },
          502,
        );
      }

      const content = visibleText(data);
      if (!content.trim()) {
        return errorResponse(
          {
            code: "empty_response",
            message: "โมเดลตอบกลับมาแต่ไม่มีข้อความ กรุณาลองอีกครั้ง",
            retryable: true,
          },
          502,
        );
      }

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
    }

    const reader = upstream.body.getReader();
    const decoder = new TextDecoder();

    const stream = new ReadableStream({
      async start(controller) {
        let buffer = "";
        let sentVisibleText = false;
        let closed = false;

        const close = () => {
          if (closed) return;
          closed = true;
          controller.enqueue(encoder.encode("data: [DONE]\n\n"));
          controller.close();
          request.signal.removeEventListener("abort", onClientAbort);
        };

        const emitPayload = (payloadText: string) => {
          if (!payloadText || payloadText === "[DONE]") return;

          try {
            const parsed = JSON.parse(payloadText);
            const text = visibleText(parsed);
            if (text) {
              sentVisibleText = true;
              const safe = JSON.stringify({
                choices: [{ delta: { content: text } }],
              });
              controller.enqueue(encoder.encode(`data: ${safe}\n\n`));
            }
          } catch {
            // Ignore malformed/non-JSON provider events without breaking chat.
          }
        };

        const readWithTimeout = async () => {
          let timer: ReturnType<typeof setTimeout> | undefined;
          try {
            return await Promise.race([
              reader.read(),
              new Promise<never>((_, reject) => {
                timer = setTimeout(
                  () => reject(new Error("STREAM_IDLE_TIMEOUT")),
                  60_000,
                );
              }),
            ]);
          } finally {
            if (timer) clearTimeout(timer);
          }
        };

        try {
          while (true) {
            const { done, value } = await readWithTimeout();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split(/\r?\n/);
            buffer = lines.pop() ?? "";

            for (const rawLine of lines) {
              const line = rawLine.trim();
              if (!line.startsWith("data:")) continue;
              emitPayload(line.slice(5).trim());
            }
          }

          buffer += decoder.decode();
          for (const rawLine of buffer.split(/\r?\n/)) {
            const line = rawLine.trim();
            if (!line.startsWith("data:")) continue;
            emitPayload(line.slice(5).trim());
          }

          if (!sentVisibleText) {
            controller.enqueue(
              encoder.encode(
                streamError({
                  code: "empty_response",
                  message: "โมเดลตอบกลับมาแต่ไม่มีข้อความ กรุณาลองอีกครั้ง",
                  retryable: true,
                }),
              ),
            );
          }

          close();
        } catch (error) {
          if (request.signal.aborted) {
            if (!closed) controller.close();
            request.signal.removeEventListener("abort", onClientAbort);
            return;
          }

          const timedOut =
            error instanceof Error && error.message === "STREAM_IDLE_TIMEOUT";
          controller.enqueue(
            encoder.encode(
              streamError({
                code: timedOut ? "timeout" : "stream_interrupted",
                message: timedOut
                  ? "โมเดลหยุดตอบนานเกินกำหนด กรุณาลองอีกครั้ง"
                  : "การเชื่อมต่อกับ AI ขาดหายระหว่างตอบ กรุณาลองอีกครั้ง",
                retryable: true,
              }),
            ),
          );
          close();
        }
      },
      cancel() {
        upstreamController.abort();
        reader.cancel().catch(() => {});
        request.signal.removeEventListener("abort", onClientAbort);
      },
    });

    return new Response(stream, {
      status: 200,
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        "X-Accel-Buffering": "no",
      },
    });
  } catch (error) {
    clearTimeout(connectionTimer);
    request.signal.removeEventListener("abort", onClientAbort);

    if (request.signal.aborted) {
      return new Response(null, { status: 499 });
    }

    if (connectionTimedOut) {
      return errorResponse(
        {
          code: "timeout",
          message: "เชื่อมต่อโมเดลนานเกินกำหนด กรุณาลองอีกครั้ง",
          retryable: true,
        },
        504,
      );
    }

    return errorResponse(
      {
        code: "provider_unavailable",
        message: "เชื่อมต่อ Kob AI ไม่สำเร็จ กรุณาลองอีกครั้งในอีกสักครู่",
        retryable: true,
      },
      502,
    );
  }
}

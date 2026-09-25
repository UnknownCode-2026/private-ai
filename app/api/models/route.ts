import { isAuthorized } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function baseUrl() {
  return (process.env.KOB_AI_BASE_URL || "https://www.kob-ai.dev/v1").replace(/\/$/, "");
}

export async function GET() {
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

  try {
    const response = await fetch(`${baseUrl()}/models`, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: "application/json",
      },
      cache: "no-store",
    });

    const text = await response.text();
    if (!response.ok) {
      return Response.json(
        { error: "โหลดรายชื่อโมเดลจาก Kob AI ไม่สำเร็จ", detail: text.slice(0, 400) },
        { status: response.status },
      );
    }

    const data: unknown = JSON.parse(text);
    const source =
      data && typeof data === "object" && "data" in data
        ? (data as { data?: unknown }).data
        : undefined;
    const rawModels: unknown[] = Array.isArray(source) ? source : [];
    const models: { id: string; ownedBy: string }[] = [];

    for (const raw of rawModels) {
      if (!raw || typeof raw !== "object" || !("id" in raw)) continue;
      const id = (raw as { id?: unknown }).id;
      if (typeof id !== "string") continue;
      const owner = (raw as { owned_by?: unknown }).owned_by;
      models.push({ id, ownedBy: typeof owner === "string" ? owner : "" });
    }

    models.sort((a, b) => a.id.localeCompare(b.id));

    return Response.json({ models });
  } catch (error) {
    return Response.json(
      {
        error: "เชื่อมต่อ Kob AI ไม่สำเร็จ",
        detail: error instanceof Error ? error.message : "ไม่ทราบสาเหตุ",
      },
      { status: 502 },
    );
  }
}

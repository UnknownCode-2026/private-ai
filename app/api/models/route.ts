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

    const data = JSON.parse(text);
    const models = Array.isArray(data?.data)
      ? data.data
          .filter((item: unknown) => item && typeof item === "object" && "id" in item)
          .map((item: { id: string; owned_by?: string }) => ({
            id: item.id,
            ownedBy: item.owned_by || "",
          }))
          .sort((a: { id: string }, b: { id: string }) => a.id.localeCompare(b.id))
      : [];

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

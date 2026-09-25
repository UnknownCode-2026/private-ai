import { test, expect, Page } from "@playwright/test";
const sizes = [
  [320, 568],
  [360, 800],
  [375, 812],
  [390, 844],
  [412, 915],
  [430, 932],
  [768, 1024],
  [1440, 900],
  [844, 390],
];
async function session(page: Page) {
  const response = await page.request.post("/api/auth", {
    data: { pin: "local-test-only" },
  });
  expect(response.status()).toBe(200);
  expect(response.headers()["set-cookie"]).toContain("HttpOnly");
  await page.goto("/");
  await expect(page.locator(".current-model")).toHaveText(
    "model-long-" + "name".repeat(30),
  );
}
async function noOverflow(page: Page) {
  const result = await page.evaluate(() => ({
    width: document.documentElement.clientWidth,
    scroll: document.documentElement.scrollWidth,
    body: document.body.scrollWidth,
    main: document.querySelector(".main-panel")?.getBoundingClientRect().right,
  }));
  expect(result.scroll).toBeLessThanOrEqual(result.width);
  expect(result.body).toBeLessThanOrEqual(result.width);
  if (result.main) expect(result.main).toBeLessThanOrEqual(result.width + 1);
}
for (const [width, height] of sizes) {
  test(`responsive ${width}x${height}`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await page.goto("/");
    await expect(
      page.getByRole("heading", { name: "ThaiBan AI" }),
    ).toBeVisible();
    await noOverflow(page);
    await session(page);
    await noOverflow(page);
    await page.screenshot({ path: `test-results/welcome-${width}.png` });
    await page
      .getByLabel("ข้อความถึง ThaiBan AI")
      .fill("ทดสอบ " + "ยาว".repeat(150));
    await page.getByLabel("ส่งข้อความ", { exact: true }).click();
    await expect(
      page.getByRole("button", { name: "สร้างคำตอบใหม่" }),
    ).toBeVisible();
    await expect(page.locator(".code-wrap")).toBeVisible();
    await noOverflow(page);
    expect(
      await page.locator(".code-wrap code").evaluate((el) => {
        const scroller = el.parentElement;
        return Boolean(scroller && scroller.scrollWidth > scroller.clientWidth);
      }),
    ).toBeTruthy();
    await expect(page.locator(".table-scroll")).toBeVisible();
    if (width <= 900) await page.getByLabel("เปิดเมนู").click();
    await expect(
      page.getByRole("button", { name: "การตั้งค่า", exact: true }),
    ).toBeVisible();
    await noOverflow(page);
    await page.getByRole("button", { name: "การตั้งค่า", exact: true }).click();
    await expect(
      page.getByRole("dialog", { name: "การตั้งค่า", exact: true }),
    ).toBeVisible();
    await noOverflow(page);
    await page.getByRole("button", { name: "สว่าง", exact: true }).click();
    await page.screenshot({ path: `test-results/settings-light-${width}.png` });
    await page.getByLabel("ปิดการตั้งค่า", { exact: true }).click();
    if (width <= 900) await page.getByLabel("ปิดเมนู", { exact: true }).click();
    await noOverflow(page);
    await page.getByLabel("ข้อความถึง ThaiBan AI").fill("บรรทัด\n".repeat(40));
    const compactHeight = Math.min(height, 400);
    await page.setViewportSize({ width, height: compactHeight });
    await page.evaluate(() => window.dispatchEvent(new Event("resize")));
    await expect
      .poll(async () => {
        const send = await page
          .getByLabel("ส่งข้อความ", { exact: true })
          .boundingBox();
        return send ? send.y + send.height : Number.POSITIVE_INFINITY;
      })
      .toBeLessThanOrEqual(compactHeight);
  });
}

test("migration preserves V1, custom settings, history and refresh", async ({
  page,
}) => {
  await page.goto("/");
  const old = [
    {
      id: "legacy",
      title: "แชตเดิม",
      createdAt: 1,
      updatedAt: 1,
      messages: [
        { id: "m1", role: "user", content: "ประวัติเดิม", createdAt: 1 },
      ],
    },
  ];
  await page.evaluate((old) => {
    localStorage.setItem("private-ai-history-v1", JSON.stringify(old));
    localStorage.setItem(
      "private-ai-settings-v1",
      JSON.stringify({
        model: "model-test",
        systemPrompt: "คำสั่งของฉัน",
        theme: "light",
      }),
    );
  }, old);
  await page.request.post("/api/auth", { data: { pin: "local-test-only" } });
  await page.reload();
  await expect(page.locator(".message-content")).toHaveText("ประวัติเดิม");
  await expect
    .poll(() =>
      page.evaluate(() => localStorage.getItem("thaiban-ai-history-v1")),
    )
    .toBe(JSON.stringify(old));
  expect(
    await page.evaluate(
      () =>
        JSON.parse(localStorage.getItem("thaiban-ai-settings-v1")!)
          .systemPrompt,
    ),
  ).toBe("คำสั่งของฉัน");
  expect(
    await page.evaluate(() => localStorage.getItem("private-ai-history-v1")),
  ).toBe(JSON.stringify(old));
  await page.reload();
  await expect(page.locator(".message-content")).toHaveText("ประวัติเดิม");
});
test("stop, regenerate, copy, rename, delete and logout", async ({
  page,
  context,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await session(page);
  await page.getByLabel("ข้อความถึง ThaiBan AI").fill("slow");
  await page.getByLabel("ส่งข้อความ", { exact: true }).click();
  await expect(page.getByLabel("หยุดการตอบ")).toBeVisible();
  await page.getByLabel("หยุดการตอบ").click();
  await expect(page.getByLabel("ส่งข้อความ", { exact: true })).toBeVisible();
  await page.getByLabel("ข้อความถึง ThaiBan AI").fill("คำตอบปกติ");
  await page.getByLabel("ส่งข้อความ", { exact: true }).click();
  await expect(
    page.getByRole("button", { name: "สร้างคำตอบใหม่" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "สร้างคำตอบใหม่" }).click();
  await expect(
    page.getByRole("button", { name: "สร้างคำตอบใหม่" }),
  ).toBeVisible();
  await page.locator(".code-copy").last().click();
  await expect(page.locator(".notice")).toContainText("คัดลอกแล้ว");
  await page.getByLabel("เปิดเมนู").click();
  page.once("dialog", (d) => d.accept("ชื่อใหม่"));
  await page.getByLabel("เปลี่ยนชื่อแชต").click();
  await expect(page.locator(".chat-title")).toHaveText("ชื่อใหม่");
  await page.getByRole("button", { name: "แชตใหม่", exact: true }).click();
  await page.getByLabel("เปิดเมนู").click();
  page.once("dialog", (d) => d.accept());
  await page.getByLabel("ลบแชต").first().click();
  await expect(page.locator(".chat-title")).toHaveText("ชื่อใหม่");
  await page.getByRole("button", { name: "ออกจากระบบ" }).click();
  await expect(page.getByRole("heading", { name: "ThaiBan AI" })).toBeVisible();
  expect((await page.request.get("/api/models")).status()).toBe(401);
});
test("invalid storage never overwritten and new key wins", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() =>
    localStorage.setItem("thaiban-ai-history-v1", "broken-json"),
  );
  await page.request.post("/api/auth", { data: { pin: "local-test-only" } });
  await page.reload();
  await expect(page.locator(".notice")).toContainText("อ่านข้อมูลเดิมไม่ได้");
  expect(
    await page.evaluate(() => localStorage.getItem("thaiban-ai-history-v1")),
  ).toBe("broken-json");
});
test("API auth, errors and PWA", async ({ request }) => {
  expect((await request.get("/api/models")).status()).toBe(401);
  expect(
    (await request.post("/api/auth", { data: { pin: 123 } })).status(),
  ).toBe(401);
  const manifest = await (await request.get("/manifest.webmanifest")).json();
  expect(manifest.name).toBe("ThaiBan AI");
  for (const icon of manifest.icons)
    expect((await request.get(icon.src)).status()).toBe(200);
  expect(await (await request.get("/sw.js")).text()).toContain(
    "thaiban-ai-v1.2",
  );
});

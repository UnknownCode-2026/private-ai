import http from "node:http";
const text =
  '# คำตอบทดสอบ\n\nข้อความภาษาไทย **อ่านง่าย**\n\n- รายการแรก\n- รายการสอง\n\n> ข้อความอ้างอิง\n\n```typescript\nconst long = "' +
  "abcdef".repeat(100) +
  '";\n```\n\n| หัวข้อ | รายละเอียด |\n| --- | --- |\n| ทดสอบ | ' +
  "long".repeat(150) +
  " |\n\n" +
  "ข้อความยาวสำหรับทดสอบ ".repeat(80);
http
  .createServer(async (req, res) => {
    if (req.url === "/v1/models") {
      res.setHeader("Content-Type", "application/json");
      return res.end(
        JSON.stringify({
          data: [
            { id: "model-test" },
            { id: "model-long-" + "name".repeat(30) },
          ],
        }),
      );
    }
    let raw = "";
    for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw);
    const slow = body.messages?.at(-1)?.content.includes("slow");
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    const parts = slow
      ? Array(100).fill("ข้อความต่อเนื่อง ")
      : [text.slice(0, 100), text.slice(100)];
    let i = 0;
    const timer = setInterval(
      () => {
        if (i === parts.length) {
          clearInterval(timer);
          return res.end("data: [DONE]\n\n");
        }
        res.write(
          "data: " +
            JSON.stringify({ choices: [{ delta: { content: parts[i++] } }] }) +
            "\n\n",
        );
      },
      slow ? 100 : 30,
    );
    res.on("close", () => clearInterval(timer));
  })
  .listen(3101, "127.0.0.1");

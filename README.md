# ThaiBan AI V1.1

AI ส่วนตัว ภาษาไทย ออกแบบสำหรับมือถือ ใช้ Next.js 16, React 19 และ TypeScript

Production: https://thaibanai.vercel.app/

## เริ่มใช้งาน

ใช้ Node.js 24 และ `npm ci` จากนั้นคัดลอก `.env.example` เป็น `.env.local` แล้วตั้งค่าเฉพาะบนเซิร์ฟเวอร์:

- `KOB_AI_API_KEY`: คีย์ Kob AI
- `PRIVATE_AI_PIN`: รหัสเข้าใช้งานเดิม คงชื่อเพื่อรองรับ Production
- `KOB_AI_BASE_URL`: `https://www.kob-ai.dev/v1`

ห้ามใส่ค่าจริงใน Git หรือใช้ `NEXT_PUBLIC_` กับความลับ

`npm run dev` เปิดโหมดพัฒนา ส่วน `npm run build` และ `npm start` ใช้ตรวจและรัน Production

## V1.1

- แบรนด์ ThaiBan AI พร้อมเครื่องหมาย TB และไอคอนติดตั้งมือถือ
- หน้าเข้าสู่ระบบ แชต เมนู และการตั้งค่าออกแบบใหม่
- ธีมมืด/สว่าง ตัวอักษรไทย ปุ่มอย่างน้อย 44px
- คีย์บอร์ดมือถือใช้ Visual Viewport ช่องข้อความขยายอัตโนมัติ
- Markdown ตาราง และโค้ดเลื่อนภายใน พร้อมคัดลอก
- ส่งข้อความแบบสตรีม หยุด และสร้างคำตอบใหม่
- ประวัติแชต เปลี่ยนชื่อ ลบ และสร้างแชตใหม่
- แป้นพิมพ์ Escape และ Tab ใช้งานใน Drawer/การตั้งค่าได้

## การย้ายข้อมูล

เมื่อเข้าสู่ระบบครั้งแรก V1.1 จะคัดลอก `private-ai-history-v1` และ `private-ai-settings-v1` ไป `thaiban-ai-history-v1` และ `thaiban-ai-settings-v1` เฉพาะเมื่อคีย์ใหม่ยังไม่มี ไม่ลบคีย์เก่า ไม่เปลี่ยนประวัติหรือคำสั่งที่ผู้ใช้เขียนเอง เปลี่ยนเฉพาะคำสั่งเริ่มต้นเดิมที่ตรงกันทั้งหมด

หากอ่านหรือเขียนข้อมูลไม่ได้ จะพักการบันทึกและแจ้งเตือนเพื่อไม่เขียนทับต้นฉบับ ประวัติเก็บเฉพาะเบราว์เซอร์และ origin เดิม การเปลี่ยนโดเมนหรืออุปกรณ์ไม่ย้ายข้อมูลข้ามกันอัตโนมัติ

## Backend และความปลอดภัย

คง API `/models`, `/chat/completions`, พารามิเตอร์และ Streaming ของ Kob AI คง `PRIVATE_AI_PIN`, ชื่อคุกกี้และรูปแบบการตรวจสิทธิ์เพื่อความเข้ากันได้ คุกกี้เป็น HttpOnly, SameSite=Strict และ Secure บน Production คีย์ API อยู่เฉพาะฝั่งเซิร์ฟเวอร์ ข้อผิดพลาดไม่ส่งรายละเอียด upstream หรือ stack trace ให้เบราว์เซอร์

## PWA

Manifest ใช้ชื่อ ThaiBan AI, standalone, ไอคอน PNG 192/512, maskable และ Apple touch icon Service worker `thaiban-ai-v1.1` ล้างแคชแบรนด์เก่าเฉพาะของแอปนี้ และเก็บเฉพาะไอคอน ไม่แคชข้อมูลส่วนตัว หน้าแชต หรือ API การสนทนากับ AI ต้องเชื่อมต่ออินเทอร์เน็ต

## การเผยแพร่

Vercel เชื่อม repository `UnknownCode-2026/thaibanai` สาขา `main` ตรวจ Build ก่อน push และตรวจ Production deployment ของ commit เดียวกันจน READY

## ทดสอบอัตโนมัติ

`npm run build`, `npx playwright install chromium`, `npm run test:e2e` ทดสอบกับ upstream จำลองภายในเครื่องและ PIN สำหรับทดสอบเท่านั้น ไม่มี Secret จริง ชุดทดสอบครอบคลุมเก้าขนาดหน้าจอ ประวัติ V1 สตรีม หยุด คัดลอก เปลี่ยนชื่อ ลบ ธีม และ manifest การทดสอบจริงกับ Kob AI ต้องเข้าสู่ระบบ Production แยกต่างหาก

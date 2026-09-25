import { isAuthorized } from "@/lib/auth";
import "pdf-parse/worker";
import { PDFParse } from "pdf-parse";
import * as mammoth from "mammoth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_FILE_BYTES = 8 * 1024 * 1024;
const MAX_EXTRACTED_CHARS = 45_000;

type DocumentKind = "pdf" | "docx";

function normalizeText(value: string) {
  return value
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function extensionOf(name: string) {
  return name.split(".").pop()?.toLowerCase() || "";
}

function documentError(
  code: string,
  message: string,
  status: number,
) {
  return Response.json(
    {
      error: {
        code,
        message,
      },
    },
    { status },
  );
}

function looksLikePdf(data: Uint8Array) {
  if (data.length < 5) return false;
  return String.fromCharCode(...data.slice(0, 5)) === "%PDF-";
}

function looksLikeZip(data: Uint8Array) {
  return (
    data.length >= 4 &&
    data[0] === 0x50 &&
    data[1] === 0x4b &&
    (data[2] === 0x03 || data[2] === 0x05 || data[2] === 0x07) &&
    (data[3] === 0x04 || data[3] === 0x06 || data[3] === 0x08)
  );
}

function isPasswordError(error: unknown) {
  if (!(error instanceof Error)) return false;
  return /password|PasswordException|NeedPasswordException|IncorrectPasswordException/i.test(
    `${error.name} ${error.message}`,
  );
}

async function extractPdf(data: Uint8Array) {
  const parser = new PDFParse({ data });

  try {
    const result = await parser.getText();
    return normalizeText(result.text || "");
  } finally {
    await parser.destroy().catch(() => undefined);
  }
}

async function extractDocx(buffer: Buffer) {
  const result = await mammoth.extractRawText({ buffer });
  return normalizeText(result.value || "");
}

export async function POST(request: Request) {
  if (!(await isAuthorized())) {
    return Response.json({ error: "ไม่ได้รับอนุญาต" }, { status: 401 });
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return documentError(
      "invalid_upload",
      "ข้อมูลไฟล์ไม่ถูกต้อง กรุณาเลือกไฟล์ใหม่แล้วลองอีกครั้ง",
      400,
    );
  }

  const file = form.get("file");
  if (!(file instanceof File)) {
    return documentError("missing_file", "กรุณาเลือกไฟล์ PDF หรือ DOCX", 400);
  }

  const extension = extensionOf(file.name);
  if (!["pdf", "docx"].includes(extension)) {
    return documentError(
      "unsupported_file",
      "รองรับเฉพาะไฟล์ PDF และ DOCX สำหรับการอ่านเอกสาร",
      415,
    );
  }

  if (file.size <= 0) {
    return documentError("empty_file", "ไฟล์นี้ไม่มีข้อมูล", 400);
  }

  if (file.size > MAX_FILE_BYTES) {
    return documentError(
      "file_too_large",
      "ไฟล์ PDF หรือ DOCX ต้องมีขนาดไม่เกิน 8 MB",
      413,
    );
  }

  const arrayBuffer = await file.arrayBuffer();
  const data = new Uint8Array(arrayBuffer);
  const kind = extension as DocumentKind;

  if (kind === "pdf" && !looksLikePdf(data)) {
    return documentError(
      "invalid_pdf",
      "ไฟล์นี้ไม่ใช่ PDF ที่ถูกต้องหรือไฟล์อาจเสียหาย",
      400,
    );
  }

  if (kind === "docx" && !looksLikeZip(data)) {
    return documentError(
      "invalid_docx",
      "ไฟล์นี้ไม่ใช่ DOCX ที่ถูกต้องหรือไฟล์อาจเสียหาย",
      400,
    );
  }

  try {
    const extracted =
      kind === "pdf"
        ? await extractPdf(data)
        : await extractDocx(Buffer.from(arrayBuffer));

    if (!extracted) {
      return documentError(
        "no_text",
        kind === "pdf"
          ? "PDF นี้ไม่มีข้อความที่อ่านได้ อาจเป็นเอกสารสแกนหรือมีแต่รูปภาพ"
          : "DOCX นี้ไม่มีข้อความที่อ่านได้",
        422,
      );
    }

    const originalCharacters = extracted.length;
    const truncated = originalCharacters > MAX_EXTRACTED_CHARS;
    const text = truncated
      ? extracted.slice(0, MAX_EXTRACTED_CHARS).trimEnd() +
        "\n\n[ข้อความส่วนที่เหลือถูกตัดเพื่อควบคุมขนาดบริบท]"
      : extracted;

    return Response.json({
      ok: true,
      name: file.name,
      type:
        kind === "pdf"
          ? "application/pdf"
          : "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      size: file.size,
      kind,
      text,
      truncated,
      originalCharacters,
      extractedCharacters: text.length,
    });
  } catch (error) {
    if (kind === "pdf" && isPasswordError(error)) {
      return documentError(
        "password_protected",
        "PDF นี้มีรหัสผ่าน กรุณาปลดรหัสผ่านก่อนอัปโหลด",
        422,
      );
    }

    return documentError(
      kind === "pdf" ? "pdf_read_failed" : "docx_read_failed",
      kind === "pdf"
        ? "อ่าน PDF ไม่สำเร็จ ไฟล์อาจเสียหายหรือใช้รูปแบบที่ไม่รองรับ"
        : "อ่าน DOCX ไม่สำเร็จ ไฟล์อาจเสียหายหรือใช้รูปแบบที่ไม่รองรับ",
      422,
    );
  }
}

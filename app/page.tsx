"use client";

import {
  FormEvent,
  KeyboardEvent,
  ReactNode,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

type Role = "user" | "assistant";

type ImageAttachment = {
  dataUrl: string;
  name: string;
  type: string;
};

type TextFileAttachment = {
  name: string;
  type: string;
  size: number;
  content: string;
};

type Message = {
  id: string;
  role: Role;
  content: string;
  createdAt: number;
  image?: ImageAttachment;
  file?: TextFileAttachment;
};

type Conversation = {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messages: Message[];
};

type ModelItem = {
  id: string;
  ownedBy?: string;
};

type Settings = {
  model: string;
  systemPrompt: string;
  temperature: number;
  maxTokens: number;
  enterToSend: boolean;
  theme: "dark" | "light";
};

const HISTORY_KEY = "thaiban-ai-history-v1";
const SETTINGS_KEY = "thaiban-ai-settings-v1";

// Copy only when the new key is absent. Never remove or overwrite the V1 backup.
function migrateStorage() {
  for (const [oldKey, newKey] of [
    ["private-ai-history-v1", HISTORY_KEY],
    ["private-ai-settings-v1", SETTINGS_KEY],
  ]) {
    if (localStorage.getItem(newKey) === null) {
      const old = localStorage.getItem(oldKey);
      if (old !== null) {
        JSON.parse(old);
        localStorage.setItem(newKey, old);
        if (localStorage.getItem(newKey) !== old) throw new Error("migration");
      }
    }
  }
}

const DEFAULT_SETTINGS: Settings = {
  model: "",
  systemPrompt:
    "คุณคือ ThaiBan AI ผู้ช่วยส่วนตัวของผู้ใช้ ตอบเป็นภาษาไทยเป็นหลัก ให้คำตอบที่ชัดเจน ถูกต้อง กระชับเมื่อทำได้ และแสดงโค้ดใน code block เมื่อมีโค้ด",
  temperature: 0.7,
  maxTokens: 4096,
  enterToSend: true,
  theme: "dark",
};

function uid() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function blankConversation(): Conversation {
  const now = Date.now();
  return {
    id: uid(),
    title: "แชตใหม่",
    createdAt: now,
    updatedAt: now,
    messages: [],
  };
}

function textFromNode(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textFromNode).join("");
  if (node && typeof node === "object" && "props" in node) {
    return textFromNode(
      (node as { props?: { children?: ReactNode } }).props?.children,
    );
  }
  return "";
}

function Markdown({
  children,
  onCopy,
}: {
  children: string;
  onCopy: (value: string) => Promise<void>;
}) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        a: ({ children: linkChildren, ...props }) => (
          <a {...props} target="_blank" rel="noreferrer">
            {linkChildren}
          </a>
        ),
        table: ({ children: tableChildren }) => (
          <div
            className="table-scroll"
            tabIndex={0}
            role="region"
            aria-label="ตาราง เลื่อนแนวนอนเพื่ออ่าน"
          >
            <table>{tableChildren}</table>
          </div>
        ),
        pre: ({ children: preChildren }) => {
          const code = textFromNode(preChildren).replace(/\n$/, "");
          return (
            <div className="code-wrap">
              <button
                className="code-copy"
                type="button"
                onClick={() => void onCopy(code)}
              >
                คัดลอก
              </button>
              <pre tabIndex={0} aria-label="โค้ด เลื่อนแนวนอนเพื่ออ่าน">
                {preChildren}
              </pre>
            </div>
          );
        },
      }}
    >
      {children}
    </ReactMarkdown>
  );
}

export default function Home() {
  const [sessionLoading, setSessionLoading] = useState(true);
  const [configured, setConfigured] = useState(true);
  const [authenticated, setAuthenticated] = useState(false);
  const [pin, setPin] = useState("");
  const [pinError, setPinError] = useState("");
  const [authBusy, setAuthBusy] = useState(false);

  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeId, setActiveId] = useState("");
  const [historyReady, setHistoryReady] = useState(false);
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [models, setModels] = useState<ModelItem[]>([]);
  const [modelsError, setModelsError] = useState("");
  const [input, setInput] = useState("");
  const [pendingImage, setPendingImage] = useState<ImageAttachment | null>(null);
  const [pendingFile, setPendingFile] = useState<TextFileAttachment | null>(null);
  const [streaming, setStreaming] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [notice, setNotice] = useState("");
  const [storageError, setStorageError] = useState(false);
  const [mobile, setMobile] = useState(true);
  const sidebarRef = useRef<HTMLElement | null>(null);
  const settingsRef = useRef<HTMLElement | null>(null);
  const messagesRef = useRef<HTMLDivElement | null>(null);
  const followRef = useRef(true);

  const abortRef = useRef<AbortController | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const activeConversation = useMemo(
    () =>
      conversations.find((item) => item.id === activeId) ?? conversations[0],
    [conversations, activeId],
  );

  useEffect(() => {
    fetch("/api/session", { cache: "no-store" })
      .then((response) => response.json())
      .then((data) => {
        setConfigured(Boolean(data.configured));
        setAuthenticated(Boolean(data.authenticated));
      })
      .catch(() => {
        setConfigured(false);
      })
      .finally(() => setSessionLoading(false));
  }, []);

  useEffect(() => {
    if (!authenticated) return;

    try {
      migrateStorage();
      const rawHistory = localStorage.getItem(HISTORY_KEY);
      const storedHistory = rawHistory
        ? (JSON.parse(rawHistory) as Conversation[])
        : [];
      if (
        !Array.isArray(storedHistory) ||
        storedHistory.some(
          (chat) =>
            !chat ||
            typeof chat.id !== "string" ||
            typeof chat.title !== "string" ||
            !Array.isArray(chat.messages) ||
            chat.messages.some(
              (message: Message) =>
                !message ||
                typeof message.content !== "string" ||
                !["user", "assistant"].includes(message.role),
            ),
        )
      )
        throw new Error("history");
      const initial =
        Array.isArray(storedHistory) && storedHistory.length
          ? storedHistory
          : [blankConversation()];
      setConversations(initial);
      setActiveId(initial[0].id);

      const rawSettings = localStorage.getItem(SETTINGS_KEY);
      if (rawSettings) {
        const stored = JSON.parse(rawSettings);
        if (
          !stored ||
          typeof stored !== "object" ||
          (stored.temperature !== undefined &&
            (typeof stored.temperature !== "number" ||
              !Number.isFinite(stored.temperature))) ||
          (stored.systemPrompt !== undefined &&
            typeof stored.systemPrompt !== "string")
        )
          throw new Error("settings");
        if (
          typeof stored.systemPrompt === "string" &&
          stored.systemPrompt ===
            "คุณคือ Private AI ผู้ช่วยส่วนตัวของผู้ใช้ ตอบเป็นภาษาไทยเป็นหลัก ให้คำตอบที่ชัดเจน ถูกต้อง กระชับเมื่อทำได้ และแสดงโค้ดใน code block เมื่อมีโค้ด"
        )
          stored.systemPrompt = DEFAULT_SETTINGS.systemPrompt;
        setSettings({ ...DEFAULT_SETTINGS, ...stored });
      }
    } catch {
      setStorageError(true);
      setNotice(
        "อ่านข้อมูลเดิมไม่ได้ จึงพักการบันทึกเพื่อรักษาประวัติเดิม กรุณาตรวจพื้นที่จัดเก็บแล้วรีเฟรช",
      );
      const initial = [blankConversation()];
      setConversations(initial);
      setActiveId(initial[0].id);
    }

    setHistoryReady(true);

    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => undefined);
    }
  }, [authenticated]);

  useEffect(() => {
    if (!authenticated || !historyReady) return;
    if (storageError) return;
    const timer = setTimeout(
      () => {
        try {
          localStorage.setItem(HISTORY_KEY, JSON.stringify(conversations));
        } catch {
          setStorageError(true);
          setNotice(
            "บันทึกประวัติไม่ได้ กรุณาตรวจพื้นที่จัดเก็บก่อนปิดหน้านี้",
          );
        }
      },
      streaming ? 300 : 0,
    );
    return () => clearTimeout(timer);
  }, [conversations, authenticated, historyReady, storageError, streaming]);

  useEffect(() => {
    if (!authenticated || !historyReady) return;
    if (!storageError) {
      try {
        localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
      } catch {
        setStorageError(true);
        setNotice("บันทึกการตั้งค่าไม่ได้ กรุณาตรวจพื้นที่จัดเก็บ");
      }
    }
    document.documentElement.dataset.theme = settings.theme;
  }, [settings, authenticated, historyReady, storageError]);

  useEffect(() => {
    if (!authenticated || !historyReady) return;

    fetch("/api/models", { cache: "no-store" })
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "โหลดโมเดลไม่สำเร็จ");
        const items = Array.isArray(data.models) ? data.models : [];
        setModels(items);
        setModelsError("");
        if (items[0]?.id) {
          setSettings((previous) => ({
            ...previous,
            model: previous.model || items[0].id,
          }));
        }
      })
      .catch((error) => {
        setModelsError("โหลดโมเดลไม่สำเร็จ กรุณาตรวจสอบการเชื่อมต่อแล้วรีเฟรช");
      });
  }, [authenticated, historyReady]);

  useEffect(() => {
    if (followRef.current && messagesRef.current)
      messagesRef.current.scrollTop = activeConversation?.messages.length
        ? messagesRef.current.scrollHeight
        : 0;
  }, [activeConversation?.messages, streaming]);

  useEffect(() => {
    const viewport = window.visualViewport;
    const update = () => {
      if (viewport?.scale && viewport.scale !== 1) return;
      const height = Math.min(
        viewport?.height ?? window.innerHeight,
        window.innerHeight,
      );
      document.documentElement.style.setProperty(
        "--viewport-height",
        `${height}px`,
      );
      document.documentElement.style.setProperty(
        "--viewport-top",
        `${viewport?.offsetTop ?? 0}px`,
      );
    };
    const media = window.matchMedia("(max-width: 900px)");
    const match = () => setMobile(media.matches);
    match();
    update();
    media.addEventListener("change", match);
    window.addEventListener("resize", update);
    viewport?.addEventListener("resize", update);
    viewport?.addEventListener("scroll", update);
    return () => {
      media.removeEventListener("change", match);
      window.removeEventListener("resize", update);
      viewport?.removeEventListener("resize", update);
      viewport?.removeEventListener("scroll", update);
    };
  }, []);

  useEffect(() => {
    const el = inputRef.current;
    if (el) {
      el.style.height = "auto";
      el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
    }
  }, [input, authenticated]);

  useEffect(() => {
    const panel = settingsOpen
      ? settingsRef.current
      : sidebarOpen && mobile
        ? sidebarRef.current
        : null;
    if (!panel) return;
    const previous = document.activeElement as HTMLElement | null;
    const targets = () =>
      Array.from(
        panel.querySelectorAll<HTMLElement>(
          'button:not(:disabled), input, textarea, select, [tabindex="0"]',
        ),
      ).filter((el) => el.getClientRects().length);
    targets()[0]?.focus();
    const key = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        setSettingsOpen(false);
        setSidebarOpen(false);
      }
      if (event.key === "Tab") {
        const elements = targets();
        const first = elements[0];
        const last = elements.at(-1);
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("keydown", key);
      previous?.focus();
    };
  }, [sidebarOpen, settingsOpen, mobile]);

  async function copyText(value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setNotice("คัดลอกแล้ว");
    } catch {
      setNotice("คัดลอกไม่ได้ กรุณาเลือกข้อความแล้วคัดลอกด้วยตนเอง");
    }
  }

  useEffect(() => {
    if (!authenticated || !historyReady || storageError) return;
    const save = () => {
      try {
        localStorage.setItem(HISTORY_KEY, JSON.stringify(conversations));
      } catch {
        /* Existing data remains untouched. */
      }
    };
    window.addEventListener("pagehide", save);
    return () => window.removeEventListener("pagehide", save);
  }, [conversations, authenticated, historyReady, storageError]);

  function patchConversation(
    id: string,
    updater: (chat: Conversation) => Conversation,
  ) {
    setConversations((previous) =>
      previous.map((chat) => (chat.id === id ? updater(chat) : chat)),
    );
  }

  function newChat() {
    if (streaming) return;
    followRef.current = true;
    const chat = blankConversation();
    setConversations((previous) => [chat, ...previous]);
    setActiveId(chat.id);
    setSidebarOpen(false);
    setInput("");
    setTimeout(() => inputRef.current?.focus(), 50);
  }

  function selectChat(id: string) {
    if (streaming) return;
    followRef.current = true;
    setActiveId(id);
    setSidebarOpen(false);
  }

  function renameChat(chat: Conversation) {
    const name = window.prompt("ตั้งชื่อแชต", chat.title)?.trim();
    if (!name) return;
    patchConversation(chat.id, (item) => ({
      ...item,
      title: name,
      updatedAt: Date.now(),
    }));
  }

  function deleteChat(id: string) {
    if (!window.confirm("ต้องการลบแชตนี้หรือไม่?")) return;
    setConversations((previous) => {
      const next = previous.filter((item) => item.id !== id);
      if (!next.length) {
        const chat = blankConversation();
        setActiveId(chat.id);
        return [chat];
      }
      if (id === activeId) setActiveId(next[0].id);
      return next;
    });
  }

  async function login(event: FormEvent) {
    event.preventDefault();
    setPinError("");
    setAuthBusy(true);

    try {
      const response = await fetch("/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pin }),
      });
      const data = await response.json();
      if (!response.ok) {
        setPinError(
          response.status === 401
            ? "รหัส PIN ไม่ถูกต้อง"
            : "เข้าสู่ระบบไม่สำเร็จ กรุณาลองอีกครั้ง",
        );
        return;
      }
      setAuthenticated(true);
      setPin("");
    } catch (error) {
      setPinError("เข้าสู่ระบบไม่สำเร็จ กรุณาตรวจสอบเครือข่ายแล้วลองอีกครั้ง");
    } finally {
      setAuthBusy(false);
    }
  }

  async function logout() {
    stopStreaming();
    try {
      const response = await fetch("/api/auth", { method: "DELETE" });
      if (!response.ok) throw new Error();
    } catch {
      setNotice("ออกจากระบบไม่สำเร็จ กรุณาลองอีกครั้ง");
      return;
    }
    setAuthenticated(false);
    setHistoryReady(false);
    setConversations([]);
    setSidebarOpen(false);
    setSettingsOpen(false);
  }

  async function streamReply(chatId: string, sourceMessages: Message[]) {
    if (!settings.model) {
      setNotice("กรุณาเลือกโมเดลก่อนส่งข้อความ");
      return;
    }

    const assistant: Message = {
      id: uid(),
      role: "assistant",
      content: "",
      createdAt: Date.now(),
    };

    patchConversation(chatId, (chat) => ({
      ...chat,
      messages: [...sourceMessages, assistant],
      updatedAt: Date.now(),
    }));

    const controller = new AbortController();
    abortRef.current = controller;
    setStreaming(true);
    setNotice("");

    try {
      const apiMessages = [
        ...(settings.systemPrompt.trim()
          ? [{ role: "system" as const, content: settings.systemPrompt.trim() }]
          : []),
        ...sourceMessages.map((message) => ({
          role: message.role,
          content:
            message.role === "user" && message.image
              ? [
                  {
                    type: "text" as const,
                    text: message.content.trim() || "ช่วยวิเคราะห์รูปภาพนี้",
                  },
                  {
                    type: "image_url" as const,
                    image_url: { url: message.image.dataUrl },
                  },
                ]
              : message.role === "user" && message.file
                ? `${message.content.trim() || "ช่วยวิเคราะห์ไฟล์นี้"}\n\n--- ไฟล์: ${message.file.name} ---\n${message.file.content}\n--- จบไฟล์ ---`
                : message.content,
        })),
      ];

      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          model: settings.model,
          messages: apiMessages,
          temperature: settings.temperature,
          maxTokens: settings.maxTokens,
        }),
      });

      if (response.status === 401) {
        setNotice("เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่");
        setAuthenticated(false);
        setHistoryReady(false);
        return;
      }
      if (!response.ok || !response.body) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || "AI ตอบกลับไม่สำเร็จ");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let full = "";

      const applyText = (value: string) => {
        full += value;
        patchConversation(chatId, (chat) => ({
          ...chat,
          updatedAt: Date.now(),
          messages: chat.messages.map((message) =>
            message.id === assistant.id
              ? { ...message, content: full }
              : message,
          ),
        }));
      };

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const rawLine of lines) {
          const line = rawLine.trim();
          if (!line || !line.startsWith("data:")) continue;
          const payload = line.slice(5).trim();
          if (!payload || payload === "[DONE]") continue;

          try {
            const json = JSON.parse(payload);
            const delta =
              json?.choices?.[0]?.delta?.content ??
              json?.choices?.[0]?.message?.content ??
              "";
            if (typeof delta === "string" && delta) applyText(delta);
          } catch {
            // ข้าม event ที่ไม่ใช่ JSON
          }
        }
      }

      if (buffer.trim()) {
        try {
          const json = JSON.parse(buffer.replace(/^data:\s*/, ""));
          const text =
            json?.choices?.[0]?.message?.content ??
            json?.choices?.[0]?.delta?.content ??
            "";
          if (typeof text === "string") applyText(text);
        } catch {
          // ไม่มีข้อความเพิ่มเติม
        }
      }

      if (!full) {
        patchConversation(chatId, (chat) => ({
          ...chat,
          messages: chat.messages.map((message) =>
            message.id === assistant.id
              ? {
                  ...message,
                  content: "ไม่ได้รับข้อความจากโมเดล กรุณาลองอีกครั้ง",
                }
              : message,
          ),
        }));
      }
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        setNotice("หยุดการตอบแล้ว");
        patchConversation(chatId, (chat) => ({
          ...chat,
          messages: chat.messages.map((item) =>
            item.id === assistant.id && !item.content
              ? { ...item, content: "หยุดการตอบแล้ว" }
              : item,
          ),
        }));
      } else {
        const message = "การเชื่อมต่อ AI ขัดข้อง กรุณาลองใหม่อีกครั้ง";
        patchConversation(chatId, (chat) => ({
          ...chat,
          messages: chat.messages.map((item) =>
            item.id === assistant.id
              ? { ...item, content: `เกิดข้อผิดพลาด: ${message}` }
              : item,
          ),
        }));
      }
    } finally {
      abortRef.current = null;
      setStreaming(false);
    }
  }

  async function sendMessage() {
    const content = input.trim();
    const chat = activeConversation;
    if ((!content && !pendingImage && !pendingFile) || !chat || streaming) return;

    if (!settings.model) {
      setNotice(modelsError || "ยังไม่มีโมเดลที่พร้อมใช้งาน");
      return;
    }

    const userMessage: Message = {
      id: uid(),
      role: "user",
      content:
        content ||
        (pendingFile ? "ช่วยวิเคราะห์ไฟล์นี้" : "ช่วยวิเคราะห์รูปภาพนี้"),
      createdAt: Date.now(),
      image: pendingImage ?? undefined,
      file: pendingFile ?? undefined,
    };
    const nextMessages = [...chat.messages, userMessage];
    const titleSource =
      content || (pendingFile ? pendingFile.name : pendingImage ? "รูปภาพ" : "");
    const title =
      chat.messages.length === 0
        ? titleSource.replace(/\s+/g, " ").slice(0, 36) || "แชตใหม่"
        : chat.title;

    followRef.current = true;
    setInput("");
    setPendingImage(null);
    setPendingFile(null);
    patchConversation(chat.id, (item) => ({
      ...item,
      title,
      messages: nextMessages,
      updatedAt: Date.now(),
    }));

    await streamReply(chat.id, nextMessages);
  }

  async function regenerate() {
    const chat = activeConversation;
    if (!chat || streaming) return;

    const lastAssistantIndex = [...chat.messages]
      .map((message) => message.role)
      .lastIndexOf("assistant");
    const source =
      lastAssistantIndex >= 0
        ? chat.messages.slice(0, lastAssistantIndex)
        : chat.messages;

    if (!source.length || source[source.length - 1]?.role !== "user") return;

    patchConversation(chat.id, (item) => ({
      ...item,
      messages: source,
      updatedAt: Date.now(),
    }));
    await streamReply(chat.id, source);
  }

  function stopStreaming() {
    abortRef.current?.abort();
  }

  function onInputKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (
      settings.enterToSend &&
      event.key === "Enter" &&
      !event.shiftKey &&
      !event.nativeEvent.isComposing
    ) {
      event.preventDefault();
      void sendMessage();
    }
  }

  if (sessionLoading) {
    return (
      <main className="center-screen">
        <div className="brand-mark">TB</div>
        <div className="loading-dots" aria-label="กำลังโหลด">
          <span />
          <span />
          <span />
        </div>
      </main>
    );
  }

  if (!configured) {
    return (
      <main className="center-screen pad">
        <section className="auth-card">
          <div className="brand-mark">TB</div>
          <h1>ThaiBan AI</h1>
          <p className="muted">
            ระบบยังไม่พร้อมใช้งาน เพราะยังไม่ได้ตั้งค่าความลับของโปรเจกต์
          </p>
          <p className="tiny">กรุณาตรวจสอบการตั้งค่าระบบแล้วลองใหม่อีกครั้ง</p>
        </section>
      </main>
    );
  }

  if (!authenticated) {
    return (
      <main className="center-screen pad">
        <form className="auth-card" onSubmit={login}>
          <div className="brand-mark">TB</div>
          <h1>ThaiBan AI</h1>
          <p className="muted">AI ส่วนตัวของคุณ</p>
          <label className="field-label" htmlFor="pin">
            รหัส PIN
          </label>
          <input
            id="pin"
            className="pin-input"
            inputMode="numeric"
            autoComplete="current-password"
            type="password"
            value={pin}
            onChange={(event) => setPin(event.target.value)}
            placeholder="กรอกรหัส PIN"
            required
            aria-invalid={Boolean(pinError)}
            aria-describedby={pinError ? "pin-error" : undefined}
          />
          {pinError ? (
            <p id="pin-error" role="alert" className="error-text">
              {pinError}
            </p>
          ) : null}
          <button
            className="primary-button"
            type="submit"
            disabled={authBusy || !pin}
          >
            {authBusy ? "กำลังตรวจสอบ..." : "เข้าสู่ระบบ"}
          </button>
          <p className="tiny">พื้นที่ส่วนตัว สำหรับทุกความคิดของคุณ</p>
          <span className="version-label">ThaiBan AI V1.1</span>
        </form>
      </main>
    );
  }

  if (!historyReady || !activeConversation) {
    return (
      <main className="center-screen">
        <div className="loading-dots" aria-label="กำลังเตรียมแชต">
          <span />
          <span />
          <span />
        </div>
      </main>
    );
  }

  return (
    <main className="app-shell">
      <div
        className={`backdrop ${sidebarOpen ? "show" : ""}`}
        onClick={() => setSidebarOpen(false)}
      />

      <aside
        ref={sidebarRef}
        inert={(mobile && !sidebarOpen) || settingsOpen}
        aria-label="เมนูและประวัติแชต"
        role={mobile ? "dialog" : undefined}
        aria-modal={mobile && sidebarOpen ? true : undefined}
        className={`sidebar ${sidebarOpen ? "open" : ""}`}
      >
        <div className="sidebar-head">
          <div className="brand-row">
            <div className="brand-mark small">T</div>
            <div>
              <strong>ThaiBan AI</strong>
              <span>พื้นที่ส่วนตัว · V1.1</span>
            </div>
          </div>
          <button
            type="button"
            aria-label="ปิดเมนู"
            className="icon-button mobile-only"
            onClick={() => setSidebarOpen(false)}
          >
            ✕
          </button>
        </div>

        <button
          disabled={streaming}
          className="new-chat-button"
          type="button"
          aria-label="แชตใหม่"
          onClick={newChat}
        >
          <span>＋</span>
          แชตใหม่
        </button>

        <div className="history-label">ประวัติแชต</div>
        <div className="chat-list">
          {conversations.map((chat) => (
            <div
              key={chat.id}
              className={`chat-item ${chat.id === activeConversation.id ? "active" : ""}`}
            >
              <button
                disabled={streaming}
                className="chat-select"
                type="button"
                onClick={() => selectChat(chat.id)}
              >
                <span className="chat-title">{chat.title}</span>
                <span className="chat-date">
                  {new Date(chat.updatedAt).toLocaleDateString("th-TH", {
                    day: "numeric",
                    month: "short",
                  })}
                </span>
              </button>
              <button
                aria-label="เปลี่ยนชื่อแชต"
                className="chat-more"
                type="button"
                onClick={() => renameChat(chat)}
              >
                ✎
              </button>
              <button
                disabled={streaming}
                aria-label="ลบแชต"
                className="chat-more danger"
                type="button"
                onClick={() => deleteChat(chat.id)}
              >
                ×
              </button>
            </div>
          ))}
        </div>

        <div className="sidebar-footer">
          <button
            type="button"
            aria-label="การตั้งค่า"
            onClick={() => setSettingsOpen(true)}
          >
            <span aria-hidden="true">⚙</span> การตั้งค่า
          </button>
          <button type="button" aria-label="ออกจากระบบ" onClick={logout}>
            <span aria-hidden="true">↪</span> ออกจากระบบ
          </button>
        </div>
      </aside>

      <section
        className="main-panel"
        inert={settingsOpen || (mobile && sidebarOpen)}
      >
        <header className="topbar">
          <button
            className="icon-button"
            type="button"
            aria-label="เปิดเมนู"
            aria-expanded={sidebarOpen}
            onClick={() => setSidebarOpen(true)}
          >
            ☰
          </button>
          <div className="topbar-title">
            {activeConversation.title !== "แชตใหม่" ? (
              <strong>{activeConversation.title}</strong>
            ) : null}
          </div>
          <button
            className="icon-button topbar-settings"
            type="button"
            aria-label="เปิดการตั้งค่า"
            onClick={() => setSettingsOpen(true)}
          >
            ⋯
          </button>
        </header>

        <div
          className="messages"
          ref={messagesRef}
          onScroll={() => {
            const el = messagesRef.current;
            if (el)
              followRef.current =
                el.scrollHeight - el.scrollTop - el.clientHeight < 100;
          }}
        >
          {activeConversation.messages.length === 0 ? (
            <section className="welcome">
              <div className="brand-mark hero">T</div>
              <h1>วันนี้ให้ ThaiBan AI ช่วยอะไร?</h1>
              <p>ถาม เขียนโค้ด สรุปไฟล์ หรือช่วยคิดไอเดียได้เลย</p>
              {modelsError ? (
                <div className="warning-card">
                  <strong>ยังโหลดโมเดลไม่ได้</strong>
                  <span>{modelsError}</span>
                </div>
              ) : (
                <div className="status-pill">
                  <span className="status-dot" />
                  {settings.model ? "AI พร้อมใช้งาน" : "กำลังเตรียมโมเดล"}
                </div>
              )}
              <p className="current-model">
                {settings.model || "กำลังโหลดโมเดล"}
              </p>
              <div className="suggestions">
                {[
                  "ช่วยเขียนโค้ดให้หน่อย",
                  "สรุปข้อความให้ฉัน",
                  "ช่วยคิดไอเดีย",
                  "อธิบายเรื่องนี้แบบเข้าใจง่าย",
                ].map((text) => (
                  <button
                    key={text}
                    type="button"
                    onClick={() => {
                      setInput(text);
                      inputRef.current?.focus();
                    }}
                  >
                    {text}
                  </button>
                ))}
              </div>
            </section>
          ) : (
            activeConversation.messages.map((message) => (
              <article
                key={message.id}
                className={`message-row ${message.role}`}
              >
                <div className="message-avatar">
                  {message.role === "user" ? "คุณ" : "TB"}
                </div>
                <div className="message-body">
                  <div className="message-meta">
                    <strong>
                      {message.role === "user" ? "คุณ" : "ThaiBan AI"}
                    </strong>
                    <button
                      type="button"
                      aria-label="คัดลอกข้อความ"
                      title="คัดลอก"
                      onClick={() => void copyText(message.content)}
                    >
                      ⧉
                    </button>
                  </div>
                  <div className="message-content">
                    {message.role === "user" && message.image ? (
                      <img
                        className="chat-image"
                        src={message.image.dataUrl}
                        alt={message.image.name || "รูปภาพที่แนบ"}
                      />
                    ) : null}
                    {message.role === "user" && message.file ? (
                      <div className="chat-file">
                        <span className="file-icon">DOC</span>
                        <span>
                          <strong>{message.file.name}</strong>
                          <small>{Math.max(1, Math.ceil(message.file.size / 1024))} KB</small>
                        </span>
                      </div>
                    ) : null}
                    {message.role === "assistant" ? (
                      message.content ? (
                        <Markdown onCopy={copyText}>{message.content}</Markdown>
                      ) : (
                        <div className="typing">
                          <span />
                          <span />
                          <span />
                        </div>
                      )
                    ) : (
                      <p>{message.content}</p>
                    )}
                  </div>
                </div>
              </article>
            ))
          )}
          <div ref={bottomRef} />
        </div>

        <div className="composer-zone">
          {notice ? (
            <button
              className="notice"
              type="button"
              onClick={() => setNotice("")}
            >
              {notice} <span>×</span>
            </button>
          ) : null}

          {activeConversation.messages.length > 1 && !streaming ? (
            <button className="regen-button" type="button" onClick={regenerate}>
              ↻ สร้างคำตอบใหม่
            </button>
          ) : null}

          {pendingFile ? (
            <div className="file-preview">
              <span className="file-icon">DOC</span>
              <div>
                <strong>{pendingFile.name}</strong>
                <span>{Math.max(1, Math.ceil(pendingFile.size / 1024))} KB · พร้อมส่งให้ AI อ่าน</span>
              </div>
              <button
                type="button"
                aria-label="ลบไฟล์"
                onClick={() => setPendingFile(null)}
              >
                ×
              </button>
            </div>
          ) : null}

          {pendingImage ? (
            <div className="image-preview">
              <img src={pendingImage.dataUrl} alt={pendingImage.name} />
              <div>
                <strong>{pendingImage.name}</strong>
                <span>พร้อมส่งพร้อมข้อความ</span>
              </div>
              <button
                type="button"
                aria-label="ลบรูปภาพ"
                onClick={() => setPendingImage(null)}
              >
                ×
              </button>
            </div>
          ) : null}

          <div className="composer">
            <input
              ref={imageInputRef}
              className="image-input"
              type="file"
              accept="image/*"
              aria-label="แนบรูปภาพ"
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = "";
                if (!file) return;
                if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
                  setNotice("รองรับเฉพาะ JPG, PNG และ WebP");
                  return;
                }
                if (file.size > 5 * 1024 * 1024) {
                  setNotice("รูปภาพต้องมีขนาดไม่เกิน 5 MB");
                  return;
                }
                const reader = new FileReader();
                reader.onload = () => {
                  if (typeof reader.result !== "string") return;
                  setPendingImage({
                    dataUrl: reader.result,
                    name: file.name,
                    type: file.type,
                  });
                  setNotice("");
                };
                reader.onerror = () => setNotice("อ่านรูปภาพไม่สำเร็จ กรุณาลองใหม่");
                reader.readAsDataURL(file);
              }}
            />
            <input
              ref={fileInputRef}
              className="image-input"
              type="file"
              accept=".txt,.md,.json,.csv,.html,.htm,.css,.js,.jsx,.ts,.tsx,.py,.php,text/plain,text/markdown,text/csv,application/json"
              aria-label="แนบไฟล์"
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = "";
                if (!file) return;
                const extension = file.name.split(".").pop()?.toLowerCase() || "";
                const allowed = new Set([
                  "txt", "md", "json", "csv", "html", "htm", "css",
                  "js", "jsx", "ts", "tsx", "py", "php",
                ]);
                if (!allowed.has(extension)) {
                  setNotice("รองรับ TXT, MD, JSON, CSV, HTML, CSS, JS, TS, Python และ PHP");
                  return;
                }
                if (file.size > 1024 * 1024) {
                  setNotice("ไฟล์ต้องมีขนาดไม่เกิน 1 MB");
                  return;
                }
                const reader = new FileReader();
                reader.onload = () => {
                  if (typeof reader.result !== "string") return;
                  setPendingFile({
                    name: file.name,
                    type: file.type || "text/plain",
                    size: file.size,
                    content: reader.result,
                  });
                  setPendingImage(null);
                  setNotice("");
                };
                reader.onerror = () => setNotice("อ่านไฟล์ไม่สำเร็จ กรุณาลองใหม่");
                reader.readAsText(file);
              }}
            />
            <button
              className="attach-button"
              type="button"
              aria-label="แนบไฟล์"
              title="แนบไฟล์"
              disabled={streaming}
              onClick={() => fileInputRef.current?.click()}
            >
              +
            </button>
            <textarea
              aria-label="ข้อความถึง ThaiBan AI"
              ref={inputRef}
              value={input}
              onChange={(event) => {
                setInput(event.target.value);
                event.target.style.height = "auto";
                event.target.style.height = `${Math.min(event.target.scrollHeight, 160)}px`;
              }}
              onKeyDown={onInputKeyDown}
              placeholder="พิมพ์ข้อความถึง ThaiBan AI..."
              rows={1}
              disabled={streaming}
            />
            {streaming ? (
              <button
                className="send-button stop"
                type="button"
                onClick={stopStreaming}
                aria-label="หยุดการตอบ"
              >
                ■
              </button>
            ) : (
              <button
                className="send-button"
                type="button"
                onClick={() => void sendMessage()}
                disabled={(!input.trim() && !pendingImage && !pendingFile) || !settings.model}
                aria-label="ส่งข้อความ"
              >
                ↑
              </button>
            )}
          </div>
          <p className="composer-note">
            AI อาจตอบผิดได้ ควรตรวจสอบข้อมูลสำคัญอีกครั้ง
          </p>
        </div>
      </section>

      <div
        className={`backdrop settings-backdrop ${settingsOpen ? "show" : ""}`}
        onClick={() => setSettingsOpen(false)}
      />
      <section
        ref={settingsRef}
        inert={!settingsOpen}
        role="dialog"
        aria-modal="true"
        aria-label="การตั้งค่า"
        className={`settings-sheet ${settingsOpen ? "open" : ""}`}
      >
        <div className="sheet-handle" />
        <div className="settings-head">
          <div>
            <h2>การตั้งค่า</h2>
            <p>ปรับ ThaiBan AI ให้เหมาะกับการใช้งานของคุณ</p>
          </div>
          <button
            className="icon-button"
            type="button"
            aria-label="ปิดการตั้งค่า"
            onClick={() => setSettingsOpen(false)}
          >
            ✕
          </button>
        </div>

        <div className="settings-scroll">
          <label className="setting-block">
            <span>โมเดลเริ่มต้น</span>
            <select
              value={settings.model}
              onChange={(event) =>
                setSettings((previous) => ({
                  ...previous,
                  model: event.target.value,
                }))
              }
            >
              <option value="">เลือกโมเดล</option>
              {models.map((model) => (
                <option key={model.id} value={model.id}>
                  {model.id}
                </option>
              ))}
            </select>
          </label>

          <label className="setting-block">
            <span>คำสั่งหลักของ AI</span>
            <textarea
              rows={5}
              value={settings.systemPrompt}
              onChange={(event) =>
                setSettings((previous) => ({
                  ...previous,
                  systemPrompt: event.target.value,
                }))
              }
            />
          </label>

          <label className="setting-block">
            <span>ความสร้างสรรค์: {settings.temperature.toFixed(1)}</span>
            <input
              type="range"
              min="0"
              max="2"
              step="0.1"
              value={settings.temperature}
              onChange={(event) =>
                setSettings((previous) => ({
                  ...previous,
                  temperature: Number(event.target.value),
                }))
              }
            />
          </label>

          <label className="setting-block">
            <span>จำนวนโทเคนคำตอบสูงสุด</span>
            <input
              type="number"
              min="256"
              max="32768"
              step="256"
              value={settings.maxTokens}
              onChange={(event) =>
                setSettings((previous) => ({
                  ...previous,
                  maxTokens: Math.min(
                    32768,
                    Math.max(256, Number(event.target.value)),
                  ),
                }))
              }
            />
          </label>

          <div className="toggle-row">
            <div>
              <strong>กด Enter เพื่อส่ง</strong>
              <span>ใช้ Shift + Enter เพื่อขึ้นบรรทัดใหม่</span>
            </div>
            <button
              type="button"
              role="switch"
              aria-label="กด Enter เพื่อส่ง"
              aria-checked={settings.enterToSend}
              className={`toggle ${settings.enterToSend ? "on" : ""}`}
              onClick={() =>
                setSettings((previous) => ({
                  ...previous,
                  enterToSend: !previous.enterToSend,
                }))
              }
            >
              <span />
            </button>
          </div>

          <div className="theme-picker">
            <span>ธีม</span>
            <div>
              <button
                type="button"
                className={settings.theme === "dark" ? "active" : ""}
                onClick={() =>
                  setSettings((previous) => ({ ...previous, theme: "dark" }))
                }
              >
                มืด
              </button>
              <button
                type="button"
                className={settings.theme === "light" ? "active" : ""}
                onClick={() =>
                  setSettings((previous) => ({ ...previous, theme: "light" }))
                }
              >
                สว่าง
              </button>
            </div>
          </div>

          <div className="info-card">
            <strong>ข้อมูลส่วนตัวบนเครื่อง</strong>
            <p>
              ประวัติแชตและการตั้งค่า เก็บไว้ในเบราว์เซอร์เครื่องนี้
              ส่วนข้อความที่ถาม AI จะถูกส่งผ่านเซิร์ฟเวอร์ของ ThaiBan AI ไปยัง
              Kob AI เพื่อประมวลผล
            </p>
          </div>

          <button
            disabled={streaming || storageError}
            className="danger-button"
            type="button"
            onClick={() => {
              if (!window.confirm("ล้างประวัติแชตทั้งหมดหรือไม่?")) return;
              const chat = blankConversation();
              setConversations([chat]);
              setActiveId(chat.id);
              setSettingsOpen(false);
            }}
          >
            ล้างประวัติแชตทั้งหมด
          </button>
        </div>
      </section>
    </main>
  );
}

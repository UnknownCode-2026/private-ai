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

type Message = {
  id: string;
  role: Role;
  content: string;
  createdAt: number;
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

const HISTORY_KEY = "private-ai-history-v1";
const SETTINGS_KEY = "private-ai-settings-v1";

const DEFAULT_SETTINGS: Settings = {
  model: "",
  systemPrompt:
    "คุณคือ Private AI ผู้ช่วยส่วนตัวของผู้ใช้ ตอบเป็นภาษาไทยเป็นหลัก ให้คำตอบที่ชัดเจน ถูกต้อง กระชับเมื่อทำได้ และแสดงโค้ดใน code block เมื่อมีโค้ด",
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
    return textFromNode((node as { props?: { children?: ReactNode } }).props?.children);
  }
  return "";
}

function Markdown({ children }: { children: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        a: ({ children: linkChildren, ...props }) => (
          <a {...props} target="_blank" rel="noreferrer">
            {linkChildren}
          </a>
        ),
        pre: ({ children: preChildren }) => {
          const code = textFromNode(preChildren).replace(/\n$/, "");
          return (
            <div className="code-wrap">
              <button
                className="code-copy"
                type="button"
                onClick={() => navigator.clipboard.writeText(code)}
              >
                คัดลอก
              </button>
              <pre>{preChildren}</pre>
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
  const [streaming, setStreaming] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [notice, setNotice] = useState("");

  const abortRef = useRef<AbortController | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  const activeConversation = useMemo(
    () => conversations.find((item) => item.id === activeId) ?? conversations[0],
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
      const rawHistory = localStorage.getItem(HISTORY_KEY);
      const storedHistory = rawHistory ? (JSON.parse(rawHistory) as Conversation[]) : [];
      const initial = Array.isArray(storedHistory) && storedHistory.length
        ? storedHistory
        : [blankConversation()];
      setConversations(initial);
      setActiveId(initial[0].id);

      const rawSettings = localStorage.getItem(SETTINGS_KEY);
      if (rawSettings) {
        setSettings({ ...DEFAULT_SETTINGS, ...JSON.parse(rawSettings) });
      }
    } catch {
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
    localStorage.setItem(HISTORY_KEY, JSON.stringify(conversations));
  }, [conversations, authenticated, historyReady]);

  useEffect(() => {
    if (!authenticated || !historyReady) return;
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    document.documentElement.dataset.theme = settings.theme;
  }, [settings, authenticated, historyReady]);

  useEffect(() => {
    if (!authenticated) return;

    fetch("/api/models", { cache: "no-store" })
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "โหลดโมเดลไม่สำเร็จ");
        const items = Array.isArray(data.models) ? data.models : [];
        setModels(items);
        setModelsError("");
        if (!settings.model && items[0]?.id) {
          setSettings((previous) => ({ ...previous, model: items[0].id }));
        }
      })
      .catch((error) => {
        setModelsError(error instanceof Error ? error.message : "โหลดโมเดลไม่สำเร็จ");
      });
  }, [authenticated, settings.model]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: streaming ? "auto" : "smooth" });
  }, [activeConversation?.messages, streaming]);

  function patchConversation(id: string, updater: (chat: Conversation) => Conversation) {
    setConversations((previous) =>
      previous.map((chat) => (chat.id === id ? updater(chat) : chat)),
    );
  }

  function newChat() {
    const chat = blankConversation();
    setConversations((previous) => [chat, ...previous]);
    setActiveId(chat.id);
    setSidebarOpen(false);
    setInput("");
    setTimeout(() => inputRef.current?.focus(), 50);
  }

  function selectChat(id: string) {
    setActiveId(id);
    setSidebarOpen(false);
  }

  function renameChat(chat: Conversation) {
    const name = window.prompt("ตั้งชื่อแชต", chat.title)?.trim();
    if (!name) return;
    patchConversation(chat.id, (item) => ({ ...item, title: name, updatedAt: Date.now() }));
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
      if (!response.ok) throw new Error(data.error || "เข้าสู่ระบบไม่สำเร็จ");
      setAuthenticated(true);
      setPin("");
    } catch (error) {
      setPinError(error instanceof Error ? error.message : "เข้าสู่ระบบไม่สำเร็จ");
    } finally {
      setAuthBusy(false);
    }
  }

  async function logout() {
    await fetch("/api/auth", { method: "DELETE" }).catch(() => undefined);
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
          content: message.content,
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

      if (!response.ok || !response.body) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || data.detail || "AI ตอบกลับไม่สำเร็จ");
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
            message.id === assistant.id ? { ...message, content: full } : message,
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

      if (!full && buffer.trim()) {
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
              ? { ...message, content: "ไม่ได้รับข้อความจากโมเดล กรุณาลองอีกครั้ง" }
              : message,
          ),
        }));
      }
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        setNotice("หยุดการตอบแล้ว");
      } else {
        const message = error instanceof Error ? error.message : "เกิดข้อผิดพลาด";
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
    if (!content || !chat || streaming) return;

    if (!settings.model) {
      setNotice(modelsError || "ยังไม่มีโมเดลที่พร้อมใช้งาน");
      return;
    }

    const userMessage: Message = {
      id: uid(),
      role: "user",
      content,
      createdAt: Date.now(),
    };
    const nextMessages = [...chat.messages, userMessage];
    const title =
      chat.messages.length === 0
        ? content.replace(/\s+/g, " ").slice(0, 36) || "แชตใหม่"
        : chat.title;

    setInput("");
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
        <div className="brand-mark">P</div>
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
          <div className="brand-mark">P</div>
          <h1>Private AI</h1>
          <p className="muted">
            ระบบยังไม่พร้อมใช้งาน เพราะยังไม่ได้ตั้งค่าความลับของโปรเจกต์
          </p>
          <div className="setup-box">
            <strong>ตั้งค่าบน Vercel ก่อนใช้งาน</strong>
            <code>KOB_AI_API_KEY</code>
            <code>PRIVATE_AI_PIN</code>
            <code>KOB_AI_BASE_URL=https://www.kob-ai.dev/v1</code>
          </div>
          <p className="tiny">
            ห้ามใส่ Token ไว้ในโค้ดหรือค่าที่ขึ้นต้นด้วย NEXT_PUBLIC_
          </p>
        </section>
      </main>
    );
  }

  if (!authenticated) {
    return (
      <main className="center-screen pad">
        <form className="auth-card" onSubmit={login}>
          <div className="brand-mark">P</div>
          <h1>Private AI</h1>
          <p className="muted">ผู้ช่วย AI ส่วนตัวของคุณ</p>
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
            autoFocus
          />
          {pinError ? <p className="error-text">{pinError}</p> : null}
          <button className="primary-button" type="submit" disabled={authBusy || !pin}>
            {authBusy ? "กำลังตรวจสอบ..." : "เข้าสู่ Private AI"}
          </button>
          <p className="tiny">ออกแบบสำหรับใช้งานส่วนตัวบนมือถือ</p>
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

      <aside className={`sidebar ${sidebarOpen ? "open" : ""}`}>
        <div className="sidebar-head">
          <div className="brand-row">
            <div className="brand-mark small">P</div>
            <div>
              <strong>Private AI</strong>
              <span>พื้นที่ส่วนตัว</span>
            </div>
          </div>
          <button className="icon-button mobile-only" onClick={() => setSidebarOpen(false)}>
            ✕
          </button>
        </div>

        <button className="new-chat-button" type="button" onClick={newChat}>
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
              <button className="chat-select" type="button" onClick={() => selectChat(chat.id)}>
                <span className="chat-title">{chat.title}</span>
                <span className="chat-date">
                  {new Date(chat.updatedAt).toLocaleDateString("th-TH", {
                    day: "numeric",
                    month: "short",
                  })}
                </span>
              </button>
              <button className="chat-more" type="button" onClick={() => renameChat(chat)}>
                ✎
              </button>
              <button className="chat-more danger" type="button" onClick={() => deleteChat(chat.id)}>
                ×
              </button>
            </div>
          ))}
        </div>

        <div className="sidebar-footer">
          <button type="button" onClick={() => setSettingsOpen(true)}>
            <span>⚙</span> การตั้งค่า
          </button>
          <button type="button" onClick={logout}>
            <span>↪</span> ออกจากระบบ
          </button>
        </div>
      </aside>

      <section className="main-panel">
        <header className="topbar">
          <button className="icon-button" type="button" onClick={() => setSidebarOpen(true)}>
            ☰
          </button>
          <div className="topbar-title">
            <strong>{activeConversation.title}</strong>
            <span>{settings.model || "ยังไม่ได้เลือกโมเดล"}</span>
          </div>
          <select
            className="model-select"
            value={settings.model}
            onChange={(event) =>
              setSettings((previous) => ({ ...previous, model: event.target.value }))
            }
            aria-label="เลือกโมเดล"
          >
            {!models.length ? <option value="">เลือกโมเดล</option> : null}
            {models.map((model) => (
              <option key={model.id} value={model.id}>
                {model.id}
              </option>
            ))}
          </select>
        </header>

        <div className="messages">
          {activeConversation.messages.length === 0 ? (
            <section className="welcome">
              <div className="brand-mark hero">P</div>
              <h1>สวัสดีครับ</h1>
              <p>วันนี้ให้ Private AI ช่วยอะไร?</p>
              {modelsError ? (
                <div className="warning-card">
                  <strong>ยังโหลดโมเดลไม่ได้</strong>
                  <span>{modelsError}</span>
                </div>
              ) : (
                <div className="status-pill">
                  <span className="status-dot" />
                  {settings.model ? "พร้อมใช้งาน" : "กำลังเตรียมโมเดล"}
                </div>
              )}
              <div className="suggestions">
                {[
                  "ช่วยเขียนโค้ดให้หน่อย",
                  "สรุปข้อความนี้ให้เข้าใจง่าย",
                  "ช่วยคิดไอเดียโปรเจกต์ใหม่",
                  "อธิบายเรื่องนี้แบบละเอียด",
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
              <article key={message.id} className={`message-row ${message.role}`}>
                <div className="message-avatar">
                  {message.role === "user" ? "คุณ" : "P"}
                </div>
                <div className="message-body">
                  <div className="message-meta">
                    <strong>{message.role === "user" ? "คุณ" : "Private AI"}</strong>
                    <button
                      type="button"
                      onClick={() => navigator.clipboard.writeText(message.content)}
                    >
                      คัดลอก
                    </button>
                  </div>
                  <div className="message-content">
                    {message.role === "assistant" ? (
                      message.content ? (
                        <Markdown>{message.content}</Markdown>
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
            <button className="notice" type="button" onClick={() => setNotice("")}>
              {notice} <span>×</span>
            </button>
          ) : null}

          {activeConversation.messages.length > 1 && !streaming ? (
            <button className="regen-button" type="button" onClick={regenerate}>
              ↻ สร้างคำตอบใหม่
            </button>
          ) : null}

          <div className="composer">
            <textarea
              ref={inputRef}
              value={input}
              onChange={(event) => {
                setInput(event.target.value);
                event.target.style.height = "auto";
                event.target.style.height = `${Math.min(event.target.scrollHeight, 160)}px`;
              }}
              onKeyDown={onInputKeyDown}
              placeholder="พิมพ์ข้อความถึง Private AI..."
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
                disabled={!input.trim() || !settings.model}
                aria-label="ส่งข้อความ"
              >
                ↑
              </button>
            )}
          </div>
          <p className="composer-note">AI อาจตอบผิดได้ ควรตรวจสอบข้อมูลสำคัญอีกครั้ง</p>
        </div>
      </section>

      <div
        className={`backdrop settings-backdrop ${settingsOpen ? "show" : ""}`}
        onClick={() => setSettingsOpen(false)}
      />
      <section className={`settings-sheet ${settingsOpen ? "open" : ""}`}>
        <div className="sheet-handle" />
        <div className="settings-head">
          <div>
            <h2>การตั้งค่า</h2>
            <p>ปรับ Private AI ให้เหมาะกับการใช้งานของคุณ</p>
          </div>
          <button className="icon-button" type="button" onClick={() => setSettingsOpen(false)}>
            ✕
          </button>
        </div>

        <div className="settings-scroll">
          <label className="setting-block">
            <span>โมเดลเริ่มต้น</span>
            <select
              value={settings.model}
              onChange={(event) =>
                setSettings((previous) => ({ ...previous, model: event.target.value }))
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
                  maxTokens: Math.min(32768, Math.max(256, Number(event.target.value))),
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
                onClick={() => setSettings((previous) => ({ ...previous, theme: "dark" }))}
              >
                มืด
              </button>
              <button
                type="button"
                className={settings.theme === "light" ? "active" : ""}
                onClick={() => setSettings((previous) => ({ ...previous, theme: "light" }))}
              >
                สว่าง
              </button>
            </div>
          </div>

          <div className="info-card">
            <strong>ข้อมูลส่วนตัวบนเครื่อง</strong>
            <p>
              ประวัติแชตและการตั้งค่าของ V1 เก็บไว้ในเบราว์เซอร์เครื่องนี้
              ส่วนข้อความที่ถาม AI จะถูกส่งผ่านเซิร์ฟเวอร์ของ Private AI ไปยัง Kob AI
              เพื่อประมวลผล
            </p>
          </div>

          <button
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

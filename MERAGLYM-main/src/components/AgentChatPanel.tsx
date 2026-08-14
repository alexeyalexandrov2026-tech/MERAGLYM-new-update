"use client";

import React, { useState, useRef, useEffect } from "react";
import { useI18n } from "@/lib/i18nContext";

interface ChatMessage {
  id: string;
  sender: "user" | "agent";
  text: string;
  timestamp: string;
  sources?: { id: number; name: string; url?: string }[];
}

let messageCounter = 0;
function generateId(prefix: string) {
  messageCounter += 1;
  return `${prefix}-${messageCounter}-${Math.random().toString(36).substring(2, 7)}`;
}

export default function AgentChatPanel() {
  const { t, locale, isRussian } = useI18n();

  const getInitialMessage = (): ChatMessage => ({
    id: "welcome-init",
    sender: "agent",
    text: t("agentChat.welcome"),
    timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
  });

  const [messages, setMessages] = useState<ChatMessage[]>([getInitialMessage()]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Update initial welcome message if user switches language and no conversation has occurred yet
  useEffect(() => {
    setMessages((prev) => {
      if (prev.length === 1 && prev[0].id === "welcome-init") {
        return [getInitialMessage()];
      }
      return prev;
    });
  }, [locale]);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, loading]);

  const quickPrompts = isRussian
    ? [
        "Как проверить компанию в РФ по ИНН / ОГРН (ЕГРЮЛ, ФНС, БО)?",
        "Как проверить физлицо (МВД розыск, суды СудРФ, долги ФССП)?",
        "Какие методы и утилиты использовать для OSINT по Email (Holehe/GHunt)?",
        "Как отслеживать криптовалютные транзакции (BTC, ETH, TRON)?",
        "Как работает корреляция сущностей и импорт STIX 2.1?",
      ]
    : [
        "How to verify a Russian company by INN / OGRN?",
        "How to investigate individuals (MVD Wanted, SudRF, FSSP)?",
        "Which tools to use for deep email & account reconnaissance?",
        "What tools trace cryptocurrency transactions (BTC, ETH, TRON)?",
        "How does entity resolution and STIX correlation work?",
      ];

  const handleSendMessage = async (customPrompt?: string) => {
    const textToSend = customPrompt || input.trim();
    if (!textToSend || loading) return;

    const userMsg: ChatMessage = {
      id: generateId("user"),
      sender: "user",
      text: textToSend,
      timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    };

    setMessages((prev) => [...prev, userMsg]);
    if (!customPrompt) setInput("");
    setLoading(true);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: textToSend, locale }),
      });

      if (res.ok) {
        const data = (await res.json()) as { answer?: string; sources?: { id: number; name: string; url?: string }[] };
        const agentMsg: ChatMessage = {
          id: generateId("agent"),
          sender: "agent",
          text: data.answer || (isRussian ? "Ответ получен." : "Response received."),
          timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
          sources: data.sources,
        };
        setMessages((prev) => [...prev, agentMsg]);
      } else {
        throw new Error(`Server returned ${res.status}`);
      }
    } catch (err) {
      console.error("Agent chat request failed:", err);
      const errorMsg: ChatMessage = {
        id: generateId("agent-err"),
        sender: "agent",
        text: isRussian
          ? "Ошибка связи с сервером ИИ-агента. Убедитесь, что backend запущен."
          : "Communication error with AI Agent backend server. Ensure backend is active.",
        timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      };
      setMessages((prev) => [...prev, errorMsg]);
    } finally {
      setLoading(false);
    }
  };

  const handleClearChat = () => {
    setMessages([getInitialMessage()]);
  };

  const handleExportChat = () => {
    const log = messages
      .map((m) => `[${m.timestamp}] ${m.sender === "user" ? "USER" : "AGENT"}:\n${m.text}\n`)
      .join("\n---\n\n");
    const blob = new Blob([log], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `meraglym-chat-${new Date().toISOString().slice(0, 10)}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", height: "100%", padding: "24px 32px", boxSizing: "border-box", background: "var(--bg-dark)" }}>
      {/* Header */}
      <div style={{ paddingBottom: "14px", borderBottom: "1px solid var(--border-highlight)", marginBottom: "16px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <h2 style={{ fontFamily: "var(--font-mono)", color: "var(--text-accent)", fontSize: "16px", margin: 0 }}>
            🤖 {t("agentChat.title")}
          </h2>
          <div style={{ fontSize: "11px", color: "var(--text-secondary)", fontFamily: "var(--font-mono)", marginTop: "4px" }}>
            {t("agentChat.subtitle")}
          </div>
        </div>

        {/* Action Controls */}
        <div style={{ display: "flex", gap: "8px" }}>
          <button
            onClick={handleClearChat}
            style={{
              background: "transparent",
              border: "1px solid var(--border-primary)",
              color: "var(--text-secondary)",
              padding: "4px 10px",
              borderRadius: "4px",
              fontSize: "11px",
              fontFamily: "var(--font-mono)",
              cursor: "pointer",
            }}
          >
            🗑️ {t("agentChat.clearChat")}
          </button>
          <button
            onClick={handleExportChat}
            style={{
              background: "transparent",
              border: "1px solid var(--border-primary)",
              color: "var(--text-secondary)",
              padding: "4px 10px",
              borderRadius: "4px",
              fontSize: "11px",
              fontFamily: "var(--font-mono)",
              cursor: "pointer",
            }}
          >
            📥 {t("agentChat.exportChat")}
          </button>
        </div>
      </div>

      {/* Quick Prompts */}
      <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", marginBottom: "14px" }}>
        {quickPrompts.map((p, idx) => (
          <button
            key={idx}
            onClick={() => handleSendMessage(p)}
            style={{
              background: "rgba(0, 255, 204, 0.05)",
              border: "1px solid var(--border-primary)",
              color: "var(--text-secondary)",
              padding: "6px 12px",
              borderRadius: "14px",
              fontSize: "11px",
              fontFamily: "var(--font-mono)",
              cursor: "pointer",
              transition: "all 0.2s",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.borderColor = "var(--border-highlight)";
              e.currentTarget.style.color = "var(--text-accent)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.borderColor = "var(--border-primary)";
              e.currentTarget.style.color = "var(--text-secondary)";
            }}
          >
            💡 {p}
          </button>
        ))}
      </div>

      {/* Chat Messages */}
      <div style={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column", gap: "14px", paddingRight: "10px" }}>
        {messages.map((msg) => (
          <div
            key={msg.id}
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: msg.sender === "user" ? "flex-end" : "flex-start",
            }}
          >
            <div
              style={{
                maxWidth: "75%",
                padding: "14px 18px",
                borderRadius: msg.sender === "user" ? "12px 12px 2px 12px" : "12px 12px 12px 2px",
                background: msg.sender === "user" ? "rgba(0, 255, 204, 0.12)" : "var(--bg-panel)",
                border: msg.sender === "user" ? "1px solid var(--border-highlight)" : "1px solid var(--border-primary)",
                color: "var(--text-primary)",
                fontFamily: "var(--font-sans)",
                fontSize: "14px",
                lineHeight: 1.6,
                whiteSpace: "pre-wrap",
                boxShadow: "0 2px 8px rgba(0,0,0,0.3)",
              }}
            >
              {msg.text}

              {msg.sources && msg.sources.length > 0 && (
                <div style={{ marginTop: "12px", paddingTop: "8px", borderTop: "1px dashed var(--border-primary)", fontSize: "11px", fontFamily: "var(--font-mono)" }}>
                  <div style={{ color: "var(--text-accent)", marginBottom: "4px", fontWeight: "bold" }}>
                    {t("agentChat.matchingSources")}
                  </div>
                  {msg.sources.map((s) => (
                    <div key={s.id} style={{ color: "var(--text-secondary)", marginTop: "2px" }}>
                      • <b>{s.name}</b> {s.url ? (
                        <a href={s.url} target="_blank" rel="noopener noreferrer" style={{ color: "var(--text-accent)", marginLeft: "4px", textDecoration: "underline" }}>
                          [↗]
                        </a>
                      ) : ""}
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div style={{ fontSize: "10px", color: "var(--text-secondary)", fontFamily: "var(--font-mono)", marginTop: "4px", padding: "0 4px" }}>
              {msg.sender === "user" ? (isRussian ? "Вы" : "You") : "MERAGLYM AI"} • {msg.timestamp}
            </div>
          </div>
        ))}

        {loading && (
          <div style={{ display: "flex", alignItems: "center", gap: "8px", color: "var(--text-accent)", fontFamily: "var(--font-mono)", fontSize: "12px", padding: "8px 0" }}>
            <span>⏳</span> {t("agentChat.generating")}
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input Box */}
      <div style={{ marginTop: "14px", display: "flex", gap: "10px" }}>
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleSendMessage();
          }}
          placeholder={t("agentChat.placeholder")}
          style={{
            flex: 1,
            background: "rgba(0, 255, 204, 0.05)",
            border: "1px solid var(--border-highlight)",
            color: "var(--text-primary)",
            padding: "12px 16px",
            fontFamily: "var(--font-mono)",
            fontSize: "13px",
            borderRadius: "4px",
            outline: "none",
          }}
        />
        <button
          onClick={() => handleSendMessage()}
          disabled={loading || !input.trim()}
          style={{
            background: "rgba(0, 255, 204, 0.15)",
            border: "1px solid var(--border-highlight)",
            color: "var(--text-accent)",
            padding: "0 22px",
            fontFamily: "var(--font-mono)",
            fontSize: "13px",
            fontWeight: "bold",
            borderRadius: "4px",
            cursor: loading || !input.trim() ? "not-allowed" : "pointer",
            transition: "all 0.2s ease",
          }}
        >
          {t("agentChat.send")}
        </button>
      </div>
    </div>
  );
}

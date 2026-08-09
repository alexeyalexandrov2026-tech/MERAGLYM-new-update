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
  const { locale } = useI18n();
  const isRu = locale === "ru";
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: "welcome-1",
      sender: "agent",
      text: isRu
        ? "Здравствуйте! Я ИИ-агент платформы разведки MERAGLYM Open Intelligence. Задайте мне любой вопрос по OSINT-поиску, инструментам или анализу данных."
        : "Hello! I am the MERAGLYM Open Intelligence AI Agent. Ask me any question regarding OSINT research, tools, or intelligence analysis.",
      timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    }
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, loading]);

  const quickPrompts = isRu
    ? [
        "Как проверить email по OSINT базами?",
        "Какие инструменты есть для поиска по номеру телефона?",
        "Что такое STIX и OpenCTI?",
        "Какие адаптеры доступны в MERAGLYM?"
      ]
    : [
        "How to check an email using OSINT tools?",
        "What tools are available for phone lookup?",
        "What is STIX and OpenCTI?",
        "Which adapters are available in MERAGLYM?"
      ];

  const handleSendMessage = async (customPrompt?: string) => {
    const textToSend = customPrompt || input.trim();
    if (!textToSend || loading) return;

    const userMsg: ChatMessage = {
      id: generateId("user"),
      sender: "user",
      text: textToSend,
      timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    };

    setMessages((prev) => [...prev, userMsg]);
    if (!customPrompt) setInput("");
    setLoading(true);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: textToSend })
      });

      if (res.ok) {
        const data = (await res.json()) as { answer?: string; sources?: { id: number; name: string; url?: string }[] };
        const agentMsg: ChatMessage = {
          id: generateId("agent"),
          sender: "agent",
          text: data.answer || (isRu ? "Ответ получен." : "Response received."),
          timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
          sources: data.sources
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
        text: isRu
          ? "Ошибка связи с сервером ИИ-агента. Убедитесь, что backend запущен."
          : "Communication error with AI Agent backend server. Ensure backend is active.",
        timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
      };
      setMessages((prev) => [...prev, errorMsg]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", height: "100%", padding: "30px", background: "var(--bg-dark)" }}>
      {/* Header */}
      <div style={{ paddingBottom: "16px", borderBottom: "1px solid var(--border-highlight)", marginBottom: "20px" }}>
        <h2 style={{ fontFamily: "var(--font-mono)", color: "var(--text-accent)", fontSize: "18px", margin: 0 }}>
          🤖 {isRu ? "Чат с ИИ-Агентом MERAGLYM" : "MERAGLYM AI Agent Chat"}
        </h2>
        <div style={{ fontSize: "12px", color: "var(--text-secondary)", fontFamily: "var(--font-mono)", marginTop: "4px" }}>
          {isRu ? "Статус: Подключено к ядру разведки (D1 + AI Engine)" : "Status: Connected to Intelligence Core (D1 + AI Engine)"}
        </div>
      </div>

      {/* Quick Prompts */}
      <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", marginBottom: "16px" }}>
        {quickPrompts.map((p, idx) => (
          <button
            key={idx}
            onClick={() => handleSendMessage(p)}
            style={{
              background: "rgba(100, 255, 218, 0.05)",
              border: "1px solid var(--border-primary)",
              color: "var(--text-secondary)",
              padding: "6px 12px",
              borderRadius: "16px",
              fontSize: "11px",
              fontFamily: "var(--font-mono)",
              cursor: "pointer",
              transition: "all 0.2s"
            }}
          >
            {p}
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
                background: msg.sender === "user" ? "rgba(100, 255, 218, 0.15)" : "var(--bg-panel)",
                border: msg.sender === "user" ? "1px solid var(--border-highlight)" : "1px solid var(--border-primary)",
                color: "var(--text-primary)",
                fontFamily: "var(--font-sans)",
                fontSize: "14px",
                lineHeight: 1.6,
                whiteSpace: "pre-wrap"
              }}
            >
              {msg.text}

              {msg.sources && msg.sources.length > 0 && (
                <div style={{ marginTop: "12px", paddingTop: "8px", borderTop: "1px dashed var(--border-primary)", fontSize: "11px", fontFamily: "var(--font-mono)" }}>
                  <div style={{ color: "var(--text-accent)", marginBottom: "4px" }}>
                    {isRu ? "Найденные источники:" : "Matching Sources:"}
                  </div>
                  {msg.sources.map((s) => (
                    <div key={s.id} style={{ color: "var(--text-secondary)" }}>
                      • {s.name} {s.url ? `(${s.url})` : ""}
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div style={{ fontSize: "10px", color: "var(--text-secondary)", fontFamily: "var(--font-mono)", marginTop: "4px", padding: "0 4px" }}>
              {msg.sender === "user" ? "Вы" : "MERAGLYM AI"} • {msg.timestamp}
            </div>
          </div>
        ))}

        {loading && (
          <div style={{ display: "flex", alignItems: "center", gap: "8px", color: "var(--text-accent)", fontFamily: "var(--font-mono)", fontSize: "12px" }}>
            <span className="spinner">⏳</span> {isRu ? "ИИ-Агент формирует ответ..." : "AI Agent is generating response..."}
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input Box */}
      <div style={{ marginTop: "16px", display: "flex", gap: "10px" }}>
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleSendMessage();
          }}
          placeholder={isRu ? "Задайте вопрос ИИ-Агенту..." : "Ask the AI Agent a question..."}
          style={{
            flex: 1,
            background: "rgba(100, 255, 218, 0.05)",
            border: "1px solid var(--border-highlight)",
            color: "var(--text-primary)",
            padding: "14px 18px",
            fontFamily: "var(--font-mono)",
            fontSize: "14px",
            borderRadius: "4px",
            outline: "none"
          }}
        />
        <button
          onClick={() => handleSendMessage()}
          disabled={loading || !input.trim()}
          style={{
            background: "var(--bg-accent)",
            border: "1px solid var(--border-highlight)",
            color: "var(--text-primary)",
            padding: "0 24px",
            fontFamily: "var(--font-mono)",
            fontSize: "14px",
            fontWeight: "bold",
            borderRadius: "4px",
            cursor: loading || !input.trim() ? "not-allowed" : "pointer"
          }}
        >
          {isRu ? "Отправить" : "Send"}
        </button>
      </div>
    </div>
  );
}

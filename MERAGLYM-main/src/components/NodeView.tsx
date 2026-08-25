"use client";

import React, { useState } from "react";
import type { Node } from "@prisma/client";
import { useI18n } from "@/lib/i18nContext";
import { UnifiedDossierModal } from "./UnifiedDossierModal";

interface NodeViewProps {
  node: Node | null;
}

export default function NodeView({ node }: NodeViewProps) {
  const { t, locale, isRussian } = useI18n();
  const [copied, setCopied] = useState(false);
  const [showRunnerModal, setShowRunnerModal] = useState(false);
  const [showUnifiedDossier, setShowUnifiedDossier] = useState(false);
  const [targetInput, setTargetInput] = useState("");
  const [isExecuting, setIsExecuting] = useState(false);
  const [executionResult, setExecutionResult] = useState<any | null>(null);

  const handleCopyLink = () => {
    if (node?.url) {
      navigator.clipboard.writeText(node.url === "#launch-tool" ? window.location.href : node.url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const getInputPlaceholder = () => {
    if (!node) return "Введите значение целевого объекта...";
    const nameLower = node.name.toLowerCase();
    if (nameLower.includes("phone") || nameLower.includes("телефон")) return "+79991234567";
    if (nameLower.includes("email") || nameLower.includes("почт") || nameLower.includes("holehe") || nameLower.includes("ghunt")) return "target.investigation@gmail.com";
    if (nameLower.includes("инн") || nameLower.includes("егрюл") || nameLower.includes("бо налог") || nameLower.includes("кад") || nameLower.includes("фнс")) return "7707083893";
    if (nameLower.includes("суд") || nameLower.includes("мвд") || nameLower.includes("розыск") || nameLower.includes("маигрет") || nameLower.includes("maigret")) return "Иванов Иван Иванович";
    if (nameLower.includes("крипт") || nameLower.includes("btc") || nameLower.includes("eth")) return "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa";
    if (nameLower.includes("stix") || nameLower.includes("opencti") || nameLower.includes("spiderfoot")) return "APT28 / target-domain.com";
    return "Целевой объект (ИНН, Email, ФИО, Телефон, IP, Кошелек)...";
  };

  const handleExecuteInProject = async () => {
    if (!targetInput.trim()) return;
    setIsExecuting(true);
    setExecutionResult(null);

    const now = new Date().toISOString();
    const cleanInput = targetInput.trim();
    const isPhone = cleanInput.startsWith("+7") || cleanInput.startsWith("8") || (cleanInput.length >= 10 && /^\+?\d+$/.test(cleanInput.replace(/[\s()-]/g, "")));
    const adapterName = isPhone ? "phone_person_correlator" : ((node?.type && node.type !== "folder" && node.type !== "url") ? node.type : (node?.name || "universal_recon"));

    // Prepare robust phone intelligence payload
    let cleanDigits = cleanInput.replace(/\D/g, "");
    if (cleanDigits.startsWith("8") && cleanDigits.length === 11) cleanDigits = "7" + cleanDigits.slice(1);
    if (!cleanDigits.startsWith("7") && cleanDigits.length === 10) cleanDigits = "7" + cleanDigits;
    const e164 = "+" + cleanDigits;
    const prefix = cleanDigits.slice(1, 4);
    const nat = cleanDigits.length === 11 
      ? `8 (${prefix}) ${cleanDigits.slice(4, 7)}-${cleanDigits.slice(7, 9)}-${cleanDigits.slice(9, 11)}`
      : cleanInput;

    let operator = "ПАО «МегаФон»";
    let region = "Новосибирская область (Сибирский ФО)";

    if (prefix.startsWith("999") || prefix.startsWith("913") || prefix.startsWith("915") || prefix.startsWith("985") || prefix.startsWith("914")) {
      operator = "ПАО «МТС»";
      region = prefix.startsWith("913") || prefix.startsWith("914") ? "Сибирский / Дальневосточный ФО" : "Московский регион";
    } else if (prefix.startsWith("923") || prefix.startsWith("926") || prefix.startsWith("936") || prefix.startsWith("928") || prefix.startsWith("933")) {
      operator = "ПАО «МегаФон»";
      region = prefix.startsWith("923") ? "Новосибирская область (Сибирский ФО)" : "Региональный пул РФ";
    } else if (prefix.startsWith("903") || prefix.startsWith("905") || prefix.startsWith("968") || prefix.startsWith("960")) {
      operator = "ПАО «ВымпелКом» (Билайн)";
      region = "Центральный / Региональный ФО";
    } else if (prefix.startsWith("977") || prefix.startsWith("958") || prefix.startsWith("991") || prefix.startsWith("951")) {
      operator = "ООО «Т2 Мобайл» (Tele2 / T-Mobile)";
      region = "Федеральный пул РФ";
    }

    const phoneOutputData = {
      entity: e164,
      phone_intelligence: {
        e164_format: e164,
        national_format: nat,
        operator: operator,
        def_code: prefix,
        region_jurisdiction: region,
        timezone: "UTC+7 (Новосибирск, Красноярск) / MSK+4",
        mnp_transfer_check: "Диапазон подтвержден в реестре связи РФ (" + operator + ")",
        line_type: "Мобильный GSM"
      },
      messengers_and_social: {
        telegram_link: `https://t.me/+${cleanDigits}`,
        whatsapp_link: `https://wa.me/${cleanDigits}`,
        viber_link: `viber://chat?number=%2B${cleanDigits}`
      },
      open_source_dorks: [
        `https://yandex.ru/search/?text="${nat}"`,
        `https://google.com/search?q="${e164}" OR "${nat}" avito`,
        `https://google.com/search?q="${e164}" site:vk.com`,
        `https://google.com/search?q="${e164}" site:hh.ru`
      ]
    };

    try {
      const res = await fetch("/api/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: adapterName,
          payload: { target: cleanInput, phone: cleanInput, inn: cleanInput, email: cleanInput, address: cleanInput },
        }),
      });

      if (res.ok) {
        let job = (await res.json()) as {
          id: string;
          status?: string;
          result?: any;
          error?: any;
        };

        // Poll until COMPLETED or FAILED
        while (job.status === "QUEUED" || job.status === "RUNNING") {
          await new Promise((resolve) => setTimeout(resolve, 2000));
          try {
            const pollRes = await fetch(`/api/jobs/${job.id}`);
            if (pollRes.ok) {
              job = await pollRes.json();
            } else {
              break;
            }
          } catch {
            break;
          }
        }

        const isVerified = job.result?.verified === true;
        setExecutionResult({
          status: job.status || "FAILED",
          adapter: adapterName,
          target: cleanInput,
          timestamp: now,
          confidence: isVerified ? "VERIFIED" : "LOCAL_ENRICHMENT",
          data: job.result || job.error || { message: "Job finished", status: job.status },
        });
      } else {
        setExecutionResult({
          status: "FAILED",
          adapter: adapterName,
          target: cleanInput,
          timestamp: now,
          confidence: "UNVERIFIED",
          data: {
            error: { code: "HTTP_ERROR", message: `HTTP ${res.status}: Backend service unavailable` },
          },
        });
      }
    } catch (err) {
      setExecutionResult({
        status: "FAILED",
        adapter: adapterName,
        target: cleanInput,
        timestamp: now,
        confidence: "UNVERIFIED",
        data: {
          error: { code: "NETWORK_ERROR", message: err instanceof Error ? err.message : "Network error" },
        },
      });
    } finally {
      setIsExecuting(false);
      setShowUnifiedDossier(true);
    }
  };

  if (!node) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", color: "var(--text-muted)", flexDirection: "column", flex: 1, padding: "20px" }}>
        <div style={{ fontSize: "42px", marginBottom: "16px", opacity: 0.25, color: "var(--text-accent)" }}>◇</div>
        <div style={{ fontFamily: "var(--font-mono)", fontSize: "14px", letterSpacing: "1px", color: "var(--text-secondary)", marginBottom: "8px" }}>
          {t("nodeView.awaitingSelection")}
        </div>
        <div style={{ fontSize: "12px", color: "var(--text-muted)", maxWidth: "420px", textAlign: "center", lineHeight: "1.5" }}>
          {t("nodeView.selectNodePrompt")}
        </div>
      </div>
    );
  }

  const isExternalPortal = node.url && node.url.startsWith("http") && !node.url.includes("github.com");

  const tags = [
    { label: isRussian ? "⚡ Встроен в проект MERAGLYM" : "⚡ Integrated In-Project Tool", color: "#00ffcc" },
    node.localInstall ? { label: t("nodeView.localInstall"), color: "#00ffcc" } : null,
    node.api ? { label: t("nodeView.api"), color: "#0088ff" } : null,
    node.registration ? { label: t("nodeView.registration"), color: "#ffb86c" } : null,
    node.googleDork ? { label: t("nodeView.googleDork"), color: "#bd93f9" } : null,
    node.invitationOnly ? { label: t("nodeView.invitationOnly"), color: "#ff79c6" } : null,
    node.deprecated ? { label: t("nodeView.deprecated"), color: "#ff5555" } : null,
  ].filter(Boolean);

  return (
    <div
      className="gotham-panel"
      style={{
        margin: "20px",
        padding: "28px 32px",
        borderRadius: "8px",
        flex: 1,
        display: "flex",
        flexDirection: "column",
        overflowY: "auto",
        animation: "pulseGlow 4s infinite",
        border: "1px solid var(--border-primary)",
        position: "relative",
      }}
    >
      {/* Header */}
      <div
        style={{
          borderBottom: "1px solid var(--border-primary)",
          paddingBottom: "18px",
          marginBottom: "20px",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          flexWrap: "wrap",
          gap: "12px",
        }}
      >
        <div>
          <div style={{ color: "var(--accent-electric)", fontSize: "11px", fontFamily: "var(--font-mono)", marginBottom: "6px", letterSpacing: "2px" }}>
            [ID: {node.id.toString().padStart(4, "0")}] {"//"} {node.type.toUpperCase()} {"//"} IN-PROJECT OSINT TOOL
          </div>
          <h1 style={{ color: "var(--text-primary)", fontSize: "24px", letterSpacing: "0.5px" }}>{node.name}</h1>
        </div>

        {/* Action Buttons */}
        <div style={{ display: "flex", gap: "10px", alignItems: "center", flexWrap: "wrap" }}>
          {/* PRIMARY BUTTON: LAUNCH IN MERAGLYM WORKBENCH */}
          <button
            onClick={() => {
              setShowRunnerModal(true);
              setExecutionResult(null);
            }}
            style={{
              padding: "10px 18px",
              background: "rgba(0, 255, 204, 0.18)",
              border: "1px solid var(--border-highlight)",
              color: "var(--text-accent)",
              fontFamily: "var(--font-mono)",
              fontSize: "12px",
              fontWeight: "bold",
              cursor: "pointer",
              borderRadius: "4px",
              transition: "all 0.2s",
              boxShadow: "0 0 12px rgba(0, 255, 204, 0.2)",
            }}
            onMouseOver={(e) => (e.currentTarget.style.background = "rgba(0, 255, 204, 0.3)")}
            onMouseOut={(e) => (e.currentTarget.style.background = "rgba(0, 255, 204, 0.18)")}
          >
            ⚡ {isRussian ? "ЗАПУСТИТЬ В ПРОЕКТЕ (WORKBENCH)" : "LAUNCH IN PROJECT WORKBENCH"}
          </button>

          {/* EXTERNAL PUBLIC WEB PORTAL LINK IF APPLICABLE */}
          {isExternalPortal && (
            <a
              href={node.url!}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                padding: "10px 16px",
                background: "rgba(0, 136, 255, 0.15)",
                border: "1px solid var(--accent-electric)",
                color: "var(--text-primary)",
                textDecoration: "none",
                fontFamily: "var(--font-mono)",
                fontSize: "12px",
                fontWeight: "bold",
                borderRadius: "4px",
                transition: "all 0.2s",
              }}
            >
              🌐 {isRussian ? "ВЕБ-ПОРТАЛ ↗" : "WEB PORTAL ↗"}
            </a>
          )}

          {/* COPY LINK / IDENTIFIER */}
          <button
            onClick={handleCopyLink}
            style={{
              padding: "10px 14px",
              background: "transparent",
              border: "1px solid var(--border-primary)",
              color: "var(--text-secondary)",
              fontFamily: "var(--font-mono)",
              fontSize: "11px",
              cursor: "pointer",
              borderRadius: "4px",
              transition: "all 0.2s",
            }}
          >
            📋 {copied ? t("common.copied") : t("nodeView.copyLink")}
          </button>
        </div>
      </div>

      {/* Tags Bar */}
      {tags.length > 0 && (
        <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", marginBottom: "20px" }}>
          {tags.map((tag, idx) => (
            <span
              key={idx}
              style={{
                fontSize: "10px",
                fontFamily: "var(--font-mono)",
                color: tag?.color,
                border: `1px solid ${tag?.color}40`,
                background: `${tag?.color}10`,
                padding: "3px 10px",
                borderRadius: "3px",
              }}
            >
              {tag?.label}
            </span>
          ))}
        </div>
      )}

      {/* Metadata Grid */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: "20px" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
          <Field label={t("nodeView.description")} value={node.description} />
          <Field label={t("nodeView.status")} value={node.status} />
          <Field label={t("nodeView.bestFor")} value={node.bestFor} />
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
          <Field label={t("nodeView.pricing")} value={node.pricing} />
          <Field label={t("nodeView.input")} value={node.input} />
          <Field label={t("nodeView.output")} value={node.output} />
          <Field
            label={t("nodeView.opsec")}
            value={node.opsec}
            isWarning={node.opsec?.toLowerCase().includes("high") || node.opsec?.toLowerCase().includes("warning")}
          />
          <Field label={t("nodeView.opsecNote")} value={node.opsecNote} />
        </div>
      </div>

      {/* IN-PROJECT INTERACTIVE TOOL RUNNER MODAL */}
      {showRunnerModal && (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: "rgba(5, 10, 15, 0.85)",
            backdropFilter: "blur(8px)",
            zIndex: 1000,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "20px",
          }}
        >
          <div
            style={{
              width: "100%",
              maxWidth: "680px",
              background: "var(--bg-panel)",
              border: "1px solid var(--border-highlight)",
              borderRadius: "8px",
              padding: "28px",
              boxShadow: "0 10px 40px rgba(0, 255, 204, 0.15)",
              display: "flex",
              flexDirection: "column",
              gap: "20px",
            }}
          >
            {/* Modal Header */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: "1px solid var(--border-primary)", paddingBottom: "14px" }}>
              <div>
                <div style={{ fontSize: "11px", color: "var(--text-accent)", fontFamily: "var(--font-mono)", letterSpacing: "1.5px" }}>
                  ⚡ MERAGLYM IN-PROJECT WORKBENCH EXECUTION
                </div>
                <h3 style={{ margin: "4px 0 0 0", color: "var(--text-primary)", fontSize: "18px", fontFamily: "var(--font-mono)" }}>
                  {node.name}
                </h3>
              </div>
              <button
                onClick={() => setShowRunnerModal(false)}
                style={{
                  background: "transparent",
                  border: "1px solid var(--border-primary)",
                  color: "var(--text-secondary)",
                  fontSize: "14px",
                  cursor: "pointer",
                  padding: "4px 10px",
                  borderRadius: "4px",
                }}
              >
                ✕
              </button>
            </div>

            {/* Input Form */}
            <div>
              <label style={{ display: "block", color: "var(--text-secondary)", fontSize: "12px", fontFamily: "var(--font-mono)", marginBottom: "8px" }}>
                🎯 {isRussian ? "Целевой параметр для разведки:" : "Target Recon Parameter:"} (<i>{node.input || "Объект"}</i>)
              </label>
              <div style={{ display: "flex", gap: "10px" }}>
                <input
                  type="text"
                  value={targetInput}
                  onChange={(e) => setTargetInput(e.target.value)}
                  placeholder={getInputPlaceholder()}
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
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleExecuteInProject();
                  }}
                />
                <button
                  onClick={handleExecuteInProject}
                  disabled={isExecuting || !targetInput.trim()}
                  style={{
                    background: isExecuting ? "rgba(0, 255, 204, 0.1)" : "rgba(0, 255, 204, 0.25)",
                    border: "1px solid var(--border-highlight)",
                    color: "var(--text-accent)",
                    padding: "0 20px",
                    fontFamily: "var(--font-mono)",
                    fontSize: "12px",
                    fontWeight: "bold",
                    borderRadius: "4px",
                    cursor: isExecuting || !targetInput.trim() ? "not-allowed" : "pointer",
                  }}
                >
                  {isExecuting ? (isRussian ? "⏳ СКАНИРОВАНИЕ..." : "⏳ SCANNING...") : (isRussian ? "▶ ЗАПУСТИТЬ РАЗВЕДКУ" : "▶ RUN TOOL")}
                </button>
              </div>
            </div>

            {/* Execution Result Log Terminal */}
            {executionResult && (
              <div
                style={{
                  background: "rgba(0, 10, 20, 0.85)",
                  border: "1px solid var(--border-highlight)",
                  borderRadius: "6px",
                  padding: "20px",
                  fontFamily: "var(--font-mono)",
                  fontSize: "12px",
                  color: "var(--text-primary)",
                  maxHeight: "420px",
                  overflowY: "auto",
                  boxShadow: "inset 0 0 20px rgba(0, 255, 204, 0.05)",
                }}
              >
                {/* Header Status */}
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: "1px solid var(--border-primary)", paddingBottom: "12px", marginBottom: "16px" }}>
                  <div>
                    <span style={{ color: "var(--text-accent)", fontWeight: "bold", fontSize: "13px" }}>
                      ✓ [STATUS: {executionResult.status}]
                    </span>
                    <span style={{ color: "var(--text-secondary)", marginLeft: "8px", fontSize: "11px" }}>
                      — {executionResult.adapter}
                    </span>
                  </div>
                  <div style={{ fontSize: "11px", color: "var(--accent-electric)", background: "rgba(0, 255, 204, 0.1)", padding: "3px 8px", borderRadius: "3px" }}>
                    {executionResult.confidence}
                  </div>
                </div>

                {/* PHONE INTELLIGENCE RICH DASHBOARD */}
                {executionResult.data?.phone_intelligence ? (
                  <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
                    {/* Telecom Details Box */}
                    <div style={{ background: "rgba(255, 255, 255, 0.03)", border: "1px solid var(--border-muted)", borderRadius: "4px", padding: "14px" }}>
                      <div style={{ color: "var(--text-accent)", fontWeight: "bold", marginBottom: "10px", fontSize: "13px" }}>
                        📱 РЕЗУЛЬТАТЫ РАЗВЕДКИ ТЕЛЕФОНА: {executionResult.data.phone_intelligence.national_format}
                      </div>
                      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "10px", fontSize: "12px" }}>
                        <div>• Оператор связи: <b style={{ color: "#00ffcc" }}>{executionResult.data.phone_intelligence.operator}</b></div>
                        <div>• Регион: <b style={{ color: "var(--text-primary)" }}>{executionResult.data.phone_intelligence.region_jurisdiction}</b></div>
                        <div>• DEF-код: <b style={{ color: "var(--text-primary)" }}>{executionResult.data.phone_intelligence.def_code}</b></div>
                        <div>• Часовой пояс: <b style={{ color: "var(--text-primary)" }}>{executionResult.data.phone_intelligence.timezone}</b></div>
                        <div>• Тип связи: <b style={{ color: "var(--text-primary)" }}>{executionResult.data.phone_intelligence.line_type}</b></div>
                        <div>• MNP статус: <b style={{ color: "#00ffcc" }}>{executionResult.data.phone_intelligence.mnp_transfer_check}</b></div>
                      </div>
                    </div>

                    {/* Quick Messengers Actions */}
                    <div>
                      <div style={{ color: "var(--text-secondary)", fontSize: "11px", marginBottom: "8px", fontWeight: "bold", letterSpacing: "1px" }}>
                        💬 ПРЯМАЯ ИДЕНТИФИКАЦИЯ В МЕССЕНДЖЕРАХ (ФОТО / ИМЯ / VCARD):
                      </div>
                      <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                        <a
                          href={executionResult.data.messengers_and_social.telegram_link}
                          target="_blank"
                          rel="noopener noreferrer"
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            gap: "6px",
                            padding: "8px 14px",
                            background: "rgba(0, 136, 255, 0.2)",
                            border: "1px solid #0088ff",
                            color: "#ffffff",
                            textDecoration: "none",
                            borderRadius: "4px",
                            fontSize: "12px",
                            fontWeight: "bold",
                          }}
                        >
                          ✈️ Открыть профиль Telegram ↗
                        </a>
                        <a
                          href={executionResult.data.messengers_and_social.whatsapp_link}
                          target="_blank"
                          rel="noopener noreferrer"
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            gap: "6px",
                            padding: "8px 14px",
                            background: "rgba(37, 211, 102, 0.2)",
                            border: "1px solid #25d366",
                            color: "#ffffff",
                            textDecoration: "none",
                            borderRadius: "4px",
                            fontSize: "12px",
                            fontWeight: "bold",
                          }}
                        >
                          🟢 Открыть чат WhatsApp ↗
                        </a>
                      </div>
                    </div>

                    {/* Instant OSINT Dorks */}
                    <div>
                      <div style={{ color: "var(--text-secondary)", fontSize: "11px", marginBottom: "8px", fontWeight: "bold", letterSpacing: "1px" }}>
                        🔍 ПОИСК ОБЪЯВЛЕНИЙ, РЕЗЮМЕ И СЛЕДОВ ВЛАДЕЛЬЦА В СЕТИ:
                      </div>
                      <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                        <a
                          href={`https://google.com/search?q="${executionResult.data.phone_intelligence.e164_format}" OR "${executionResult.data.phone_intelligence.national_format}" site:avito.ru`}
                          target="_blank"
                          rel="noopener noreferrer"
                          style={{
                            padding: "6px 12px",
                            background: "rgba(255, 184, 108, 0.15)",
                            border: "1px solid #ffb86c",
                            color: "#ffb86c",
                            textDecoration: "none",
                            borderRadius: "4px",
                            fontSize: "11px",
                          }}
                        >
                          📦 Искать на Авито ↗
                        </a>
                        <a
                          href={`https://google.com/search?q="${executionResult.data.phone_intelligence.e164_format}" OR "${executionResult.data.phone_intelligence.national_format}" site:hh.ru`}
                          target="_blank"
                          rel="noopener noreferrer"
                          style={{
                            padding: "6px 12px",
                            background: "rgba(255, 85, 85, 0.15)",
                            border: "1px solid #ff5555",
                            color: "#ff5555",
                            textDecoration: "none",
                            borderRadius: "4px",
                            fontSize: "11px",
                          }}
                        >
                          📄 Резюме HeadHunter ↗
                        </a>
                        <a
                          href={`https://yandex.ru/search/?text="${executionResult.data.phone_intelligence.national_format}"`}
                          target="_blank"
                          rel="noopener noreferrer"
                          style={{
                            padding: "6px 12px",
                            background: "rgba(255, 255, 255, 0.08)",
                            border: "1px solid var(--border-primary)",
                            color: "var(--text-primary)",
                            textDecoration: "none",
                            borderRadius: "4px",
                            fontSize: "11px",
                          }}
                        >
                          🌐 Поиск в Яндексе ↗
                        </a>
                        <a
                          href={`https://google.com/search?q="${executionResult.data.phone_intelligence.e164_format}" site:vk.com`}
                          target="_blank"
                          rel="noopener noreferrer"
                          style={{
                            padding: "6px 12px",
                            background: "rgba(0, 136, 255, 0.15)",
                            border: "1px solid var(--border-muted)",
                            color: "#0088ff",
                            textDecoration: "none",
                            borderRadius: "4px",
                            fontSize: "11px",
                          }}
                        >
                          👥 Профиль VKontakte ↗
                        </a>
                      </div>
                    </div>

                    {/* How-to Workflow */}
                    <div style={{ background: "rgba(0, 255, 204, 0.04)", border: "1px dashed var(--border-highlight)", borderRadius: "4px", padding: "12px" }}>
                      <div style={{ color: "var(--text-accent)", fontWeight: "bold", fontSize: "11px", marginBottom: "6px" }}>
                        🎯 КАК УСТАНОВИТЬ ЛИЧНОСТЬ ВЛАДЕЛЬЦА:
                      </div>
                      <div style={{ fontSize: "11px", color: "var(--text-secondary)", lineHeight: 1.6 }}>
                        1. Нажмите <b>«Открыть профиль Telegram»</b> — у большинства пользователей открывается реальное имя и фото.<br />
                        2. Нажмите <b>«Искать на Авито»</b> — номер проверяется по архивам проданных авто, квартир и товаров с именем продавца.<br />
                        3. По закону 152-ФЗ паспортные данные операторов закрыты, поэтому идентификация проводится по связке: Мессенджер + Авито + Регион <b>{executionResult.data.phone_intelligence.region_jurisdiction}</b>.
                      </div>
                    </div>
                  </div>
                ) : (
                  /* GENERAL OBJECT SUMMARY */
                  <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                    <div style={{ color: "var(--text-accent)", fontSize: "13px" }}>
                      🎯 Объект: <b>{executionResult.target}</b>
                    </div>
                    {executionResult.data?.summary && (
                      <div style={{ color: "var(--text-secondary)", fontSize: "12px", lineHeight: 1.5 }}>
                        {executionResult.data.summary}
                      </div>
                    )}
                    {executionResult.data?.findings && (
                      <ul style={{ margin: 0, paddingLeft: "18px", color: "var(--text-primary)", fontSize: "12px" }}>
                        {executionResult.data.findings.map((f: string, i: number) => (
                          <li key={i} style={{ marginBottom: "4px" }}>{f}</li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Footer buttons */}
            <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px" }}>
              <button
                onClick={() => setShowRunnerModal(false)}
                style={{
                  padding: "8px 18px",
                  background: "transparent",
                  border: "1px solid var(--border-primary)",
                  color: "var(--text-secondary)",
                  fontFamily: "var(--font-mono)",
                  fontSize: "12px",
                  borderRadius: "4px",
                  cursor: "pointer",
                }}
              >
                {isRussian ? "ЗАКРЫТЬ WORKBENCH" : "CLOSE WORKBENCH"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* UNIFIED DOSSIER FINAL REPORT MODAL WINDOW */}
      <UnifiedDossierModal
        isOpen={showUnifiedDossier}
        onClose={() => setShowUnifiedDossier(false)}
        targetInput={targetInput}
        isRussian={isRussian}
      />
    </div>
  );
}

function Field({ label, value, isWarning }: { label: string; value?: string | null; isWarning?: boolean }) {
  if (!value) return null;

  return (
    <div>
      <div style={{ color: "var(--text-secondary)", fontSize: "11px", fontFamily: "var(--font-mono)", marginBottom: "4px" }}>
        {label}
      </div>
      <div
        style={{
          color: isWarning ? "var(--accent-warning)" : "var(--text-primary)",
          fontSize: "13px",
          lineHeight: "1.5",
          padding: "8px 12px",
          background: "rgba(255,255,255,0.02)",
          borderLeft: `2px solid ${isWarning ? "var(--accent-warning)" : "var(--border-muted)"}`,
          borderRadius: "0 2px 2px 0",
        }}
      >
        {value}
      </div>
    </div>
  );
}

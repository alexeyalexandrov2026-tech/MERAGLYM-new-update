"use client";

import React, { useState, useEffect, useCallback } from "react";
import type { Node } from "@prisma/client";
import { useI18n } from "@/lib/i18nContext";
import { UnifiedDossierModal } from "./UnifiedDossierModal";

export default function SearchPanel() {
  const { t, locale, isRussian } = useI18n();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Node[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [activeCategoryFilter, setActiveCategoryFilter] = useState<string>("ALL");

  // Workbench Modal Runner state
  const [activeNode, setActiveNode] = useState<Node | null>(null);
  const [targetInput, setTargetInput] = useState("");
  const [isExecuting, setIsExecuting] = useState(false);
  const [showUnifiedDossier, setShowUnifiedDossier] = useState(false);
  const [executionResult, setExecutionResult] = useState<any | null>(null);

  const filterButtons = [
    { id: "ALL", label: t("searchPanel.filterAll") },
    { id: "RU", label: t("searchPanel.filterRu") },
    { id: "EMAIL", label: t("searchPanel.filterEmail") },
    { id: "PHONE", label: t("searchPanel.filterPhone") },
    { id: "COMPANY", label: t("searchPanel.filterCompany") },
    { id: "CRYPTO", label: t("searchPanel.filterCrypto") },
    { id: "CAMERA", label: t("searchPanel.filterCamera") },
    { id: "DARKWEB", label: t("searchPanel.filterDarkweb") },
    { id: "SOCIAL", label: t("searchPanel.filterSocial") },
  ];

  const generateClientSideSearchResults = (q: string): Node[] => {
    const qLower = q.toLowerCase();
    const isPhone = /^(\+?\d{1,4}[-.\s]?)?(\(?\d{3}\)?[-.\s]?)?\d{3}[-.\s]?\d{2}[-.\s]?\d{2}$/.test(q.replace(/\s+/g, "")) || (q.length >= 7 && /^\+?\d+$/.test(q.replace(/[\s()-]/g, "")));
    const isInn = /^\d{10}$|^\d{12}$/.test(q.trim());
    const isEmail = q.includes("@") && q.includes(".");
    const isCrypto = (q.startsWith("1") || q.startsWith("3") || q.startsWith("bc1") || q.startsWith("0x")) && q.length > 24;

    const items: Node[] = [];

    if (isPhone) {
      items.push({
        id: 9901,
        parentId: 300,
        name: `📱 PhoneInfoga OSINT Разведка Телефона: ${q}`,
        type: "phone_recon",
        url: "#launch-tool",
        description: `Анализ номера ${q}: Валидация формата E.164, определение оператора связи (МТС/Мегафон/Билайн/T-Mobile), MNP-перенос, мессенджеры Telegram/WhatsApp и утекшие объявления.`,
        status: "Active",
        pricing: "Free / In-Project Tool",
        bestFor: `Разведка владельца номера ${q}`,
        input: q,
        output: "Оператор, регион, Telegram ID, WhatsApp статус, Avito",
        opsec: "Low",
        localInstall: true,
        googleDork: true,
        registration: false,
        editUrl: false,
        api: true,
        invitationOnly: false,
        deprecated: false,
        createdAt: new Date(),
      } as Node);
    }

    if (isInn || qLower.includes("сбер") || qLower.includes("янндекс") || qLower.includes("газпром") || qLower.includes("ооо") || qLower.includes("пао")) {
      items.push({
        id: 9902,
        parentId: 100,
        name: `🏢 ЕГРЮЛ / ФНС / ГИР БО Разведка Компании (${q})`,
        type: "company_recon",
        url: "https://egrul.nalog.ru",
        description: `Комплексная выписка ЕГРЮЛ ФНС РФ по цели «${q}»: Проверка учредителей, генерального директора, финансовых отчетов БО Налог, арбитражных споров КАД и приставов ФССП.`,
        status: "Active",
        pricing: "Free / Official Registry",
        bestFor: `Глубокая корпоративная проверка по цели ${q}`,
        input: q,
        output: "Выписка ЕГРЮЛ, Бухгалтерский баланс, Судебные иски",
        opsec: "Low",
        localInstall: false,
        googleDork: false,
        registration: false,
        editUrl: false,
        api: true,
        invitationOnly: false,
        deprecated: false,
        createdAt: new Date(),
      } as Node);
    }

    if (isEmail) {
      items.push({
        id: 9903,
        parentId: 200,
        name: `✉️ Holehe & GHunt OSINT Разведка Почты: ${q}`,
        type: "email_recon",
        url: "#launch-tool",
        description: `Пассивная проверка email адреса ${q} по 120+ веб-сервисам (Holehe) и извлечение Google Gaia ID, аватаров и отзывов Google Maps (GHunt).`,
        status: "Active",
        pricing: "Free / In-Project Tool",
        bestFor: `Разведка профилей и аккаунтов по ${q}`,
        input: q,
        output: "Зарегистрированные сервисы, Google ID, Breaches",
        opsec: "High",
        localInstall: true,
        googleDork: false,
        registration: false,
        editUrl: false,
        api: true,
        invitationOnly: false,
        deprecated: false,
        createdAt: new Date(),
      } as Node);
    }

    if (isCrypto) {
      items.push({
        id: 9904,
        parentId: 600,
        name: `💰 Legendary Crypto Трейсинг Кошелька: ${q}`,
        type: "crypto_recon",
        url: "#launch-tool",
        description: `Расследование криптовалютных транзакций кошелька ${q}: Кластеризация входов, выявление биржевых депозитов (Binance/Garantex/OKX) и отслеживание смарт-контрактов.`,
        status: "Active",
        pricing: "Free / In-Project Tool",
        bestFor: `Анализ движений средств кошелька ${q}`,
        input: q,
        output: "Баланс, Граф транзакций, Exchange Deposit",
        opsec: "Low",
        localInstall: true,
        googleDork: false,
        registration: false,
        editUrl: false,
        api: true,
        invitationOnly: false,
        deprecated: false,
        createdAt: new Date(),
      } as Node);
    }

    // Default Universal OSINT Card
    items.push({
      id: 9999,
      parentId: 100,
      name: `🔍 Исполнительный Модуль Разведки MERAGLYM по запросу «${q}»`,
      type: "universal_recon",
      url: "#launch-tool",
      description: `Полномасштабный поиск и нормализация сущностей по запросу «${q}» в подключенных базах данных и граф STIX 2.1.`,
      status: "Active",
      pricing: "Free / In-Project Tool",
      bestFor: `Запуск разведки по запросу ${q}`,
      input: q,
      output: "Граф сущностей STIX, результаты подключенных адаптеров",
      opsec: "High",
      localInstall: true,
      googleDork: false,
      registration: false,
      editUrl: false,
      api: true,
      invitationOnly: false,
      deprecated: false,
      createdAt: new Date(),
    } as Node);

    return items;
  };

  const performSearch = useCallback(async (q: string) => {
    setLoading(true);
    setSearched(true);
    try {
      const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`);
      if (res.ok) {
        const data = (await res.json()) as Node[];
        if (Array.isArray(data) && data.length > 0) {
          setResults(data);
        } else {
          setResults(generateClientSideSearchResults(q));
        }
      } else {
        setResults(generateClientSideSearchResults(q));
      }
    } catch (err) {
      console.warn("Search API fallback engaging client-side synthesis:", err);
      setResults(generateClientSideSearchResults(q));
    } finally {
      setLoading(false);
    }
  }, []);

  const handleFilterClick = (filterId: string) => {
    setActiveCategoryFilter(filterId);
    let searchSeed = "";
    switch (filterId) {
      case "RU":
        searchSeed = isRussian ? "Россия" : "Russia";
        break;
      case "EMAIL":
        searchSeed = isRussian ? "почта" : "email";
        break;
      case "PHONE":
        searchSeed = "+79991234567";
        break;
      case "COMPANY":
        searchSeed = "7707083893";
        break;
      case "CRYPTO":
        searchSeed = "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa";
        break;
      case "CAMERA":
        searchSeed = isRussian ? "камера" : "camera";
        break;
      case "DARKWEB":
        searchSeed = "tor";
        break;
      case "SOCIAL":
        searchSeed = isRussian ? "соцсети" : "social";
        break;
      default:
        searchSeed = "";
        break;
    }
    if (searchSeed) {
      setQuery(searchSeed);
      performSearch(searchSeed);
    }
  };

  useEffect(() => {
    const delayDebounceFn = setTimeout(() => {
      if (query.trim().length > 0) {
        performSearch(query);
      } else {
        setResults([]);
        setSearched(false);
      }
    }, 250);

    return () => clearTimeout(delayDebounceFn);
  }, [query, performSearch]);

  const handleOpenWorkbench = (node: Node) => {
    setActiveNode(node);
    setTargetInput(node.input || query || "");
    setExecutionResult(null);
  };

  const handleExecuteJob = async () => {
    if (!targetInput.trim()) return;
    setIsExecuting(true);
    setExecutionResult(null);

    const now = new Date().toISOString();
    const cleanInput = targetInput.trim();
    const isPhone = cleanInput.startsWith("+7") || cleanInput.startsWith("8") || (cleanInput.length >= 10 && /^\+?\d+$/.test(cleanInput.replace(/[\s()-]/g, "")));
    const adapterName = isPhone ? "phone_person_correlator" : ((activeNode?.type && activeNode.type !== "folder" && activeNode.type !== "url") ? activeNode.type : (activeNode?.name || "universal_recon"));

    try {
      const res = await fetch("/api/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: adapterName,
          payload: { target: cleanInput, phone: cleanInput, inn: cleanInput, email: cleanInput },
        }),
      });

      if (res.ok) {
        let job = (await res.json()) as {
          id: string;
          status?: string;
          result?: any;
          error?: any;
        };

        // Polling loop
        while (job.status === "QUEUED" || job.status === "RUNNING") {
          await new Promise((resolve) => setTimeout(resolve, 2000));
          try {
            const pollRes = await fetch(`/api/jobs/${job.id}`);
            if (pollRes.ok) {
              job = await pollRes.json();
            } else {
              break; // Stop polling on error
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
            error: `HTTP ${res.status}: Backend service unavailable`,
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
          error: err instanceof Error ? err.message : "Network error",
        },
      });
    } finally {
      setIsExecuting(false);
      setShowUnifiedDossier(true);
    }
  };

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", padding: "32px 40px", overflowY: "auto" }}>
      <div style={{ maxWidth: "1000px", width: "100%", margin: "0 auto" }}>
        <h2 style={{ fontFamily: "var(--font-mono)", color: "var(--text-accent)", marginBottom: "4px", fontSize: "17px" }}>
          🔍 {t("searchPanel.title")}
        </h2>
        <div style={{ fontSize: "12px", color: "var(--text-secondary)", marginBottom: "20px" }}>
          {t("searchPanel.subtitle")}
        </div>

        {/* Filter Quick Pills */}
        <div style={{ display: "flex", gap: "6px", flexWrap: "wrap", marginBottom: "16px" }}>
          {filterButtons.map((btn) => (
            <button
              key={btn.id}
              onClick={() => handleFilterClick(btn.id)}
              style={{
                background: activeCategoryFilter === btn.id ? "rgba(0, 255, 204, 0.15)" : "rgba(0, 255, 204, 0.04)",
                border: `1px solid ${activeCategoryFilter === btn.id ? "var(--border-highlight)" : "var(--border-primary)"}`,
                color: activeCategoryFilter === btn.id ? "var(--text-accent)" : "var(--text-secondary)",
                padding: "5px 12px",
                borderRadius: "14px",
                fontSize: "11px",
                fontFamily: "var(--font-mono)",
                cursor: "pointer",
                transition: "all 0.2s",
              }}
            >
              {btn.label}
            </button>
          ))}
        </div>

        {/* Search Input Box */}
        <div style={{ marginBottom: "24px" }}>
          <input
            type="text"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActiveCategoryFilter("ALL");
            }}
            placeholder={t("searchPanel.placeholder")}
            style={{
              width: "100%",
              boxSizing: "border-box",
              background: "rgba(0, 255, 204, 0.05)",
              border: "1px solid var(--border-highlight)",
              color: "var(--text-primary)",
              padding: "14px 18px",
              fontFamily: "var(--font-mono)",
              fontSize: "14px",
              borderRadius: "4px",
              outline: "none",
              boxShadow: "0 0 12px rgba(0, 255, 204, 0.1)",
            }}
          />
        </div>

        {/* Results Area */}
        <div style={{ flex: 1, borderTop: "1px solid var(--border-primary)", paddingTop: "20px" }}>
          {loading && (
            <div style={{ color: "var(--text-accent)", fontFamily: "var(--font-mono)", fontSize: "13px", padding: "12px 0" }}>
              ⏳ {t("searchPanel.searching")}
            </div>
          )}

          {!loading && searched && results.length === 0 && (
            <div style={{ color: "var(--text-secondary)", fontFamily: "var(--font-mono)", fontSize: "13px", padding: "20px 0", textAlign: "center" }}>
              {t("searchPanel.noResults")}
            </div>
          )}

          {!loading && results.length > 0 && (
            <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
              <div style={{ fontSize: "11px", color: "var(--text-secondary)", fontFamily: "var(--font-mono)", marginBottom: "4px" }}>
                {results.length} {t("searchPanel.matches")}
              </div>
              {results.map((node) => {
                const isExternalPortal = node.url && node.url.startsWith("http") && !node.url.includes("github.com");

                return (
                  <div
                    key={node.id}
                    className="gotham-panel"
                    style={{
                      padding: "18px 22px",
                      borderRadius: "6px",
                      border: "1px solid var(--border-primary)",
                      transition: "all 0.2s ease",
                    }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "8px" }}>
                      <div style={{ color: "var(--text-accent)", fontWeight: "bold", fontSize: "15px", fontFamily: "var(--font-mono)" }}>
                        {node.name}
                      </div>
                      <div
                        style={{
                          fontSize: "10px",
                          color: "var(--text-secondary)",
                          background: "rgba(255, 255, 255, 0.05)",
                          padding: "2px 8px",
                          borderRadius: "2px",
                          fontFamily: "var(--font-mono)",
                          border: "1px solid var(--border-muted)",
                        }}
                      >
                        {node.type.toUpperCase()}
                      </div>
                    </div>

                    {node.description && (
                      <div style={{ fontSize: "13px", color: "var(--text-secondary)", lineHeight: 1.5, marginBottom: "12px" }}>
                        {node.description}
                      </div>
                    )}

                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "10px" }}>
                      {node.bestFor && (
                        <div style={{ fontSize: "11px", fontFamily: "var(--font-mono)", color: "var(--text-muted)" }}>
                          {isRussian ? "Применение:" : "Best for:"} <span style={{ color: "var(--text-secondary)" }}>{node.bestFor}</span>
                        </div>
                      )}

                      <div style={{ display: "flex", gap: "8px" }}>
                        {/* IN-PROJECT LAUNCH BUTTON */}
                        <button
                          onClick={() => handleOpenWorkbench(node)}
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            gap: "4px",
                            fontSize: "12px",
                            fontWeight: "bold",
                            color: "var(--text-accent)",
                            border: "1px solid var(--border-highlight)",
                            background: "rgba(0, 255, 204, 0.15)",
                            padding: "6px 14px",
                            borderRadius: "3px",
                            fontFamily: "var(--font-mono)",
                            cursor: "pointer",
                          }}
                        >
                          ⚡ {isRussian ? "ЗАПУСТИТЬ В WORKBENCH" : "LAUNCH IN WORKBENCH"}
                        </button>

                        {/* EXTERNAL PORTAL LINK */}
                        {isExternalPortal && (
                          <a
                            href={node.url!}
                            target="_blank"
                            rel="noopener noreferrer"
                            style={{
                              display: "inline-flex",
                              alignItems: "center",
                              gap: "4px",
                              fontSize: "12px",
                              color: "var(--text-primary)",
                              textDecoration: "none",
                              border: "1px solid var(--border-muted)",
                              background: "rgba(255, 255, 255, 0.05)",
                              padding: "6px 12px",
                              borderRadius: "3px",
                              fontFamily: "var(--font-mono)",
                            }}
                          >
                            <span>🌐 {isRussian ? "ВЕБ-ПОРТАЛ ↗" : "WEB PORTAL ↗"}</span>
                          </a>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* WORKBENCH MODAL RUNNER IN SEARCH PANEL */}
      {activeNode && (
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
                  {activeNode.name}
                </h3>
              </div>
              <button
                onClick={() => setActiveNode(null)}
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
                🎯 {isRussian ? "Целевой объект разведки:" : "Target Recon Parameter:"} (<i>{activeNode.input || "Объект"}</i>)
              </label>
              <div style={{ display: "flex", gap: "10px" }}>
                <input
                  type="text"
                  value={targetInput}
                  onChange={(e) => setTargetInput(e.target.value)}
                  placeholder={query || "Введите объект..."}
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
                    if (e.key === "Enter") handleExecuteJob();
                  }}
                />
                <button
                  onClick={handleExecuteJob}
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
                onClick={() => setActiveNode(null)}
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
        jobData={executionResult}
      />
    </div>
  );
}

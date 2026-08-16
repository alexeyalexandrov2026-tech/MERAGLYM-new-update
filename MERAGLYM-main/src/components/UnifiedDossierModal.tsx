import React, { useState } from "react";

export interface UnifiedDossierModalProps {
  isOpen: boolean;
  onClose: () => void;
  targetInput: string;
  isRussian?: boolean;
  jobData?: any;
}

export function UnifiedDossierModal({
  isOpen,
  onClose,
  targetInput,
  isRussian = true,
  jobData,
}: UnifiedDossierModalProps) {
  const [copied, setCopied] = useState(false);

  if (!isOpen) return null;

  const cleanInput = targetInput.trim();
  const isQueued = !jobData || jobData.status === "QUEUED" || jobData.status === "RUNNING";
  const isFailed = jobData?.status === "FAILED";

  const renderContent = () => {
    if (isQueued) {
      return (
        <div style={{ padding: "40px", textAlign: "center", color: "var(--text-accent)", fontFamily: "var(--font-mono)" }}>
          <div style={{ fontSize: "24px", marginBottom: "16px", animation: "pulse 1.5s infinite" }}>⏳</div>
          <h3>ОЖИДАНИЕ РЕЗУЛЬТАТОВ / В ОЧЕРЕДИ</h3>
          <p style={{ color: "var(--text-secondary)", fontSize: "13px" }}>Запрос помещен в персистентную очередь D1.</p>
          <p style={{ color: "var(--text-secondary)", fontSize: "13px" }}>Ожидается обработка воркером (Real execution).</p>
          <pre style={{ textAlign: "left", background: "rgba(0,0,0,0.3)", padding: "12px", marginTop: "20px", borderRadius: "4px", fontSize: "12px" }}>
            {JSON.stringify(jobData, null, 2)}
          </pre>
        </div>
      );
    }

    const errObj = jobData?.data?.error || jobData?.error;
    const isCredReq = errObj?.code === "CREDENTIAL_REQUIRED" || (typeof errObj === "string" && errObj.includes("CREDENTIAL_REQUIRED"));

    if (isFailed || isCredReq) {
      return (
        <div style={{ padding: "30px", fontFamily: "var(--font-mono)" }}>
          <div style={{ background: "rgba(255, 184, 108, 0.08)", border: "1px solid #ffb86c", borderRadius: "6px", padding: "20px", marginBottom: "20px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "10px", color: "#ffb86c", fontSize: "15px", fontWeight: "bold", marginBottom: "8px" }}>
              <span>🔐</span>
              <span>{isCredReq ? "ТРЕБУЕТСЯ API КЛЮЧ (CREDENTIAL_REQUIRED)" : "ОШИБКА ВЫПОЛНЕНИЯ (FAILED)"}</span>
            </div>
            <p style={{ color: "var(--text-secondary)", fontSize: "12px", margin: "0 0 12px 0", lineHeight: "1.5" }}>
              {isCredReq
                ? "Адаптер требует внешний API ключ для прямого обращения к реестру. В режиме без ключей генерация фейковых данных заблокирована."
                : "Адаптер завершил работу с ошибкой."}
            </p>
            {errObj && (
              <div style={{ background: "rgba(0,0,0,0.3)", padding: "10px 14px", borderRadius: "4px", color: "#ff5555", fontSize: "12px" }}>
                <b>Код:</b> {typeof errObj === "object" ? errObj.code : "CREDENTIAL_REQUIRED"}<br />
                <b>Сообщение:</b> {typeof errObj === "object" ? errObj.message : String(errObj)}
              </div>
            )}
          </div>
          <pre style={{ textAlign: "left", background: "rgba(0,0,0,0.3)", padding: "12px", borderRadius: "4px", color: "var(--text-muted)", fontSize: "11px", overflowX: "auto" }}>
            {JSON.stringify(jobData, null, 2)}
          </pre>
        </div>
      );
    }

    const resData = jobData?.data || jobData?.result || {};
    const provenance = resData?.source?.[0] || jobData?.source?.[0] || {};
    const isVerified = resData?.verified === true || jobData?.verified === true;
    const sourceType = provenance?.sourceType || resData?.mode || (isVerified ? "LIVE_EXTERNAL_SOURCE" : "LOCAL_ENRICHMENT");
    const isExtRef = sourceType === "EXTERNAL_REFERENCE" || resData?.mode === "EXTERNAL_REFERENCE";

    // 1. EXTERNAL_REFERENCE Mode: Official Portal Reference & Direct Link
    if (isExtRef) {
      const sourceName = resData?.sourceName || provenance?.sourceName || "Официальный портал";
      const sourceUrl = resData?.sourceUrl || provenance?.sourceUrl || provenance?.url || "#";
      const portalTitle = resData?.portalTitle || resData?.description || "Официальный источник для ручной проверки";
      const instructions = resData?.instructions || [
        "1. Перейдите на официальный портал по кнопке ниже.",
        `2. Введите параметры объекта: «${cleanInput}».`,
        "3. Ознакомьтесь с актуальными официальными данными ведомства.",
      ];

      return (
        <div style={{ padding: "24px", fontFamily: "var(--font-mono)", fontSize: "13px" }}>
          {/* Header Badge */}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
            <div style={{ color: "#ffb86c", fontSize: "14px", fontWeight: "bold", display: "flex", alignItems: "center", gap: "8px" }}>
              <span>🌐</span>
              <span>ОФИЦИАЛЬНЫЙ ИСТОЧНИК ИНФОРМАЦИИ (EXTERNAL_REFERENCE)</span>
            </div>
            <span style={{ fontSize: "11px", padding: "3px 10px", borderRadius: "4px", background: "rgba(255, 184, 108, 0.15)", color: "#ffb86c", border: "1px solid rgba(255, 184, 108, 0.4)" }}>
              verified=false | EXTERNAL_REFERENCE
            </span>
          </div>

          {/* Official Source Card */}
          <div style={{ background: "rgba(255, 184, 108, 0.05)", border: "1px solid rgba(255, 184, 108, 0.3)", borderRadius: "8px", padding: "22px", marginBottom: "20px" }}>
            <div style={{ color: "var(--text-accent)", fontSize: "16px", fontWeight: "bold", marginBottom: "8px", display: "flex", alignItems: "center", gap: "8px" }}>
              <span>🏛️</span>
              <span>{sourceName}</span>
            </div>

            <div style={{ color: "var(--text-secondary)", fontSize: "13px", lineHeight: "1.6", marginBottom: "18px" }}>
              {portalTitle}
            </div>

            {/* Target Query Display */}
            <div style={{ background: "rgba(0,0,0,0.3)", padding: "12px 16px", borderRadius: "6px", marginBottom: "18px", border: "1px solid var(--border-primary)" }}>
              <div style={{ fontSize: "11px", color: "var(--text-muted)", marginBottom: "4px" }}>ПАРАМЕТРЫ ДЛЯ ПРОВЕРКИ:</div>
              <div style={{ fontSize: "14px", color: "#00ffcc", fontWeight: "bold" }}>{cleanInput}</div>
            </div>

            {/* Instructions */}
            <div style={{ marginBottom: "20px" }}>
              <div style={{ fontSize: "11px", color: "var(--text-secondary)", fontWeight: "bold", marginBottom: "8px", letterSpacing: "1px" }}>
                📋 ПОРЯДОК РУЧНОЙ ВЕРИФИКАЦИИ:
              </div>
              <ul style={{ margin: 0, paddingLeft: "18px", color: "var(--text-primary)", fontSize: "12px", lineHeight: "1.7" }}>
                {Array.isArray(instructions) && instructions.map((inst: string, idx: number) => (
                  <li key={idx}>{inst}</li>
                ))}
              </ul>
            </div>

            {/* Direct Link Action Button */}
            <div style={{ display: "flex", gap: "12px", flexWrap: "wrap", alignItems: "center" }}>
              <a
                href={sourceUrl}
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "8px",
                  padding: "10px 20px",
                  background: "linear-gradient(90deg, rgba(255, 184, 108, 0.25), rgba(255, 140, 0, 0.25))",
                  border: "1px solid #ffb86c",
                  color: "#ffffff",
                  textDecoration: "none",
                  borderRadius: "6px",
                  fontSize: "13px",
                  fontWeight: "bold",
                  fontFamily: "var(--font-mono)",
                  transition: "all 0.2s ease",
                  boxShadow: "0 4px 14px rgba(255, 184, 108, 0.2)",
                }}
              >
                <span>🔗</span>
                <span>ПЕРЕЙТИ НА ОФИЦИАЛЬНЫЙ САЙТ ({sourceName}) ↗</span>
              </a>

              <span style={{ fontSize: "11px", color: "var(--text-muted)" }}>
                Прямая ссылка на официальный реестр ведомства
              </span>
            </div>
          </div>

          {/* Raw Provenance Payload */}
          <div style={{ background: "rgba(0,0,0,0.3)", borderRadius: "6px", padding: "14px", border: "1px solid var(--border-primary)" }}>
            <div style={{ fontSize: "11px", color: "var(--text-muted)", marginBottom: "8px" }}>ТЕХНИЧЕСКИЙ ПАСПОРТ ЗАДАЧИ:</div>
            <pre style={{ margin: 0, color: "var(--text-primary)", overflowX: "auto", fontSize: "11px" }}>
              {JSON.stringify(jobData, null, 2)}
            </pre>
          </div>
        </div>
      );
    }

    // 2. Standard Verified or Local Enrichment Modes
    return (
      <div style={{ padding: "24px", fontFamily: "var(--font-mono)", fontSize: "13px" }}>
        <div style={{ background: isVerified ? "rgba(0, 255, 204, 0.06)" : "rgba(0, 136, 255, 0.06)", border: `1px solid ${isVerified ? "var(--border-highlight)" : "#0088ff60"}`, borderRadius: "6px", padding: "18px", marginBottom: "20px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
            <div style={{ color: isVerified ? "var(--text-accent)" : "#0088ff", fontSize: "14px", fontWeight: "bold" }}>
              {isVerified ? "🟢 ПОДТВЕРЖДЕННЫЙ ВНЕШНИЙ ИСТОЧНИК (LIVE_EXTERNAL_SOURCE)" : "🔵 ЛОКАЛЬНОЕ ОБОГАЩЕНИЕ (LOCAL_ENRICHMENT)"}
            </div>
            <span style={{ fontSize: "11px", padding: "2px 8px", borderRadius: "4px", background: isVerified ? "rgba(0,255,204,0.15)" : "rgba(0,136,255,0.15)", color: isVerified ? "#00ffcc" : "#0088ff", border: `1px solid ${isVerified ? "#00ffcc40" : "#0088ff40"}` }}>
              verified={String(isVerified)} | {sourceType}
            </span>
          </div>
          <p style={{ color: "var(--text-secondary)", fontSize: "11px", margin: "0 0 14px 0", lineHeight: "1.4" }}>
            {isVerified
              ? "Данные получены в реальном времени из внешнего API с подтвержденным источником и provenance."
              : "Данные сформированы локальным парсером / детерминированным алгоритмом (DEF-коды, ссылки на профили, синтаксический анализ). verified=false."}
          </p>
          <pre style={{ background: "rgba(0,0,0,0.3)", padding: "12px", borderRadius: "4px", color: "var(--text-primary)", overflowX: "auto", fontSize: "12px" }}>
            {JSON.stringify(jobData, null, 2)}
          </pre>
        </div>
      </div>
    );
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(JSON.stringify(jobData, null, 2));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: "rgba(3, 7, 12, 0.92)",
        backdropFilter: "blur(10px)",
        zIndex: 9999,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "20px",
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: "960px",
          maxHeight: "90vh",
          background: "var(--bg-panel)",
          border: "1px solid var(--border-highlight)",
          borderRadius: "8px",
          boxShadow: "0 20px 60px rgba(0, 255, 204, 0.2)",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            padding: "20px 28px",
            background: "linear-gradient(90deg, rgba(0, 255, 204, 0.15), rgba(0, 136, 255, 0.1))",
            borderBottom: "1px solid var(--border-highlight)",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <div>
            <div style={{ fontSize: "11px", fontFamily: "var(--font-mono)", color: "var(--text-accent)", letterSpacing: "2px" }}>
              ⚡ ЕДИНЫЙ ИТОГОВЫЙ ОТЧЕТ КОМПЛЕКСНОЙ РАЗВЕДКИ MERAGLYM (REAL EXECUTION)
            </div>
            <h2 style={{ margin: "4px 0 0 0", color: "var(--text-primary)", fontSize: "20px", fontFamily: "var(--font-mono)" }}>
              🎯 Досье объекта: <span style={{ color: "#00ffcc" }}>{cleanInput}</span>
            </h2>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
            <span style={{ fontSize: "11px", fontFamily: "var(--font-mono)", background: "rgba(0, 255, 204, 0.2)", color: "#00ffcc", border: "1px solid #00ffcc40", padding: "4px 10px", borderRadius: "4px" }}>
              {isQueued ? "ПРОЦЕСС ВЫПОЛНЕНИЯ..." : "ВЫПОЛНЕНИЕ ЗАВЕРШЕНО"}
            </span>
            <button onClick={onClose} style={{ background: "transparent", border: "1px solid var(--border-primary)", color: "var(--text-secondary)", fontSize: "16px", cursor: "pointer", padding: "6px 12px", borderRadius: "4px" }}>✕</button>
          </div>
        </div>

        <div style={{ overflowY: "auto", flex: 1 }}>
          {renderContent()}
        </div>

        <div
          style={{
            padding: "16px 28px",
            background: "rgba(0, 10, 20, 0.8)",
            borderTop: "1px solid var(--border-primary)",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <div style={{ display: "flex", gap: "10px" }}>
            <button
              onClick={handleCopy}
              style={{
                padding: "8px 16px",
                background: "rgba(0, 255, 204, 0.15)",
                border: "1px solid var(--border-highlight)",
                color: "var(--text-accent)",
                fontFamily: "var(--font-mono)",
                fontSize: "12px",
                borderRadius: "4px",
                cursor: "pointer",
              }}
            >
              📋 {copied ? "СКОПИРОВАНО!" : "СКОПИРОВАТЬ РЕЗУЛЬТАТ (JSON)"}
            </button>
          </div>

          <button
            onClick={onClose}
            style={{
              padding: "8px 20px",
              background: "transparent",
              border: "1px solid var(--border-primary)",
              color: "var(--text-secondary)",
              fontFamily: "var(--font-mono)",
              fontSize: "12px",
              borderRadius: "4px",
              cursor: "pointer",
            }}
          >
            ЗАКРЫТЬ
          </button>
        </div>
      </div>
    </div>
  );
}

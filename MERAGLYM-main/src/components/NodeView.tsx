"use client";

import React, { useState } from "react";
import type { Node } from "@prisma/client";
import { useI18n } from "@/lib/i18nContext";

interface NodeViewProps {
  node: Node | null;
}

export default function NodeView({ node }: NodeViewProps) {
  const { t, locale } = useI18n();
  const [copied, setCopied] = useState(false);

  const handleCopyLink = () => {
    if (node?.url) {
      navigator.clipboard.writeText(node.url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
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

  const tags = [
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
            [ID: {node.id.toString().padStart(4, "0")}] // {node.type.toUpperCase()}
          </div>
          <h1 style={{ color: "var(--text-primary)", fontSize: "24px", letterSpacing: "0.5px" }}>{node.name}</h1>
        </div>

        {/* Action Buttons */}
        <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
          {node.url && (
            <>
              <button
                onClick={handleCopyLink}
                style={{
                  padding: "8px 12px",
                  background: "transparent",
                  border: "1px solid var(--border-primary)",
                  color: "var(--text-secondary)",
                  fontFamily: "var(--font-mono)",
                  fontSize: "11px",
                  cursor: "pointer",
                  borderRadius: "3px",
                  transition: "all 0.2s",
                }}
              >
                {copied ? t("common.copied") : t("nodeView.copyLink")}
              </button>
              <a
                href={node.url}
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  padding: "8px 16px",
                  background: "rgba(0, 136, 255, 0.15)",
                  border: "1px solid var(--accent-electric)",
                  color: "var(--text-primary)",
                  textDecoration: "none",
                  fontFamily: "var(--font-mono)",
                  fontSize: "12px",
                  fontWeight: "bold",
                  cursor: "pointer",
                  borderRadius: "3px",
                  transition: "all 0.2s",
                }}
                onMouseOver={(e) => (e.currentTarget.style.background = "rgba(0, 136, 255, 0.3)")}
                onMouseOut={(e) => (e.currentTarget.style.background = "rgba(0, 136, 255, 0.15)")}
              >
                {t("nodeView.initiateUplink")}
              </a>
            </>
          )}
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
                padding: "2px 8px",
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

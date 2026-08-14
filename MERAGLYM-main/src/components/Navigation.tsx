"use client";

import React from "react";
import { useI18n } from "@/lib/i18nContext";

interface NavigationProps {
  currentView: string;
  onViewChange: (view: string) => void;
}

export default function Navigation({ currentView, onViewChange }: NavigationProps) {
  const { t, locale, toggleLocale } = useI18n();

  const navItems = [
    { id: "agent", label: t("nav.agent"), short: locale === "ru" ? "ИИ" : "AI", icon: "🤖" },
    { id: "overview", label: t("nav.overview"), short: locale === "ru" ? "ИНФО" : "SYS", icon: "📊" },
    { id: "osint", label: t("nav.osint"), short: locale === "ru" ? "ДЕРЕВО" : "OSINT", icon: "🌐" },
    { id: "search", label: t("nav.search"), short: locale === "ru" ? "ПОИСК" : "SRCH", icon: "🔍" },
    { id: "jobs", label: t("nav.jobs"), short: locale === "ru" ? "ЗАДАЧИ" : "JOBS", icon: "⚡" },
  ];

  return (
    <div
      className="gotham-panel"
      style={{
        width: "68px",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "space-between",
        borderRight: "1px solid var(--border-highlight)",
        borderTop: "none",
        borderBottom: "none",
        borderLeft: "none",
        padding: "16px 0",
        boxSizing: "border-box",
        zIndex: 20,
      }}
    >
      {/* Top Section: Brand & Nav Items */}
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", width: "100%", gap: "14px" }}>
        {/* Brand logo */}
        <div
          title={t("header.brandTitle")}
          style={{
            width: "44px",
            height: "44px",
            borderRadius: "6px",
            background: "rgba(0, 255, 204, 0.12)",
            border: "1px solid var(--border-highlight)",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            color: "var(--text-accent)",
            fontWeight: "bold",
            fontSize: "11px",
            cursor: "pointer",
            boxShadow: "0 0 12px rgba(0, 255, 204, 0.2)",
            transition: "all 0.2s ease",
          }}
          onClick={() => onViewChange("overview")}
        >
          <span>MX</span>
          <span style={{ fontSize: "7px", opacity: 0.8, letterSpacing: "0.5px" }}>OSINT</span>
        </div>

        <div style={{ width: "32px", height: "1px", background: "var(--border-primary)", margin: "4px 0" }} />

        {/* Navigation Items */}
        {navItems.map((item) => {
          const isActive = currentView === item.id;
          return (
            <button
              key={item.id}
              title={item.label}
              onClick={() => onViewChange(item.id)}
              style={{
                width: "48px",
                height: "56px",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                cursor: "pointer",
                borderRadius: "6px",
                background: isActive ? "rgba(0, 255, 204, 0.15)" : "transparent",
                color: isActive ? "var(--text-accent)" : "var(--text-secondary)",
                border: isActive ? "1px solid var(--border-highlight)" : "1px solid transparent",
                boxShadow: isActive ? "0 0 14px rgba(0, 255, 204, 0.25)" : "none",
                transition: "all 0.2s ease",
                padding: "4px 0",
                gap: "2px",
              }}
            >
              <span style={{ fontSize: "16px" }}>{item.icon}</span>
              <span
                style={{
                  fontSize: "9px",
                  fontFamily: "var(--font-mono)",
                  letterSpacing: "0.5px",
                  fontWeight: isActive ? "bold" : "normal",
                  textAlign: "center",
                  lineHeight: 1.1,
                }}
              >
                {item.short}
              </span>
            </button>
          );
        })}
      </div>

      {/* Bottom Section: Language Switcher & System Indicator */}
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", width: "100%", gap: "10px" }}>
        {/* Bilingual Quick Toggle */}
        <button
          onClick={toggleLocale}
          title={locale === "ru" ? "Switch to English" : "Переключить на русский"}
          style={{
            width: "46px",
            padding: "6px 2px",
            borderRadius: "4px",
            background: "rgba(0, 255, 204, 0.08)",
            border: "1px solid var(--border-highlight)",
            color: "var(--text-accent)",
            fontFamily: "var(--font-mono)",
            fontSize: "11px",
            fontWeight: "bold",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: "2px",
            transition: "all 0.2s ease",
          }}
        >
          <span style={{ color: locale === "ru" ? "var(--text-accent)" : "var(--text-muted)" }}>RU</span>
          <span style={{ color: "var(--border-primary)", fontSize: "9px" }}>|</span>
          <span style={{ color: locale === "en" ? "var(--text-accent)" : "var(--text-muted)" }}>EN</span>
        </button>

        {/* Live Status LED */}
        <div
          title={t("common.systemOnline")}
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: "10px",
            height: "10px",
            borderRadius: "50%",
            background: "#00ffcc",
            boxShadow: "0 0 8px #00ffcc",
          }}
        />
      </div>
    </div>
  );
}

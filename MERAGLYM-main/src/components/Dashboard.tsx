"use client";

import React, { useState } from "react";
import type { Job, Node } from "@prisma/client";
import Sidebar from "./Sidebar";
import NodeView from "./NodeView";
import Navigation from "./Navigation";
import SearchPanel from "./SearchPanel";
import AgentChatPanel from "./AgentChatPanel";
import JobsPanel from "./JobsPanel";
import { useI18n } from "@/lib/i18nContext";

interface DashboardProps {
  initialNodes: Node[];
  initialJobs: Job[];
}

export default function Dashboard({ initialNodes, initialJobs }: DashboardProps) {
  const [selectedNode, setSelectedNode] = useState<Node | null>(null);
  const [currentView, setCurrentView] = useState("agent");
  const { t, locale, toggleLocale } = useI18n();

  const getViewTitle = () => {
    switch (currentView) {
      case "agent":
        return t("nav.agent");
      case "overview":
        return t("nav.overview");
      case "osint":
        return t("nav.osint");
      case "search":
        return t("nav.search");
      case "jobs":
        return t("nav.jobs");
      default:
        return "";
    }
  };

  return (
    <div style={{ display: "flex", height: "100vh", overflow: "hidden", position: "relative", width: "100vw", background: "var(--bg-primary)" }}>
      <div className="scanline" />
      
      {/* Left Navigation Bar */}
      <Navigation currentView={currentView} onViewChange={setCurrentView} />

      {/* Main Content Area */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
        
        {/* Global Top Tactical Header Bar */}
        <header
          style={{
            height: "48px",
            borderBottom: "1px solid var(--border-primary)",
            background: "rgba(10, 16, 27, 0.85)",
            backdropFilter: "blur(10px)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "0 24px",
            boxSizing: "border-box",
            zIndex: 15,
          }}
        >
          {/* Left Title & Status */}
          <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
            <span style={{ fontFamily: "var(--font-mono)", fontSize: "13px", fontWeight: "bold", color: "var(--text-accent)", letterSpacing: "1px" }}>
              MERAGLYM // {getViewTitle()}
            </span>
            <div style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "11px", fontFamily: "var(--font-mono)", color: "var(--text-secondary)" }}>
              <span style={{ display: "inline-block", width: "7px", height: "7px", borderRadius: "50%", background: "#00ffcc", boxShadow: "0 0 6px #00ffcc" }} />
              <span>{t("common.systemOnline")}</span>
            </div>
          </div>

          {/* Right Controls: Telemetry & Language Switcher */}
          <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
            <div style={{ fontSize: "11px", fontFamily: "var(--font-mono)", color: "var(--text-muted)", display: "flex", gap: "12px" }}>
              <span>D1: <b style={{ color: "var(--text-accent)" }}>CONNECTED</b></span>
              <span>ENGINES: <b style={{ color: "var(--text-accent)" }}>19/19</b></span>
              <span>{t("common.version")}</span>
            </div>

            {/* Language Switcher Pill */}
            <button
              onClick={toggleLocale}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "6px",
                background: "rgba(0, 255, 204, 0.08)",
                border: "1px solid var(--border-highlight)",
                color: "var(--text-accent)",
                padding: "4px 10px",
                borderRadius: "4px",
                fontSize: "11px",
                fontFamily: "var(--font-mono)",
                cursor: "pointer",
                transition: "all 0.2s",
              }}
            >
              <span>🌐</span>
              <span style={{ fontWeight: locale === "ru" ? "bold" : "normal", color: locale === "ru" ? "var(--text-accent)" : "var(--text-muted)" }}>
                РУС
              </span>
              <span style={{ color: "var(--border-primary)" }}>/</span>
              <span style={{ fontWeight: locale === "en" ? "bold" : "normal", color: locale === "en" ? "var(--text-accent)" : "var(--text-muted)" }}>
                ENG
              </span>
            </button>
          </div>
        </header>

        {/* Dynamic View Panels */}
        <div style={{ flex: 1, display: "flex", height: "calc(100vh - 48px)", overflow: "hidden" }}>
          {currentView === "agent" && <AgentChatPanel />}

          {currentView === "osint" && (
            <>
              <Sidebar initialNodes={initialNodes} onSelectNode={setSelectedNode} selectedNodeId={selectedNode?.id} />
              <NodeView node={selectedNode} />
            </>
          )}

          {currentView === "overview" && (
            <div style={{ padding: "36px 44px", color: "var(--text-primary)", flex: 1, overflowY: "auto", position: "relative" }}>
              <div style={{ maxWidth: "1100px", margin: "0 auto" }}>
                <h1 style={{ fontFamily: "var(--font-mono)", color: "var(--text-accent)", fontSize: "22px", marginBottom: "8px" }}>
                  {t("dashboard.title")}
                </h1>
                <p style={{ color: "var(--text-secondary)", fontSize: "14px", lineHeight: "1.6", marginBottom: "28px" }}>
                  {t("dashboard.welcome")}
                </p>

                {/* Metrics Cards Grid */}
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "16px", marginBottom: "32px" }}>
                  <MetricCard label={t("dashboard.registeredAdapters")} value="19" subtitle="100% OPERATIONAL" icon="⚡" />
                  <MetricCard label={t("dashboard.cisEngines")} value="8" subtitle="EGRUL / FNS / BO / MVD / SUDRF" icon="🇷🇺" />
                  <MetricCard label={t("dashboard.globalEngines")} value="11" subtitle="STIX / HOLEHE / GHUNT / CCTV" icon="🌐" />
                  <MetricCard label={t("dashboard.indexedResources")} value="1,300+" subtitle="D1 DATABASE INDEX" icon="📚" />
                </div>

                {/* Architecture & Capabilities Section */}
                <div className="gotham-panel" style={{ padding: "24px", borderRadius: "6px", marginBottom: "28px" }}>
                  <h3 style={{ color: "var(--text-accent)", fontSize: "15px", marginBottom: "12px", fontFamily: "var(--font-mono)" }}>
                    🛡️ {t("dashboard.statsTitle")}
                  </h3>
                  <p style={{ color: "var(--text-secondary)", fontSize: "13px", lineHeight: "1.7", margin: 0 }}>
                    {t("dashboard.modulesDescription")}
                  </p>
                </div>

                {/* Quick Action Navigation Buttons */}
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: "16px" }}>
                  <ActionCard
                    icon="🤖"
                    title={t("nav.agent")}
                    desc={locale === "ru" ? "Запустить диалог с ИИ-помощником по расследованиям" : "Start interactive AI investigation assistant"}
                    onClick={() => setCurrentView("agent")}
                  />
                  <ActionCard
                    icon="🌐"
                    title={t("nav.osint")}
                    desc={locale === "ru" ? "Изучить 1300+ структурированных инструментов разведки" : "Explore 1300+ hierarchical OSINT intelligence tools"}
                    onClick={() => setCurrentView("osint")}
                  />
                  <ActionCard
                    icon="🔍"
                    title={t("nav.search")}
                    desc={locale === "ru" ? "Поиск по ИНН, доменам, почтам, кошелькам и базам" : "Search by INN, domains, emails, wallets and databases"}
                    onClick={() => setCurrentView("search")}
                  />
                  <ActionCard
                    icon="⚡"
                    title={t("nav.jobs")}
                    desc={locale === "ru" ? "Мониторинг фоновых задач и конвейеров воркеров" : "Monitor background tasks and worker pipelines"}
                    onClick={() => setCurrentView("jobs")}
                  />
                </div>
              </div>
            </div>
          )}

          {currentView === "search" && <SearchPanel />}
          {currentView === "jobs" && <JobsPanel initialJobs={initialJobs} />}
        </div>
      </div>
    </div>
  );
}

function MetricCard({ label, value, subtitle, icon }: { label: string; value: string; subtitle: string; icon: string }) {
  return (
    <div
      className="gotham-panel"
      style={{
        padding: "18px 20px",
        borderRadius: "6px",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        border: "1px solid var(--border-primary)",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
        <span style={{ fontSize: "11px", fontFamily: "var(--font-mono)", color: "var(--text-secondary)" }}>{label}</span>
        <span style={{ fontSize: "18px" }}>{icon}</span>
      </div>
      <div style={{ fontSize: "28px", fontWeight: "bold", color: "var(--text-accent)", fontFamily: "var(--font-mono)", lineHeight: 1.1 }}>
        {value}
      </div>
      <div style={{ fontSize: "10px", color: "var(--text-muted)", fontFamily: "var(--font-mono)", marginTop: "6px", letterSpacing: "0.5px" }}>
        {subtitle}
      </div>
    </div>
  );
}

function ActionCard({ icon, title, desc, onClick }: { icon: string; title: string; desc: string; onClick: () => void }) {
  return (
    <div
      className="gotham-panel"
      onClick={onClick}
      style={{
        padding: "20px",
        borderRadius: "6px",
        cursor: "pointer",
        transition: "all 0.2s ease",
        border: "1px solid var(--border-primary)",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.borderColor = "var(--border-highlight)";
        e.currentTarget.style.transform = "translateY(-2px)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.borderColor = "var(--border-primary)";
        e.currentTarget.style.transform = "translateY(0)";
      }}
    >
      <div style={{ fontSize: "24px", marginBottom: "8px" }}>{icon}</div>
      <div style={{ color: "var(--text-accent)", fontFamily: "var(--font-mono)", fontWeight: "bold", fontSize: "14px", marginBottom: "4px" }}>
        {title} ↗
      </div>
      <div style={{ color: "var(--text-secondary)", fontSize: "12px", lineHeight: "1.4" }}>
        {desc}
      </div>
    </div>
  );
}

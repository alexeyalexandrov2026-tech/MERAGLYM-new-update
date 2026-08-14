"use client";

import React, { useEffect, useState } from "react";
import type { Job } from "@prisma/client";
import { useI18n } from "@/lib/i18nContext";

interface JobsPanelProps {
  initialJobs: Job[];
}

export default function JobsPanel({ initialJobs }: JobsPanelProps) {
  const { t, locale, isRussian } = useI18n();
  const [jobs, setJobs] = useState<Job[]>(initialJobs || []);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;

    const refresh = async () => {
      try {
        const res = await fetch("/api/jobs", { cache: "no-store" });
        if (!res.ok) {
          throw new Error(`Jobs request failed with ${res.status}`);
        }

        const data = (await res.json()) as Job[];
        if (!cancelled && Array.isArray(data)) {
          setJobs(data);
        }
      } catch (error) {
        if (!cancelled) {
          console.error("Failed to fetch jobs", error);
        }
      }
    };

    void refresh();
    const interval = window.setInterval(() => {
      void refresh();
    }, 5000);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, []);

  const refreshNow = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/jobs", { cache: "no-store" });
      if (!res.ok) {
        throw new Error(`Jobs request failed with ${res.status}`);
      }
      const data = (await res.json()) as Job[];
      if (Array.isArray(data)) {
        setJobs(data);
      }
    } catch (error) {
      console.error("Failed to fetch jobs", error);
    } finally {
      setLoading(false);
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case "COMPLETED":
        return "#00ffcc";
      case "RUNNING":
        return "#e2b714";
      case "FAILED":
        return "#ff5555";
      case "RETRY":
        return "#ffb86c";
      default:
        return "var(--text-secondary)";
    }
  };

  const getLocalizedStatus = (status: string) => {
    if (!isRussian) return status;
    switch (status) {
      case "COMPLETED":
        return "ЗАВЕРШЕНО";
      case "RUNNING":
        return "ВЫПОЛНЯЕТСЯ";
      case "FAILED":
        return "ОШИБКА";
      case "RETRY":
        return "ПОВТОР";
      case "PENDING":
        return "В ОЖИДАНИИ";
      default:
        return status;
    }
  };

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", padding: "32px 40px", overflowY: "auto" }}>
      <div style={{ maxWidth: "1000px", width: "100%", margin: "0 auto" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "20px" }}>
          <div>
            <h2 style={{ fontFamily: "var(--font-mono)", color: "var(--text-accent)", fontSize: "16px", margin: 0 }}>
              ⚡ {t("jobsPanel.title")} {jobs.length} {t("jobsPanel.recent")}
            </h2>
            <div style={{ fontSize: "11px", color: "var(--text-secondary)", fontFamily: "var(--font-mono)", marginTop: "4px" }}>
              {isRussian ? "Автоматический опрос воркеров каждые 5 сек" : "Automatic worker scheduler poll every 5s"}
            </div>
          </div>

          <button
            onClick={() => void refreshNow()}
            disabled={loading}
            style={{
              background: "rgba(0, 255, 204, 0.08)",
              border: "1px solid var(--border-highlight)",
              color: "var(--text-accent)",
              padding: "6px 14px",
              fontFamily: "var(--font-mono)",
              fontSize: "12px",
              cursor: loading ? "wait" : "pointer",
              borderRadius: "4px",
              transition: "all 0.2s ease",
            }}
          >
            {loading ? "..." : `🔄 ${t("jobsPanel.refresh")}`}
          </button>
        </div>

        <div style={{ flex: 1 }}>
          {loading && jobs.length === 0 && (
            <div style={{ color: "var(--text-secondary)", fontFamily: "var(--font-mono)", fontSize: "12px", padding: "16px 0" }}>
              {t("jobsPanel.loading")}
            </div>
          )}

          {!loading && jobs.length === 0 && (
            <div style={{ color: "var(--text-secondary)", fontFamily: "var(--font-mono)", fontSize: "12px", padding: "24px 0", textAlign: "center" }}>
              {t("jobsPanel.noJobs")}
            </div>
          )}

          <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
            {jobs.map((job) => (
              <div
                key={job.id}
                className="gotham-panel"
                style={{
                  padding: "16px 20px",
                  borderLeft: `4px solid ${getStatusColor(job.status)}`,
                  borderTop: "1px solid var(--border-primary)",
                  borderRight: "1px solid var(--border-primary)",
                  borderBottom: "1px solid var(--border-primary)",
                  borderRadius: "4px",
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "10px" }}>
                  <div style={{ display: "flex", gap: "14px", alignItems: "center" }}>
                    <span style={{ fontFamily: "var(--font-mono)", fontWeight: "bold", color: "var(--text-primary)", fontSize: "14px" }}>
                      {job.type}
                    </span>
                    <span style={{ fontSize: "11px", fontFamily: "var(--font-mono)", color: "var(--text-muted)" }}>
                      {t("jobsPanel.id")} {job.id}
                    </span>
                  </div>
                  <div
                    style={{
                      color: getStatusColor(job.status),
                      fontFamily: "var(--font-mono)",
                      fontSize: "11px",
                      fontWeight: "bold",
                      background: "rgba(255,255,255,0.03)",
                      padding: "2px 8px",
                      borderRadius: "2px",
                      border: `1px solid ${getStatusColor(job.status)}40`,
                    }}
                  >
                    [{getLocalizedStatus(job.status)}]
                  </div>
                </div>

                <div style={{ fontSize: "11px", color: "var(--text-secondary)", fontFamily: "var(--font-mono)", display: "flex", gap: "20px", flexWrap: "wrap" }}>
                  <div>{t("jobsPanel.created")} {new Date(job.createdAt).toLocaleString(locale === "ru" ? "ru-RU" : "en-US")}</div>
                  {job.startedAt && <div>{t("jobsPanel.started")} {new Date(job.startedAt).toLocaleString(locale === "ru" ? "ru-RU" : "en-US")}</div>}
                  {job.completedAt && <div>{t("jobsPanel.completed")} {new Date(job.completedAt).toLocaleString(locale === "ru" ? "ru-RU" : "en-US")}</div>}
                </div>

                {job.error && (
                  <div
                    style={{
                      marginTop: "10px",
                      padding: "8px 12px",
                      background: "rgba(255, 85, 85, 0.1)",
                      border: "1px solid rgba(255, 85, 85, 0.3)",
                      color: "#ff5555",
                      fontSize: "11px",
                      fontFamily: "var(--font-mono)",
                      whiteSpace: "pre-wrap",
                      borderRadius: "2px",
                    }}
                  >
                    {t("jobsPanel.error")}: {job.error}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

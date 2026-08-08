"use client";

import React, { useEffect, useState } from "react";
import type { Job } from "@prisma/client";
import { useI18n } from "@/lib/i18nContext";

interface JobsPanelProps {
  initialJobs: Job[];
}

export default function JobsPanel({ initialJobs }: JobsPanelProps) {
  const { t } = useI18n();
  const [jobs, setJobs] = useState<Job[]>(initialJobs);
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
        if (!cancelled) {
          setJobs(data);
        }
      } catch (error) {
        if (!cancelled) {
          console.error("Failed to fetch jobs", error);
        }
      }
    };

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
      setJobs((await res.json()) as Job[]);
    } catch (error) {
      console.error("Failed to fetch jobs", error);
    } finally {
      setLoading(false);
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case "COMPLETED":
        return "var(--text-accent)";
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

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", padding: "40px", overflowY: "auto" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "20px" }}>
        <h2 style={{ fontFamily: "var(--font-mono)", color: "var(--text-accent)", fontSize: "16px" }}>
          {t("jobsPanel.title")} {jobs.length} {t("jobsPanel.recent")}
        </h2>
        <button
          onClick={() => void refreshNow()}
          disabled={loading}
          style={{
            background: "transparent",
            border: "1px solid var(--border-highlight)",
            color: "var(--text-accent)",
            padding: "6px 12px",
            fontFamily: "var(--font-mono)",
            fontSize: "12px",
            cursor: loading ? "wait" : "pointer",
          }}
        >
          {loading ? "..." : t("jobsPanel.refresh")}
        </button>
      </div>

      <div style={{ flex: 1 }}>
        {loading && jobs.length === 0 && (
          <div style={{ color: "var(--text-secondary)", fontFamily: "var(--font-mono)" }}>{t("jobsPanel.loading")}</div>
        )}

        {!loading && jobs.length === 0 && (
          <div style={{ color: "var(--text-secondary)", fontFamily: "var(--font-mono)" }}>{t("jobsPanel.noJobs")}</div>
        )}

        <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
          {jobs.map((job) => (
            <div
              key={job.id}
              style={{
                padding: "16px",
                background: "var(--bg-panel)",
                borderLeft: `3px solid ${getStatusColor(job.status)}`,
                borderTop: "1px solid var(--border-primary)",
                borderRight: "1px solid var(--border-primary)",
                borderBottom: "1px solid var(--border-primary)",
                borderRadius: "2px",
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "12px" }}>
                <div style={{ display: "flex", gap: "16px", alignItems: "center" }}>
                  <span style={{ fontFamily: "var(--font-mono)", fontWeight: "bold", color: "var(--text-primary)" }}>
                    {job.type}
                  </span>
                  <span style={{ fontSize: "12px", fontFamily: "var(--font-mono)", color: "var(--text-secondary)" }}>
                    {t("jobsPanel.id")} {job.id}
                  </span>
                </div>
                <div
                  style={{
                    color: getStatusColor(job.status),
                    fontFamily: "var(--font-mono)",
                    fontSize: "12px",
                    fontWeight: "bold",
                  }}
                >
                  [{job.status}]
                </div>
              </div>

              <div style={{ fontSize: "12px", color: "var(--text-secondary)", fontFamily: "var(--font-mono)", display: "flex", gap: "24px" }}>
                <div>{t("jobsPanel.created")} {new Date(job.createdAt).toLocaleString()}</div>
                {job.startedAt && <div>{t("jobsPanel.started")} {new Date(job.startedAt).toLocaleString()}</div>}
                {job.completedAt && <div>{t("jobsPanel.completed")} {new Date(job.completedAt).toLocaleString()}</div>}
              </div>

              {job.error && (
                <div
                  style={{
                    marginTop: "12px",
                    padding: "8px",
                    background: "rgba(255, 85, 85, 0.1)",
                    border: "1px solid rgba(255, 85, 85, 0.3)",
                    color: "#ff5555",
                    fontSize: "12px",
                    fontFamily: "var(--font-mono)",
                    whiteSpace: "pre-wrap",
                  }}
                >
                  {job.error}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

"use client";

import React, { useState, useEffect, useCallback } from "react";
import type { Node } from "@prisma/client";
import { useI18n } from "@/lib/i18nContext";

export default function SearchPanel() {
  const { t, locale, isRussian } = useI18n();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Node[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [activeCategoryFilter, setActiveCategoryFilter] = useState<string>("ALL");

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

  const performSearch = useCallback(async (q: string) => {
    setLoading(true);
    setSearched(true);
    try {
      const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`);
      if (res.ok) {
        const data = (await res.json()) as Node[];
        setResults(Array.isArray(data) ? data : []);
      }
    } catch (err) {
      console.error("Search failed", err);
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
        searchSeed = isRussian ? "телефон" : "phone";
        break;
      case "COMPANY":
        searchSeed = isRussian ? "налог" : "company";
        break;
      case "CRYPTO":
        searchSeed = isRussian ? "крипта" : "crypto";
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
      if (query.trim().length > 1) {
        performSearch(query);
      } else {
        setResults([]);
        setSearched(false);
      }
    }, 250);

    return () => clearTimeout(delayDebounceFn);
  }, [query, performSearch]);

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
              {results.map((node) => (
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

                    {node.url && (
                      <a
                        href={node.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: "4px",
                          fontSize: "12px",
                          color: "var(--text-accent)",
                          textDecoration: "none",
                          border: "1px solid var(--border-highlight)",
                          background: "rgba(0, 255, 204, 0.08)",
                          padding: "4px 10px",
                          borderRadius: "3px",
                          fontFamily: "var(--font-mono)",
                        }}
                      >
                        <span>{t("nodeView.initiateUplink")}</span>
                      </a>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

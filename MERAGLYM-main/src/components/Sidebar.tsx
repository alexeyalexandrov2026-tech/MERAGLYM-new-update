"use client";

import React, { useState, useEffect, useMemo } from "react";
import type { Node } from "@prisma/client";
import { useI18n } from "@/lib/i18nContext";

interface SidebarProps {
  initialNodes: Node[];
  onSelectNode: (node: Node) => void;
  selectedNodeId?: number | null;
}

const TreeNode = ({
  node,
  level,
  onSelectNode,
  selectedNodeId,
}: {
  node: Node;
  level: number;
  onSelectNode: (node: Node) => void;
  selectedNodeId?: number | null;
}) => {
  const [expanded, setExpanded] = useState(false);
  const [children, setChildren] = useState<Node[]>([]);
  const [loading, setLoading] = useState(false);
  const [hasFetched, setHasFetched] = useState(false);

  const mightHaveChildren = node.type === "folder";
  const isSelected = selectedNodeId === node.id;

  const handleToggle = async () => {
    if (!expanded && !hasFetched && mightHaveChildren) {
      setLoading(true);
      try {
        const res = await fetch(`/api/nodes?parentId=${node.id}`);
        if (res.ok) {
          const data = (await res.json()) as Node[];
          setChildren(Array.isArray(data) ? data : []);
        }
      } catch (err) {
        console.error("Failed to load children", err);
      } finally {
        setLoading(false);
        setHasFetched(true);
      }
    }
    setExpanded(!expanded);
  };

  return (
    <div style={{ marginLeft: level > 0 ? "14px" : "0" }}>
      <div
        className={`node-item ${isSelected ? "node-active" : ""}`}
        style={{
          display: "flex",
          alignItems: "center",
          padding: "6px 12px",
          borderLeft: "2px solid transparent",
          color: isSelected ? "var(--text-accent)" : "var(--text-primary)",
          fontSize: "13px",
          userSelect: "none",
          cursor: "pointer",
        }}
        onClick={() => {
          if (mightHaveChildren) handleToggle();
          onSelectNode(node);
        }}
      >
        <span
          style={{
            marginRight: "6px",
            fontFamily: "var(--font-mono)",
            opacity: 0.7,
            width: "18px",
            display: "inline-block",
            textAlign: "center",
            fontSize: "11px",
          }}
        >
          {loading ? "..." : mightHaveChildren ? (expanded ? "[-]" : "[+]") : "›"}
        </span>
        <span
          style={{
            fontFamily: node.type === "folder" ? "var(--font-mono)" : "var(--font-sans)",
            fontWeight: node.type === "folder" ? "bold" : "normal",
            letterSpacing: node.type === "folder" ? "0.4px" : "normal",
            fontSize: node.type === "folder" ? "12px" : "13px",
          }}
        >
          {node.name}
        </span>
      </div>
      {expanded && children.length > 0 && (
        <div style={{ borderLeft: "1px dashed var(--border-muted)", marginLeft: "8px" }}>
          {children.map((child) => (
            <TreeNode
              key={child.id}
              node={child}
              level={level + 1}
              onSelectNode={onSelectNode}
              selectedNodeId={selectedNodeId}
            />
          ))}
        </div>
      )}
    </div>
  );
};

export default function Sidebar({ initialNodes, onSelectNode, selectedNodeId }: SidebarProps) {
  const { t, locale } = useI18n();
  const hasInitial = Boolean(initialNodes && initialNodes.length > 0);
  const [nodes, setNodes] = useState<Node[]>(initialNodes || []);
  const [loading, setLoading] = useState(!hasInitial);
  const [filterRegion, setFilterRegion] = useState<"ALL" | "CIS" | "GLOBAL">("ALL");
  const [searchFilter, setSearchFilter] = useState("");

  const displayNodes = hasInitial ? initialNodes! : nodes;

  useEffect(() => {
    if (hasInitial) {
      return;
    }

    let isMounted = true;
    fetch("/api/nodes")
      .then((res) => res.json())
      .then((data) => {
        if (isMounted && Array.isArray(data)) {
          setNodes(data as Node[]);
        }
      })
      .catch((err) => console.error("Failed to fetch root nodes:", err))
      .finally(() => {
        if (isMounted) setLoading(false);
      });

    return () => {
      isMounted = false;
    };
  }, [hasInitial]);

  const filteredNodes = useMemo(() => {
    return displayNodes.filter((node) => {
      if (searchFilter.trim()) {
        const query = searchFilter.toLowerCase();
        const matchName = node.name.toLowerCase().includes(query);
        const matchDesc = node.description ? node.description.toLowerCase().includes(query) : false;
        if (!matchName && !matchDesc) return false;
      }

      if (filterRegion === "CIS") {
        const isCis =
          node.name.toLowerCase().includes("cis") ||
          node.name.toLowerCase().includes("russia") ||
          node.name.toLowerCase().includes("рф") ||
          node.name.toLowerCase().includes("росси") ||
          node.name.toLowerCase().includes("егрюл") ||
          node.name.toLowerCase().includes("фнс") ||
          node.name.toLowerCase().includes("суд");
        return isCis;
      }

      if (filterRegion === "GLOBAL") {
        const isCis =
          node.name.toLowerCase().includes("cis") ||
          node.name.toLowerCase().includes("russia") ||
          node.name.toLowerCase().includes("рф") ||
          node.name.toLowerCase().includes("росси");
        return !isCis;
      }

      return true;
    });
  }, [displayNodes, filterRegion, searchFilter]);

  return (
    <div
      className="gotham-panel"
      style={{
        width: "360px",
        height: "100%",
        overflowY: "auto",
        display: "flex",
        flexDirection: "column",
        borderRight: "1px solid var(--border-highlight)",
        borderTop: "none",
        borderBottom: "none",
        borderLeft: "none",
      }}
    >
      {/* Sticky Header */}
      <div
        style={{
          padding: "16px 20px",
          borderBottom: "1px solid var(--border-primary)",
          position: "sticky",
          top: 0,
          background: "var(--bg-panel)",
          zIndex: 10,
          backdropFilter: "blur(12px)",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
          <h2 style={{ color: "var(--text-accent)", fontSize: "14px", margin: 0 }}>
            {t("sidebar.sysIndex")}
          </h2>
          <div style={{ fontSize: "11px", color: "var(--text-secondary)", fontFamily: "var(--font-mono)" }}>
            {filteredNodes.length} {t("sidebar.entries")}
          </div>
        </div>

        {/* Filter Pills */}
        <div style={{ display: "flex", gap: "6px", marginBottom: "10px" }}>
          <button
            onClick={() => setFilterRegion("ALL")}
            style={{
              flex: 1,
              padding: "3px 0",
              background: filterRegion === "ALL" ? "rgba(0, 255, 204, 0.15)" : "transparent",
              border: `1px solid ${filterRegion === "ALL" ? "var(--border-highlight)" : "var(--border-primary)"}`,
              color: filterRegion === "ALL" ? "var(--text-accent)" : "var(--text-secondary)",
              fontSize: "10px",
              fontFamily: "var(--font-mono)",
              cursor: "pointer",
              borderRadius: "2px",
            }}
          >
            {t("sidebar.filterAll")}
          </button>
          <button
            onClick={() => setFilterRegion("CIS")}
            style={{
              flex: 1,
              padding: "3px 0",
              background: filterRegion === "CIS" ? "rgba(0, 255, 204, 0.15)" : "transparent",
              border: `1px solid ${filterRegion === "CIS" ? "var(--border-highlight)" : "var(--border-primary)"}`,
              color: filterRegion === "CIS" ? "var(--text-accent)" : "var(--text-secondary)",
              fontSize: "10px",
              fontFamily: "var(--font-mono)",
              cursor: "pointer",
              borderRadius: "2px",
            }}
          >
            🇷🇺 {t("sidebar.filterCIS")}
          </button>
          <button
            onClick={() => setFilterRegion("GLOBAL")}
            style={{
              flex: 1,
              padding: "3px 0",
              background: filterRegion === "GLOBAL" ? "rgba(0, 255, 204, 0.15)" : "transparent",
              border: `1px solid ${filterRegion === "GLOBAL" ? "var(--border-highlight)" : "var(--border-primary)"}`,
              color: filterRegion === "GLOBAL" ? "var(--text-accent)" : "var(--text-secondary)",
              fontSize: "10px",
              fontFamily: "var(--font-mono)",
              cursor: "pointer",
              borderRadius: "2px",
            }}
          >
            🌐 {t("sidebar.filterGlobal")}
          </button>
        </div>

        {/* Quick Filter Input */}
        <input
          type="text"
          value={searchFilter}
          onChange={(e) => setSearchFilter(e.target.value)}
          placeholder={t("sidebar.searchTreePlaceholder")}
          style={{
            width: "100%",
            boxSizing: "border-box",
            background: "rgba(0, 255, 204, 0.04)",
            border: "1px solid var(--border-primary)",
            color: "var(--text-primary)",
            padding: "6px 10px",
            fontFamily: "var(--font-mono)",
            fontSize: "11px",
            borderRadius: "2px",
            outline: "none",
          }}
        />
      </div>

      {/* Tree View Nodes */}
      <div style={{ padding: "8px 0", flex: 1 }}>
        {loading && displayNodes.length === 0 && (
          <div style={{ padding: "20px", color: "var(--text-secondary)", fontFamily: "var(--font-mono)", fontSize: "12px" }}>
            {t("sidebar.loading")}
          </div>
        )}

        {filteredNodes.map((node) => (
          <TreeNode
            key={node.id}
            node={node}
            level={0}
            onSelectNode={onSelectNode}
            selectedNodeId={selectedNodeId}
          />
        ))}

        {!loading && filteredNodes.length === 0 && (
          <div style={{ padding: "20px", color: "var(--text-muted)", fontFamily: "var(--font-mono)", fontSize: "11px", textAlign: "center" }}>
            {locale === "ru" ? "Нет элементов по фильтру" : "No elements matching filter"}
          </div>
        )}
      </div>
    </div>
  );
}

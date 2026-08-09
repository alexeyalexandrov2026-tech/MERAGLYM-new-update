import fs from 'node:fs';
import path from 'node:path';

async function main() {
  console.log("Fetching arf.json...");
  const res = await fetch("https://raw.githubusercontent.com/lockfale/OSINT-Framework/master/public/arf.json");
  if (!res.ok) throw new Error(`Failed to fetch arf.json: ${res.statusText}`);
  const data = await res.json();

  const roots = Array.isArray(data) ? data : [data];

  let idCounter = 1;
  const sqlStatements = [];

  // Table schema creation for D1 / SQLite if not already created
  sqlStatements.push(`
CREATE TABLE IF NOT EXISTS "Node" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "parentId" INTEGER,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "url" TEXT,
    "description" TEXT,
    "status" TEXT,
    "pricing" TEXT,
    "bestFor" TEXT,
    "input" TEXT,
    "output" TEXT,
    "opsec" TEXT,
    "opsecNote" TEXT,
    "localInstall" BOOLEAN,
    "googleDork" BOOLEAN,
    "registration" BOOLEAN,
    "editUrl" BOOLEAN,
    "api" BOOLEAN,
    "invitationOnly" BOOLEAN,
    "deprecated" BOOLEAN,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY ("parentId") REFERENCES "Node" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "Job" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "payload" TEXT,
    "result" TEXT,
    "error" TEXT,
    "startedAt" DATETIME,
    "completedAt" DATETIME,
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "maxRetries" INTEGER NOT NULL DEFAULT 3,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
  `.trim());

  function escapeSql(val) {
    if (val === null || val === undefined) return 'NULL';
    if (typeof val === 'boolean') return val ? 1 : 0;
    if (typeof val === 'number') return val;
    return `'${String(val).replace(/'/g, "''")}'`;
  }

  function processNode(node, parentId = null) {
    const currentId = idCounter++;
    const nodeType = node.type || (node.children && node.children.length > 0 ? "folder" : "url");

    sqlStatements.push(`INSERT INTO "Node" (id, parentId, name, type, url, description, status, pricing, bestFor, input, output, opsec, opsecNote, localInstall, googleDork, registration, editUrl, api, invitationOnly, deprecated) VALUES (${currentId}, ${parentId === null ? 'NULL' : parentId}, ${escapeSql(node.name)}, ${escapeSql(nodeType)}, ${escapeSql(node.url)}, ${escapeSql(node.description)}, ${escapeSql(node.status)}, ${escapeSql(node.pricing)}, ${escapeSql(node.bestFor)}, ${escapeSql(node.input)}, ${escapeSql(node.output)}, ${escapeSql(node.opsec)}, ${escapeSql(node.opsecNote)}, ${escapeSql(node.localInstall)}, ${escapeSql(node.googleDork)}, ${escapeSql(node.registration)}, ${escapeSql(node.editUrl)}, ${escapeSql(node.api)}, ${escapeSql(node.invitationOnly)}, ${escapeSql(node.deprecated)});`);

    if (Array.isArray(node.children)) {
      for (const child of node.children) {
        processNode(child, currentId);
      }
    }
  }

  for (const root of roots) {
    processNode(root, null);
  }

  // Seed sample jobs for jobs telemetry view
  sqlStatements.push(`INSERT INTO "Job" (type, status, payload, result, startedAt, completedAt) VALUES ('ingest_arf', 'COMPLETED', '{"source":"https://raw.githubusercontent.com/lockfale/OSINT-Framework/master/public/arf.json"}', '{"nodes_ingested": ${idCounter - 1}}', datetime('now', '-10 minutes'), datetime('now', '-8 minutes'));`);
  sqlStatements.push(`INSERT INTO "Job" (type, status, payload, startedAt) VALUES ('egrul_registry', 'RUNNING', '{"target":"0700000000"}', datetime('now', '-2 minutes'));`);
  sqlStatements.push(`INSERT INTO "Job" (type, status, payload) VALUES ('mvd_wanted', 'PENDING', '{"target":"Ivanov Ivan"}');`);
  sqlStatements.push(`INSERT INTO "Job" (type, status, payload, completedAt) VALUES ('social_recon', 'COMPLETED', '{"username":"alexey"}', datetime('now', '-1 hour'));`);

  const outputPath = path.resolve('prisma/d1-seed.sql');
  fs.writeFileSync(outputPath, sqlStatements.join('\n'), 'utf-8');
  console.log(`Generated ${sqlStatements.length} SQL statements in ${outputPath}`);
}

main().catch(err => {
  console.error("Error generating seed:", err);
  process.exit(1);
});

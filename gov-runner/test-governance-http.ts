/**
 * 治理助手 Gov API 集成测试（通过 DataToolbox HTTP API）
 * 运行前准备：服务已启动（默认 http://localhost:8080）
 *
 * 用法：cd gov-runner && bun test-governance-http.ts
 * 环境变量：API_BASE（默认 http://localhost:8080）、USERNAME、PASSWORD
 */

import * as XLSX from "xlsx";
import PizZip from "pizzip";
import { Database } from "bun:sqlite";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";

const API_BASE = process.env.API_BASE ?? "http://localhost:8080";
const USERNAME = process.env.USERNAME ?? "admin";
const PASSWORD = process.env.PASSWORD ?? "admin1234";
const TEST_DIR = "/tmp/dt-test";

type Case = { name: string; ok: boolean; detail?: string };

const report: Case[] = [];

function ok(name: string, detail?: string) {
  report.push({ name, ok: true, detail });
  console.log(`[PASS] ${name}${detail ? ` — ${detail}` : ""}`);
}

function fail(name: string, err: unknown) {
  const msg = err instanceof Error ? err.message : String(err);
  report.push({ name, ok: false, detail: msg });
  console.log(`[FAIL] ${name} — ${msg}`);
}

async function fetchJson(
  path: string,
  init: RequestInit & { headers?: Record<string, string> } = {}
): Promise<any> {
  const url = path.startsWith("http") ? path : `${API_BASE}${path}`;
  const h = (init.headers as Record<string, string> | undefined) ?? {};
  const headers: Record<string, string> = { ...h };
  if (init.method && init.method !== "GET" && init.body) {
    headers["Content-Type"] = headers["Content-Type"] ?? "application/json";
  }
  const r = await fetch(url, { ...init, headers });
  const text = await r.text();
  let data: any = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { _raw: text };
  }
  if (!r.ok) {
    throw new Error(`${r.status} ${data.message ?? text.slice(0, 200)}`);
  }
  return data;
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function prepareTestDir() {
  await mkdir(TEST_DIR, { recursive: true });
  // sample.xlsx
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet([
    ["col1", "col2"],
    [1, 2],
    [3, 4],
  ]);
  XLSX.utils.book_append_sheet(wb, ws, "Data");
  const xlsxBuf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
  await Bun.write(join(TEST_DIR, "sample.xlsx"), xlsxBuf);

  // excel_template.xlsx — A1 供 flat 填充
  const wbT = XLSX.utils.book_new();
  const wsT = XLSX.utils.aoa_to_sheet([["tpl"], [" "]]);
  XLSX.utils.book_append_sheet(wbT, wsT, "Sheet1");
  const xlsxT = XLSX.write(wbT, { type: "buffer", bookType: "xlsx" }) as Buffer;
  await Bun.write(join(TEST_DIR, "excel_template.xlsx"), xlsxT);

  // template.docx — docxtemplater 占位
  const zip = new PizZip();
  zip.file(
    "[Content_Types].xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`
  );
  zip.folder("_rels")!.file(
    ".rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`
  );
  zip.folder("word")!.folder("_rels")!.file(
    "document.xml.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>`
  );
  zip.folder("word")!.file(
    "document.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p><w:r><w:t>Name: </w:t></w:r><w:r><w:t>{{name}}</w:t></w:r></w:p>
  </w:body>
</w:document>`
  );
  const docxBuf = zip.generate({ type: "nodebuffer" }) as Buffer;
  await Bun.write(join(TEST_DIR, "template.docx"), docxBuf);

  // SQLite
  const dbPath = join(TEST_DIR, "gov_sqlite.db");
  const db = new Database(dbPath);
  db.run("DROP TABLE IF EXISTS gov_t;");
  db.run("CREATE TABLE gov_t (id INTEGER PRIMARY KEY AUTOINCREMENT, v TEXT);");
  db.run("INSERT INTO gov_t (v) VALUES ('before');");
  db.close();
}

async function login(): Promise<string> {
  const data = await fetchJson("/api/data-ontology/login", {
    method: "POST",
    body: JSON.stringify({ username: USERNAME, password: PASSWORD }),
  });
  if (!data.success || !data.token) {
    throw new Error(data.message ?? "登录失败");
  }
  return data.token as string;
}

async function registerSqlite(token: string): Promise<string> {
  const dbPath = join(TEST_DIR, "gov_sqlite.db");
  const data = await fetchJson("/api/data-ontology/databases", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      type: "sqlite",
      name: `dt-test-gov-${Date.now()}`,
      path: dbPath,
    }),
  });
  if (!data.success || !data.id) {
    throw new Error(data.message ?? "注册 SQLite 失败");
  }
  return data.id as string;
}

/** 治理任务 JS：覆盖 gov 文件/SQL API（callAI 单独测） */
function buildGovTaskJs(): string {
  return `
(async () => {
  const find = (n) => (INPUT_FILES || []).find((f) => f && f.name === n) || null;

  // readCSV (INPUT_TEXT)
  const csvRows = await gov.readCSV(INPUT_TEXT);
  if (!csvRows || csvRows[0][0] !== "h1" || csvRows[1][1] !== "b") {
    throw new Error("readCSV 结果不符");
  }
  gov.log("readCSV:ok");

  // readExcel
  const sx = find("sample.xlsx");
  if (!sx) throw new Error("缺少 sample.xlsx");
  const wb = await gov.readExcel(sx);
  const sh = wb.Sheets[wb.SheetNames[0]];
  const j = XLSX.utils.sheet_to_json(sh, { header: 1 });
  if (JSON.stringify(j[0]) !== JSON.stringify(["col1","col2"])) throw new Error("readExcel 表头不符");
  gov.log("readExcel:ok");

  // readWord
  const wd = find("template.docx");
  if (!wd) throw new Error("缺少 template.docx");
  const wt = await gov.readWord(wd);
  if (!wt.value || String(wt.value).trim().length < 1) throw new Error("readWord 无内容");
  gov.log("readWord:ok");

  // writeExcel / writeCSV / writeText / writeJSON
  gov.writeExcel("out_write", [[1, 2], [3, 4]], { sheetName: "S" });
  gov.writeCSV("out_write", [["x", "y"], ["1", "2"]]);
  gov.writeText("note", "hello");
  gov.writeJSON("data", { a: 1 });

  // fillWordTemplate
  await gov.fillWordTemplate(wd, { name: "Tester" }, "filled_word");

  // fillExcelTemplate
  const xt = find("excel_template.xlsx");
  if (!xt) throw new Error("缺少 excel_template.xlsx");
  await gov.fillExcelTemplate(xt, { A1: "filled" }, "filled_excel");

  // querySQL / executeSQL（任务已关联 database_id）
  const rows = await gov.querySQL("SELECT v FROM gov_t WHERE id = 1");
  if (!rows || !rows.length) throw new Error("querySQL 无行");
  const v0 = rows[0].v ?? rows[0].V;
  if (String(v0) !== "before") throw new Error("querySQL 值不符: " + v0);

  const n = await gov.executeSQL("UPDATE gov_t SET v = ? WHERE id = 1", ["after"]);
  if (typeof n !== "number") throw new Error("executeSQL 返回值异常");

  const rows2 = await gov.querySQL("SELECT v FROM gov_t WHERE id = 1");
  const v1 = rows2[0].v ?? rows2[0].V;
  if (String(v1) !== "after") throw new Error("UPDATE 未生效");

  gov.log("querySQL/executeSQL:ok");
})();
`;
}

async function createAndRunGovTask(
  token: string,
  databaseId: string
): Promise<string> {
  const body = {
    name: `dt-gov-e2e-${Date.now()}`,
    type: "interactive",
    js_code: buildGovTaskJs(),
    database_id: databaseId,
    file_batch_mode: "single",
    input_type: "both",
  };

  const created = await fetchJson("/api/data-ontology/governance/tasks", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  if (!created.success || !created.task?.id) {
    throw new Error(created.message ?? "创建任务失败");
  }
  const taskId = created.task.id as string;

  const form = new FormData();
  form.append("input_text", ["h1,h2", "a,b", "c,d"].join("\n"));
  const files = ["sample.xlsx", "template.docx", "excel_template.xlsx"];
  for (const name of files) {
    const path = join(TEST_DIR, name);
    const blob = new Blob([await Bun.file(path).arrayBuffer()]);
    form.append("files", blob, name);
  }

  const runUrl = `${API_BASE}/api/data-ontology/governance/tasks/${taskId}/run`;
  const runRes = await fetch(runUrl, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
  const runData = await runRes.json();
  if (!runRes.ok || !runData.success) {
    await fetch(`${API_BASE}/api/data-ontology/governance/tasks/${taskId}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    }).catch(() => {});
    throw new Error(runData.message ?? "排队执行失败");
  }

  const maxWait = 120_000;
  const t0 = Date.now();
  let lastOut = "";
  while (Date.now() - t0 < maxWait) {
    const prog = await fetchJson(
      `/api/data-ontology/governance/tasks/${taskId}/progress`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    const st = prog.status as string;
    lastOut = (prog.last_output as string) ?? lastOut;
    if (st === "success") {
      await fetch(`${API_BASE}/api/data-ontology/governance/tasks/${taskId}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      }).catch(() => {});
      return lastOut;
    }
    if (st === "error") {
      const err = prog.last_error ?? "执行失败";
      await fetch(`${API_BASE}/api/data-ontology/governance/tasks/${taskId}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      }).catch(() => {});
      throw new Error(String(err));
    }
    await sleep(500);
  }
  await fetch(`${API_BASE}/api/data-ontology/governance/tasks/${taskId}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  }).catch(() => {});
  throw new Error("执行超时");
}

function assertGovLogMarkers(log: string) {
  const need = [
    "readCSV:ok",
    "readExcel:ok",
    "readWord:ok",
    "querySQL/executeSQL:ok",
    "已生成输出文件",
  ];
  for (const m of need) {
    if (!log.includes(m)) {
      throw new Error(`日志缺少标记: ${m}`);
    }
  }
}

async function testExecuteSqlDirect(token: string, databaseId: string) {
  const q = await fetchJson("/api/data-ontology/governance/execute-sql", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      database_id: databaseId,
      sql: "SELECT 1 AS one",
      params: [],
    }),
  });
  if (!q.success) throw new Error(q.message ?? "execute-sql SELECT 失败");
  const row = q.data?.[0];
  const one = row?.one ?? row?.ONE;
  if (Number(one) !== 1) throw new Error("SELECT 1 结果异常");
}

async function testCallAiDirect(token: string) {
  const r = await fetch(`${API_BASE}/api/data-ontology/ai/completion`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ prompt: "仅回复字符：OK" }),
  });
  const data = await r.json();
  if (!r.ok || !data.success) {
    throw new Error(data.message ?? `HTTP ${r.status}`);
  }
  if (typeof data.content !== "string" || !data.content.length) {
    throw new Error("AI 返回为空");
  }
}

async function main() {
  console.log(`DataToolbox 治理 API 测试  base=${API_BASE}`);
  await prepareTestDir();

  let token: string;
  try {
    token = await login();
    ok("login", "已获取 token");
  } catch (e) {
    fail("login", e);
    printReport();
    process.exit(1);
  }

  let sqliteId: string | null = null;
  try {
    sqliteId = await registerSqlite(token);
    ok("registerSqlite", sqliteId);
  } catch (e) {
    fail("registerSqlite(测试库)", e);
  }

  if (sqliteId) {
    try {
      await testExecuteSqlDirect(token, sqliteId);
      ok("execute-sql (HTTP 直连 SELECT)", "querySQL/executeSQL 服务端路径可用");
    } catch (e) {
      fail("execute-sql (HTTP 直连)", e);
    }
  }

  try {
    await testCallAiDirect(token);
    ok("callAI (HTTP /ai/completion)", "模型已配置");
  } catch (e) {
    fail("callAI (需配置 AI 设置)", e);
  }

  if (sqliteId) {
    try {
      const log = await createAndRunGovTask(token, sqliteId);
      assertGovLogMarkers(log);
      ok("readExcel", "gov 任务日志确认");
      ok("readCSV", "gov 任务日志确认");
      ok("readWord", "gov 任务日志确认");
      ok("writeExcel", "产出文件行");
      ok("writeCSV", "产出文件行");
      ok("writeText", "产出文件行");
      ok("writeJSON", "产出文件行");
      ok("fillWordTemplate", "产出文件行");
      ok("fillExcelTemplate", "产出文件行");
      ok("querySQL", "gov 任务日志确认");
      ok("executeSQL", "gov 任务日志确认");
    } catch (e) {
      fail("gov-runner 治理任务(多文件+SQL)", e);
    }
  } else {
    fail("gov 任务(文件与 SQL 助手方法)", new Error("无 SQLite，已跳过"));
  }

  if (sqliteId) {
    await fetch(`${API_BASE}/api/data-ontology/databases/${sqliteId}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    }).catch(() => {});
  }

  printReport();
  const failed = report.filter((c) => !c.ok);
  process.exit(failed.length > 0 ? 1 : 0);
}

function printReport() {
  console.log("\n========== 测试结果报告 ==========");
  const pass = report.filter((c) => c.ok).length;
  const fail = report.filter((c) => !c.ok).length;
  for (const c of report) {
    const mark = c.ok ? "✓" : "✗";
    console.log(`${mark} ${c.name}${c.detail ? ` — ${c.detail}` : ""}`);
  }
  console.log("--------------------------------");
  console.log(`通过: ${pass}  失败: ${fail}  合计: ${report.length}`);
  console.log("==================================\n");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

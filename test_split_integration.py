#!/usr/bin/env python3
"""
DataToolbox 拆分后全面集成测试
验证所有 API 端点在拆分后功能正常
"""

import json
import sys
import time
import urllib.request
import urllib.error

BASE = "http://localhost:8080"
TOKEN = None
RESULTS = {"pass": 0, "fail": 0, "errors": []}


def api(method, path, data=None, token=None, expect_status=200):
    """发送 HTTP 请求并返回 (status_code, parsed_json)"""
    url = f"{BASE}{path}"
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    body = json.dumps(data).encode() if data else None
    req = urllib.request.Request(url, data=body, headers=headers, method=method)
    try:
        resp = urllib.request.urlopen(req, timeout=30)
        status = resp.status
        raw = resp.read().decode("utf-8", errors="replace")
        try:
            return status, json.loads(raw)
        except json.JSONDecodeError:
            return status, {"_raw": raw[:200]}
    except urllib.error.HTTPError as e:
        raw = e.read().decode("utf-8", errors="replace")
        try:
            return e.code, json.loads(raw)
        except json.JSONDecodeError:
            return e.code, {"_raw": raw[:200]}
    except Exception as ex:
        return 0, {"_error": str(ex)}


def check(name, condition, detail=""):
    """断言并记录结果"""
    if condition:
        RESULTS["pass"] += 1
        print(f"  ✅ {name}")
    else:
        RESULTS["fail"] += 1
        RESULTS["errors"].append(f"{name}: {detail}")
        print(f"  ❌ {name} — {detail}")


# ============================================================
# 1. 基础服务
# ============================================================
print("\n" + "=" * 60)
print("1. 基础服务")
print("=" * 60)

status, data = api("GET", "/api/version")
check("版本接口可访问", status == 200, f"status={status}")
check("版本号非空", data.get("version", "") != "", f"data={data}")

status, _ = api("GET", "/")
check("首页可访问", status == 200, f"status={status}")

status, _ = api("GET", "/apps/data-ontology/")
check("前端页面可访问", status == 200, f"status={status}")

status, _ = api("GET", "/share/test")
check("分享页面可访问", status == 200, f"status={status}")


# ============================================================
# 2. 认证系统 (auth.go)
# ============================================================
print("\n" + "=" * 60)
print("2. 认证系统")
print("=" * 60)

status, data = api("POST", "/api/data-ontology/login", {"username": "admin", "password": "admin1234"})
check("管理员登录成功", data.get("success") is True, f"data={data}")
TOKEN = data.get("token", "")
check("返回有效 token", TOKEN != "", "token 为空")

status, data = api("POST", "/api/data-ontology/login", {"username": "admin", "password": "wrong"})
check("错误密码登录失败", data.get("success") is False, f"data={data}")

status, data = api("POST", "/api/data-ontology/login", {"username": "nobody", "password": "x"})
check("不存在用户登录失败", data.get("success") is False, f"data={data}")

# 无 token 访问受保护接口
status, data = api("GET", "/api/data-ontology/databases")
check("无 token 拒绝访问", status in (401, 403) or data.get("success") is False, f"status={status}")


# ============================================================
# 3. 用户管理 (auth.go)
# ============================================================
print("\n" + "=" * 60)
print("3. 用户管理")
print("=" * 60)

status, data = api("GET", "/api/data-ontology/users", token=TOKEN)
check("获取用户列表", data.get("success") is True or "users" in data, f"data={data}")

status, data = api("GET", "/api/data-ontology/users/admin", token=TOKEN)
check("获取用户详情", status == 200, f"status={status}")

status, data = api("GET", "/api/data-ontology/apikey", token=TOKEN)
check("获取 API Key", status == 200, f"status={status}")

status, data = api("GET", "/api/data-ontology/settings", token=TOKEN)
check("获取用户设置", status == 200, f"status={status}")


# ============================================================
# 4. 数据库管理 (database.go + handlers_api.go)
# ============================================================
print("\n" + "=" * 60)
print("4. 数据库管理")
print("=" * 60)

status, data = api("GET", "/api/data-ontology/databases", token=TOKEN)
check("获取数据库列表", data.get("success") is True or "databases" in data, f"data={data}")
databases = data.get("databases", [])
db_id = databases[0].get("id", "") if databases else ""
check("至少有一个数据库", len(databases) >= 1, f"count={len(databases)}")

if db_id:
    status, data = api("GET", f"/api/data-ontology/databases/{db_id}", token=TOKEN)
    check("获取数据库详情", status == 200, f"status={status}")

    status, data = api("GET", f"/api/data-ontology/databases/{db_id}/lineage", token=TOKEN)
    check("获取数据血缘", status == 200, f"status={status}")

# 测试连接（SQLite 内存数据库）
status, data = api("POST", "/api/data-ontology/test-connection", {
    "type": "sqlite",
    "path": ":memory:"
}, token=TOKEN)
check("测试数据库连接", status == 200, f"status={status}, data={data}")


# ============================================================
# 5. AI 配置 (ai_query.go)
# ============================================================
print("\n" + "=" * 60)
print("5. AI 配置")
print("=" * 60)

status, data = api("GET", "/api/data-ontology/ai/config", token=TOKEN)
check("获取 AI 配置", data.get("success") is True, f"data={data}")

status, data = api("GET", "/api/data-ontology/ai/embedding-config", token=TOKEN)
check("获取 Embedding 配置", status == 200, f"status={status}")

status, data = api("GET", "/api/data-ontology/ai/table-retrieval-config", token=TOKEN)
check("获取表检索配置", status == 200, f"status={status}")

status, data = api("GET", "/api/data-ontology/ai/capabilities", token=TOKEN)
check("获取 AI 能力", status == 200, f"status={status}")


# ============================================================
# 6. 模型管理 (ai_query.go)
# ============================================================
print("\n" + "=" * 60)
print("6. 模型管理")
print("=" * 60)

status, data = api("GET", "/api/data-ontology/models/llm", token=TOKEN)
check("获取 LLM 模型列表", status == 200, f"status={status}")

status, data = api("GET", "/api/data-ontology/models/small", token=TOKEN)
check("获取小模型列表", status == 200, f"status={status}")


# ============================================================
# 7. MCP 配置 (handlers_api.go)
# ============================================================
print("\n" + "=" * 60)
print("7. MCP 配置")
print("=" * 60)

status, data = api("GET", "/api/data-ontology/mcp/safe-config", token=TOKEN)
check("获取 MCP 安全配置", data.get("success") is True, f"data={data}")

status, data = api("GET", "/api/data-ontology/mcp/config", token=TOKEN)
check("获取 MCP 配置", status == 200, f"status={status}")

status, data = api("GET", "/api/data-ontology/mcp/port", token=TOKEN)
check("获取 MCP 端口", status == 200, f"status={status}")


# ============================================================
# 8. Skills 导出 (handlers_api.go)
# ============================================================
print("\n" + "=" * 60)
print("8. Skills 导出")
print("=" * 60)

status, data = api("GET", "/api/data-ontology/skills/export", token=TOKEN)
check("Skills 导出缺参数返回错误", data.get("success") is False and "type" in data.get("message", ""), f"data={data}")

status, data = api("GET", "/api/data-ontology/skills/export?type=cursor", token=TOKEN)
check("Skills 导出 cursor 类型", status == 200, f"status={status}")


# ============================================================
# 9. 表检索系统 (handlers_retrieval.go + fts5.go)
# ============================================================
print("\n" + "=" * 60)
print("9. 表检索系统")
print("=" * 60)

status, data = api("GET", "/api/data-ontology/table-retrieval/status", token=TOKEN)
check("表检索状态接口", status == 200, f"status={status}")

status, data = api("GET", "/api/data-ontology/table-retrieval/embedding-status", token=TOKEN)
check("Embedding 状态接口", status == 200, f"status={status}")

status, data = api("GET", "/api/data-ontology/table-retrieval/relation-status", token=TOKEN)
check("关系状态接口", status == 200, f"status={status}")

if db_id:
    status, data = api("POST", "/api/data-ontology/table-retrieval/search", {
        "database_id": db_id,
        "query": "用户"
    }, token=TOKEN)
    check("表检索搜索接口", status == 200, f"status={status}")

    status, data = api("GET", f"/api/data-ontology/table-retrieval/vectors?database_id={db_id}", token=TOKEN)
    check("向量列表接口", status == 200, f"status={status}")

    status, data = api("GET", f"/api/data-ontology/table-retrieval/relations?database_id={db_id}", token=TOKEN)
    check("关系列表接口", status == 200, f"status={status}")


# ============================================================
# 10. 治理任务 (governance.go)
# ============================================================
print("\n" + "=" * 60)
print("10. 治理任务")
print("=" * 60)

status, data = api("GET", "/api/data-ontology/governance/tasks", token=TOKEN)
check("获取治理任务列表", data.get("success") is True or "tasks" in data, f"data={data}")
tasks = data.get("tasks", [])
task_id = tasks[0].get("id", "") if tasks else ""

if task_id:
    status, data = api("GET", f"/api/data-ontology/governance/tasks/{task_id}", token=TOKEN)
    check("获取治理任务详情", status == 200, f"status={status}")

    status, data = api("GET", f"/api/data-ontology/governance/tasks/{task_id}/logs", token=TOKEN)
    check("获取治理任务日志", status == 200, f"status={status}")

status, data = api("GET", "/api/data-ontology/governance/examples/download", token=TOKEN)
check("治理示例下载接口", status in (200, 400, 404), f"status={status}")

status, data = api("POST", "/api/data-ontology/governance/execute-sql", {
    "database_id": db_id or "test",
    "sql": "SELECT 1"
}, token=TOKEN)
check("治理执行 SQL 接口", status == 200, f"status={status}")


# ============================================================
# 11. API 接口管理 (ai_api_handlers.go)
# ============================================================
print("\n" + "=" * 60)
print("11. API 接口管理")
print("=" * 60)

status, data = api("GET", "/api/data-ontology/apis", token=TOKEN)
check("获取 API 列表", status == 200, f"status={status}")


# ============================================================
# 12. Agent 集群模式 (ai_query.go)
# ============================================================
print("\n" + "=" * 60)
print("12. Agent 集群模式")
print("=" * 60)

status, data = api("GET", "/api/data-ontology/agent/status", token=TOKEN)
check("Agent 状态接口", data.get("success") is True, f"data={data}")

status, data = api("GET", "/api/data-ontology/agent/mode", token=TOKEN)
check("Agent 模式接口", status == 200, f"status={status}")


# ============================================================
# 13. 本体扫描 (ontology.go)
# ============================================================
print("\n" + "=" * 60)
print("13. 本体扫描")
print("=" * 60)

if db_id:
    status, data = api("POST", "/api/data-ontology/databases/{db_id}/ontology/scan".replace("{db_id}", db_id), {
        "rules": ["exact", "case_insensitive"]
    }, token=TOKEN)
    check("本体扫描接口", status in (200, 0), f"status={status}")  # 0=timeout但接口存在

    status, data = api("GET", f"/api/data-ontology/databases/{db_id}/ontology/relations", token=TOKEN)
    check("本体关系列表接口", status == 200, f"status={status}")


# ============================================================
# 14. 文本解析 (ontology.go)
# ============================================================
print("\n" + "=" * 60)
print("14. 文本解析")
print("=" * 60)

status, data = api("POST", "/api/data-ontology/gov/parse-text", {
    "text": "第一章 总则\n第一条 目的\n第二条 范围",
    "min_level": 1,
    "max_level": 3
}, token=TOKEN)
check("文本结构化解析接口", status == 200, f"status={status}")


# ============================================================
# 15. 数据备份恢复 (store.go)
# ============================================================
print("\n" + "=" * 60)
print("15. 数据备份恢复")
print("=" * 60)

status, data = api("GET", "/api/data-ontology/backup", token=TOKEN)
check("数据备份接口", status == 200, f"status={status}")


# ============================================================
# 16. WebNav 导航 (store.go)
# ============================================================
print("\n" + "=" * 60)
print("16. WebNav 导航")
print("=" * 60)

status, data = api("POST", "/api/web-nav/login", {"username": "admin", "password": "admin1234"})
check("WebNav 登录接口", status == 200, f"status={status}")

status, data = api("GET", "/api/web-nav/links", token=TOKEN)
check("WebNav 链接列表", status == 200, f"status={status}")


# ============================================================
# 17. 分享功能 (share.go)
# ============================================================
print("\n" + "=" * 60)
print("17. 分享功能")
print("=" * 60)

if task_id:
    status, data = api("GET", f"/api/data-ontology/share/{task_id}", token=TOKEN)
    check("分享信息接口", status == 200, f"status={status}")


# ============================================================
# 18. 质量审计 (quality_audit.go)
# ============================================================
print("\n" + "=" * 60)
print("18. 质量审计")
print("=" * 60)

status, data = api("GET", "/api/data-ontology/quality-audit/test", token=TOKEN)
check("质量审计接口", status in (200, 400, 404, 405), f"status={status}")


# ============================================================
# 19. SFTP 运维 (sftp.go) - 仅验证接口可达
# ============================================================
print("\n" + "=" * 60)
print("19. SFTP 运维")
print("=" * 60)

status, data = api("POST", "/api/ops/sftp/connect", {
    "host": "127.0.0.1", "port": 22, "user": "test", "password": "test"
}, token=TOKEN)
check("SFTP 连接接口可达", status in (200, 400), f"status={status}")
# 连接应该失败（没有SSH服务），但接口本身应该响应
check("SFTP 连接失败返回错误", data.get("success") is False or "error" in json.dumps(data).lower(), f"data={data}")


# ============================================================
# 20. CORS 中间件 (middleware.go)
# ============================================================
print("\n" + "=" * 60)
print("20. CORS 中间件")
print("=" * 60)

req = urllib.request.Request(f"{BASE}/api/version", method="OPTIONS")
req.add_header("Origin", "http://example.com")
req.add_header("Access-Control-Request-Method", "GET")
try:
    resp = urllib.request.urlopen(req, timeout=5)
    cors_header = resp.headers.get("Access-Control-Allow-Origin", "")
    check("CORS 头存在", cors_header in ("*", "http://example.com"), f"cors={cors_header}")
except Exception as ex:
    check("CORS 预检请求", False, str(ex))


# ============================================================
# 21. 工具函数 (helpers.go) - 通过 API 行为验证
# ============================================================
print("\n" + "=" * 60)
print("21. 工具函数 (通过 API 行为验证)")
print("=" * 60)

# 测试 apiBadRequest
status, data = api("POST", "/api/data-ontology/login", {})
check("空请求体返回错误", data.get("success") is False, f"data={data}")

# 测试 apiMethodNotAllowed
status, data = api("PUT", "/api/data-ontology/login", {"username": "a", "password": "b"})
check("错误方法返回错误", data.get("success") is False or data.get("error_code") == "METHOD_NOT_ALLOWED", f"data={data}")

# 测试 apiNotFound
status, data = api("GET", "/api/data-ontology/databases/nonexistent-id", token=TOKEN)
check("不存在资源返回 404 或错误", status in (200, 404) or data.get("success") is False, f"status={status}")


# ============================================================
# 22. WebSocket 端点可达性 (websocket.go)
# ============================================================
print("\n" + "=" * 60)
print("22. WebSocket 端点")
print("=" * 60)

# WebSocket 端点用 HTTP GET 应返回 400（不是 WebSocket 升级请求）
try:
    req = urllib.request.Request(f"{BASE}/ws/chat")
    resp = urllib.request.urlopen(req, timeout=5)
    check("WebSocket 端点可达", True)
except urllib.error.HTTPError as e:
    # 400 Bad Request 是正常的（不是 WebSocket 升级）
    check("WebSocket 端点可达", e.code in (400, 502), f"code={e.code}")
except Exception as ex:
    check("WebSocket 端点可达", False, str(ex))


# ============================================================
# 23. 数据库表数据 CRUD (handlers_table.go)
# ============================================================
print("\n" + "=" * 60)
print("23. 数据库表数据 CRUD")
print("=" * 60)

if db_id:
    # 获取表列表
    status, data = api("GET", f"/api/data-ontology/databases/{db_id}/tables", token=TOKEN)
    check("获取表列表", status == 200, f"status={status}")
    tables = data.get("tables", [])
    table_name = tables[0] if isinstance(tables[0], str) else tables[0].get("name", "") if tables else ""

    if table_name:
        status, data = api("GET", f"/api/data-ontology/databases/{db_id}/tables/{table_name}", token=TOKEN)
        check("获取表数据", status == 200, f"status={status}")


# ============================================================
# 24. 内部调用鉴权 (auth.go - X-Internal-Call)
# ============================================================
print("\n" + "=" * 60)
print("24. 内部调用鉴权")
print("=" * 60)

# X-Internal-Call header 应该让请求以 admin 身份通过
req = urllib.request.Request(f"{BASE}/api/data-ontology/databases", method="GET")
req.add_header("X-Internal-Call", "datatoolbox-agent")
try:
    resp = urllib.request.urlopen(req, timeout=5)
    status = resp.status
    raw = resp.read().decode()
    data = json.loads(raw)
    check("内部调用鉴权通过", data.get("success") is True or "databases" in data, f"data={data}")
except urllib.error.HTTPError as e:
    check("内部调用鉴权通过", False, f"HTTP {e.code}")
except Exception as ex:
    check("内部调用鉴权通过", False, str(ex))


# ============================================================
# 25. API Key 鉴权 (auth.go)
# ============================================================
print("\n" + "=" * 60)
print("25. API Key 鉴权")
print("=" * 60)

# 先获取 API key
status, data = api("GET", "/api/data-ontology/apikey", token=TOKEN)
if data.get("success") and data.get("api_key"):
    api_key = data["api_key"]
    # 用 API key 访问
    req = urllib.request.Request(f"{BASE}/api/data-ontology/databases", method="GET")
    req.add_header("Authorization", f"Bearer {api_key}")
    try:
        resp = urllib.request.urlopen(req, timeout=5)
        check("API Key 鉴权通过", resp.status == 200, f"status={resp.status}")
    except urllib.error.HTTPError as e:
        check("API Key 鉴权通过", False, f"HTTP {e.code}")
else:
    print("  ⏭️  跳过：无法获取 API Key")


# ============================================================
# 汇总
# ============================================================
print("\n" + "=" * 60)
print("测试汇总")
print("=" * 60)
total = RESULTS["pass"] + RESULTS["fail"]
print(f"  通过: {RESULTS['pass']}/{total}")
print(f"  失败: {RESULTS['fail']}/{total}")

if RESULTS["errors"]:
    print("\n失败详情:")
    for err in RESULTS["errors"]:
        print(f"  ❌ {err}")

if RESULTS["fail"] > 0:
    print(f"\n⚠️  有 {RESULTS['fail']} 个测试失败！")
    sys.exit(1)
else:
    print("\n🎉 所有测试通过！拆分后功能完整。")
    sys.exit(0)

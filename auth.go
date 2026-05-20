package main

import (
	"encoding/json"
	"github.com/google/uuid"
	"golang.org/x/crypto/bcrypt"
	"log"
	"net/http"
	"net/url"
	"sort"
	"strings"
	"time"
)

func initDataOntology() {
	// 初始化存储层（SQLite + JSON 自动迁移）
	if err := initStore(); err != nil {
		log.Printf("初始化存储层失败: %v", err)
	}
	ensureGovernanceExampleFiles()

	// 如果没有用户，创建默认管理员账号
	dataOntologyMu.Lock()
	if len(dataOntologyUsers) == 0 {
		hashedPassword := hashPassword("admin1234")
		dataOntologyUsers["admin"] = &User{
			Username: "admin",
			Password: hashedPassword,
			ApiKey:   "dok_" + uuid.New().String(), // 自动生成 API Key
		}
		log.Println("已创建默认管理员账号: admin/admin1234")
		log.Printf("已自动生成 API Key: %s...", dataOntologyUsers["admin"].ApiKey[:12])

		// 保存初始数据
		dataOntologyMu.Unlock()
		if err := saveDataOntologyStore(); err != nil {
			log.Printf("保存初始数据失败: %v", err)
		}
		dataOntologyMu.Lock()
	} else {
		// 确保 admin 用户有 API Key
		if adminUser, ok := dataOntologyUsers["admin"]; ok && adminUser.ApiKey == "" {
			adminUser.ApiKey = "dok_" + uuid.New().String()
			log.Printf("已为 admin 用户生成 API Key: %s...", adminUser.ApiKey[:12])
			dataOntologyMu.Unlock()
			if err := saveDataOntologyStore(); err != nil {
				log.Printf("保存 API Key 失败: %v", err)
			}
			dataOntologyMu.Lock()
		}
	}
	
	// 设置默认 AI 配置（如果未配置）
	if dataOntologyAIConfig == nil {
		trueVal := true
		falseVal := false
		dataOntologyAIConfig = &AIConfig{
			URL:               "https://api.siliconflow.cn/v1",
			APIKey:            "", // 用户需要自行配置
			Model:             "Qwen/Qwen3-32B",
			Timeout:           120,
			EnableFunctionCall: &trueVal,
			EnableThinking:    &trueVal,
			EnableStreaming:   &trueVal,
			EnableJSONMode:    &falseVal,
		}
		log.Println("已设置默认 Agent 服务模型配置:")
		log.Printf("  URL: %s", dataOntologyAIConfig.URL)
		log.Printf("  Model: %s", dataOntologyAIConfig.Model)
		log.Println("  提示: 请在前端配置 API Key 后使用智能助手功能")
	}
	dataOntologyMu.Unlock()

	// 如果没有治理任务，创建示例任务
	dataOntologyMu.Lock()
	if len(governanceTasks) == 0 {
		now := time.Now().Format(time.RFC3339)

		// 示例1: 定时任务 - 数据库表统计
		scheduledID := uuid.New().String()
		governanceTasks[scheduledID] = &GovernanceTask{
			ID:          scheduledID,
			Owner:       "admin",
			Name:        "数据库表行数统计",
			Type:        "scheduled",
			Description: "查询所有表的行数，输出统计报告（需关联数据库）",
			JsCode:      "// 定时任务：统计数据库所有表的行数（支持 MySQL / 达梦等）\nconst dbType = gov.getDbType();\nlet tableList = [];\nif (dbType === 'dm') {\n  const rows = await gov.querySQL('SELECT TABLE_NAME FROM USER_TABLES');\n  tableList = rows.map(r => r.TABLE_NAME != null ? r.TABLE_NAME : r.table_name);\n} else {\n  const rows = await gov.querySQL('SHOW TABLES');\n  tableList = rows.map(r => Object.values(r)[0]);\n}\nconst q = (t) => { if (dbType === 'oracle') return '\"' + String(t).replace(/\"/g, '\"\"') + '\"'; if (dbType === 'dm') return String(t); if (dbType === 'mysql' || dbType === 'mariadb' || dbType === 'tidb') return '`' + String(t).replace(/`/g, '``') + '`'; return t; };\ngov.log('='.repeat(40));\ngov.log(`共 ${tableList.length} 张表`);\ngov.log('='.repeat(40));\nfor (const tableName of tableList) {\n  const result = await gov.querySQL(`SELECT COUNT(*) as cnt FROM ${q(tableName)}`);\n  const cnt = result && result[0] ? (result[0].cnt ?? result[0].CNT ?? 0) : 0;\n  gov.log(`  ${String(tableName).padEnd(30)} ${cnt} 行`);\n}\ngov.log('='.repeat(40));\ngov.log('统计完成');",
			CronExpr:    "0 2 * * *",
			Enabled:     false,
			CreatedAt:   now,
			Status:      "idle",
		}

		// 示例2: 交互任务 - Excel数据导入
		interactiveID := uuid.New().String()
		governanceTasks[interactiveID] = &GovernanceTask{
			ID:          interactiveID,
			Owner:       "admin",
			Name:        "Excel数据解析入库",
			Type:        "interactive",
			Description: "上传Excel文件，解析内容预览，可选入库",
			JsCode:      "// Excel 数据解析预览 + 入「当前关联的单个库」的指定表\n\nconst workbook = await gov.readExcel(INPUT_FILE);\nconst sheetName = workbook.SheetNames[0];\nconst data = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1 });\nconst headers = data[0];\nconst rows = data.slice(1);\n\ngov.log(`工作表: ${sheetName}`);\ngov.log(`总行数: ${rows.length}, 列数: ${headers.length}`);\ngov.log(`表头: ${headers.join(', ')}`);\n\ngov.log('\\n--- 数据预览 (前5行) ---');\nfor (let i = 0; i < Math.min(5, rows.length); i++) {\n    gov.log(`  行${i + 1}: ${rows[i].join(' | ')}`);\n}\n\n// 入当前任务关联的单个库的某张表（编辑任务时可选择关联数据库）\nconst tableName = 'your_table';\nconst insertCols = ['col1', 'col2', 'col3'];\nlet n = 0;\ntry {\n  for (let i = 0; i < rows.length; i++) {\n    const row = rows[i];\n    await gov.executeSQL(`INSERT INTO ${tableName} (${insertCols.join(',')}) VALUES (?,?,?)`, [row[0], row[1], row[2] ?? null]);\n    n++;\n  }\n  gov.log(`\\n入库完成: ${tableName} 写入 ${n} 行`);\n} catch (e) {\n  gov.log('\\n入库失败: ' + e.message);\n  gov.log('请编辑任务：1) 关联一个数据库 2) 修改上面 tableName、insertCols 与列数');\n}\n",
			InputType:   "file",
			AcceptExts:  []string{".xlsx", ".xls"},
			CreatedAt:   now,
			Status:      "idle",
		}

		// 示例3: 交互任务 - CSV文本解析
		textTaskID := uuid.New().String()
		governanceTasks[textTaskID] = &GovernanceTask{
			ID:          textTaskID,
			Owner:       "admin",
			Name:        "CSV文本解析",
			Type:        "interactive",
			Description: "输入CSV格式文本，解析并展示结构化结果",
			JsCode:      "// CSV 文本解析预览\n\nconst result = Papa.parse(INPUT_TEXT, { header: true });\n\ngov.log(`列数: ${result.meta.fields.length}`);\ngov.log(`表头: ${result.meta.fields.join(', ')}`);\ngov.log(`数据行数: ${result.data.length}`);\n\ngov.log('\\n--- 数据预览 (前5行) ---');\nfor (let i = 0; i < Math.min(5, result.data.length); i++) {\n    const row = result.data[i];\n    gov.log(`行 ${i + 1}: ${Object.values(row).join(' | ')}`);\n}\ngov.log(`\\n提示: 使用\"入库代码生成助手\"可快速生成入库代码`);",
			InputType:   "text",
			CreatedAt:   now,
			Status:      "idle",
		}

		// 示例4: 定时任务 - 数据完整性检查
		syncCheckID := uuid.New().String()
		governanceTasks[syncCheckID] = &GovernanceTask{
			ID:          syncCheckID,
			Owner:       "admin",
			Name:        "数据完整性检查",
			Type:        "scheduled",
			Description: "检查数据库表的空值情况（需关联数据库）",
			JsCode:      "// 定时任务：检查各表的数据完整性（支持 MySQL / 达梦等）\nconst dbType = gov.getDbType();\nlet tableList = [];\nif (dbType === 'dm') {\n  const rows = await gov.querySQL('SELECT TABLE_NAME FROM USER_TABLES');\n  tableList = rows.map(r => r.TABLE_NAME != null ? r.TABLE_NAME : r.table_name);\n} else {\n  const rows = await gov.querySQL('SHOW TABLES');\n  tableList = rows.map(r => Object.values(r)[0]);\n}\nconst q = (t) => { if (dbType === 'oracle') return '\"' + String(t).replace(/\"/g, '\"\"') + '\"'; if (dbType === 'dm') return String(t); if (dbType === 'mysql' || dbType === 'mariadb' || dbType === 'tidb') return '`' + String(t).replace(/`/g, '``') + '`'; return t; };\nconst now = new Date().toLocaleString();\ngov.log(`数据完整性检查报告 - ${now}`);\ngov.log('='.repeat(50));\nfor (const tableName of tableList) {\n  gov.log(`\\n[${tableName}]`);\n  let columns = [];\n  if (dbType === 'dm') {\n    const rows = await gov.querySQL(`SELECT COLUMN_NAME, NULLABLE FROM USER_TAB_COLUMNS WHERE TABLE_NAME = '${String(tableName).replace(/'/g, \"''\").toUpperCase()}' ORDER BY COLUMN_ID`);\n    columns = rows.map(r => ({ name: r.COLUMN_NAME ?? r.column_name, nullable: (r.NULLABLE ?? r.nullable) === 'Y' }));\n  } else {\n    const rows = await gov.querySQL(`SHOW COLUMNS FROM ${q(tableName)}`);\n    columns = rows.map(r => ({ name: r.Field, nullable: r.Null === 'YES' }));\n  }\n  const countResult = await gov.querySQL(`SELECT COUNT(*) as cnt FROM ${q(tableName)}`);\n  const totalCnt = countResult && countResult[0] ? (countResult[0].cnt ?? countResult[0].CNT ?? 0) : 0;\n  for (const col of columns) {\n    if (col.nullable) {\n      const colQ = q(col.name);\n      const nullResult = await gov.querySQL(`SELECT COUNT(*) as cnt FROM ${q(tableName)} WHERE ${colQ} IS NULL`);\n      const n = nullResult && nullResult[0] ? (nullResult[0].cnt ?? nullResult[0].CNT ?? 0) : 0;\n      if (n > 0) gov.log(`  ⚠ ${col.name}: ${n} 个空值`);\n    }\n  }\n  gov.log(`  总行数: ${totalCnt}, 列数: ${columns.length}`);\n}\ngov.log('='.repeat(50));\ngov.log('检查完成');",
			CronExpr:    "30 1 * * *",
			Enabled:     false,
			CreatedAt:   now,
			Status:      "idle",
		}

		// 示例5: 交互任务 - Word文档解析
		docTaskID := uuid.New().String()
		governanceTasks[docTaskID] = &GovernanceTask{
			ID:          docTaskID,
			Owner:       "admin",
			Name:        "Word文档内容提取",
			Type:        "interactive",
			Description: "上传Word，提取文本后经AI结构化并入库（AI使用「AI助手」的URL/API Key/模型）",
			JsCode:      "// 1. 读取 Word 得到非结构化文本\nconst result = await gov.readWord(INPUT_FILE);\nconst rawText = result.value || '';\ngov.log('Word 原文长度: ' + rawText.length + ' 字符');\nif (result.messages && result.messages.length > 0) {\n  result.messages.forEach(m => gov.log(`  ${m.type}: ${m.message}`));\n}\n\n// 2. 使用 AI（与 AI 助手相同的 API URL / API Key / Model）将非结构化文本整理为结构化数据\nconst prompt = `你是一个文本结构化助手。请将下面从 Word 文档提取的非结构化文本，整理为结构化数据。\n要求：只输出一个 JSON 数组，每项为对象，包含字段 title（标题）、summary（摘要）、content（对应段落或条目的正文）。若原文无明确标题/摘要，可据内容归纳。不要输出任何 markdown 或解释，仅输出 JSON 数组。\n\n原文：\n${rawText.slice(0, 6000)}`;\n\nlet structured = [];\ntry {\n  const aiText = await gov.callAI(prompt);\n  const jsonMatch = aiText.match(/\\[([\\s\\S]*)\\]/);\n  const jsonStr = jsonMatch ? '[' + jsonMatch[1] + ']' : aiText;\n  structured = JSON.parse(jsonStr);\n  gov.log('AI 结构化得到 ' + structured.length + ' 条');\n} catch (e) {\n  gov.log('AI 结构化失败: ' + e.message);\n  gov.log('原文前 500 字: ' + rawText.slice(0, 500));\n}\n\n// 3. 若关联了数据库，则写入表（请按实际表结构修改表名和列）\nconst tableName = 'doc_extracts';\nconst dbType = gov.getDbType();\nif (structured.length > 0 && dbType) {\n  let n = 0;\n  for (const row of structured) {\n    try {\n      await gov.executeSQL(\n        'INSERT INTO ' + tableName + ' (title, summary, content) VALUES (?, ?, ?)',\n        [row.title || '', row.summary || '', row.content || '']\n      );\n      n++;\n    } catch (e) {\n      gov.log('写入失败: ' + e.message);\n    }\n  }\ngov.log('入库完成: ' + tableName + ' 写入 ' + n + ' 条');\n} else if (structured.length > 0) {\n  gov.log('未关联数据库，仅展示结构化结果（关联数据库后可自动入库）');\n  structured.slice(0, 5).forEach((r, i) => gov.log(`  [${i+1}] ${(r.title || '').slice(0, 30)}`));\n}\ngov.log('文档处理完成');",
			InputType:   "file",
			AcceptExts:  []string{".docx"},
			ExampleFiles: []GovernanceExampleFile{
				{Name: "国际新闻与运输情况通报_模拟数据.docx", Path: "国际新闻与运输情况通报_模拟数据.docx"},
			},
			CreatedAt: now,
			Status:    "idle",
		}

		// 示例6: 交互任务 - 综合日报生成器（多文件一次执行 + JSON解析 + docxtemplater）
		reportTaskID := uuid.New().String()
		governanceTasks[reportTaskID] = &GovernanceTask{
			ID:            reportTaskID,
			Owner:         "admin",
			Name:          "综合日报生成器",
			Type:          "interactive",
			Description:   "上传综合日报 Word 模板 + 多份单位日报（.docx），按文件名解析日期与单位，JSON 结构化提取后生成综合日报",
			JsCode:        loadGovernanceAggregateDailyReportJS(),
			InputType:     "file",
			AcceptExts:    []string{".docx"},
			FileBatchMode: "single",
			ExampleFiles: []GovernanceExampleFile{
				{Name: "综合日报模板.docx", Path: "综合日报模板.docx"},
				{Name: "2024年4月12日单位A日报.docx", Path: "2024年4月12日单位A日报.docx"},
				{Name: "2024年4月12日单位B日报.docx", Path: "2024年4月12日单位B日报.docx"},
				{Name: "2024年4月12日单位C日报.docx", Path: "2024年4月12日单位C日报.docx"},
				{Name: "2024年4月12日单位D日报.docx", Path: "2024年4月12日单位D日报.docx"},
				{Name: "2024年4月12日单位E日报.docx", Path: "2024年4月12日单位E日报.docx"},
			},
			CreatedAt: now,
			Status:    "idle",
		}

		// 示例7: 交互任务 - 国际新闻入库
		newsTaskID := uuid.New().String()
		governanceTasks[newsTaskID] = &GovernanceTask{
			ID:          newsTaskID,
			Owner:       "admin",
			Name:        "国际新闻入库",
			Type:        "interactive",
			Description: "上传国际新闻与运输情况通报 Word 文档，提取结构化数据入库",
			JsCode: `* 国际新闻入库脚本 — DataToolbox Gov Task
 *
 * 三张表：
 *   1. intl_news        国际新闻动态  (新闻内码, 时间, 区域, 事件)
 *   2. transport_support 运输保障情况  (运保内码, 时间, 区域, 运输情况)
 *   3. dispatch_force    保障力量出动  (出动内码, 运保内码, 装备型号, 架次, 批次)
 *
 * 流程：原始新闻文本 → gov.callAI 分块结构化解析 → gov.executeSQL 批量入库
 * 数据库：达梦(DM)，绑定到任务即可使用
 */

// ============================================================
// 1. DDL — 达梦建表语句（在任务中执行一次即可）
// ============================================================

const DDL = [
    '-- 国际新闻动态',
    'CREATE TABLE IF NOT EXISTS intl_news (',
    '    news_id       VARCHAR(64)   NOT NULL,',
    '    news_time     TIMESTAMP,',
    '    region        VARCHAR(128),',
    '    event         TEXT,',
    '    PRIMARY KEY (news_id)',
    ');',
    '',
    '-- 运输保障情况',
    'CREATE TABLE IF NOT EXISTS transport_support (',
    '    support_id    VARCHAR(64)   NOT NULL,',
    '    support_time  TIMESTAMP,',
    '    region        VARCHAR(128),',
    '    transport_info TEXT,',
    '    PRIMARY KEY (support_id)',
    ');',
    '',
    '-- 保障力量出动情况',
    'CREATE TABLE IF NOT EXISTS dispatch_force (',
    '    dispatch_id   VARCHAR(64)   NOT NULL,',
    '    support_id    VARCHAR(64),',
    '    equip_model   VARCHAR(128),',
    '    sorties       INT,',
    '    batches       INT,',
    '    PRIMARY KEY (dispatch_id)',
    ');',
].join('\n');

// ============================================================
// 2. AI Prompt 模板
// ============================================================

/**
 * 核心 Prompt：要求 LLM 从新闻文本中提取三张表的结构化数据
 * 输出严格 JSON，方便后续直接解析入库
 */

const EXTRACT_PROMPT = [
    '',
    '要求：',
    '1. 提取所有新闻事件，每条事件包含：时间、区域、事件描述',
    '2. 提取所有运输保障相关信息，每条包含：时间、区域、运输情况描述',
    '3. 对每条运输保障，提取对应的保障力量出动信息：装备型号、架次、批次',
    '',
    '输出格式（严格遵守，不要输出任何其他内容）：',
    '{',
    '  "news": [',
    '    {',
    '      "news_id": "NWS_yyyyMMdd_HHmmss_序号",',
    '      "news_time": "2025-01-15 08:30:00",',
    '      "region": "某某区域",',
    '      "event": "事件描述"',
    '    }',
    '  ],',
    '  "transport_support": [',
    '    {',
    '      "support_id": "TRS_yyyyMMdd_HHmmss_序号",',
    '      "support_time": "2025-01-15 10:00:00",',
    '      "region": "某某区域",',
    '      "transport_info": "运输情况描述",',
    '      "dispatch_force": [',
    '        {',
    '          "dispatch_id": "DSP_yyyyMMdd_HHmmss_序号",',
    '          "equip_model": "运-20",',
    '          "sorties": 3,',
    '          "batches": 1',
    '        }',
    '      ]',
    '    }',
    '  ]',
    '}',
    '',
    '规则：',
    '- news_id 格式：NWS_时间戳_序号，时间取事件发生时间，序号从1开始',
    '- support_id 格式：TRS_时间戳_序号',
    '- dispatch_id 格式：DSP_时间戳_序号',
    '- 时间格式：yyyy-MM-dd HH:mm:ss，无法确定具体时间的用新闻发布时间',
    '- 如果某条新闻没有运输保障信息，transport_support 数组为空即可',
    '- dispatch_force 中的 support_id 必须与上层 transport_support 的 support_id 一致',
    '- sorties（架次）和 batches（批次）必须为整数，无法提取则为 null',
].join('\n');

/**
 * 分块 Prompt：当新闻文本过长时，先拆分为多个分块分别提取
 */

const CHUNK_EXTRACT_PROMPT = [
    '',
    '{base_prompt}',
    '',
].join('\n');

// ============================================================
// 3. 核心逻辑
// ============================================================

/**
 * 生成唯一 ID
 */
function generateId(prefix, index = 1) {
    const now = new Date();
    const ts = now.getFullYear().toString() +
        String(now.getMonth() + 1).padStart(2, '0') +
        String(now.getDate()).padStart(2, '0') +
        '_' +
        String(now.getHours()).padStart(2, '0') +
        String(now.getMinutes()).padStart(2, '0') +
        String(now.getSeconds()).padStart(2, '0');
    return prefix + '_' + ts + '_' + String(index).padStart(3, '0');
}

/**
 * 分块：将长文本拆分为多段
 * @param {string} text - 原始文本
 * @param {number} maxChars - 每块最大字符数（默认 3000，预留 prompt 空间）
 * @returns {string[]} 文本块数组
 */
function chunkText(text, maxChars = 3000) {
    if (text.length <= maxChars) return [text];

    const chunks = [];
    // 按段落分割，尽量在段落边界断开
    const paragraphs = text.split(/\\n+/);
    let current = '';

    for (const para of paragraphs) {
        if (current.length + para.length + 1 > maxChars && current.length > 0) {
            chunks.push(current.trim());
            current = '';
        }
        current += (current ? '\\n' : '') + para;
    }
    if (current.trim()) chunks.push(current.trim());

    // 如果某块仍然超长，强制截断
    return chunks.map(c => c.length > maxChars * 1.5 ? c.slice(0, maxChars * 1.5) : c);
}

/**
 * 从 AI 返回文本中解析 JSON（兼容 markdown 代码块包裹的情况）
 */
function parseAIResponse(text) {
    // 去掉可能的 markdown 代码块包裹
    const BACKTICK3 = String.fromCharCode(96,96,96);
    let cleaned = text.trim();
    if (cleaned.startsWith(BACKTICK3 + 'json')) {
        cleaned = cleaned.slice(7);
    } else if (cleaned.startsWith(BACKTICK3)) {
        cleaned = cleaned.slice(3);
    }
    if (cleaned.endsWith(BACKTICK3)) {
        cleaned = cleaned.slice(0, -3);
    }
    cleaned = cleaned.trim();

    try {
        return JSON.parse(cleaned);
    } catch (e) {
        // 尝试从文本中找到 JSON 对象
        const startIdx = cleaned.indexOf('{');
        const lastIdx = cleaned.lastIndexOf('}');
        if (startIdx >= 0 && lastIdx > startIdx) {
            const jsonStr = cleaned.slice(startIdx, lastIdx + 1);
            try {
                return JSON.parse(jsonStr);
            } catch (e2) {
        throw new Error('JSON 解析失败: ' + e2.message + '\\\\n原始文本: ' + cleaned.slice(0, 200));
            }
        }
        throw new Error('AI 返回内容中未找到有效 JSON: ' + cleaned.slice(0, 200));
    }
}

/**
 * 合并多个分块的提取结果，去重并修正 ID
 */
function mergeChunkResults(results) {
    const merged = { news: [], transport_support: [] };

    for (const result of results) {
        if (result.news) merged.news.push(...result.news);
        if (result.transport_support) {
            for (const ts of result.transport_support) {
                merged.transport_support.push(ts);
            }
        }
    }

    // 重新生成 ID 去重
    let newsIdx = 1;
    const idMap = {}; // old_id -> new_id 映射
    for (const item of merged.news) {
        const newId = generateId('NWS', newsIdx++);
        idMap[item.news_id] = newId;
        item.news_id = newId;
    }

    let supportIdx = 1;
    for (const ts of merged.transport_support) {
        const oldSupportId = ts.support_id;
        const newSupportId = generateId('TRS', supportIdx++);
        idMap[oldSupportId] = newSupportId;
        ts.support_id = newSupportId;

        if (ts.dispatch_force) {
            let dispatchIdx = 1;
            for (const df of ts.dispatch_force) {
                df.support_id = newSupportId; // 关联上层
                df.dispatch_id = generateId('DSP', dispatchIdx++);
            }
        }
    }

    return merged;
}

/**
 * 简单去重：按 (时间+区域+事件描述) 去重新闻
 */
function deduplicateNews(newsList) {
    const seen = new Set();
    return newsList.filter(item => {
        const key = (item.news_time + '|' + item.region + '|' + item.event).slice(0, 200);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

/**
 * 入库：将解析结果写入达梦数据库
 */
async function insertToDatabase(data) {
    const results = { news: 0, transport_support: 0, dispatch_force: 0, errors: [] };

    // 1. 入库国际新闻
    for (const item of data.news) {
        try {
            const sql = 'INSERT INTO intl_news (news_id, news_time, region, event) VALUES (?, ?, ?, ?)';
            const affected = await gov.executeSQL(sql, [
                item.news_id,
                item.news_time,
                item.region || '',
                item.event || ''
            ]);
            results.news += affected;
        } catch (e) {
            results.errors.push('新闻入库失败 [' + item.news_id + ']: ' + e.message);
            gov.log('⚠ 新闻入库失败 [' + item.news_id + ']: ' + e.message);
        }
    }

    // 2. 入库运输保障 + 保障力量出动
    for (const item of data.transport_support) {
        try {
            const sql = 'INSERT INTO transport_support (support_id, support_time, region, transport_info) VALUES (?, ?, ?, ?)';
            const affected = await gov.executeSQL(sql, [
                item.support_id,
                item.support_time,
                item.region || '',
                item.transport_info || ''
            ]);
            results.transport_support += affected;
        } catch (e) {
            results.errors.push('运保入库失败 [' + item.support_id + ']: ' + e.message);
            gov.log('⚠ 运保入库失败 [' + item.support_id + ']: ' + e.message);
            continue; // 运保失败则跳过对应的出动
        }

        // 3. 入库保障力量出动
        if (item.dispatch_force) {
            for (const df of item.dispatch_force) {
                try {
                    const sql = 'INSERT INTO dispatch_force (dispatch_id, support_id, equip_model, sorties, batches) VALUES (?, ?, ?, ?, ?)';
                    const affected = await gov.executeSQL(sql, [
                        df.dispatch_id,
                        df.support_id,
                        df.equip_model || '',
                        df.sorties != null ? df.sorties : 0,
                        df.batches != null ? df.batches : 0
                    ]);
                    results.dispatch_force += affected;
                } catch (e) {
            results.errors.push('动出入库失败 [' + df.dispatch_id + ']: ' + e.message);
                    gov.log('⚠ 动出入库失败 [' + df.dispatch_id + ']: ' + e.message);
                }
            }
        }
    }

    return results;
}

/**
 * 查询已有数据量（用于幂等判断）
 */
async function checkExistingData() {
    try {
        const newsCount = await gov.querySQL('SELECT COUNT(*) AS CNT FROM intl_news');
        const supportCount = await gov.querySQL('SELECT COUNT(*) AS CNT FROM transport_support');
        const dispatchCount = await gov.querySQL('SELECT COUNT(*) AS CNT FROM dispatch_force');
        return {
            news: newsCount[0]?.CNT || 0,
            transport_support: supportCount[0]?.CNT || 0,
            dispatch_force: dispatchCount[0]?.CNT || 0
        };
    } catch (e) {
        gov.log('查询已有数据失败（表可能不存在）: ' + e.message);
        return null;
    }
}

// ============================================================
// 4. 主入口
// ============================================================

/**
 * 主处理流程
 * INPUT_TEXT: 任务输入的原始新闻文本
 *
 * 使用方式：
 *   在 DataToolbox 数据治理任务中，粘贴新闻文本作为输入，
 *   关联达梦数据库，运行此脚本即可自动解析入库。
 */
async function main() {
    gov.log('=== 国际新闻入库流程启动 ===');

    // -- Step 0: 初始化数据库表 --
    try {
        // 达梦建表（IF NOT EXISTS 保证幂等）
        const ddlStatements = DDL.split(';').map(s => s.trim()).filter(s => s && !s.startsWith('--'));
        for (const stmt of ddlStatements) {
            if (stmt) {
                await gov.executeSQL(stmt);
            }
        }
        gov.log('✓ 数据库表初始化完成');
    } catch (e) {
        gov.log('⚠ 建表可能已存在，跳过: ' + e.message);
    }

    // -- Step 1: 获取输入 --
    const rawText = typeof INPUT_TEXT !== 'undefined' ? INPUT_TEXT : '';
    if (!rawText || rawText.trim().length === 0) {
        gov.log('✗ 未提供新闻文本输入（INPUT_TEXT 为空）');
        return;
    }
    gov.log('✓ 获取输入文本，共 ' + rawText.length + ' 字符');

    // -- Step 2: 分块 + AI 提取 --
    const chunks = chunkText(rawText);
    gov.log('✓ 文本分为 ' + chunks.length + ' 块进行处理');

    const extractResults = [];
    for (let i = 0; i < chunks.length; i++) {
        const chunkIndex = i + 1;
        gov.log('→ 正在处理第 ' + chunkIndex + '/' + chunks.length + ' 块...');

        let prompt;
        if (chunks.length === 1) {
            prompt = EXTRACT_PROMPT + '\\n\\n---\\n新闻文本：\\n' + chunks[i];
        } else {
            prompt = CHUNK_EXTRACT_PROMPT
                .replace('{chunk_index}', chunkIndex)
                .replace('{total_chunks}', chunks.length)
                .replace('{base_prompt}', EXTRACT_PROMPT)
                + '\\n\\n---\\n新闻文本：\\n' + chunks[i];
        }

        try {
            const aiResponse = await gov.callAI(prompt);
            const parsed = parseAIResponse(aiResponse);
            extractResults.push(parsed);
            gov.log('  ✓ 第 ' + chunkIndex + ' 块提取完成: ' + parsed.news?.length || 0 + ' 条新闻, ' + parsed.transport_support?.length || 0 + ' 条运保');
        } catch (e) {
            gov.log('  ✗ 第 ' + chunkIndex + ' 块 AI 提取失败: ' + e.message);
            // 继续下一块
        }
    }

    if (extractResults.length === 0) {
        gov.log('✗ 所有分块提取均失败，流程终止');
        return;
    }

    // -- Step 3: 合并结果 + 去重 --
    const merged = mergeChunkResults(extractResults);
    merged.news = deduplicateNews(merged.news);

    gov.log('✓ 合并后共: ' + merged.news.length + ' 条新闻, ' + merged.transport_support.length + ' 条运保');

    // 展示提取结果
    gov.showTable(merged.news.map(n => ({
        新闻内码: n.news_id,
        时间: n.news_time,
        区域: n.region,
        事件: n.event?.slice(0, 50) + '...'
    })));

    // -- Step 4: 入库 --
    gov.log('→ 开始入库...');
    const insertResult = await insertToDatabase(merged);

    gov.log('=== 入库结果 ===');
    gov.log('  国际新闻: ' + insertResult.news + ' 条');
    gov.log('  运输保障: ' + insertResult.transport_support + ' 条');
    gov.log('  保障力量出动: ' + insertResult.dispatch_force + ' 条');
    if (insertResult.errors.length > 0) {
        gov.log('  ⚠ 错误: ' + insertResult.errors.length + ' 条');
        insertResult.errors.forEach(e => gov.log('    - ' + e));
    }

    // -- Step 5: 验证 --
    const finalCount = await checkExistingData();
    if (finalCount) {
        gov.log('=== 数据库当前数据量 ===');
        gov.showTable([{
            国际新闻: finalCount.news,
            运输保障: finalCount.transport_support,
            保障力量出动: finalCount.dispatch_force
        }]);
    }

    gov.log('=== 国际新闻入库流程完成 ===');
}

// 执行
main().catch(e => {
    gov.log('✗ 流程异常: ' + e.message);`,
			InputType:     "file",
			AcceptExts:    []string{".docx"},
			FileBatchMode: "single",
			ExampleFiles: []GovernanceExampleFile{
				{Name: "19990101_国际新闻与运输情况通报_模拟数据.docx", Path: "19990101_国际新闻与运输情况通报_模拟数据.docx"},
				{Name: "19990102_国际新闻与运输情况通报_模拟数据.docx", Path: "19990102_国际新闻与运输情况通报_模拟数据.docx"},
				{Name: "19990103_国际新闻与运输情况通报_模拟数据.docx", Path: "19990103_国际新闻与运输情况通报_模拟数据.docx"},
			},
			CreatedAt: now,
			Status:    "idle",
		}

		log.Printf("已创建 %d 个示例治理任务", len(governanceTasks))

		dataOntologyMu.Unlock()
		if err := saveDataOntologyStore(); err != nil {
			log.Printf("保存示例治理任务失败: %v", err)
		}
		dataOntologyMu.Lock()
	}
	dataOntologyMu.Unlock()

	log.Printf("数据本体池初始化完成 - 用户数: %d, 数据库配置数: %d, 治理任务数: %d",
		len(dataOntologyUsers), len(dataOntologyDatabases), len(governanceTasks))

	initQualityAuditDB()

	// 进程重启后内存队列已清空，持久化仍为「运行中」的任务无法继续，需收尾以免状态与日志长期不一致
	reconcileStuckGovernanceRuns()

	// 启动治理任务 worker（后台执行器）
	go governanceWorker()

	// 启动治理任务调度器
	go governanceScheduler()
}

// 密码哈希 - 使用 bcrypt

func isBcryptHash(s string) bool {
	return strings.HasPrefix(s, "$2a$") || strings.HasPrefix(s, "$2b$") || strings.HasPrefix(s, "$2y$")
}

func hashPassword(password string) string {
	hash, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		// bcrypt 失败时回退到简单哈希（不应发生）
		log.Printf("bcrypt 哈希失败: %v", err)
		return ""
	}
	return string(hash)
}

// 验证密码 - 支持 bcrypt 和旧的 MD5 哈希（向后兼容）

func verifyPassword(password, hashedPassword string) bool {
	// 检查是否是 bcrypt 哈希（以 $2a$、$2b$ 或 $2y$ 开头）
	if strings.HasPrefix(hashedPassword, "$2a$") || strings.HasPrefix(hashedPassword, "$2b$") || strings.HasPrefix(hashedPassword, "$2y$") {
		err := bcrypt.CompareHashAndPassword([]byte(hashedPassword), []byte(password))
		return err == nil
	}
	// 旧的 MD5 哈希（向后兼容）- 已弃用，仅用于迁移
	return false
}

// safeErrorMessage 返回安全的错误消息，避免泄露敏感信息
// 对于数据库错误、连接错误等，返回通用消息；对于用户输入错误，返回具体提示

func safeErrorMessage(err error, defaultMsg string) string {
	if err == nil {
		return defaultMsg
	}
	errStr := err.Error()

	// 检测敏感关键词，返回通用错误消息
	sensitivePatterns := []string{
		"password", "passwd", "secret", "token", "key", "credential",
		"connection string", "dsn", "sql:", "driver:",
		"access denied", "authentication", "permission",
	}
	lowerErr := strings.ToLower(errStr)
	for _, pattern := range sensitivePatterns {
		if strings.Contains(lowerErr, pattern) {
			log.Printf("安全过滤错误消息: %s", errStr)
			return defaultMsg
		}
	}

	// 对于已知的安全错误类型，可以返回具体消息
	// 如：唯一约束冲突、外键约束等
	if strings.Contains(errStr, "UNIQUE constraint") ||
		strings.Contains(errStr, "duplicate key") ||
		strings.Contains(errStr, "already exists") {
		return "记录已存在"
	}
	if strings.Contains(errStr, "FOREIGN KEY constraint") ||
		strings.Contains(errStr, "foreign key") {
		return "关联数据不存在"
	}
	if strings.Contains(errStr, "NOT NULL constraint") ||
		strings.Contains(errStr, "cannot be null") {
		return "必填字段不能为空"
	}

	// 其他错误返回默认消息，但记录详细日志
	log.Printf("错误详情: %s", errStr)
	return defaultMsg
}

// 生成Token

func generateToken() string {
	return uuid.New().String()
}

// 构建数据库连接字符串

func getDataOntologyUserFromRequest(r *http.Request) (username string, ok bool) {
	// 内部调用：agent 通过 DataToolboxAPITool 调用，带 X-Internal-Call header
	if r.Header.Get("X-Internal-Call") == "datatoolbox-agent" {
		return "admin", true
	}
	authHeader := r.Header.Get("Authorization")
	if authHeader == "" {
		return "", false
	}
	token := strings.TrimSpace(strings.TrimPrefix(authHeader, "Bearer "))
	if token == "" {
		return "", false
	}
	dataOntologyMu.RLock()
	defer dataOntologyMu.RUnlock()
	for uname, user := range dataOntologyUsers {
		if userHasToken(user, token) || (user.ApiKey != "" && user.ApiKey == token) {
			return uname, true
		}
	}
	return "", false
}

// dataOntologyResourceVisible 非 admin 仅可见 Owner 与本人一致的资源；Owner 为空视为仅 admin 可见

func dataOntologyResourceVisible(owner, username string) bool {
	if username == "admin" {
		return true
	}
	return owner != "" && owner == username
}

// requireGovernanceTaskAccess 校验当前用户对治理任务的访问权，失败时写入 JSON 响应

func requireGovernanceTaskAccess(w http.ResponseWriter, r *http.Request, taskID string) (*GovernanceTask, string, bool) {
	username, ok := getDataOntologyUserFromRequest(r)
	if !ok {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "message": "未授权"})
		return nil, "", false
	}
	dataOntologyMu.RLock()
	task, exists := governanceTasks[taskID]
	dataOntologyMu.RUnlock()
	if !exists || !dataOntologyResourceVisible(task.Owner, username) {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "message": "任务不存在"})
		return nil, "", false
	}
	return task, username, true
}

const dataOntologyTokenTTL = 7 * 24 * time.Hour

// userHasToken 检查用户的 Tokens 列表、TokenEntries 或旧 Token 字段中是否包含指定 token

func userHasToken(user *User, token string) bool {
	now := time.Now().Unix()
	// 优先检查带时间戳的 TokenEntries，并过滤过期 token
	for _, entry := range user.TokenEntries {
		if entry.Token == token && now-entry.CreatedAt <= int64(dataOntologyTokenTTL.Seconds()) {
			return true
		}
	}
	// 兼容不带时间戳的 Tokens 列表
	for _, t := range user.Tokens {
		if t == token {
			return true
		}
	}
	// 向后兼容旧 Token 字段
	return user.Token == token
}

// 验证Token（同时支持登录Token和ApiKey）

func verifyToken(r *http.Request) bool {
	_, ok := getDataOntologyUserFromRequest(r)
	return ok
}

// 登录处理

func handleDataOntologyLogin(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	if r.Method != http.MethodPost {
		jsonError(w, "只支持POST请求", ErrCodeMethodNotAllowed)
		return
	}

	var loginReq struct {
		Username string `json:"username"`
		Password string `json:"password"`
	}

	if err := json.NewDecoder(r.Body).Decode(&loginReq); err != nil {
		jsonError(w, "请求格式错误", ErrCodeBadRequest)
		return
	}

	dataOntologyMu.Lock()
	defer dataOntologyMu.Unlock()

	user, exists := dataOntologyUsers[loginReq.Username]
	// 使用 verifyPassword 比较 bcrypt 哈希（bcrypt 每次生成不同的哈希，不能用 == 比较）
	if !exists || !verifyPassword(loginReq.Password, user.Password) {
		log.Printf("[Auth] 登录失败: username=%s, reason=%v", loginReq.Username, map[bool]string{true: "密码错误", false: "用户不存在"}[exists])
		jsonError(w, "用户名或密码错误", ErrCodeUnauthorized)
		return
	}

	// 生成新Token并立即持久化，避免重启后 token 丢失或偶发回退。
	token := generateToken()
	// 支持多 token：追加到 Tokens 列表和 TokenEntries，不覆盖旧 token
	user.Tokens = append(user.Tokens, token)
	user.TokenEntries = append(user.TokenEntries, TokenEntry{Token: token, CreatedAt: time.Now().Unix()})
	// 向后兼容：如果旧数据有 Token 字段，迁移到 Tokens 后清空
	if user.Token != "" {
		user.Tokens = append(user.Tokens, user.Token)
		user.Token = "" // 清空旧字段，避免重复
	}
	dataOntologyMu.Unlock()
	if err := saveDataOntologyStore(); err != nil {
		log.Printf("[Auth] 保存登录 token 失败: username=%s, err=%v", loginReq.Username, err)
	}
	dataOntologyMu.Lock()

	log.Printf("[Auth] 登录成功: username=%s", loginReq.Username)
	jsonSuccess(w, map[string]interface{}{"success": true, "token": token})
}

// handleApiKey 管理ApiKey（GET获取/POST生成/DELETE删除）

func handleApiKey(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	authHeader := r.Header.Get("Authorization")
	if authHeader == "" {
		apiUnauthorized(w, "未授权")
		return
	}
	loginToken := strings.TrimPrefix(authHeader, "Bearer ")

	dataOntologyMu.Lock()
	defer dataOntologyMu.Unlock()

	var currentUser *User
	for _, u := range dataOntologyUsers {
		if userHasToken(u, loginToken) {
			currentUser = u
			break
		}
	}
	if currentUser == nil {
		apiUnauthorized(w, "未授权")
		return
	}

	switch r.Method {
	case http.MethodGet:
		jsonSuccess(w, map[string]interface{}{"success": true, "api_key": currentUser.ApiKey})
	case http.MethodPost:
		var target *User = currentUser
		var body struct {
			Username string `json:"username"`
		}
		_ = json.NewDecoder(r.Body).Decode(&body)
		targetName := strings.TrimSpace(body.Username)
		log.Printf("[APIKey] POST body.Username=%q targetName=%q currentUser=%s", body.Username, targetName, currentUser.Username)
		if targetName != "" && currentUser.Username == "admin" {
			if u, ok := dataOntologyUsers[targetName]; ok && u != nil {
				target = u
				log.Printf("[APIKey] target switched to %s", target.Username)
			} else {
				log.Printf("[APIKey] user %q not found in map, keeping currentUser", targetName)
			}
		}
		target.ApiKey = "dok_" + uuid.New().String()
		dataOntologyMu.Unlock()
		saveDataOntologyStore()
		dataOntologyMu.Lock()
		log.Printf("[APIKey] 生成新API Key: user=%s", target.Username)
		jsonSuccess(w, map[string]interface{}{"success": true, "api_key": target.ApiKey})
	case http.MethodDelete:
		currentUser.ApiKey = ""
		dataOntologyMu.Unlock()
		saveDataOntologyStore()
		dataOntologyMu.Lock()
		log.Printf("[APIKey] 删除API Key: user=%s", currentUser.Username)
		jsonSuccess(w, map[string]interface{}{"success": true})
	default:
		apiMethodNotAllowed(w, "不支持的方法")
	}
}

// handleUserSettings 管理用户设置（GET获取/POST保存）

func handleUserSettings(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	authHeader := r.Header.Get("Authorization")
	if authHeader == "" {
		apiUnauthorized(w, "未授权")
		return
	}
	loginToken := strings.TrimPrefix(authHeader, "Bearer ")

	dataOntologyMu.Lock()
	defer dataOntologyMu.Unlock()

	var currentUser *User
	for _, u := range dataOntologyUsers {
		if userHasToken(u, loginToken) {
			currentUser = u
			break
		}
	}
	if currentUser == nil {
		apiUnauthorized(w, "未授权")
		return
	}

	switch r.Method {
	case http.MethodGet:
		settings := currentUser.Settings
		if settings == nil {
			settings = map[string]interface{}{}
		}
		// 设置默认值（如果用户没有设置过）
		if _, ok := settings["embedMode"]; !ok {
			settings["embedMode"] = true
		}
		if _, ok := settings["tabVisibility"]; !ok {
			settings["tabVisibility"] = map[string]interface{}{
				"database":   true,
				"governance": true,
				"api":        true,
				"ai":         true,
				"ontology":   false,
				"lineage":    false,
				"mcp":        false,
				"models":     false,
				"quality":    false,
			}
		}
		if _, ok := settings["tabOrder"]; !ok {
			settings["tabOrder"] = []string{"database", "governance", "api", "ai", "ontology", "lineage", "mcp", "models", "quality"}
		}
		if _, ok := settings["tabNames"]; !ok {
			settings["tabNames"] = map[string]interface{}{}
		}
		if _, ok := settings["govTaskOrder"]; !ok {
			settings["govTaskOrder"] = []string{}
		}
		jsonSuccess(w, map[string]interface{}{"success": true, "settings": settings})
	case http.MethodPost:
		var body map[string]interface{}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			apiBadRequest(w, "无效的请求体")
			return
		}
		// 直接用 body 替换设置，避免嵌套
		currentUser.Settings = body
		dataOntologyMu.Unlock()
		saveDataOntologyStore()
		dataOntologyMu.Lock()
		log.Printf("[Settings] 保存用户设置: user=%s", currentUser.Username)
		jsonSuccess(w, map[string]interface{}{"success": true})
	default:
		apiMethodNotAllowed(w, "不支持的方法")
	}
}

// requireDataOntologyAdmin 当前用户须为 admin

func requireDataOntologyAdmin(w http.ResponseWriter, r *http.Request) (string, bool) {
	u, ok := getDataOntologyUserFromRequest(r)
	if !ok {
		apiUnauthorized(w, "未授权")
		return "", false
	}
	if u != "admin" {
		apiForbidden(w, "需要管理员权限")
		return "", false
	}
	return u, true
}

// UserPublic 用户列表展示（不含密码）

type UserPublic struct {
	Username string `json:"username"`
	ApiKey   string `json:"api_key,omitempty"`
}

// handleDataOntologyUsers GET 列出用户 / POST 创建用户（仅 admin）

func handleDataOntologyUsers(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	switch r.Method {
	case http.MethodGet:
		if _, ok := requireDataOntologyAdmin(w, r); !ok {
			return
		}
		dataOntologyMu.RLock()
		list := make([]UserPublic, 0, len(dataOntologyUsers))
		for name, u := range dataOntologyUsers {
			if u == nil {
				continue
			}
			apiKey := ""
			if u.ApiKey != "" {
				apiKey = u.ApiKey
			}
			list = append(list, UserPublic{Username: name, ApiKey: apiKey})
		}
		dataOntologyMu.RUnlock()
		sort.Slice(list, func(i, j int) bool { return list[i].Username < list[j].Username })
		json.NewEncoder(w).Encode(map[string]interface{}{"success": true, "users": list})

	case http.MethodPost:
		if _, ok := requireDataOntologyAdmin(w, r); !ok {
			return
		}
		var body struct {
			Username string `json:"username"`
			Password string `json:"password"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "message": "请求格式错误"})
			return
		}
		name := strings.TrimSpace(body.Username)
		if name == "" || body.Password == "" {
			json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "message": "用户名和密码不能为空"})
			return
		}
		dataOntologyMu.Lock()
		if _, exists := dataOntologyUsers[name]; exists {
			dataOntologyMu.Unlock()
			json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "message": "用户名已存在"})
			return
		}
		dataOntologyUsers[name] = &User{
			Username: name,
			Password: hashPassword(body.Password),
		}
		dataOntologyMu.Unlock()
		if err := saveDataOntologyStore(); err != nil {
			log.Printf("保存用户失败: %v", err)
		}
		json.NewEncoder(w).Encode(map[string]interface{}{"success": true})

	default:
		json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "message": "不支持的方法"})
	}
}

// handleDataOntologyUsersBatch POST /api/users/batch 批量创建用户（仅 admin）

func handleDataOntologyUsersBatch(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	if r.Method != http.MethodPost {
		json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "message": "不支持的方法"})
		return
	}

	if _, ok := requireDataOntologyAdmin(w, r); !ok {
		return
	}

	var body struct {
		Users []struct {
			Username string `json:"username"`
			Password string `json:"password"`
		} `json:"users"`
	}

	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "message": "请求格式错误"})
		return
	}

	if len(body.Users) == 0 {
		json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "message": "用户列表不能为空"})
		return
	}

	type ResultItem struct {
		Username string `json:"username"`
		Success  bool   `json:"success"`
		Message  string `json:"message,omitempty"`
	}

	var successList []ResultItem
	var failList []ResultItem

	dataOntologyMu.Lock()
	for _, user := range body.Users {
		name := strings.TrimSpace(user.Username)
		pwd := strings.TrimSpace(user.Password)

		if name == "" {
			failList = append(failList, ResultItem{
				Username: user.Username,
				Success:  false,
				Message:  "用户名不能为空",
			})
			continue
		}

		if pwd == "" {
			failList = append(failList, ResultItem{
				Username: name,
				Success:  false,
				Message:  "密码不能为空",
			})
			continue
		}

		if _, exists := dataOntologyUsers[name]; exists {
			failList = append(failList, ResultItem{
				Username: name,
				Success:  false,
				Message:  "用户名已存在",
			})
			continue
		}

		dataOntologyUsers[name] = &User{
			Username: name,
			Password: hashPassword(pwd),
		}
		successList = append(successList, ResultItem{
			Username: name,
			Success:  true,
		})
	}
	dataOntologyMu.Unlock()

	if err := saveDataOntologyStore(); err != nil {
		log.Printf("保存用户失败: %v", err)
	}

	json.NewEncoder(w).Encode(map[string]interface{}{
		"success":       true,
		"total":         len(body.Users),
		"success_count": len(successList),
		"fail_count":    len(failList),
		"success_list":  successList,
		"fail_list":     failList,
	})
}

// handleDataOntologyUsersDetail DELETE /users/{username} / PUT /users/{username}/password

func handleDataOntologyUsersDetail(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	base := "/api/v1/system/users/"
	if !strings.HasPrefix(r.URL.Path, base) {
		http.NotFound(w, r)
		return
	}
	rest := strings.TrimPrefix(r.URL.Path, base)
	rest = strings.TrimSuffix(rest, "/")
	if rest == "" {
		json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "message": "无效路径"})
		return
	}
	parts := strings.Split(rest, "/")
	targetName := parts[0]
	if u, err := url.PathUnescape(targetName); err == nil && u != "" {
		targetName = u
	}

	if len(parts) == 1 {
		if r.Method != http.MethodDelete {
			json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "message": "不支持的方法"})
			return
		}
		if _, ok := requireDataOntologyAdmin(w, r); !ok {
			return
		}
		if targetName == "admin" {
			json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "message": "不能删除管理员账号"})
			return
		}
		dataOntologyMu.Lock()
		if _, exists := dataOntologyUsers[targetName]; !exists {
			dataOntologyMu.Unlock()
			json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "message": "用户不存在"})
			return
		}
		delete(dataOntologyUsers, targetName)
		dataOntologyMu.Unlock()
		if err := saveDataOntologyStore(); err != nil {
			log.Printf("保存用户失败: %v", err)
		}
		json.NewEncoder(w).Encode(map[string]interface{}{"success": true})
		return
	}

	if len(parts) == 2 && parts[1] == "password" && r.Method == http.MethodPut {
		caller, ok := getDataOntologyUserFromRequest(r)
		if !ok {
			apiUnauthorized(w, "未授权")
			return
		}
		if caller != "admin" && caller != targetName {
			apiForbidden(w, "只能修改自己的密码")
			return
		}
		var body struct {
			Password string `json:"password"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			apiBadRequest(w, "请求格式错误")
			return
		}
		if strings.TrimSpace(body.Password) == "" {
			apiInvalidInput(w, "密码不能为空")
			return
		}
		dataOntologyMu.Lock()
		user, exists := dataOntologyUsers[targetName]
		if !exists || user == nil {
			dataOntologyMu.Unlock()
			apiNotFound(w, "用户不存在")
			return
		}
		user.Password = hashPassword(body.Password)
		dataOntologyMu.Unlock()
		if err := saveDataOntologyStore(); err != nil {
			log.Printf("[User] 保存用户密码失败: user=%s, err=%v", targetName, err)
		}
		log.Printf("[User] 密码已更新: user=%s, by=%s", targetName, caller)
		jsonSuccess(w, map[string]interface{}{"success": true})
		return
	}

	apiNotFound(w, "无效路径")
}

// handleMCPConfig MCP 总开关：GET 返回当前状态，PUT 更新（需授权）

func handleMCPConfig(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	if !verifyToken(r) {
		apiUnauthorized(w, "未授权")
		return
	}
	switch r.Method {
	case http.MethodGet:
		dataOntologyMu.RLock()
		enabled := dataOntologyMCPEnabled == nil || *dataOntologyMCPEnabled
		port := dataOntologyMCPPort
		dataOntologyMu.RUnlock()
		jsonSuccess(w, map[string]interface{}{"success": true, "enabled": enabled, "port": port})
	case http.MethodPut:
		var body struct {
			Enabled *bool `json:"enabled"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			apiBadRequest(w, "请求格式错误")
			return
		}
		dataOntologyMu.Lock()
		dataOntologyMCPEnabled = body.Enabled
		dataOntologyMu.Unlock()
		if err := saveDataOntologyStore(); err != nil {
			log.Printf("[MCP] 保存配置失败: err=%v", err)
		}
		enabled := dataOntologyMCPEnabled == nil || *dataOntologyMCPEnabled
		log.Printf("[MCP] 配置已更新: enabled=%v", enabled)
		jsonSuccess(w, map[string]interface{}{"success": true, "enabled": enabled})
	default:
		apiMethodNotAllowed(w)
	}
}

// handleSkillsExport 技能导出：根据类型生成不同 AI 平台的技能配置
// generateDataToolboxSkill 生成 DataToolbox MCP 使用指南 skill

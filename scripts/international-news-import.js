// 国际新闻入库脚本 — DataToolbox Gov Task
// 
// 三张表：
//   1. intl_news        国际新闻动态  (新闻内码, 时间, 区域, 事件)
//   2. transport_support 运输保障情况  (运保内码, 时间, 区域, 运输情况)
//   3. dispatch_force    保障力量出动  (出动内码, 运保内码, 装备型号, 架次, 批次)
// 
// 流程：原始新闻文本 → gov.callAI 分块结构化解析 → gov.executeSQL 批量入库
// 数据库：达梦(DM)，绑定到任务即可使用

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

// 核心 Prompt：要求 LLM 从新闻文本中提取三张表的结构化数据，输出严格 JSON
const EXTRACT_PROMPT = [
    '从下文提取结构化数据，严格输出JSON（不要输出其他内容）。',
    '',
    '提取：1.新闻事件(时间/区域/事件) 2.运输保障(时间/区域/情况) 3.保障力量出动(装备型号/架次/批次)',
    '',
    '格式：',
    '{"news":[{"news_id":"NWS_yyyyMMdd_HHmmss_序号","news_time":"yyyy-MM-dd HH:mm:ss","region":"区域","event":"事件"}],"transport_support":[{"support_id":"TRS_yyyyMMdd_HHmmss_序号","support_time":"yyyy-MM-dd HH:mm:ss","region":"区域","transport_info":"情况","dispatch_force":[{"dispatch_id":"DSP_yyyyMMdd_HHmmss_序号","support_id":"同上层support_id","equip_model":"型号","sorties":1,"batches":1}]}]}',
    '',
    '规则：时间格式yyyy-MM-dd HH:mm:ss；无运保则transport_support为空数组；sorties/batches为整数或null',
].join('\\n');

// 分块 Prompt：当新闻文本过长时，先拆分为多个分块分别提取
const CHUNK_EXTRACT_PROMPT = [
    '',
    '{base_prompt}',
    '',
].join('\n');

// ============================================================
// 3. 核心逻辑
// ============================================================

// 生成唯一 ID
function generateId(prefix, index = 1) {
    const now = new Date();
    const ts = now.getFullYear().toString() +
        String(now.getMonth() + 1).padStart(2, '0') +
        String(now.getDate()).padStart(2, '0') +
        '_'+
        String(now.getHours()).padStart(2, '0') +
        String(now.getMinutes()).padStart(2, '0') +
        String(now.getSeconds()).padStart(2, '0');
    return prefix + '_' + ts + '_' + String(index).padStart(3, '0');
}

// 分块：将长文本拆分为多段
// @param {string} text - 原始文本
// @param {number} maxChars - 每块最大字符数（默认 3000，预留 prompt 空间）
// @returns {string[]} 文本块数组
function chunkText(text, maxChars = 1500) {
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

// 从 AI 返回文本中解析 JSON（兼容 markdown 代码块包裹的情况，支持修复不完整 JSON）
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

    // 尝试直接解析
    try {
        return JSON.parse(cleaned);
    } catch (e) {
        // 尝试从文本中找到 JSON 对象
        const startIdx = cleaned.indexOf('{');
        const lastIdx = cleaned.lastIndexOf('}');
        if (startIdx >= 0 && lastIdx > startIdx) {
            let jsonStr = cleaned.slice(startIdx, lastIdx + 1);

            // 尝试修复不完整的 JSON
            jsonStr = repairJSON(jsonStr);

            try {
                return JSON.parse(jsonStr);
            } catch (e2) {
                throw new Error('JSON 解析失败: ' + e2.message + '\\n原始文本: ' + cleaned.slice(0, 200));
            }
        }
        throw new Error('AI 返回内容中未找到有效 JSON: ' + cleaned.slice(0, 200));
    }
}

// 修复不完整的 JSON（补全括号、引号等）
function repairJSON(jsonStr) {
    let repaired = jsonStr;

    // 统计括号数量
    const countChar = (str, char) => (str.match(new RegExp('\\' + char, 'g')) || []).length;
    const openBraces = countChar(repaired, '{');
    const closeBraces = countChar(repaired, '}');
    const openBrackets = countChar(repaired, '[');
    const closeBrackets = countChar(repaired, ']');

    // 补全缺失的闭合括号
    if (openBraces > closeBraces) {
        repaired += '}'.repeat(openBraces - closeBraces);
    }
    if (openBrackets > closeBrackets) {
        repaired += ']'.repeat(openBrackets - closeBrackets);
    }

    // 如果 JSON 被截断在字符串中间，尝试闭合字符串
    // 查找最后一个未闭合的引号
    const lastQuote = repaired.lastIndexOf('"');
    if (lastQuote >= 0) {
        // 检查这个引号是否闭合
        const beforeLastQuote = repaired.slice(0, lastQuote);
        const quoteCount = countChar(beforeLastQuote, '"');
        if (quoteCount % 2 === 1) {
            // 奇数个引号，说明最后一个字符串未闭合
            // 在最后一个引号后添加闭合引号
            repaired = repaired.slice(0, lastQuote + 1) + '"' + repaired.slice(lastQuote + 1);
        }
    }

    return repaired;
}

// 合并多个分块的提取结果，去重并修正 ID
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

// 简单去重：按 (时间+区域+事件描述) 去重新闻
function deduplicateNews(newsList) {
    const seen = new Set();
    return newsList.filter(item => {
        const key = (item.news_time + '|' + item.region + '|' + item.event).slice(0, 200);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

// 入库：将解析结果写入达梦数据库
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

// 查询已有数据量（用于幂等判断）
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

// 处理单个文件：读取 → AI提取 → 显示表格 → 入库
async function processFile(file, fileIndex, totalFiles) {
    gov.log('\\n' + '='.repeat(60));
    gov.log('处理文件 [' + fileIndex + '/' + totalFiles + ']: ' + file.name);
    gov.log('='.repeat(60));

    // Step 1: 读取文件
    gov.log('→ 正在读取 Word 文件...');
    let rawText = '';
    try {
        // 如果是虚拟文件（文本输入模式），直接使用内容
        if (file.content) {
            rawText = file.content;
        } else {
            const result = await gov.readWord(file);
            rawText = result.value || '';
        }
        if (!rawText.trim()) {
            gov.log('⚠ 文件内容为空，跳过此文件');
            return null;
        }
        gov.log('✓ 文件读取成功，共 ' + rawText.length + ' 字符');
    } catch (e) {
        gov.log('✗ 文件读取失败: ' + e.message);
        return null;
    }

    // Step 2: 分块 + AI 提取
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

        const maxRetries = 2;
        let aiResponse = null;
        let lastError = null;
        for (let retry = 0; retry <= maxRetries; retry++) {
            try {
                if (retry > 0) {
                    gov.log('  ↻ 第 ' + chunkIndex + ' 块重试第 ' + retry + ' 次...');
                }
                aiResponse = await gov.callAI(prompt);
                break; // 成功则跳出
            } catch (e) {
                lastError = e;
                gov.log('  ⚠ AI调用失败（第 ' + (retry + 1) + ' 次）: ' + e.message);
                if (retry < maxRetries) {
                    gov.log('  等待 5 秒后重试...');
                    await new Promise(r => setTimeout(r, 5000));
                }
            }
        }
        if (aiResponse === null) {
            gov.log('  ✗ 第 ' + chunkIndex + ' 块 AI 提取失败（已重试 ' + maxRetries + ' 次）: ' + (lastError ? lastError.message : 'unknown'));
            continue; // 继续下一块
        }

        try {
            const parsed = parseAIResponse(aiResponse);
            extractResults.push(parsed);
            gov.log('  ✓ 第 ' + chunkIndex + ' 块提取完成: ' + (parsed.news?.length || 0) + ' 条新闻, ' + (parsed.transport_support?.length || 0) + ' 条运保');
        } catch (e) {
            gov.log('  ✗ 第 ' + chunkIndex + ' 块 JSON 解析失败: ' + e.message);
            gov.log('  AI 返回内容（前 500 字符）: ' + aiResponse.slice(0, 500));
        }
    }

    if (extractResults.length === 0) {
        gov.log('✗ 所有分块提取均失败，跳过此文件');
        return null;
    }

    // Step 3: 合并结果 + 去重
    const merged = mergeChunkResults(extractResults);
    merged.news = deduplicateNews(merged.news);

    gov.log('✓ 合并后共: ' + merged.news.length + ' 条新闻, ' + merged.transport_support.length + ' 条运保');

    // Step 4: 显示三张表
    gov.log('\\n--- 国际新闻表 ---');
    if (merged.news.length > 0) {
        gov.showTable(merged.news.map(n => ({
            新闻内码: n.news_id,
            时间: n.news_time,
            区域: n.region,
            事件: n.event?.length > 50 ? n.event.slice(0, 50) + '...' : n.event
        })));
    } else {
        gov.log('（无数据）');
    }

    gov.log('\\n--- 运输保障表 ---');
    if (merged.transport_support.length > 0) {
        gov.showTable(merged.transport_support.map(ts => ({
            运保内码: ts.support_id,
            时间: ts.support_time,
            区域: ts.region,
            运输情况: ts.transport_info?.length > 50 ? ts.transport_info.slice(0, 50) + '...' : ts.transport_info
        })));
    } else {
        gov.log('（无数据）');
    }

    gov.log('\\n--- 保障力量出动表 ---');
    const allDispatch = [];
    for (const ts of merged.transport_support) {
        if (ts.dispatch_force) {
            allDispatch.push(...ts.dispatch_force);
        }
    }
    if (allDispatch.length > 0) {
        gov.showTable(allDispatch.map(df => ({
            出动内码: df.dispatch_id,
            运保内码: df.support_id,
            装备型号: df.equip_model,
            架次: df.sorties,
            批次: df.batches
        })));
    } else {
        gov.log('（无数据）');
    }

    // Step 5: 入库
    gov.log('\\n→ 开始入库...');
    const insertResult = await insertToDatabase(merged);

    gov.log('=== 入库结果 ===');
    gov.log('  国际新闻: ' + insertResult.news + ' 条');
    gov.log('  运输保障: ' + insertResult.transport_support + ' 条');
    gov.log('  保障力量出动: ' + insertResult.dispatch_force + ' 条');
    if (insertResult.errors.length > 0) {
        gov.log('  ⚠ 错误: ' + insertResult.errors.length + ' 条');
        insertResult.errors.forEach(e => gov.log('    - ' + e));
    }

    return insertResult;
}

// 主处理流程
// INPUT_TEXT: 任务输入的原始新闻文本
// 使用方式：
// 在 DataToolbox 数据治理任务中，粘贴新闻文本作为输入，
// 关联达梦数据库，运行此脚本即可自动解析入库。
// 直接执行（顶层代码，不用函数包裹，避免 Bun AsyncFunction 构造器中 await 挂起）
try {
    gov.log('=== 国际新闻入库流程启动 ===');

    // -- Step 0: 初始化数据库表 --
    try {
        // 达梦建表（IF NOT EXISTS 保证幂等）
        // 按分号分割，去掉注释行，再重新组合
        const ddlStatements = DDL.split(';')
            .map(s => s.trim())
            .filter(s => s)
            .map(s => {
                // 去掉开头的注释行
                const lines = s.split('\\n').filter(l => !l.trim().startsWith('--'));
                return lines.join('\\n').trim();
            })
            .filter(s => s);
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
    let rawText = '';

    // 优先使用文件输入模式（每个文件单独处理）
    if (typeof INPUT_FILES !== 'undefined' && INPUT_FILES && INPUT_FILES.length > 0) {
        gov.log('✓ 检测到文件输入模式，共 ' + INPUT_FILES.length + ' 个文件');

        const totalResults = { news: 0, transport_support: 0, dispatch_force: 0, errors: [] };

        for (let i = 0; i < INPUT_FILES.length; i++) {
            const result = await processFile(INPUT_FILES[i], i + 1, INPUT_FILES.length);
            if (result) {
                totalResults.news += result.news;
                totalResults.transport_support += result.transport_support;
                totalResults.dispatch_force += result.dispatch_force;
                totalResults.errors.push(...result.errors);
            }
        }

        gov.log('\\n' + '='.repeat(60));
        gov.log('=== 所有文件处理完成 ===');
        gov.log('总计入库：');
        gov.log('  国际新闻: ' + totalResults.news + ' 条');
        gov.log('  运输保障: ' + totalResults.transport_support + ' 条');
        gov.log('  保障力量出动: ' + totalResults.dispatch_force + ' 条');
        if (totalResults.errors.length > 0) {
            gov.log('  ⚠ 总错误: ' + totalResults.errors.length + ' 条');
        }

    } else if (typeof INPUT_TEXT !== 'undefined' && INPUT_TEXT && INPUT_TEXT.trim()) {
        // 回退到文本输入模式
        rawText = INPUT_TEXT;
        gov.log('✓ 使用文本输入模式，共 ' + rawText.length + ' 字符');

        // 创建一个虚拟文件对象
        const virtualFile = { name: 'INPUT_TEXT', content: rawText };
        await processFile(virtualFile, 1, 1);

    } else {
        gov.log('✗ 未提供有效输入（INPUT_FILES 或 INPUT_TEXT 均为空）');
    }

    // -- 最终验证 --
    const finalCount = await checkExistingData();
    if (finalCount) {
        gov.log('\\n=== 数据库当前数据量 ===');
        gov.showTable([{
            国际新闻: finalCount.news,
            运输保障: finalCount.transport_support,
            保障力量出动: finalCount.dispatch_force
        }]);
    }

    gov.log('\\n=== 国际新闻入库流程完成 ===');
} catch (e) {
    gov.log('✗ 流程异常: ' + e.message);
}
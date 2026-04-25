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
    '-- 国际新闻动态表',
    'CREATE TABLE IF NOT EXISTS intl_news (',
    '    news_id       VARCHAR(64)   NOT NULL,',
    '    news_time     TIMESTAMP,',
    '    region        VARCHAR(128),',
    '    event         TEXT,',
    '    PRIMARY KEY (news_id)',
    ');',
    '',
    '-- 运输保障情况表',
    'CREATE TABLE IF NOT EXISTS transport_support (',
    '    support_id    VARCHAR(64)   NOT NULL,',
    '    support_time  TIMESTAMP,',
    '    region        VARCHAR(128),',
    '    transport_info TEXT,',
    '    PRIMARY KEY (support_id)',
    ');',
    '',
    '-- 保障力量出动情况表',
    'CREATE TABLE IF NOT EXISTS dispatch_force (',
    '    dispatch_id   VARCHAR(64)   NOT NULL,',
    '    support_id    VARCHAR(64),',
    '    equip_model   VARCHAR(128),',
    '    sorties       INT,',
    '    batches       INT,',
    '    PRIMARY KEY (dispatch_id)',
    ');',
].join('\n');

// 达梦数据库 COMMENT 语句（表注释 + 字段注释）
const COMMENT_DDL = [
    "COMMENT ON TABLE intl_news IS '国际新闻动态表';",
    "COMMENT ON COLUMN intl_news.news_id IS '新闻内码';",
    "COMMENT ON COLUMN intl_news.news_time IS '时间';",
    "COMMENT ON COLUMN intl_news.region IS '区域';",
    "COMMENT ON COLUMN intl_news.event IS '事件';",
    "COMMENT ON TABLE transport_support IS '运输保障情况表';",
    "COMMENT ON COLUMN transport_support.support_id IS '运保内码';",
    "COMMENT ON COLUMN transport_support.support_time IS '时间';",
    "COMMENT ON COLUMN transport_support.region IS '区域';",
    "COMMENT ON COLUMN transport_support.transport_info IS '运输情况';",
    "COMMENT ON TABLE dispatch_force IS '保障力量出动表';",
    "COMMENT ON COLUMN dispatch_force.dispatch_id IS '出动内码';",
    "COMMENT ON COLUMN dispatch_force.support_id IS '运保内码';",
    "COMMENT ON COLUMN dispatch_force.equip_model IS '装备型号';",
    "COMMENT ON COLUMN dispatch_force.sorties IS '架次';",
    "COMMENT ON COLUMN dispatch_force.batches IS '批次';",
].join(';\n');

// ============================================================
// 2. AI Prompt 模板
// ============================================================

// Prompt 1: 提取国际新闻动态（从"一、"部分）
const EXTRACT_NEWS_PROMPT = [
    '从下文提取国际新闻动态数据，严格输出JSON（不要输出其他内容）。',
    '',
    '提取字段：新闻内码、时间、区域、事件',
    '',
    '格式：',
    '{"news":[{"news_id":"NWS_yyyyMMdd_HHmmss_序号","news_time":"yyyy-MM-dd HH:mm:ss","region":"区域","event":"事件"}]}',
    '',
    '规则：',
    '1. 时间格式 yyyy-MM-dd HH:mm:ss',
    '2. news_id 按格式自动生成',
    '3. 如果没有新闻数据，返回 {"news":[]}',
].join('\\n');

// Prompt 2: 提取运输保障情况（从"二、"部分）
const EXTRACT_TRANSPORT_PROMPT = [
    '从下文提取运输保障情况数据，严格输出JSON（不要输出其他内容）。',
    '',
    '提取字段：运保内码、时间、区域、运输情况',
    '',
    '格式：',
    '{"transport_support":[{"support_id":"TRS_yyyyMMdd_HHmmss_序号","support_time":"yyyy-MM-dd HH:mm:ss","region":"区域","transport_info":"运输情况"}]}',
    '',
    '规则：',
    '1. 时间格式 yyyy-MM-dd HH:mm:ss',
    '2. support_id 按格式自动生成',
    '3. 如果没有运输保障数据，返回 {"transport_support":[]}',
].join('\\n');

// Prompt 3: 从运输保障信息中提取保障力量出动
const EXTRACT_DISPATCH_PROMPT = [
    '从下文运输保障信息中提取保障力量出动数据，严格输出JSON（不要输出其他内容）。',
    '',
    '提取字段：出动内码、运保内码、装备型号、架次、批次',
    '',
    '格式：',
    '{"dispatch_force":[{"dispatch_id":"DSP_yyyyMMdd_HHmmss_序号","support_id":"提供的运保内码","equip_model":"装备型号","sorties":1,"batches":1}]}',
    '',
    '规则：',
    '1. dispatch_id 按格式自动生成',
    '2. support_id 必须使用提供的运保内码',
    '3. sorties 和 batches 为整数或 null',
    '4. 如果没有出动数据，返回 {"dispatch_force":[]}',
].join('\\n');

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

// 分割文档：按"一、"和"二、"分割内容
// @param {string} text - 原始文档文本
// @returns {object} { newsSection: '一、部分内容', transportSection: '二、部分内容' }
function splitDocument(text) {
    const result = { newsSection: '', transportSection: '' };

    // 匹配"一、"开头的内容（国际新闻动态）
    const newsMatch = text.match(/一、[^二]*/);
    if (newsMatch) {
        result.newsSection = newsMatch[0].trim();
    }

    // 匹配"二、"开头的内容（运输保障情况）
    const transportMatch = text.match(/二、.*/);
    if (transportMatch) {
        result.transportSection = transportMatch[0].trim();
    }

    return result;
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

// 重新生成 ID 去重
function regenerateIds(data) {
    let newsIdx = 1;
    let supportIdx = 1;
    let dispatchIdx = 1;

    // 重新生成新闻 ID
    if (data.news) {
        for (const item of data.news) {
            item.news_id = generateId('NWS', newsIdx++);
        }
    }

    // 重新生成运保 ID 和出动 ID
    if (data.transport_support) {
        for (const ts of data.transport_support) {
            ts.support_id = generateId('TRS', supportIdx++);

            if (ts.dispatch_force) {
                for (const df of ts.dispatch_force) {
                    df.support_id = ts.support_id; // 关联上层
                    df.dispatch_id = generateId('DSP', dispatchIdx++);
                }
            }
        }
    }

    return data;
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

// 处理单个文件：读取 → 分割文档 → 分别提取 → 显示表格 → 入库
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

    // Step 2: 分割文档
    gov.log('→ 正在分割文档...');
    const sections = splitDocument(rawText);
    gov.log('✓ 文档分割完成');
    gov.log('  国际新闻部分: ' + sections.newsSection.length + ' 字符');
    gov.log('  运输保障部分: ' + sections.transportSection.length + ' 字符');

    const finalData = { news: [], transport_support: [] };

    // Step 3: 提取国际新闻（Prompt 1）
    if (sections.newsSection.trim()) {
        gov.log('\\n→ 正在提取国际新闻动态...');
        const prompt1 = EXTRACT_NEWS_PROMPT + '\\n\\n---\\n新闻文本：\\n' + sections.newsSection;

        try {
            const aiResponse1 = await gov.callAI(prompt1);
            const newsData = parseAIResponse(aiResponse1);

            if (newsData.news && Array.isArray(newsData.news)) {
                finalData.news = newsData.news;
                gov.log('✓ 提取到 ' + finalData.news.length + ' 条国际新闻');
            } else {
                gov.log('⚠ 国际新闻数据格式不正确');
            }
        } catch (e) {
            gov.log('✗ 国际新闻提取失败: ' + e.message);
        }
    } else {
        gov.log('⚠ 未找到"一、"国际新闻部分');
    }

    // Step 4: 提取运输保障（Prompt 2）
    if (sections.transportSection.trim()) {
        gov.log('\\n→ 正在提取运输保障情况...');
        const prompt2 = EXTRACT_TRANSPORT_PROMPT + '\\n\\n---\\n运输保障文本：\\n' + sections.transportSection;

        try {
            const aiResponse2 = await gov.callAI(prompt2);
            const transportData = parseAIResponse(aiResponse2);

            if (transportData.transport_support && Array.isArray(transportData.transport_support)) {
                finalData.transport_support = transportData.transport_support;
                gov.log('✓ 提取到 ' + finalData.transport_support.length + ' 条运输保障');

                // Step 5: 从每条运输保障中提取保障力量出动（Prompt 3）
                for (const ts of finalData.transport_support) {
                    if (ts.transport_info && ts.transport_info.trim()) {
                        gov.log('\\n→ 正在提取保障力量出动（运保内码: ' + ts.support_id + ')...');
                        const prompt3 = EXTRACT_DISPATCH_PROMPT
                            .replace('提供的运保内码', ts.support_id)
                            + '\\n\\n---\\n运输保障信息：\\n' + ts.transport_info;

                        try {
                            const aiResponse3 = await gov.callAI(prompt3);
                            const dispatchData = parseAIResponse(aiResponse3);

                            if (dispatchData.dispatch_force && Array.isArray(dispatchData.dispatch_force)) {
                                ts.dispatch_force = dispatchData.dispatch_force;
                                gov.log('✓ 提取到 ' + ts.dispatch_force.length + ' 条保障力量出动');
                            } else {
                                ts.dispatch_force = [];
                            }
                        } catch (e) {
                            gov.log('⚠ 保障力量出动提取失败: ' + e.message);
                            ts.dispatch_force = [];
                        }
                    } else {
                        ts.dispatch_force = [];
                    }
                }
            } else {
                gov.log('⚠ 运输保障数据格式不正确');
            }
        } catch (e) {
            gov.log('✗ 运输保障提取失败: ' + e.message);
        }
    } else {
        gov.log('⚠ 未找到"二、"运输保障部分');
    }

    // Step 6: 重新生成 ID 并去重
    regenerateIds(finalData);
    finalData.news = deduplicateNews(finalData.news);

    gov.log('\\n✓ 数据处理完成: ' + finalData.news.length + ' 条新闻, ' + finalData.transport_support.length + ' 条运保');

    // Step 7: 显示三张表
    gov.log('\\n--- 国际新闻表 ---');
    if (finalData.news.length > 0) {
        gov.showTable(finalData.news.map(n => ({
            新闻内码: n.news_id,
            时间: n.news_time,
            区域: n.region,
            事件: n.event?.length > 50 ? n.event.slice(0, 50) + '...' : n.event
        })));
    } else {
        gov.log('（无数据）');
    }

    gov.log('\\n--- 运输保障表 ---');
    if (finalData.transport_support.length > 0) {
        gov.showTable(finalData.transport_support.map(ts => ({
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
    for (const ts of finalData.transport_support) {
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

    // Step 8: 入库
    gov.log('\\n→ 开始入库...');
    const insertResult = await insertToDatabase(finalData);

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
                const lines = s.split('\n').filter(l => !l.trim().startsWith('--'));
                return lines.join('\n').trim();
            })
            .filter(s => s);
        for (const stmt of ddlStatements) {
            if (stmt) {
                await gov.executeSQL(stmt);
            }
        }
        gov.log('✓ 数据库表创建完成');
    } catch (e) {
        gov.log('⚠ 建表可能已存在，跳过: ' + e.message);
    }

    // -- Step 0.1: 添加表和字段注释 --
    try {
        const commentStatements = COMMENT_DDL.split(';')
            .map(s => s.trim())
            .filter(s => s && !s.startsWith('--'));
        for (const stmt of commentStatements) {
            if (stmt) {
                await gov.executeSQL(stmt);
            }
        }
        gov.log('✓ 表和字段注释添加完成');
    } catch (e) {
        gov.log('⚠ 添加注释失败: ' + e.message);
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
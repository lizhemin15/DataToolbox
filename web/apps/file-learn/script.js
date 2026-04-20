// ===== 常量与工具 =====
const STORAGE_KEY = 'file_learn_progress';
const AsyncFunction = Object.getPrototypeOf(async function(){}).constructor;

const EMPLOYEE_CSV = `姓名,年龄,城市,部门,薪资
张三,28,北京,技术部,15000
李四,24,上海,市场部,12000
王五,32,广州,技术部,18000
赵六,27,深圳,人事部,13000
孙七,35,北京,技术部,22000
周八,29,上海,市场部,14000
吴九,31,广州,人事部,16000
郑十,26,深圳,技术部,17000`;

const EMPLOYEE_DATA = [
    { 姓名: '张三', 年龄: 28, 城市: '北京', 部门: '技术部', 薪资: 15000 },
    { 姓名: '李四', 年龄: 24, 城市: '上海', 部门: '市场部', 薪资: 12000 },
    { 姓名: '王五', 年龄: 32, 城市: '广州', 部门: '技术部', 薪资: 18000 },
    { 姓名: '赵六', 年龄: 27, 城市: '深圳', 部门: '人事部', 薪资: 13000 },
    { 姓名: '孙七', 年龄: 35, 城市: '北京', 部门: '技术部', 薪资: 22000 },
    { 姓名: '周八', 年龄: 29, 城市: '上海', 部门: '市场部', 薪资: 14000 },
    { 姓名: '吴九', 年龄: 31, 城市: '广州', 部门: '人事部', 薪资: 16000 },
    { 姓名: '郑十', 年龄: 26, 城市: '深圳', 部门: '技术部', 薪资: 17000 }
];

const DIRTY_CSV = `姓名,年龄,城市,薪资
张三,28,北京,15000
  李四  ,24,上海,12000
,,, 
王五,三十二,广州,18000
赵六,27,,13000
,,,
孙七,35,北京,abc
周八,29,上海,14000
  , ,  ,  
吴九,31,广州,16000`;

// ===== 关卡数据 =====
const LEVELS = [
    // ===== 第一阶段：文件基础 =====
    {
        id: 1,
        title: '认识 Blob',
        description: '学习用 Blob 创建内存中的文件数据',
        tutorial: `
            <p><strong>Blob</strong>（Binary Large Object）是浏览器中表示文件数据的基础对象。所有文件操作都建立在 Blob 之上。</p>
            <p>创建 Blob 的语法：</p>
            <div class="syntax-block">const blob = new Blob([内容], { type: 'MIME类型' });</div>
            <p>常用 MIME 类型：</p>
            <ul style="margin:6px 0 6px 20px;line-height:1.8;">
                <li><code>text/plain</code> — 纯文本</li>
                <li><code>text/csv</code> — CSV 文件</li>
                <li><code>application/json</code> — JSON 文件</li>
            </ul>
            <p>Blob 对象有两个常用属性：<code>blob.size</code>（字节数）和 <code>blob.type</code>（MIME 类型）。</p>
        `,
        task: '创建一个 Blob 对象，内容为 <code>"姓名,年龄,城市\\n张三,28,北京\\n李四,24,上海"</code>，MIME 类型为 <code>text/csv;charset=utf-8</code>，赋值给 <code>result</code>。',
        sampleData: '<p>本关无预设变量，请从零创建 Blob。</p>',
        getContext() { return {}; },
        hint: `const content = "姓名,年龄,城市\\n张三,28,北京\\n李四,24,上海";
result = new Blob([content], { type: 'text/csv;charset=utf-8' });`,
        answer: `const content = "姓名,年龄,城市\\n张三,28,北京\\n李四,24,上海";
result = new Blob([content], { type: 'text/csv;charset=utf-8' });`,
        validate(code, { result, logs, error }) {
            const checks = [];
            if (error) { checks.push({ pass: false, msg: '代码执行出错: ' + error }); return checks; }
            checks.push({ pass: result instanceof Blob, msg: 'result 是 Blob 对象' });
            checks.push({ pass: result && result.type === 'text/csv;charset=utf-8', msg: 'MIME 类型为 text/csv;charset=utf-8' });
            checks.push({ pass: result && result.size > 0, msg: 'Blob 大小大于 0' });
            checks.push({ pass: /new\s+Blob/.test(code), msg: '使用了 new Blob() 构造函数' });
            return checks;
        }
    },
    {
        id: 2,
        title: 'Blob 异步读取',
        description: '用 await 读取 Blob 的文本内容',
        tutorial: `
            <p>Blob 的内容不能直接访问，需要通过异步方法读取：</p>
            <div class="syntax-block">const text = await blob.text();  // 读取为文本
const buf  = await blob.arrayBuffer(); // 读取为二进制</div>
            <p><code>blob.text()</code> 返回一个 <strong>Promise</strong>，需要用 <code>await</code> 等待结果。</p>
            <p>执行环境已支持顶层 <code>await</code>，可以直接使用。</p>
        `,
        task: '读取预设变量 <code>blob</code> 的文本内容，赋值给 <code>result</code>。',
        sampleData: `<p><span class="var-name">blob</span> <span class="var-type">Blob</span> — 包含 CSV 数据的 Blob 对象</p>
            <div class="data-block">内容: "编号,产品,数量\\n001,笔记本电脑,50\\n002,机械键盘,120\\n003,显示器,80"</div>`,
        getContext() {
            return { blob: new Blob(['编号,产品,数量\n001,笔记本电脑,50\n002,机械键盘,120\n003,显示器,80'], { type: 'text/csv' }) };
        },
        hint: `result = await blob.text();`,
        answer: `result = await blob.text();`,
        validate(code, { result, logs, error }) {
            const checks = [];
            if (error) { checks.push({ pass: false, msg: '代码执行出错: ' + error }); return checks; }
            const expected = '编号,产品,数量\n001,笔记本电脑,50\n002,机械键盘,120\n003,显示器,80';
            checks.push({ pass: result === expected, msg: 'result 等于 Blob 的文本内容' });
            checks.push({ pass: /\.text\s*\(\s*\)/.test(code), msg: '使用了 blob.text()' });
            checks.push({ pass: /await/.test(code), msg: '使用了 await 等待异步结果' });
            return checks;
        }
    },
    {
        id: 3,
        title: '生成下载链接',
        description: '用 Blob + URL.createObjectURL 创建可下载文件',
        tutorial: `
            <p>在浏览器中下载文件的核心步骤：</p>
            <div class="syntax-block">// 1. 创建 Blob
const blob = new Blob([内容], { type: 'text/csv' });

// 2. 生成临时 URL
const url = URL.createObjectURL(blob);

// 3. 创建下载链接
const a = document.createElement('a');
a.href = url;
a.download = '文件名.csv';  // 指定下载文件名
a.click();  // 触发下载

// 4. 释放 URL（可选，节省内存）
URL.revokeObjectURL(url);</div>
            <p><code>URL.createObjectURL()</code> 为 Blob 生成一个临时 <code>blob://</code> 地址，可用作下载链接。</p>
        `,
        task: '将预设的 <code>csvText</code> 创建为 Blob，然后用 <code>URL.createObjectURL()</code> 生成下载链接。将 <code>{ blob, url }</code> 对象赋值给 <code>result</code>。',
        sampleData: `<p><span class="var-name">csvText</span> <span class="var-type">String</span> — CSV 文本</p>
            <div class="data-block">姓名,分数\n张三,92\n李四,78\n王五,85</div>`,
        getContext() {
            return { csvText: '姓名,分数\n张三,92\n李四,78\n王五,85' };
        },
        hint: `const blob = new Blob([csvText], { type: 'text/csv;charset=utf-8' });
const url = URL.createObjectURL(blob);
result = { blob, url };`,
        answer: `const blob = new Blob([csvText], { type: 'text/csv;charset=utf-8' });
const url = URL.createObjectURL(blob);
result = { blob, url };`,
        validate(code, { result, logs, error }) {
            const checks = [];
            if (error) { checks.push({ pass: false, msg: '代码执行出错: ' + error }); return checks; }
            checks.push({ pass: result && result.blob instanceof Blob, msg: 'result.blob 是 Blob 对象' });
            checks.push({ pass: result && typeof result.url === 'string' && result.url.startsWith('blob:'), msg: 'result.url 是 blob:// 链接' });
            checks.push({ pass: /createObjectURL/.test(code), msg: '使用了 URL.createObjectURL()' });
            checks.push({ pass: /new\s+Blob/.test(code), msg: '使用了 new Blob()' });
            return checks;
        }
    },

    // ===== 第二阶段：CSV 处理 =====
    {
        id: 4,
        title: 'CSV 解析入门',
        description: '用 Papa Parse 将 CSV 文本解析为数组',
        tutorial: `
            <p><strong>Papa Parse</strong> 是最流行的 JS CSV 解析库，一行代码即可解析 CSV：</p>
            <div class="syntax-block">const parsed = Papa.parse(csvString);
// parsed.data → 二维数组 [[行1], [行2], ...]
// parsed.errors → 解析错误
// parsed.meta → 元信息（分隔符等）</div>
            <p>默认解析结果是<strong>二维数组</strong>，第一行是表头：</p>
            <div class="syntax-block">Papa.parse("姓名,年龄\\n张三,28")
→ { data: [["姓名","年龄"], ["张三","28"]] }</div>
        `,
        task: '使用 <code>Papa.parse()</code> 解析 <code>csvText</code>，将 <code>parsed.data</code> 赋值给 <code>result</code>。',
        sampleData: `<p><span class="var-name">csvText</span> <span class="var-type">String</span> — CSV 文本</p>
            <div class="data-block">姓名,年龄,城市\n张三,28,北京\n李四,24,上海\n王五,32,广州</div>`,
        getContext() {
            return { csvText: '姓名,年龄,城市\n张三,28,北京\n李四,24,上海\n王五,32,广州' };
        },
        hint: `const parsed = Papa.parse(csvText);
result = parsed.data;`,
        answer: `const parsed = Papa.parse(csvText);
result = parsed.data;`,
        validate(code, { result, logs, error }) {
            const checks = [];
            if (error) { checks.push({ pass: false, msg: '代码执行出错: ' + error }); return checks; }
            checks.push({ pass: Array.isArray(result), msg: 'result 是数组' });
            checks.push({ pass: result && result.length >= 4, msg: '包含 4 行数据（含表头）' });
            checks.push({ pass: result && result[0] && result[0][0] === '姓名', msg: '第一行第一列为"姓名"' });
            checks.push({ pass: result && result[1] && result[1][0] === '张三', msg: '第二行第一列为"张三"' });
            checks.push({ pass: /Papa\s*\.\s*parse/.test(code), msg: '使用了 Papa.parse()' });
            return checks;
        }
    },
    {
        id: 5,
        title: '带表头 CSV 解析',
        description: '解析 CSV 为对象数组，用表头作为键名',
        tutorial: `
            <p>添加 <code>header: true</code> 选项，Papa Parse 会用第一行作为键名，返回<strong>对象数组</strong>：</p>
            <div class="syntax-block">Papa.parse(csv, { header: true })
→ { data: [
    { 姓名: "张三", 年龄: "28" },
    { 姓名: "李四", 年龄: "24" }
  ] }</div>
            <p>注意：所有值默认都是<strong>字符串</strong>。加 <code>dynamicTyping: true</code> 可自动转换数字：</p>
            <div class="syntax-block">Papa.parse(csv, { header: true, dynamicTyping: true })
→ { data: [{ 姓名: "张三", 年龄: 28 }] }  // 28 是数字</div>
        `,
        task: '用 <code>Papa.parse()</code> 解析 <code>csvText</code>，启用 <code>header: true</code> 和 <code>dynamicTyping: true</code>，将 <code>parsed.data</code> 赋值给 <code>result</code>。',
        sampleData: `<p><span class="var-name">csvText</span> <span class="var-type">String</span> — 员工 CSV 数据</p>
            <div class="data-block">姓名,年龄,城市,部门,薪资\n张三,28,北京,技术部,15000\n李四,24,上海,市场部,12000\n王五,32,广州,技术部,18000</div>`,
        getContext() {
            return { csvText: '姓名,年龄,城市,部门,薪资\n张三,28,北京,技术部,15000\n李四,24,上海,市场部,12000\n王五,32,广州,技术部,18000' };
        },
        hint: `const parsed = Papa.parse(csvText, { header: true, dynamicTyping: true });
result = parsed.data;`,
        answer: `const parsed = Papa.parse(csvText, { header: true, dynamicTyping: true });
result = parsed.data;`,
        validate(code, { result, logs, error }) {
            const checks = [];
            if (error) { checks.push({ pass: false, msg: '代码执行出错: ' + error }); return checks; }
            checks.push({ pass: Array.isArray(result), msg: 'result 是数组' });
            checks.push({ pass: result && result.length === 3, msg: '包含 3 条数据记录' });
            checks.push({ pass: result && result[0] && result[0].姓名 === '张三', msg: '第一条记录的姓名为"张三"' });
            checks.push({ pass: result && result[0] && result[0].年龄 === 28, msg: '年龄自动转换为数字 28' });
            checks.push({ pass: result && result[0] && result[0].薪资 === 15000, msg: '薪资自动转换为数字 15000' });
            checks.push({ pass: /header\s*:\s*true/.test(code), msg: '启用了 header: true' });
            checks.push({ pass: /dynamicTyping\s*:\s*true/.test(code), msg: '启用了 dynamicTyping: true' });
            return checks;
        }
    },
    {
        id: 6,
        title: 'CSV 数据统计',
        description: '对解析后的数据进行聚合计算',
        tutorial: `
            <p>解析 CSV 后，可用 JavaScript 数组方法做数据统计：</p>
            <div class="syntax-block">// 求和
const total = data.reduce((sum, row) => sum + row.薪资, 0);

// 平均值
const avg = total / data.length;

// 最大值
const max = Math.max(...data.map(r => r.薪资));

// 计数
const count = data.filter(r => r.部门 === '技术部').length;</div>
        `,
        task: '计算 <code>data</code> 中全部员工的 <strong>总薪资</strong>、<strong>平均薪资</strong>（四舍五入取整）和 <strong>最高薪资</strong>，将 <code>{ total, avg, max }</code> 赋值给 <code>result</code>。',
        sampleData: `<p><span class="var-name">data</span> <span class="var-type">Array&lt;Object&gt;</span> — 8 条员工记录</p>
            <div class="data-block">[{ 姓名:"张三", 年龄:28, 城市:"北京", 部门:"技术部", 薪资:15000 }, ...]
共 8 条记录，薪资: 15000, 12000, 18000, 13000, 22000, 14000, 16000, 17000</div>`,
        getContext() { return { data: JSON.parse(JSON.stringify(EMPLOYEE_DATA)) }; },
        hint: `const total = data.reduce((sum, r) => sum + r.薪资, 0);
const avg = Math.round(total / data.length);
const max = Math.max(...data.map(r => r.薪资));
result = { total, avg, max };`,
        answer: `const total = data.reduce((sum, r) => sum + r.薪资, 0);
const avg = Math.round(total / data.length);
const max = Math.max(...data.map(r => r.薪资));
result = { total, avg, max };`,
        validate(code, { result, logs, error }) {
            const checks = [];
            if (error) { checks.push({ pass: false, msg: '代码执行出错: ' + error }); return checks; }
            checks.push({ pass: result && typeof result === 'object', msg: 'result 是对象' });
            checks.push({ pass: result && result.total === 127000, msg: '总薪资 total = 127000' });
            checks.push({ pass: result && result.avg === 15875, msg: '平均薪资 avg = 15875' });
            checks.push({ pass: result && result.max === 22000, msg: '最高薪资 max = 22000' });
            checks.push({ pass: /reduce/.test(code), msg: '使用了 reduce 求和' });
            return checks;
        }
    },
    {
        id: 7,
        title: 'CSV 数据筛选',
        description: '用 filter 按条件筛选数据',
        tutorial: `
            <p><code>Array.filter()</code> 返回满足条件的新数组，是数据工作中最常用的方法：</p>
            <div class="syntax-block">// 筛选技术部员工
const techStaff = data.filter(r => r.部门 === '技术部');

// 组合条件：年龄大于 25 且在北京
const result = data.filter(r => r.年龄 > 25 && r.城市 === '北京');

// 链式操作：筛选后排序
const sorted = data
    .filter(r => r.薪资 >= 15000)
    .sort((a, b) => b.薪资 - a.薪资);</div>
        `,
        task: '从 <code>data</code> 中筛选出<strong>技术部</strong>的员工，按<strong>薪资从高到低</strong>排序，赋值给 <code>result</code>。',
        sampleData: `<p><span class="var-name">data</span> <span class="var-type">Array&lt;Object&gt;</span> — 8 条员工记录</p>
            <div class="data-block">技术部员工: 张三(15000), 王五(18000), 孙七(22000), 郑十(17000)</div>`,
        getContext() { return { data: JSON.parse(JSON.stringify(EMPLOYEE_DATA)) }; },
        hint: `result = data
    .filter(r => r.部门 === '技术部')
    .sort((a, b) => b.薪资 - a.薪资);`,
        answer: `result = data
    .filter(r => r.部门 === '技术部')
    .sort((a, b) => b.薪资 - a.薪资);`,
        validate(code, { result, logs, error }) {
            const checks = [];
            if (error) { checks.push({ pass: false, msg: '代码执行出错: ' + error }); return checks; }
            checks.push({ pass: Array.isArray(result), msg: 'result 是数组' });
            checks.push({ pass: result && result.length === 4, msg: '筛选出 4 名技术部员工' });
            checks.push({ pass: result && result.every(r => r.部门 === '技术部'), msg: '全部属于技术部' });
            checks.push({ pass: result && result[0] && result[0].姓名 === '孙七', msg: '薪资最高者（孙七）排第一' });
            checks.push({ pass: result && result[3] && result[3].姓名 === '张三', msg: '薪资最低者（张三）排最后' });
            checks.push({ pass: /filter/.test(code), msg: '使用了 filter' });
            checks.push({ pass: /sort/.test(code), msg: '使用了 sort 排序' });
            return checks;
        }
    },
    {
        id: 8,
        title: '生成 CSV 文本',
        description: '用 Papa.unparse 将数据转回 CSV 格式',
        tutorial: `
            <p><code>Papa.unparse()</code> 是 <code>Papa.parse()</code> 的逆操作，将数组或对象转为 CSV 文本：</p>
            <div class="syntax-block">// 从对象数组生成
Papa.unparse([
    { 姓名: "张三", 分数: 90 },
    { 姓名: "李四", 分数: 85 }
]);
→ "姓名,分数\\n张三,90\\n李四,85"

// 从二维数组生成
Papa.unparse([
    ["姓名", "分数"],
    ["张三", 90]
]);
→ "姓名,分数\\n张三,90"</div>
        `,
        task: '将 <code>data</code>（对象数组）用 <code>Papa.unparse()</code> 转为 CSV 文本，赋值给 <code>result</code>。',
        sampleData: `<p><span class="var-name">data</span> <span class="var-type">Array&lt;Object&gt;</span> — 3 条简单记录</p>
            <div class="data-block">[
  { 姓名: "张三", 年龄: 28, 城市: "北京" },
  { 姓名: "李四", 年龄: 24, 城市: "上海" },
  { 姓名: "王五", 年龄: 32, 城市: "广州" }
]</div>`,
        getContext() {
            return { data: [
                { 姓名: '张三', 年龄: 28, 城市: '北京' },
                { 姓名: '李四', 年龄: 24, 城市: '上海' },
                { 姓名: '王五', 年龄: 32, 城市: '广州' }
            ]};
        },
        hint: `result = Papa.unparse(data);`,
        answer: `result = Papa.unparse(data);`,
        validate(code, { result, logs, error }) {
            const checks = [];
            if (error) { checks.push({ pass: false, msg: '代码执行出错: ' + error }); return checks; }
            checks.push({ pass: typeof result === 'string', msg: 'result 是字符串' });
            checks.push({ pass: result && result.includes('姓名'), msg: '包含表头"姓名"' });
            checks.push({ pass: result && result.includes('张三'), msg: '包含数据"张三"' });
            checks.push({ pass: result && result.includes('广州'), msg: '包含数据"广州"' });
            const lines = result ? result.trim().split('\n') : [];
            checks.push({ pass: lines.length === 4, msg: 'CSV 共 4 行（1 行表头 + 3 行数据）' });
            checks.push({ pass: /Papa\s*\.\s*unparse/.test(code), msg: '使用了 Papa.unparse()' });
            return checks;
        }
    },

    // ===== 第三阶段：Excel 处理 =====
    {
        id: 9,
        title: '创建 Excel 工作簿',
        description: '用 SheetJS 从二维数组创建 Excel',
        tutorial: `
            <p><strong>SheetJS（XLSX）</strong>是 JS 处理 Excel 的标准库。创建 Excel 的核心步骤：</p>
            <div class="syntax-block">// 1. 创建空工作簿
const wb = XLSX.utils.book_new();

// 2. 从二维数组创建工作表（第一行为表头）
const ws = XLSX.utils.aoa_to_sheet([
    ["姓名", "分数"],
    ["张三", 92],
    ["李四", 78]
]);

// 3. 将工作表添加到工作簿
XLSX.utils.book_append_sheet(wb, ws, "成绩表");

// 4. 导出文件（本关只需前3步）
// XLSX.writeFile(wb, "output.xlsx");</div>
        `,
        task: '用 <code>tableData</code>（二维数组）创建 Excel 工作簿，工作表命名为 <code>"成绩表"</code>，将工作簿赋值给 <code>result</code>。',
        sampleData: `<p><span class="var-name">tableData</span> <span class="var-type">Array&lt;Array&gt;</span> — 二维数组（含表头）</p>
            <div class="data-block">[
  ["姓名", "分数", "等级"],
  ["张三", 92, "A"],
  ["李四", 78, "B"],
  ["王五", 85, "A"],
  ["赵六", 63, "C"]
]</div>`,
        getContext() {
            return { tableData: [['姓名','分数','等级'],['张三',92,'A'],['李四',78,'B'],['王五',85,'A'],['赵六',63,'C']] };
        },
        hint: `const wb = XLSX.utils.book_new();
const ws = XLSX.utils.aoa_to_sheet(tableData);
XLSX.utils.book_append_sheet(wb, ws, '成绩表');
result = wb;`,
        answer: `const wb = XLSX.utils.book_new();
const ws = XLSX.utils.aoa_to_sheet(tableData);
XLSX.utils.book_append_sheet(wb, ws, '成绩表');
result = wb;`,
        validate(code, { result, logs, error }) {
            const checks = [];
            if (error) { checks.push({ pass: false, msg: '代码执行出错: ' + error }); return checks; }
            checks.push({ pass: result && result.SheetNames, msg: 'result 是工作簿对象' });
            checks.push({ pass: result && result.SheetNames && result.SheetNames[0] === '成绩表', msg: '工作表名称为"成绩表"' });
            checks.push({ pass: result && result.Sheets && result.Sheets['成绩表'], msg: '工作簿包含"成绩表"工作表' });
            const ws = result && result.Sheets && result.Sheets['成绩表'];
            checks.push({ pass: ws && ws['A1'] && ws['A1'].v === '姓名', msg: 'A1 单元格为"姓名"' });
            checks.push({ pass: ws && ws['B2'] && ws['B2'].v === 92, msg: 'B2 单元格为 92' });
            checks.push({ pass: /book_new/.test(code), msg: '使用了 XLSX.utils.book_new()' });
            checks.push({ pass: /aoa_to_sheet/.test(code), msg: '使用了 XLSX.utils.aoa_to_sheet()' });
            return checks;
        }
    },
    {
        id: 10,
        title: 'JSON 导出 Excel',
        description: '将 JSON 对象数组导出为 Excel 工作表',
        tutorial: `
            <p>实际工作中，数据通常是<strong>对象数组</strong>格式。用 <code>json_to_sheet()</code> 直接转换：</p>
            <div class="syntax-block">const data = [
    { 姓名: "张三", 薪资: 15000 },
    { 姓名: "李四", 薪资: 12000 }
];
const ws = XLSX.utils.json_to_sheet(data);
// 自动以对象键名作为表头</div>
            <p>对比两种创建工作表的方法：</p>
            <ul style="margin:6px 0 6px 20px;line-height:1.8;">
                <li><code>aoa_to_sheet()</code> — 适用于二维数组</li>
                <li><code>json_to_sheet()</code> — 适用于对象数组（更常用）</li>
            </ul>
        `,
        task: '将 <code>records</code>（对象数组）转为工作表，创建工作簿，表名 <code>"员工数据"</code>，赋值给 <code>result</code>。',
        sampleData: `<p><span class="var-name">records</span> <span class="var-type">Array&lt;Object&gt;</span> — 员工数据</p>
            <div class="data-block">[
  { 姓名: "张三", 年龄: 28, 部门: "技术部", 薪资: 15000 },
  { 姓名: "李四", 年龄: 24, 部门: "市场部", 薪资: 12000 },
  { 姓名: "王五", 年龄: 32, 部门: "技术部", 薪资: 18000 }
]</div>`,
        getContext() {
            return { records: [
                { 姓名: '张三', 年龄: 28, 部门: '技术部', 薪资: 15000 },
                { 姓名: '李四', 年龄: 24, 部门: '市场部', 薪资: 12000 },
                { 姓名: '王五', 年龄: 32, 部门: '技术部', 薪资: 18000 }
            ]};
        },
        hint: `const wb = XLSX.utils.book_new();
const ws = XLSX.utils.json_to_sheet(records);
XLSX.utils.book_append_sheet(wb, ws, '员工数据');
result = wb;`,
        answer: `const wb = XLSX.utils.book_new();
const ws = XLSX.utils.json_to_sheet(records);
XLSX.utils.book_append_sheet(wb, ws, '员工数据');
result = wb;`,
        validate(code, { result, logs, error }) {
            const checks = [];
            if (error) { checks.push({ pass: false, msg: '代码执行出错: ' + error }); return checks; }
            checks.push({ pass: result && result.SheetNames, msg: 'result 是工作簿对象' });
            checks.push({ pass: result && result.SheetNames && result.SheetNames.includes('员工数据'), msg: '包含"员工数据"工作表' });
            const ws = result && result.Sheets && result.Sheets['员工数据'];
            checks.push({ pass: ws && ws['A1'] && ws['A1'].v === '姓名', msg: '表头 A1 为"姓名"' });
            checks.push({ pass: ws && ws['D2'] && ws['D2'].v === 15000, msg: 'D2（张三薪资）为 15000' });
            checks.push({ pass: /json_to_sheet/.test(code), msg: '使用了 XLSX.utils.json_to_sheet()' });
            return checks;
        }
    },
    {
        id: 11,
        title: '读取 Excel 数据',
        description: '解析 Excel 二进制数据为 JSON',
        tutorial: `
            <p>读取 Excel 文件的核心步骤：</p>
            <div class="syntax-block">// 1. 读取二进制数据为工作簿对象
const wb = XLSX.read(binaryData, { type: 'array' });

// 2. 获取第一个工作表
const sheetName = wb.SheetNames[0];
const ws = wb.Sheets[sheetName];

// 3. 转换为 JSON 对象数组
const data = XLSX.utils.sheet_to_json(ws);

// 或转换为二维数组
const aoa = XLSX.utils.sheet_to_json(ws, { header: 1 });</div>
            <p><code>type: 'array'</code> 表示输入是 Uint8Array/ArrayBuffer。</p>
        `,
        task: '读取 <code>excelData</code>（Uint8Array），提取第一个工作表的数据为 JSON 对象数组，赋值给 <code>result</code>。',
        sampleData: `<p><span class="var-name">excelData</span> <span class="var-type">Uint8Array</span> — Excel 文件二进制数据</p>
            <div class="data-block">包含工作表"成绩表"：
姓名  | 分数 | 等级
张三  | 92   | A
李四  | 78   | B
王五  | 85   | A
赵六  | 63   | C</div>`,
        getContext() {
            const wb = XLSX.utils.book_new();
            const ws = XLSX.utils.aoa_to_sheet([['姓名','分数','等级'],['张三',92,'A'],['李四',78,'B'],['王五',85,'A'],['赵六',63,'C']]);
            XLSX.utils.book_append_sheet(wb, ws, '成绩表');
            const binary = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
            return { excelData: new Uint8Array(binary) };
        },
        hint: `const wb = XLSX.read(excelData, { type: 'array' });
const ws = wb.Sheets[wb.SheetNames[0]];
result = XLSX.utils.sheet_to_json(ws);`,
        answer: `const wb = XLSX.read(excelData, { type: 'array' });
const ws = wb.Sheets[wb.SheetNames[0]];
result = XLSX.utils.sheet_to_json(ws);`,
        validate(code, { result, logs, error }) {
            const checks = [];
            if (error) { checks.push({ pass: false, msg: '代码执行出错: ' + error }); return checks; }
            checks.push({ pass: Array.isArray(result), msg: 'result 是数组' });
            checks.push({ pass: result && result.length === 4, msg: '包含 4 条记录' });
            checks.push({ pass: result && result[0] && result[0]['姓名'] === '张三', msg: '第一条记录姓名为"张三"' });
            checks.push({ pass: result && result[0] && result[0]['分数'] === 92, msg: '张三分数为 92' });
            checks.push({ pass: /XLSX\s*\.\s*read/.test(code), msg: '使用了 XLSX.read()' });
            checks.push({ pass: /sheet_to_json/.test(code), msg: '使用了 XLSX.utils.sheet_to_json()' });
            return checks;
        }
    },

    // ===== 第四阶段：格式转换 =====
    {
        id: 12,
        title: 'CSV 转 Excel',
        description: '组合 Papa Parse + SheetJS 实现格式转换',
        tutorial: `
            <p>格式转换是数据工作的核心任务。CSV 转 Excel 的流程：</p>
            <div class="syntax-block">// 完整流程：CSV → 解析 → Excel
const parsed = Papa.parse(csvText, {
    header: true,
    dynamicTyping: true
});
const wb = XLSX.utils.book_new();
const ws = XLSX.utils.json_to_sheet(parsed.data);
XLSX.utils.book_append_sheet(wb, ws, '数据');
// XLSX.writeFile(wb, 'output.xlsx');</div>
            <p>这就是组合两个库的威力——Papa Parse 负责解析，SheetJS 负责生成。</p>
        `,
        task: '将 <code>csvText</code> 解析后转为 Excel 工作簿，工作表名 <code>"员工表"</code>，赋值给 <code>result</code>。要求用 <code>header: true</code> 和 <code>dynamicTyping: true</code> 解析。',
        sampleData: `<p><span class="var-name">csvText</span> <span class="var-type">String</span> — 完整员工 CSV 数据（8条记录）</p>
            <div class="data-block">姓名,年龄,城市,部门,薪资\n张三,28,北京,技术部,15000\n...(共8条)</div>`,
        getContext() { return { csvText: EMPLOYEE_CSV }; },
        hint: `const parsed = Papa.parse(csvText, { header: true, dynamicTyping: true });
const wb = XLSX.utils.book_new();
const ws = XLSX.utils.json_to_sheet(parsed.data);
XLSX.utils.book_append_sheet(wb, ws, '员工表');
result = wb;`,
        answer: `const parsed = Papa.parse(csvText, { header: true, dynamicTyping: true });
const wb = XLSX.utils.book_new();
const ws = XLSX.utils.json_to_sheet(parsed.data);
XLSX.utils.book_append_sheet(wb, ws, '员工表');
result = wb;`,
        validate(code, { result, logs, error }) {
            const checks = [];
            if (error) { checks.push({ pass: false, msg: '代码执行出错: ' + error }); return checks; }
            checks.push({ pass: result && result.SheetNames, msg: 'result 是工作簿' });
            checks.push({ pass: result && result.SheetNames && result.SheetNames.includes('员工表'), msg: '包含"员工表"工作表' });
            const ws = result && result.Sheets && result.Sheets['员工表'];
            checks.push({ pass: ws && ws['A1'] && ws['A1'].v === '姓名', msg: '表头包含"姓名"' });
            const data = ws ? XLSX.utils.sheet_to_json(ws) : [];
            checks.push({ pass: data.length === 8, msg: '包含 8 条员工数据' });
            checks.push({ pass: data[0] && data[0]['薪资'] === 15000, msg: '薪资为数字类型' });
            checks.push({ pass: /Papa\s*\.\s*parse/.test(code), msg: '使用了 Papa.parse()' });
            checks.push({ pass: /json_to_sheet|aoa_to_sheet/.test(code), msg: '使用了 SheetJS 创建工作表' });
            return checks;
        }
    },
    {
        id: 13,
        title: '多 Sheet 操作',
        description: '在一个工作簿中创建多个工作表',
        tutorial: `
            <p>一个 Excel 文件可以有<strong>多个工作表</strong>。多次调用 <code>book_append_sheet</code> 即可：</p>
            <div class="syntax-block">const wb = XLSX.utils.book_new();

// 添加第一个 Sheet
const ws1 = XLSX.utils.json_to_sheet(data1);
XLSX.utils.book_append_sheet(wb, ws1, '销售数据');

// 添加第二个 Sheet
const ws2 = XLSX.utils.json_to_sheet(data2);
XLSX.utils.book_append_sheet(wb, ws2, '库存数据');

wb.SheetNames → ['销售数据', '库存数据']</div>
            <p>实际应用场景：按部门拆分数据，每个部门一个 Sheet。</p>
        `,
        task: '将 <code>data</code> 按<strong>部门</strong>分组，每个部门创建一个独立工作表（表名为部门名），赋值给 <code>result</code>。',
        sampleData: `<p><span class="var-name">data</span> <span class="var-type">Array&lt;Object&gt;</span> — 8 条员工记录</p>
            <div class="data-block">部门分布: 技术部(4人), 市场部(2人), 人事部(2人)</div>`,
        getContext() { return { data: JSON.parse(JSON.stringify(EMPLOYEE_DATA)) }; },
        hint: `const wb = XLSX.utils.book_new();
const groups = {};
data.forEach(r => {
    if (!groups[r.部门]) groups[r.部门] = [];
    groups[r.部门].push(r);
});
for (const [dept, rows] of Object.entries(groups)) {
    const ws = XLSX.utils.json_to_sheet(rows);
    XLSX.utils.book_append_sheet(wb, ws, dept);
}
result = wb;`,
        answer: `const wb = XLSX.utils.book_new();
const groups = {};
data.forEach(r => {
    if (!groups[r.部门]) groups[r.部门] = [];
    groups[r.部门].push(r);
});
for (const [dept, rows] of Object.entries(groups)) {
    const ws = XLSX.utils.json_to_sheet(rows);
    XLSX.utils.book_append_sheet(wb, ws, dept);
}
result = wb;`,
        validate(code, { result, logs, error }) {
            const checks = [];
            if (error) { checks.push({ pass: false, msg: '代码执行出错: ' + error }); return checks; }
            checks.push({ pass: result && result.SheetNames, msg: 'result 是工作簿' });
            const names = result ? result.SheetNames : [];
            checks.push({ pass: names.length === 3, msg: '包含 3 个工作表' });
            checks.push({ pass: names.includes('技术部'), msg: '包含"技术部"工作表' });
            checks.push({ pass: names.includes('市场部'), msg: '包含"市场部"工作表' });
            checks.push({ pass: names.includes('人事部'), msg: '包含"人事部"工作表' });
            const techWs = result && result.Sheets && result.Sheets['技术部'];
            const techData = techWs ? XLSX.utils.sheet_to_json(techWs) : [];
            checks.push({ pass: techData.length === 4, msg: '技术部有 4 条记录' });
            return checks;
        }
    },
    {
        id: 14,
        title: '数据清洗管道',
        description: '解析脏数据、清洗、转换的完整流程',
        tutorial: `
            <p>真实数据往往包含各种问题：空行、多余空格、类型错误等。清洗流程：</p>
            <div class="syntax-block">// 1. 解析原始 CSV（跳过空行）
const parsed = Papa.parse(csv, {
    header: true,
    skipEmptyLines: true
});

// 2. 过滤无效行
const valid = parsed.data.filter(r => r.姓名 && r.姓名.trim());

// 3. 清洗字段
const cleaned = valid.map(r => ({
    姓名: r.姓名.trim(),          // 去除空格
    年龄: parseInt(r.年龄) || 0,   // 转为数字
    城市: r.城市 ? r.城市.trim() : '未知'
}));

// 4. 过滤不合理数据
const final = cleaned.filter(r => r.年龄 > 0);</div>
        `,
        task: `清洗 <code>dirtyCSV</code>：<br>1. 用 Papa Parse 解析（跳过空行）<br>2. 过滤掉姓名为空的行<br>3. 去除姓名和城市的首尾空格，城市为空则填"未知"<br>4. 年龄和薪资转为数字（非法值设为 0）<br>5. 过滤掉年龄或薪资为 0 的记录<br>将最终清洗后的数组赋值给 <code>result</code>。`,
        sampleData: `<p><span class="var-name">dirtyCSV</span> <span class="var-type">String</span> — 包含脏数据的 CSV</p>
            <div class="data-block">姓名,年龄,城市,薪资
张三,28,北京,15000
  李四  ,24,上海,12000
,,,                    ← 空行
王五,三十二,广州,18000  ← 年龄非数字
赵六,27,,13000         ← 城市为空
孙七,35,北京,abc       ← 薪资非数字
周八,29,上海,14000
吴九,31,广州,16000</div>`,
        getContext() { return { dirtyCSV: DIRTY_CSV }; },
        hint: `const parsed = Papa.parse(dirtyCSV, { header: true, skipEmptyLines: true });
const cleaned = parsed.data
    .filter(r => r.姓名 && r.姓名.trim())
    .map(r => ({
        姓名: r.姓名.trim(),
        年龄: parseInt(r.年龄) || 0,
        城市: r.城市 ? r.城市.trim() : '未知',
        薪资: parseFloat(r.薪资) || 0
    }))
    .filter(r => r.年龄 > 0 && r.薪资 > 0);
result = cleaned;`,
        answer: `const parsed = Papa.parse(dirtyCSV, { header: true, skipEmptyLines: true });
const cleaned = parsed.data
    .filter(r => r.姓名 && r.姓名.trim())
    .map(r => ({
        姓名: r.姓名.trim(),
        年龄: parseInt(r.年龄) || 0,
        城市: r.城市 ? r.城市.trim() : '未知',
        薪资: parseFloat(r.薪资) || 0
    }))
    .filter(r => r.年龄 > 0 && r.薪资 > 0);
result = cleaned;`,
        validate(code, { result, logs, error }) {
            const checks = [];
            if (error) { checks.push({ pass: false, msg: '代码执行出错: ' + error }); return checks; }
            checks.push({ pass: Array.isArray(result), msg: 'result 是数组' });
            checks.push({ pass: result && result.length === 5, msg: '清洗后剩 5 条有效记录' });
            checks.push({ pass: result && result.every(r => r.姓名 && r.姓名 === r.姓名.trim()), msg: '姓名无多余空格' });
            checks.push({ pass: result && result.every(r => typeof r.年龄 === 'number' && r.年龄 > 0), msg: '年龄均为正数' });
            checks.push({ pass: result && result.every(r => typeof r.薪资 === 'number' && r.薪资 > 0), msg: '薪资均为正数' });
            const zhao = result && result.find(r => r.姓名 === '赵六');
            checks.push({ pass: zhao && zhao.城市 === '未知', msg: '赵六的城市填充为"未知"' });
            checks.push({ pass: /skipEmptyLines/.test(code), msg: '使用了 skipEmptyLines 跳过空行' });
            checks.push({ pass: /trim/.test(code), msg: '使用了 trim() 去除空格' });
            checks.push({ pass: /parseInt|parseFloat|Number/.test(code), msg: '进行了数字类型转换' });
            return checks;
        }
    },

    // ===== 第五阶段：综合应用 =====
    {
        id: 15,
        title: 'ZIP 打包导出',
        description: '用 JSZip 将多种格式文件打包为 ZIP',
        tutorial: `
            <p><strong>JSZip</strong> 可以在浏览器中创建 ZIP 压缩包，适合批量导出多个文件：</p>
            <div class="syntax-block">// 1. 创建 ZIP 实例
const zip = new JSZip();

// 2. 添加文本文件
zip.file('data.csv', csvText);
zip.file('config.json', jsonText);

// 3. 添加二进制文件（如 Excel）
const xlsxData = XLSX.write(wb, {
    type: 'array', bookType: 'xlsx'
});
zip.file('report.xlsx', new Uint8Array(xlsxData));

// 4. 生成 ZIP（异步）
const blob = await zip.generateAsync({ type: 'blob' });
// 然后可下载 blob</div>
        `,
        task: `将 <code>employees</code> 数据同时导出为三种格式并打包为 ZIP：<br>1. <code>employees.csv</code> — CSV 格式（用 Papa.unparse）<br>2. <code>employees.xlsx</code> — Excel 格式（表名"员工数据"）<br>3. <code>employees.json</code> — JSON 格式（格式化缩进）<br>将 JSZip 实例赋值给 <code>result</code>。`,
        sampleData: `<p><span class="var-name">employees</span> <span class="var-type">Array&lt;Object&gt;</span> — 8 条员工数据</p>
            <div class="data-block">与前几关相同的完整员工数据（张三、李四...郑十）</div>`,
        getContext() { return { employees: JSON.parse(JSON.stringify(EMPLOYEE_DATA)) }; },
        hint: `const zip = new JSZip();

// CSV
const csv = Papa.unparse(employees);
zip.file('employees.csv', csv);

// Excel
const wb = XLSX.utils.book_new();
const ws = XLSX.utils.json_to_sheet(employees);
XLSX.utils.book_append_sheet(wb, ws, '员工数据');
const xlsxBuf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
zip.file('employees.xlsx', new Uint8Array(xlsxBuf));

// JSON
zip.file('employees.json', JSON.stringify(employees, null, 2));

result = zip;`,
        answer: `const zip = new JSZip();

// CSV
const csv = Papa.unparse(employees);
zip.file('employees.csv', csv);

// Excel
const wb = XLSX.utils.book_new();
const ws = XLSX.utils.json_to_sheet(employees);
XLSX.utils.book_append_sheet(wb, ws, '员工数据');
const xlsxBuf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
zip.file('employees.xlsx', new Uint8Array(xlsxBuf));

// JSON
zip.file('employees.json', JSON.stringify(employees, null, 2));

result = zip;`,
        validate(code, { result, logs, error }) {
            const checks = [];
            if (error) { checks.push({ pass: false, msg: '代码执行出错: ' + error }); return checks; }
            checks.push({ pass: result instanceof JSZip, msg: 'result 是 JSZip 实例' });
            const files = result ? Object.keys(result.files) : [];
            checks.push({ pass: files.includes('employees.csv'), msg: '包含 employees.csv' });
            checks.push({ pass: files.includes('employees.xlsx'), msg: '包含 employees.xlsx' });
            checks.push({ pass: files.includes('employees.json'), msg: '包含 employees.json' });
            checks.push({ pass: files.length === 3, msg: 'ZIP 内共 3 个文件' });
            checks.push({ pass: /new\s+JSZip/.test(code), msg: '使用了 new JSZip()' });
            checks.push({ pass: /Papa\s*\.\s*unparse/.test(code), msg: '使用了 Papa.unparse() 生成 CSV' });
            checks.push({ pass: /XLSX\s*\.\s*write/.test(code), msg: '使用了 XLSX.write() 生成 Excel 二进制' });
            checks.push({ pass: /JSON\s*\.\s*stringify/.test(code), msg: '使用了 JSON.stringify() 生成 JSON' });
            return checks;
        }
    }
];

// ===== 代码执行引擎 =====
async function executeUserCode(userCode, context) {
    const logs = [];
    const log = (...args) => {
        logs.push(args.map(a => {
            if (a === null) return 'null';
            if (a === undefined) return 'undefined';
            if (a instanceof Blob) return `Blob { size: ${a.size}, type: "${a.type}" }`;
            if (a instanceof Uint8Array) return `Uint8Array [${a.length} bytes]`;
            if (typeof a === 'object') {
                try { return JSON.stringify(a, null, 2); }
                catch { return String(a); }
            }
            return String(a);
        }).join(' '));
    };

    const paramNames = Object.keys(context);
    const paramValues = Object.values(context);

    try {
        const fn = new AsyncFunction(
            'log', 'console', 'XLSX', 'Papa', 'JSZip',
            ...paramNames,
            'let result;\n' + userCode + '\nreturn result;'
        );
        const mockConsole = { log: log, warn: log, error: log, info: log };
        const result = await fn(log, mockConsole, XLSX, Papa, JSZip, ...paramValues);
        return { result, logs, error: null };
    } catch (err) {
        return { result: undefined, logs, error: err.message };
    }
}

function formatResult(val) {
    if (val === undefined) return 'undefined';
    if (val === null) return 'null';
    if (val instanceof Blob) return `Blob { size: ${val.size}, type: "${val.type}" }`;
    if (val instanceof Uint8Array) return `Uint8Array [${val.length} bytes]`;
    if (val instanceof JSZip) {
        const files = Object.keys(val.files);
        return `JSZip { files: [${files.map(f => '"' + f + '"').join(', ')}] }`;
    }
    if (val && val.SheetNames) {
        let s = `Workbook { sheets: [${val.SheetNames.map(n => '"' + n + '"').join(', ')}] }`;
        val.SheetNames.forEach(name => {
            const ws = val.Sheets[name];
            if (ws) {
                const data = XLSX.utils.sheet_to_json(ws, { header: 1 });
                if (data.length > 0) {
                    s += `\n\n📄 ${name}:`;
                    data.slice(0, 6).forEach((row, i) => {
                        s += '\n  ' + (Array.isArray(row) ? row.join(' | ') : String(row));
                    });
                    if (data.length > 6) s += `\n  ... (共 ${data.length} 行)`;
                }
            }
        });
        return s;
    }
    if (typeof val === 'object') {
        try {
            const str = JSON.stringify(val, null, 2);
            return str.length > 2000 ? str.substring(0, 2000) + '\n... (已截断)' : str;
        } catch { return String(val); }
    }
    return String(val);
}

// ===== 全局状态 =====
let currentLevelIdx = -1;

function getProgress() {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || {}; }
    catch { return {}; }
}

function saveProgress(levelId) {
    const p = getProgress();
    p[levelId] = true;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(p));
}

function isLevelCompleted(levelId) {
    return !!getProgress()[levelId];
}

function isLevelUnlocked(idx) {
    if (idx === 0) return true;
    return isLevelCompleted(LEVELS[idx - 1].id);
}

function getCompletedCount() {
    const p = getProgress();
    return LEVELS.filter(l => p[l.id]).length;
}

// ===== UI 渲染 =====
function goBack() {
    if (currentLevelIdx >= 0) {
        showLevelSelect();
    } else {
        window.location.href = '../../index.html';
    }
}

function showLevelSelect() {
    currentLevelIdx = -1;
    document.getElementById('levelSelect').style.display = '';
    document.getElementById('levelDetail').style.display = 'none';
    renderLevelGrid();
}

function renderLevelGrid() {
    const grid = document.getElementById('levelGrid');
    const completed = getCompletedCount();

    document.getElementById('totalProgress').style.width = (completed / LEVELS.length * 100) + '%';
    document.getElementById('progressText').textContent = `已完成 ${completed} / ${LEVELS.length} 关`;

    grid.innerHTML = LEVELS.map((level, idx) => {
        const done = isLevelCompleted(level.id);
        const unlocked = isLevelUnlocked(idx);
        let cls = 'level-card';
        if (done) cls += ' completed';
        if (!unlocked) cls += ' locked';
        return `
            <div class="${cls}" data-idx="${idx}">
                ${!unlocked ? '<div class="lock-icon">🔒</div>' : ''}
                <div class="level-number">第 ${level.id} 关</div>
                <div class="level-card-title">${level.title}</div>
                <div class="level-card-desc">${level.description}</div>
            </div>
        `;
    }).join('');

    grid.querySelectorAll('.level-card:not(.locked)').forEach(card => {
        card.addEventListener('click', () => {
            openLevel(parseInt(card.dataset.idx));
        });
    });
}

function openLevel(idx) {
    currentLevelIdx = idx;
    const level = LEVELS[idx];

    document.getElementById('levelSelect').style.display = 'none';
    document.getElementById('levelDetail').style.display = '';

    document.getElementById('levelTitle').textContent = `第 ${level.id} 关：${level.title}`;
    document.getElementById('tutorialContent').innerHTML = level.tutorial;
    document.getElementById('taskContent').innerHTML = level.task;
    document.getElementById('dataPreview').innerHTML = level.sampleData;

    document.getElementById('codeEditor').value = '';
    document.getElementById('resultArea').innerHTML = '<p class="placeholder-text">编写代码后点击运行查看结果</p>';
    document.getElementById('hintBox').style.display = 'none';
    document.getElementById('expectedSection').style.display = 'none';

    document.getElementById('btnPrevLevel').disabled = (idx === 0);
    const nextUnlocked = idx + 1 < LEVELS.length && isLevelUnlocked(idx + 1);
    document.getElementById('btnNextLevel').disabled = !nextUnlocked;
}

async function handleRun() {
    const level = LEVELS[currentLevelIdx];
    const code = document.getElementById('codeEditor').value.trim();
    if (!code) return;

    const resultArea = document.getElementById('resultArea');
    resultArea.innerHTML = '<p class="placeholder-text">⏳ 正在执行...</p>';

    const context = level.getContext();
    const execResult = await executeUserCode(code, context);
    const checks = level.validate(code, execResult);
    const allPass = checks.every(c => c.pass);

    let html = '';

    // 显示日志
    if (execResult.logs.length > 0) {
        html += '<div class="log-label">📝 控制台输出：</div>';
        html += '<div class="log-output">' + escapeHtml(execResult.logs.join('\n')) + '</div>';
    }

    // 显示错误
    if (execResult.error) {
        html += '<div class="error-msg">❌ ' + escapeHtml(execResult.error) + '</div>';
    }

    // 显示结果
    if (execResult.result !== undefined) {
        html += '<div class="log-label">📦 result 值：</div>';
        html += '<div class="result-display">' + escapeHtml(formatResult(execResult.result)) + '</div>';
    }

    // 显示检查结果
    html += '<ul class="check-list">';
    checks.forEach(c => {
        const cls = c.pass ? 'pass' : 'fail';
        const icon = c.pass ? '✅' : '❌';
        html += `<li class="${cls}"><span class="check-icon">${icon}</span>${escapeHtml(c.msg)}</li>`;
    });
    html += '</ul>';

    if (allPass) {
        resultArea.innerHTML = '<div class="success-msg">🎉 完全正确！所有检查点都通过了。</div>' + html;
        document.getElementById('expectedSection').style.display = 'none';
        saveProgress(level.id);
        showSuccessModal(level);
    } else {
        const passCount = checks.filter(c => c.pass).length;
        resultArea.innerHTML = `<div class="fail-msg">⚠️ 通过 ${passCount}/${checks.length} 项检查，请继续完善。</div>` + html;
        const expectedSection = document.getElementById('expectedSection');
        expectedSection.style.display = '';
        document.getElementById('expectedArea').innerHTML =
            '<div class="answer-label">参考代码：</div>' +
            `<div class="answer-block">${escapeHtml(level.answer)}</div>`;
    }
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function showSuccessModal(level) {
    const modal = document.getElementById('successModal');
    const idx = LEVELS.indexOf(level);
    const isLast = idx === LEVELS.length - 1;

    document.getElementById('successMsg').textContent = isLast
        ? '你已完成所有关卡，JS 文件处理技能已全部掌握！'
        : `你已掌握「${level.title}」，继续挑战下一关吧！`;

    document.getElementById('btnNextFromModal').style.display = isLast ? 'none' : '';
    modal.style.display = 'flex';
}

function handleHint() {
    const level = LEVELS[currentLevelIdx];
    const box = document.getElementById('hintBox');
    box.textContent = level.hint;
    box.style.display = box.style.display === 'none' ? '' : 'none';
}

// ===== 事件绑定 =====
document.addEventListener('DOMContentLoaded', () => {
    showLevelSelect();

    document.getElementById('btnRun').addEventListener('click', handleRun);
    document.getElementById('btnHint').addEventListener('click', handleHint);

    document.getElementById('btnPrevLevel').addEventListener('click', () => {
        if (currentLevelIdx > 0) openLevel(currentLevelIdx - 1);
    });

    document.getElementById('btnNextLevel').addEventListener('click', () => {
        if (currentLevelIdx < LEVELS.length - 1 && isLevelUnlocked(currentLevelIdx + 1)) {
            openLevel(currentLevelIdx + 1);
        }
    });

    document.getElementById('btnBackToList').addEventListener('click', () => {
        document.getElementById('successModal').style.display = 'none';
        showLevelSelect();
    });

    document.getElementById('btnNextFromModal').addEventListener('click', () => {
        document.getElementById('successModal').style.display = 'none';
        if (currentLevelIdx < LEVELS.length - 1) {
            openLevel(currentLevelIdx + 1);
        }
    });

    document.getElementById('codeEditor').addEventListener('keydown', (e) => {
        if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
            e.preventDefault();
            handleRun();
        }
        if (e.key === 'Tab') {
            e.preventDefault();
            const editor = e.target;
            const start = editor.selectionStart;
            const end = editor.selectionEnd;
            editor.value = editor.value.substring(0, start) + '    ' + editor.value.substring(end);
            editor.selectionStart = editor.selectionEnd = start + 4;
        }
    });
});

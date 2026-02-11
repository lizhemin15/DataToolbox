// ===== 关卡数据 =====
const LEVELS = [
    {
        id: 1,
        title: '创建工作簿',
        description: '认识 SheetJS，创建第一个工作簿',
        tutorial: `
            <p><strong>SheetJS（XLSX.js）</strong>是一个强大的 JavaScript 库，可以在浏览器中读写 Excel 文件，无需后端支持。</p>
            <p>在 SheetJS 中，一个 Excel 文件被称为<strong>工作簿（Workbook）</strong>。使用以下方法创建一个空工作簿：</p>
            <div class="syntax-block">var wb = XLSX.utils.book_new();</div>
            <p>创建后的工作簿对象包含两个核心属性：</p>
            <ul style="margin:8px 0 8px 20px;line-height:2;">
                <li><code>SheetNames</code>：工作表名称列表（数组）</li>
                <li><code>Sheets</code>：工作表集合（对象）</li>
            </ul>
            <p>这类似于打开一个空的 Excel 文件，里面还没有任何 Sheet 页。</p>
        `,
        task: '使用 <code>XLSX.utils.book_new()</code> 创建一个新的空工作簿，将其赋值给 <code>result</code>。',
        hint: '只需一行代码：var result = XLSX.utils.book_new();',
        setupCode: '',
        previewData: null,
        answer: 'var result = XLSX.utils.book_new();',
        validate(result) {
            var checks = [];
            checks.push({
                pass: result !== undefined && result !== null && typeof result === 'object',
                msg: 'result 应该是一个对象（工作簿）'
            });
            checks.push({
                pass: result && Array.isArray(result.SheetNames),
                msg: '工作簿应包含 SheetNames 数组属性'
            });
            checks.push({
                pass: result && result.SheetNames && result.SheetNames.length === 0,
                msg: '新工作簿的 SheetNames 应为空数组'
            });
            return checks;
        }
    },
    {
        id: 2,
        title: '用二维数组创建工作表',
        description: '学习 aoa_to_sheet，从数组创建 Sheet',
        tutorial: `
            <p><strong>工作表（Worksheet）</strong>是 Excel 中的一个 Sheet 页。SheetJS 提供多种方式创建工作表。</p>
            <p>最直观的方式是从<strong>二维数组</strong>创建，使用 <code>XLSX.utils.aoa_to_sheet()</code>：</p>
            <div class="syntax-block">var data = [
    ['姓名', '年龄'],    // 第一行作为表头
    ['张三', 25],
    ['李四', 30]
];
var ws = XLSX.utils.aoa_to_sheet(data);</div>
            <p>其中 <code>aoa</code> 是 "Array of Arrays"（数组的数组）的缩写。</p>
            <p>创建后的工作表是一个对象，每个单元格以 Excel 地址（如 A1、B2）为 key 存储。</p>
        `,
        task: '已预定义二维数组 <code>data</code>，请使用 <code>XLSX.utils.aoa_to_sheet(data)</code> 将其转换为工作表，赋值给 <code>result</code>。',
        hint: '只需一行：var result = XLSX.utils.aoa_to_sheet(data);',
        setupCode: `
            var data = [
                ['姓名', '部门', '工资'],
                ['张三', '技术部', 12000],
                ['李四', '市场部', 15000],
                ['王五', '技术部', 18000]
            ];
        `,
        previewData: {
            label: '变量 data（二维数组）',
            headers: ['姓名', '部门', '工资'],
            rows: [
                ['张三', '技术部', 12000],
                ['李四', '市场部', 15000],
                ['王五', '技术部', 18000]
            ]
        },
        answer: 'var result = XLSX.utils.aoa_to_sheet(data);',
        validate(result) {
            var checks = [];
            checks.push({
                pass: result !== undefined && typeof result === 'object',
                msg: 'result 应该是一个工作表对象'
            });
            checks.push({
                pass: result && result['A1'] && result['A1'].v === '姓名',
                msg: 'A1 单元格应为 "姓名"'
            });
            checks.push({
                pass: result && result['B1'] && result['B1'].v === '部门',
                msg: 'B1 单元格应为 "部门"'
            });
            checks.push({
                pass: result && result['A2'] && result['A2'].v === '张三',
                msg: 'A2 单元格应为 "张三"'
            });
            checks.push({
                pass: result && result['C4'] && result['C4'].v === 18000,
                msg: 'C4 单元格应为 18000'
            });
            return checks;
        }
    },
    {
        id: 3,
        title: '组装完整工作簿',
        description: '将工作表添加到工作簿中',
        tutorial: `
            <p>创建了工作簿和工作表后，需要将工作表<strong>添加</strong>到工作簿中：</p>
            <div class="syntax-block">XLSX.utils.book_append_sheet(wb, ws, "Sheet名称");</div>
            <p>参数说明：</p>
            <ul style="margin:8px 0 8px 20px;line-height:2;">
                <li><code>wb</code>：目标工作簿</li>
                <li><code>ws</code>：要添加的工作表</li>
                <li>第三个参数：工作表名称（Excel 底部 tab 显示的名称）</li>
            </ul>
            <p>完整创建流程：</p>
            <div class="syntax-block">var wb = XLSX.utils.book_new();
var ws = XLSX.utils.aoa_to_sheet(data);
XLSX.utils.book_append_sheet(wb, ws, '员工表');</div>
        `,
        task: '已预定义二维数组 <code>data</code>，请：①创建工作簿 ②将 <code>data</code> 转为工作表 ③以 <code>"员工信息"</code> 为名称添加到工作簿 ④将工作簿赋值给 <code>result</code>。',
        hint: '分三步：book_new() 创建工作簿 → aoa_to_sheet(data) 创建工作表 → book_append_sheet(wb, ws, "员工信息") 添加到工作簿 → var result = wb;',
        setupCode: `
            var data = [
                ['姓名', '部门', '工资'],
                ['张三', '技术部', 12000],
                ['李四', '市场部', 15000],
                ['王五', '技术部', 18000],
                ['赵六', '人事部', 8000]
            ];
        `,
        previewData: {
            label: '变量 data（二维数组）',
            headers: ['姓名', '部门', '工资'],
            rows: [
                ['张三', '技术部', 12000],
                ['李四', '市场部', 15000],
                ['王五', '技术部', 18000],
                ['赵六', '人事部', 8000]
            ]
        },
        answer: `var wb = XLSX.utils.book_new();
var ws = XLSX.utils.aoa_to_sheet(data);
XLSX.utils.book_append_sheet(wb, ws, '员工信息');
var result = wb;`,
        validate(result) {
            var checks = [];
            checks.push({
                pass: result && Array.isArray(result.SheetNames),
                msg: 'result 应该是一个工作簿对象'
            });
            checks.push({
                pass: result && result.SheetNames && result.SheetNames.indexOf('员工信息') !== -1,
                msg: '工作簿应包含名为 "员工信息" 的工作表'
            });
            var ws = result && result.Sheets && result.Sheets['员工信息'];
            checks.push({
                pass: ws && ws['A1'] && ws['A1'].v === '姓名',
                msg: '"员工信息" 工作表 A1 应为 "姓名"'
            });
            checks.push({
                pass: ws && ws['A5'] && ws['A5'].v === '赵六',
                msg: '"员工信息" 工作表应包含全部4行数据'
            });
            return checks;
        }
    },
    {
        id: 4,
        title: '从 JSON 创建工作表',
        description: '用 json_to_sheet 从 JSON 数组创建',
        tutorial: `
            <p>实际工作中，数据通常以 <strong>JSON 格式</strong>存在（如从接口获取的数据）。SheetJS 可以直接将 JSON 数组转为工作表：</p>
            <div class="syntax-block">var jsonData = [
    { 姓名: '张三', 年龄: 25 },
    { 姓名: '李四', 年龄: 30 }
];
var ws = XLSX.utils.json_to_sheet(jsonData);</div>
            <p>JSON 对象的 <strong>key 会自动成为表头</strong>（第一行），每个对象对应一行数据。</p>
            <p>这是实际开发中最常用的创建工作表方式。</p>
        `,
        task: '已预定义 JSON 数组 <code>jsonData</code>，请用 <code>XLSX.utils.json_to_sheet(jsonData)</code> 转为工作表，赋值给 <code>result</code>。',
        hint: '只需一行：var result = XLSX.utils.json_to_sheet(jsonData);',
        setupCode: `
            var jsonData = [
                { 姓名: '张三', 部门: '技术部', 职位: '工程师', 工资: 12000 },
                { 姓名: '李四', 部门: '市场部', 职位: '经理', 工资: 15000 },
                { 姓名: '王五', 部门: '技术部', 职位: '高级工程师', 工资: 18000 },
                { 姓名: '赵六', 部门: '人事部', 职位: '专员', 工资: 8000 },
                { 姓名: '孙七', 部门: '市场部', 职位: '专员', 工资: 9000 }
            ];
        `,
        previewData: {
            label: '变量 jsonData（JSON 数组）',
            headers: ['姓名', '部门', '职位', '工资'],
            rows: [
                ['张三', '技术部', '工程师', 12000],
                ['李四', '市场部', '经理', 15000],
                ['王五', '技术部', '高级工程师', 18000],
                ['赵六', '人事部', '专员', 8000],
                ['孙七', '市场部', '专员', 9000]
            ]
        },
        answer: 'var result = XLSX.utils.json_to_sheet(jsonData);',
        validate(result) {
            var checks = [];
            checks.push({
                pass: result !== undefined && typeof result === 'object',
                msg: 'result 应该是一个工作表对象'
            });
            checks.push({
                pass: result && result['A1'] && result['A1'].v === '姓名',
                msg: 'A1 单元格应为 "姓名"（自动生成的表头）'
            });
            checks.push({
                pass: result && result['D1'] && result['D1'].v === '工资',
                msg: 'D1 单元格应为 "工资"'
            });
            checks.push({
                pass: result && result['A2'] && result['A2'].v === '张三',
                msg: 'A2 单元格应为 "张三"'
            });
            checks.push({
                pass: result && result['D3'] && result['D3'].v === 15000,
                msg: 'D3（李四的工资）应为 15000'
            });
            return checks;
        }
    },
    {
        id: 5,
        title: '工作表转 JSON',
        description: '学习 sheet_to_json，最常用的读取方式',
        tutorial: `
            <p>读取 Excel 数据最常用的方式是转为 <strong>JSON 数组</strong>：</p>
            <div class="syntax-block">var json = XLSX.utils.sheet_to_json(ws);</div>
            <p>返回格式（以第一行为 key）：</p>
            <div class="syntax-block">[
    { 姓名: '张三', 部门: '技术部', 工资: 12000 },
    { 姓名: '李四', 部门: '市场部', 工资: 15000 }
]</div>
            <p>这是处理 Excel 数据<strong>最推荐</strong>的方式——转为 JSON 后可以直接用 JavaScript 数组方法（filter、map、sort 等）处理。</p>
        `,
        task: '已预定义工作表 <code>ws</code>（包含员工数据），请将其转为 JSON 数组，赋值给 <code>result</code>。',
        hint: '使用 XLSX.utils.sheet_to_json(ws) 即可将工作表转为 JSON 数组。',
        setupCode: `
            var ws = XLSX.utils.aoa_to_sheet([
                ['姓名', '部门', '工资'],
                ['张三', '技术部', 12000],
                ['李四', '市场部', 15000],
                ['王五', '技术部', 18000],
                ['赵六', '人事部', 8000],
                ['孙七', '市场部', 9000]
            ]);
        `,
        previewData: {
            label: '工作表 ws 的内容',
            headers: ['姓名', '部门', '工资'],
            rows: [
                ['张三', '技术部', 12000],
                ['李四', '市场部', 15000],
                ['王五', '技术部', 18000],
                ['赵六', '人事部', 8000],
                ['孙七', '市场部', 9000]
            ]
        },
        answer: 'var result = XLSX.utils.sheet_to_json(ws);',
        validate(result) {
            var checks = [];
            checks.push({
                pass: Array.isArray(result),
                msg: 'result 应该是一个数组'
            });
            checks.push({
                pass: result && result.length === 5,
                msg: '数组应包含 5 条记录'
            });
            checks.push({
                pass: result && result[0] && result[0]['姓名'] === '张三',
                msg: '第一条记录的姓名应为 "张三"'
            });
            checks.push({
                pass: result && result[0] && result[0]['工资'] === 12000,
                msg: '第一条记录的工资应为 12000'
            });
            checks.push({
                pass: result && result[4] && result[4]['姓名'] === '孙七',
                msg: '第五条记录的姓名应为 "孙七"'
            });
            return checks;
        }
    },
    {
        id: 6,
        title: '工作表转二维数组',
        description: '用 header:1 参数获取原始数组格式',
        tutorial: `
            <p>除了 JSON 格式，还可以将工作表转为<strong>二维数组</strong>：</p>
            <div class="syntax-block">var arr = XLSX.utils.sheet_to_json(ws, { header: 1 });</div>
            <p>设置 <code>header: 1</code> 表示不使用第一行作为 key，返回纯粹的二维数组：</p>
            <div class="syntax-block">[
    ['姓名', '部门', '工资'],   // 表头也在其中
    ['张三', '技术部', 12000],
    ['李四', '市场部', 15000]
]</div>
            <p>这种格式适合需要处理表头行，或表头不规则的场景。</p>
        `,
        task: '已预定义工作表 <code>ws</code>，请将其转为二维数组（包含表头行），赋值给 <code>result</code>。',
        hint: '使用 XLSX.utils.sheet_to_json(ws, { header: 1 }) 加上 header: 1 参数。',
        setupCode: `
            var ws = XLSX.utils.aoa_to_sheet([
                ['姓名', '部门', '工资'],
                ['张三', '技术部', 12000],
                ['李四', '市场部', 15000],
                ['王五', '技术部', 18000],
                ['赵六', '人事部', 8000],
                ['孙七', '市场部', 9000]
            ]);
        `,
        previewData: {
            label: '工作表 ws 的内容',
            headers: ['姓名', '部门', '工资'],
            rows: [
                ['张三', '技术部', 12000],
                ['李四', '市场部', 15000],
                ['王五', '技术部', 18000],
                ['赵六', '人事部', 8000],
                ['孙七', '市场部', 9000]
            ]
        },
        answer: 'var result = XLSX.utils.sheet_to_json(ws, { header: 1 });',
        validate(result) {
            var checks = [];
            checks.push({
                pass: Array.isArray(result),
                msg: 'result 应该是一个数组'
            });
            checks.push({
                pass: result && result.length === 6,
                msg: '数组应包含 6 行（1行表头 + 5行数据）'
            });
            checks.push({
                pass: result && result[0] && result[0][0] === '姓名',
                msg: '第一行第一列应为 "姓名"（表头）'
            });
            checks.push({
                pass: result && result[0] && result[0][2] === '工资',
                msg: '第一行第三列应为 "工资"'
            });
            checks.push({
                pass: result && result[1] && result[1][0] === '张三',
                msg: '第二行第一列应为 "张三"'
            });
            checks.push({
                pass: result && result[5] && result[5][2] === 9000,
                msg: '最后一行第三列应为 9000'
            });
            return checks;
        }
    },
    {
        id: 7,
        title: '读取单元格',
        description: '用 Excel 地址精确访问单元格数据',
        tutorial: `
            <p>SheetJS 工作表中，每个单元格用 <strong>Excel 地址</strong>引用：</p>
            <ul style="margin:8px 0 8px 20px;line-height:2;">
                <li><code>A1</code> = 第1列第1行</li>
                <li><code>B3</code> = 第2列第3行</li>
                <li><code>C5</code> = 第3列第5行</li>
            </ul>
            <p>访问方式：<code>ws['A1']</code>，返回一个<strong>单元格对象</strong>，包含：</p>
            <ul style="margin:8px 0 8px 20px;line-height:2;">
                <li><code>v</code>：值（value）</li>
                <li><code>t</code>：类型（<code>'s'</code>=字符串, <code>'n'</code>=数字, <code>'b'</code>=布尔值）</li>
            </ul>
            <div class="syntax-block">var name = ws['A2'].v;   // 获取 A2 的值
var salary = ws['C3'].v;  // 获取 C3 的值</div>
        `,
        task: '已预定义工作表 <code>ws</code>。请读取 <code>B3</code> 单元格（李四的部门）和 <code>C4</code> 单元格（王五的工资）的值，将它们组成对象 <code>{ dept: B3的值, salary: C4的值 }</code> 赋值给 <code>result</code>。',
        hint: '使用 ws["B3"].v 和 ws["C4"].v 分别获取两个单元格的值。',
        setupCode: `
            var ws = XLSX.utils.aoa_to_sheet([
                ['姓名', '部门', '工资'],
                ['张三', '技术部', 12000],
                ['李四', '市场部', 15000],
                ['王五', '技术部', 18000],
                ['赵六', '人事部', 8000]
            ]);
        `,
        previewData: {
            label: '工作表 ws 的内容（注意行号从1开始，第1行是表头）',
            headers: ['', 'A列(姓名)', 'B列(部门)', 'C列(工资)'],
            rows: [
                ['第1行', '姓名', '部门', '工资'],
                ['第2行', '张三', '技术部', 12000],
                ['第3行', '李四', '市场部', 15000],
                ['第4行', '王五', '技术部', 18000],
                ['第5行', '赵六', '人事部', 8000]
            ]
        },
        answer: `var result = {
    dept: ws['B3'].v,
    salary: ws['C4'].v
};`,
        validate(result) {
            var checks = [];
            checks.push({
                pass: result !== undefined && typeof result === 'object' && !Array.isArray(result),
                msg: 'result 应该是一个对象'
            });
            checks.push({
                pass: result && result.dept === '市场部',
                msg: 'dept 属性应为 "市场部"（B3 的值）'
            });
            checks.push({
                pass: result && result.salary === 18000,
                msg: 'salary 属性应为 18000（C4 的值）'
            });
            return checks;
        }
    },
    {
        id: 8,
        title: '修改单元格',
        description: '直接修改工作表中的单元格',
        tutorial: `
            <p>修改单元格很直接——直接给单元格引用<strong>赋值</strong>即可：</p>
            <div class="syntax-block">ws['A1'] = { t: 's', v: '新值' };   // 字符串
ws['B2'] = { t: 'n', v: 9999 };     // 数字</div>
            <p>其中 <code>t</code> 表示类型：</p>
            <ul style="margin:8px 0 8px 20px;line-height:2;">
                <li><code>'s'</code>：字符串（string）</li>
                <li><code>'n'</code>：数字（number）</li>
                <li><code>'b'</code>：布尔值（boolean）</li>
            </ul>
            <p>注意：如果修改的位置超出原有数据范围，需要手动更新 <code>ws['!ref']</code> 属性。在现有范围内修改则不需要。</p>
        `,
        task: '已预定义工作表 <code>ws</code>。请将 <code>A2</code>（张三）修改为 <code>"张三丰"</code>，将 <code>C2</code>（张三的工资 12000）修改为 <code>15000</code>，然后将修改后的 <code>ws</code> 赋值给 <code>result</code>。',
        hint: '分别给 ws["A2"] 和 ws["C2"] 赋新的单元格对象，注意类型 t 要对应。',
        setupCode: `
            var ws = XLSX.utils.aoa_to_sheet([
                ['姓名', '部门', '工资'],
                ['张三', '技术部', 12000],
                ['李四', '市场部', 15000],
                ['王五', '技术部', 18000],
                ['赵六', '人事部', 8000]
            ]);
        `,
        previewData: {
            label: '工作表 ws 的内容',
            headers: ['姓名', '部门', '工资'],
            rows: [
                ['张三', '技术部', 12000],
                ['李四', '市场部', 15000],
                ['王五', '技术部', 18000],
                ['赵六', '人事部', 8000]
            ]
        },
        answer: `ws['A2'] = { t: 's', v: '张三丰' };
ws['C2'] = { t: 'n', v: 15000 };
var result = ws;`,
        validate(result) {
            var checks = [];
            checks.push({
                pass: result !== undefined && typeof result === 'object',
                msg: 'result 应该是一个工作表对象'
            });
            checks.push({
                pass: result && result['A2'] && result['A2'].v === '张三丰',
                msg: 'A2 单元格应修改为 "张三丰"'
            });
            checks.push({
                pass: result && result['C2'] && result['C2'].v === 15000,
                msg: 'C2 单元格应修改为 15000'
            });
            checks.push({
                pass: result && result['A1'] && result['A1'].v === '姓名',
                msg: 'A1（表头）不应被修改，仍为 "姓名"'
            });
            checks.push({
                pass: result && result['B2'] && result['B2'].v === '技术部',
                msg: 'B2（部门）不应被修改，仍为 "技术部"'
            });
            return checks;
        }
    },
    {
        id: 9,
        title: '数据筛选',
        description: '从 Excel 数据中筛选符合条件的行',
        tutorial: `
            <p>处理 Excel 数据时，经常需要<strong>筛选</strong>出满足条件的行。结合 <code>sheet_to_json</code> 和数组的 <code>filter</code> 方法即可实现：</p>
            <div class="syntax-block">// 1. 转为 JSON
var data = XLSX.utils.sheet_to_json(ws);

// 2. 筛选（例：工资 > 10000 的员工）
var filtered = data.filter(function(row) {
    return row['工资'] > 10000;
});</div>
            <p>这就是<strong>"读取 → 处理"</strong>的基本数据处理模式，后续还可以用 <code>json_to_sheet</code> 把结果转回工作表。</p>
        `,
        task: '已预定义工作表 <code>ws</code>（8名员工数据），请筛选出<strong>部门为 "技术部"</strong> 的员工数据（JSON 数组），赋值给 <code>result</code>。',
        hint: '先用 sheet_to_json(ws) 转为数组，再用 filter 筛选部门等于 "技术部" 的记录。',
        setupCode: `
            var ws = XLSX.utils.aoa_to_sheet([
                ['姓名', '部门', '职位', '工资'],
                ['张三', '技术部', '工程师', 12000],
                ['李四', '市场部', '经理', 15000],
                ['王五', '技术部', '高级工程师', 18000],
                ['赵六', '人事部', '专员', 8000],
                ['孙七', '市场部', '专员', 9000],
                ['周八', '财务部', '会计', 10000],
                ['吴九', '技术部', '实习生', 5000],
                ['郑十', '财务部', '经理', 16000]
            ]);
        `,
        previewData: {
            label: '工作表 ws 的内容',
            headers: ['姓名', '部门', '职位', '工资'],
            rows: [
                ['张三', '技术部', '工程师', 12000],
                ['李四', '市场部', '经理', 15000],
                ['王五', '技术部', '高级工程师', 18000],
                ['赵六', '人事部', '专员', 8000],
                ['孙七', '市场部', '专员', 9000],
                ['周八', '财务部', '会计', 10000],
                ['吴九', '技术部', '实习生', 5000],
                ['郑十', '财务部', '经理', 16000]
            ]
        },
        answer: `var data = XLSX.utils.sheet_to_json(ws);
var result = data.filter(function(row) {
    return row['部门'] === '技术部';
});`,
        validate(result) {
            var checks = [];
            checks.push({
                pass: Array.isArray(result),
                msg: 'result 应该是一个数组'
            });
            checks.push({
                pass: result && result.length === 3,
                msg: '技术部共有 3 名员工'
            });
            var allTech = result && result.every(function(r) { return r['部门'] === '技术部'; });
            checks.push({
                pass: allTech,
                msg: '所有记录的部门应为 "技术部"'
            });
            var names = result ? result.map(function(r) { return r['姓名']; }) : [];
            checks.push({
                pass: names.indexOf('张三') !== -1 && names.indexOf('王五') !== -1 && names.indexOf('吴九') !== -1,
                msg: '应包含张三、王五、吴九三人'
            });
            return checks;
        }
    },
    {
        id: 10,
        title: '数据排序',
        description: '对 Excel 数据按指定字段排序',
        tutorial: `
            <p>对 Excel 数据排序同样使用<strong>"读取 → 处理"</strong>模式：</p>
            <div class="syntax-block">var data = XLSX.utils.sheet_to_json(ws);

// 按工资降序排序（大→小）
data.sort(function(a, b) {
    return b['工资'] - a['工资'];
});</div>
            <p>排序规则：</p>
            <ul style="margin:8px 0 8px 20px;line-height:2;">
                <li><strong>升序</strong>（小→大）：<code>a.字段 - b.字段</code></li>
                <li><strong>降序</strong>（大→小）：<code>b.字段 - a.字段</code></li>
                <li><strong>字符串排序</strong>：<code>a.字段.localeCompare(b.字段)</code></li>
            </ul>
        `,
        task: '已预定义工作表 <code>ws</code>，请将员工数据按<strong>工资从高到低</strong>排序，将排序后的 JSON 数组赋值给 <code>result</code>。',
        hint: '先 sheet_to_json 转为数组，再用 sort 方法按工资字段降序排序（b - a）。',
        setupCode: `
            var ws = XLSX.utils.aoa_to_sheet([
                ['姓名', '部门', '职位', '工资'],
                ['张三', '技术部', '工程师', 12000],
                ['李四', '市场部', '经理', 15000],
                ['王五', '技术部', '高级工程师', 18000],
                ['赵六', '人事部', '专员', 8000],
                ['孙七', '市场部', '专员', 9000],
                ['周八', '财务部', '会计', 10000],
                ['吴九', '技术部', '实习生', 5000],
                ['郑十', '财务部', '经理', 16000]
            ]);
        `,
        previewData: {
            label: '工作表 ws 的内容',
            headers: ['姓名', '部门', '职位', '工资'],
            rows: [
                ['张三', '技术部', '工程师', 12000],
                ['李四', '市场部', '经理', 15000],
                ['王五', '技术部', '高级工程师', 18000],
                ['赵六', '人事部', '专员', 8000],
                ['孙七', '市场部', '专员', 9000],
                ['周八', '财务部', '会计', 10000],
                ['吴九', '技术部', '实习生', 5000],
                ['郑十', '财务部', '经理', 16000]
            ]
        },
        answer: `var data = XLSX.utils.sheet_to_json(ws);
data.sort(function(a, b) {
    return b['工资'] - a['工资'];
});
var result = data;`,
        validate(result) {
            var checks = [];
            checks.push({
                pass: Array.isArray(result),
                msg: 'result 应该是一个数组'
            });
            checks.push({
                pass: result && result.length === 8,
                msg: '数组应包含 8 条记录'
            });
            checks.push({
                pass: result && result[0] && result[0]['姓名'] === '王五' && result[0]['工资'] === 18000,
                msg: '第一名应为王五（工资 18000）'
            });
            checks.push({
                pass: result && result[result.length - 1] && result[result.length - 1]['姓名'] === '吴九' && result[result.length - 1]['工资'] === 5000,
                msg: '最后一名应为吴九（工资 5000）'
            });
            var sorted = result && result.every(function(r, i) {
                if (i === 0) return true;
                return r['工资'] <= result[i - 1]['工资'];
            });
            checks.push({
                pass: sorted,
                msg: '工资应按从高到低排列'
            });
            return checks;
        }
    },
    {
        id: 11,
        title: '数据分组统计',
        description: '按部门统计人数和平均工资',
        tutorial: `
            <p><strong>分组统计</strong>是数据工作中的高频需求，如"各部门平均工资"、"各部门人数"。</p>
            <p>思路：用一个对象收集各分组的数据，最后转为数组：</p>
            <div class="syntax-block">var data = XLSX.utils.sheet_to_json(ws);
var groups = {};
data.forEach(function(row) {
    var key = row['部门'];
    if (!groups[key]) {
        groups[key] = { 部门: key, 人数: 0, 总工资: 0 };
    }
    groups[key].人数++;
    groups[key].总工资 += row['工资'];
});
var stats = Object.values(groups);</div>
            <p>然后可以进一步计算平均值等指标。</p>
        `,
        task: '已预定义工作表 <code>ws</code>，请统计各部门的<strong>人数</strong>和<strong>平均工资</strong>（取整数），返回格式为 <code>[{部门, 人数, 平均工资}, ...]</code> 的数组，赋值给 <code>result</code>。',
        hint: '先 sheet_to_json 读取数据，用 forEach 遍历，用对象收集各部门的人数和总工资，最后 Object.values 转数组并计算平均值（Math.floor 取整）。',
        setupCode: `
            var ws = XLSX.utils.aoa_to_sheet([
                ['姓名', '部门', '职位', '工资'],
                ['张三', '技术部', '工程师', 12000],
                ['李四', '市场部', '经理', 15000],
                ['王五', '技术部', '高级工程师', 18000],
                ['赵六', '人事部', '专员', 8000],
                ['孙七', '市场部', '专员', 9000],
                ['周八', '财务部', '会计', 10000],
                ['吴九', '技术部', '实习生', 5000],
                ['郑十', '财务部', '经理', 16000]
            ]);
        `,
        previewData: {
            label: '工作表 ws 的内容',
            headers: ['姓名', '部门', '职位', '工资'],
            rows: [
                ['张三', '技术部', '工程师', 12000],
                ['李四', '市场部', '经理', 15000],
                ['王五', '技术部', '高级工程师', 18000],
                ['赵六', '人事部', '专员', 8000],
                ['孙七', '市场部', '专员', 9000],
                ['周八', '财务部', '会计', 10000],
                ['吴九', '技术部', '实习生', 5000],
                ['郑十', '财务部', '经理', 16000]
            ]
        },
        answer: `var data = XLSX.utils.sheet_to_json(ws);
var groups = {};
data.forEach(function(row) {
    var dept = row['部门'];
    if (!groups[dept]) {
        groups[dept] = { 部门: dept, 人数: 0, 总工资: 0 };
    }
    groups[dept].人数++;
    groups[dept].总工资 += row['工资'];
});
var result = Object.values(groups).map(function(g) {
    return {
        部门: g.部门,
        人数: g.人数,
        平均工资: Math.floor(g.总工资 / g.人数)
    };
});`,
        validate(result) {
            var checks = [];
            checks.push({
                pass: Array.isArray(result),
                msg: 'result 应该是一个数组'
            });
            checks.push({
                pass: result && result.length === 4,
                msg: '共有 4 个部门'
            });
            // 预期：技术部3人 avg 11666, 市场部2人 avg 12000, 人事部1人 avg 8000, 财务部2人 avg 13000
            var findDept = function(name) { return result ? result.find(function(r) { return r['部门'] === name; }) : null; };
            var tech = findDept('技术部');
            checks.push({
                pass: tech && tech['人数'] === 3 && tech['平均工资'] === Math.floor((12000 + 18000 + 5000) / 3),
                msg: '技术部：3人，平均工资 ' + Math.floor(35000 / 3)
            });
            var market = findDept('市场部');
            checks.push({
                pass: market && market['人数'] === 2 && market['平均工资'] === 12000,
                msg: '市场部：2人，平均工资 12000'
            });
            var finance = findDept('财务部');
            checks.push({
                pass: finance && finance['人数'] === 2 && finance['平均工资'] === 13000,
                msg: '财务部：2人，平均工资 13000'
            });
            return checks;
        }
    },
    {
        id: 12,
        title: '多 Sheet 读取与合并',
        description: '遍历工作簿中的多个工作表并合并数据',
        tutorial: `
            <p>一个 Excel 文件可能包含多个工作表。SheetJS 通过以下方式访问：</p>
            <div class="syntax-block">// 获取所有工作表名称
var names = wb.SheetNames;  // ['1月', '2月', ...]

// 通过名称获取工作表
var ws = wb.Sheets[names[0]];

// 遍历所有工作表
wb.SheetNames.forEach(function(name) {
    var ws = wb.Sheets[name];
    var data = XLSX.utils.sheet_to_json(ws);
    // 处理 data...
});</div>
            <p><strong>合并多表</strong>的常见模式：遍历所有表，将数据放入同一个数组。</p>
        `,
        task: '已预定义工作簿 <code>wb</code>（含 "1月" 和 "2月" 两个工作表，结构相同），请读取并<strong>合并</strong>两个月的销售数据到一个 JSON 数组中，赋值给 <code>result</code>。',
        hint: '用 wb.SheetNames.forEach 遍历所有 Sheet，对每个 Sheet 用 sheet_to_json 读取后 concat 到结果数组。',
        setupCode: `
            var wb = XLSX.utils.book_new();
            var ws1 = XLSX.utils.aoa_to_sheet([
                ['姓名', '销售额'],
                ['张三', 50000],
                ['李四', 60000]
            ]);
            var ws2 = XLSX.utils.aoa_to_sheet([
                ['姓名', '销售额'],
                ['张三', 55000],
                ['李四', 70000],
                ['王五', 45000]
            ]);
            XLSX.utils.book_append_sheet(wb, ws1, '1月');
            XLSX.utils.book_append_sheet(wb, ws2, '2月');
        `,
        previewData: {
            label: '工作簿 wb 包含两个工作表',
            multi: [
                {
                    sheetName: '1月',
                    headers: ['姓名', '销售额'],
                    rows: [['张三', 50000], ['李四', 60000]]
                },
                {
                    sheetName: '2月',
                    headers: ['姓名', '销售额'],
                    rows: [['张三', 55000], ['李四', 70000], ['王五', 45000]]
                }
            ]
        },
        answer: `var result = [];
wb.SheetNames.forEach(function(name) {
    var ws = wb.Sheets[name];
    var data = XLSX.utils.sheet_to_json(ws);
    result = result.concat(data);
});`,
        validate(result) {
            var checks = [];
            checks.push({
                pass: Array.isArray(result),
                msg: 'result 应该是一个数组'
            });
            checks.push({
                pass: result && result.length === 5,
                msg: '合并后应有 5 条记录（1月2条 + 2月3条）'
            });
            var allHaveFields = result && result.every(function(r) {
                return r['姓名'] !== undefined && r['销售额'] !== undefined;
            });
            checks.push({
                pass: allHaveFields,
                msg: '每条记录应包含"姓名"和"销售额"字段'
            });
            var totalSales = result ? result.reduce(function(s, r) { return s + r['销售额']; }, 0) : 0;
            checks.push({
                pass: totalSales === 280000,
                msg: '总销售额应为 280000'
            });
            return checks;
        }
    },
    {
        id: 13,
        title: '向工作表追加数据',
        description: '使用 sheet_add_aoa 追加行数据',
        tutorial: `
            <p>向已有工作表追加数据，使用 <code>XLSX.utils.sheet_add_aoa()</code>：</p>
            <div class="syntax-block">// 追加到末尾
XLSX.utils.sheet_add_aoa(ws, newRows, { origin: -1 });</div>
            <p><code>origin</code> 参数控制写入位置：</p>
            <ul style="margin:8px 0 8px 20px;line-height:2;">
                <li><code>-1</code>：追加到数据末尾</li>
                <li><code>'A6'</code>：从 A6 单元格开始写入</li>
                <li><code>{ r: 5, c: 0 }</code>：从第6行第1列开始</li>
            </ul>
            <p>也可以用 <code>sheet_add_json</code> 追加 JSON 数据：</p>
            <div class="syntax-block">XLSX.utils.sheet_add_json(ws, jsonArr, { origin: -1, skipHeader: true });</div>
        `,
        task: '已预定义工作表 <code>ws</code>（3行员工数据），请用 <code>XLSX.utils.sheet_add_aoa()</code> 追加两行新数据 <code>[["周八", "财务部", 10000], ["吴九", "技术部", 5000]]</code> 到末尾，将修改后的 <code>ws</code> 赋值给 <code>result</code>。',
        hint: '创建新数据数组，然后调用 XLSX.utils.sheet_add_aoa(ws, newRows, { origin: -1 }); 即可追加。',
        setupCode: `
            var ws = XLSX.utils.aoa_to_sheet([
                ['姓名', '部门', '工资'],
                ['张三', '技术部', 12000],
                ['李四', '市场部', 15000],
                ['王五', '技术部', 18000]
            ]);
        `,
        previewData: {
            label: '工作表 ws 的内容（当前3行数据）',
            headers: ['姓名', '部门', '工资'],
            rows: [
                ['张三', '技术部', 12000],
                ['李四', '市场部', 15000],
                ['王五', '技术部', 18000]
            ]
        },
        answer: `var newRows = [['周八', '财务部', 10000], ['吴九', '技术部', 5000]];
XLSX.utils.sheet_add_aoa(ws, newRows, { origin: -1 });
var result = ws;`,
        validate(result) {
            var checks = [];
            checks.push({
                pass: result !== undefined && typeof result === 'object',
                msg: 'result 应该是一个工作表对象'
            });
            checks.push({
                pass: result && result['A5'] && result['A5'].v === '周八',
                msg: 'A5 应为 "周八"（新追加的第一行）'
            });
            checks.push({
                pass: result && result['B5'] && result['B5'].v === '财务部',
                msg: 'B5 应为 "财务部"'
            });
            checks.push({
                pass: result && result['A6'] && result['A6'].v === '吴九',
                msg: 'A6 应为 "吴九"（新追加的第二行）'
            });
            checks.push({
                pass: result && result['C6'] && result['C6'].v === 5000,
                msg: 'C6 应为 5000'
            });
            return checks;
        }
    },
    {
        id: 14,
        title: '设置列宽',
        description: '设置 Excel 导出时的列宽格式',
        tutorial: `
            <p>导出 Excel 时，默认列宽通常不够。通过 <code>ws['!cols']</code> 可以设置每列的宽度：</p>
            <div class="syntax-block">ws['!cols'] = [
    { wch: 10 },   // 第1列宽10个字符
    { wch: 15 },   // 第2列宽15个字符
    { wch: 12 }    // 第3列宽12个字符
];</div>
            <p><code>wch</code> 表示字符宽度（width in characters），中文字符通常需要更宽。</p>
            <p>实用技巧——<strong>自动计算列宽</strong>：</p>
            <div class="syntax-block">var rows = XLSX.utils.sheet_to_json(ws, {header:1});
var colWidths = rows[0].map(function(h, i) {
    var maxLen = String(h).length;
    rows.forEach(function(row) {
        var len = String(row[i] || '').length;
        if (len > maxLen) maxLen = len;
    });
    return { wch: maxLen + 2 };
});
ws['!cols'] = colWidths;</div>
        `,
        task: '已预定义工作表 <code>ws</code>，请设置列宽：第1列（姓名）<code>wch: 10</code>，第2列（部门）<code>wch: 15</code>，第3列（工资）<code>wch: 12</code>，将修改后的 <code>ws</code> 赋值给 <code>result</code>。',
        hint: '直接给 ws["!cols"] 赋值一个包含三个 {wch: 数值} 对象的数组。',
        setupCode: `
            var ws = XLSX.utils.aoa_to_sheet([
                ['姓名', '部门', '工资'],
                ['张三', '技术部', 12000],
                ['李四', '市场部', 15000],
                ['王五', '技术部', 18000]
            ]);
        `,
        previewData: {
            label: '工作表 ws 的内容',
            headers: ['姓名', '部门', '工资'],
            rows: [
                ['张三', '技术部', 12000],
                ['李四', '市场部', 15000],
                ['王五', '技术部', 18000]
            ]
        },
        answer: `ws['!cols'] = [
    { wch: 10 },
    { wch: 15 },
    { wch: 12 }
];
var result = ws;`,
        validate(result) {
            var checks = [];
            checks.push({
                pass: result !== undefined && typeof result === 'object',
                msg: 'result 应该是一个工作表对象'
            });
            checks.push({
                pass: result && Array.isArray(result['!cols']),
                msg: '工作表应包含 !cols 属性（数组）'
            });
            var cols = result ? result['!cols'] : null;
            checks.push({
                pass: cols && cols.length >= 3,
                msg: '!cols 数组应至少包含 3 个元素'
            });
            checks.push({
                pass: cols && cols[0] && cols[0].wch === 10,
                msg: '第1列宽度应为 10'
            });
            checks.push({
                pass: cols && cols[1] && cols[1].wch === 15,
                msg: '第2列宽度应为 15'
            });
            checks.push({
                pass: cols && cols[2] && cols[2].wch === 12,
                msg: '第3列宽度应为 12'
            });
            return checks;
        }
    },
    {
        id: 15,
        title: '综合实战：数据处理报表',
        description: '综合运用所有技能完成完整的数据处理流程',
        tutorial: `
            <p>恭喜你来到最后一关！这是一个<strong>综合实战</strong>任务，需要组合运用前面学到的所有技能。</p>
            <p>典型的 Excel 数据处理流程：</p>
            <div class="syntax-block">1. 读取数据（sheet_to_json）
2. 数据处理（筛选、排序、统计等）
3. 创建新工作表（json_to_sheet）
4. 组装工作簿（book_new + book_append_sheet）
5. 设置格式（列宽等）</div>
            <p>这就是用 JavaScript 处理 Excel 的<strong>完整工作流</strong>！掌握这套流程，你可以用纯前端代码完成绝大部分数据处理任务。</p>
        `,
        task: `已预定义工作簿 <code>wb</code>（含 "员工表"），请完成以下任务：<br>
            1. 读取 "员工表" 数据<br>
            2. 筛选出<strong>工资 >= 10000</strong> 的员工<br>
            3. 按<strong>工资从高到低</strong>排序<br>
            4. 创建新工作簿，将结果以 <code>"高薪员工"</code> 为 Sheet 名添加<br>
            5. 设置列宽（每列 <code>wch</code> 为 <code>15</code>）<br>
            6. 将新工作簿赋值给 <code>result</code>`,
        hint: '分步完成：sheet_to_json 读取 → filter 筛选 → sort 排序 → json_to_sheet 转工作表 → 设置 !cols → book_new + book_append_sheet 组装 → var result = newWb;',
        setupCode: `
            var wb = XLSX.utils.book_new();
            var ws = XLSX.utils.aoa_to_sheet([
                ['姓名', '部门', '职位', '工资'],
                ['张三', '技术部', '工程师', 12000],
                ['李四', '市场部', '经理', 15000],
                ['王五', '技术部', '高级工程师', 18000],
                ['赵六', '人事部', '专员', 8000],
                ['孙七', '市场部', '专员', 9000],
                ['周八', '财务部', '会计', 10000],
                ['吴九', '技术部', '实习生', 5000],
                ['郑十', '财务部', '经理', 16000]
            ]);
            XLSX.utils.book_append_sheet(wb, ws, '员工表');
        `,
        previewData: {
            label: '工作簿 wb 中的 "员工表"',
            headers: ['姓名', '部门', '职位', '工资'],
            rows: [
                ['张三', '技术部', '工程师', 12000],
                ['李四', '市场部', '经理', 15000],
                ['王五', '技术部', '高级工程师', 18000],
                ['赵六', '人事部', '专员', 8000],
                ['孙七', '市场部', '专员', 9000],
                ['周八', '财务部', '会计', 10000],
                ['吴九', '技术部', '实习生', 5000],
                ['郑十', '财务部', '经理', 16000]
            ]
        },
        answer: `// 1. 读取数据
var data = XLSX.utils.sheet_to_json(wb.Sheets['员工表']);

// 2. 筛选工资 >= 10000
var filtered = data.filter(function(row) {
    return row['工资'] >= 10000;
});

// 3. 按工资降序排序
filtered.sort(function(a, b) {
    return b['工资'] - a['工资'];
});

// 4. 创建新工作簿
var newWb = XLSX.utils.book_new();
var newWs = XLSX.utils.json_to_sheet(filtered);

// 5. 设置列宽
newWs['!cols'] = [
    { wch: 15 }, { wch: 15 }, { wch: 15 }, { wch: 15 }
];

XLSX.utils.book_append_sheet(newWb, newWs, '高薪员工');

// 6. 返回结果
var result = newWb;`,
        validate(result) {
            var checks = [];
            checks.push({
                pass: result && Array.isArray(result.SheetNames),
                msg: 'result 应该是一个工作簿对象'
            });
            checks.push({
                pass: result && result.SheetNames && result.SheetNames.indexOf('高薪员工') !== -1,
                msg: '工作簿应包含名为 "高薪员工" 的工作表'
            });
            var ws = result && result.Sheets ? result.Sheets['高薪员工'] : null;
            var data = [];
            if (ws) {
                try { data = XLSX.utils.sheet_to_json(ws); } catch(e) {}
            }
            checks.push({
                pass: data.length === 5,
                msg: '应有 5 名工资 >= 10000 的员工（王五/郑十/李四/张三/周八）'
            });
            checks.push({
                pass: data.length > 0 && data[0]['姓名'] === '王五' && data[0]['工资'] === 18000,
                msg: '第一名应为王五（工资最高 18000）'
            });
            checks.push({
                pass: data.length >= 5 && data[4]['姓名'] === '周八' && data[4]['工资'] === 10000,
                msg: '最后一名应为周八（工资 10000）'
            });
            var sorted = data.every(function(r, i) {
                if (i === 0) return true;
                return r['工资'] <= data[i - 1]['工资'];
            });
            checks.push({
                pass: sorted,
                msg: '数据应按工资从高到低排列'
            });
            checks.push({
                pass: ws && Array.isArray(ws['!cols']) && ws['!cols'].length >= 4 && ws['!cols'].every(function(c) { return c.wch === 15; }),
                msg: '每列宽度应设置为 15'
            });
            return checks;
        }
    }
];

// ===== 进度管理 =====
const STORAGE_KEY = 'excel_learn_progress';
let currentLevelIdx = -1;

function getProgress() {
    try {
        return JSON.parse(localStorage.getItem(STORAGE_KEY)) || {};
    } catch { return {}; }
}

function saveProgress(levelId) {
    var p = getProgress();
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
    var p = getProgress();
    return LEVELS.filter(function(l) { return p[l.id]; }).length;
}

// ===== 代码执行引擎 =====
function executeUserCode(userCode, setupCode) {
    try {
        var fullCode = setupCode + '\n' + userCode + '\nreturn typeof result !== "undefined" ? result : undefined;';
        var fn = new Function(fullCode);
        var output = fn();
        return { success: true, result: output };
    } catch(e) {
        return { success: false, error: e.message };
    }
}

// ===== 结果格式化显示 =====
function formatResultHTML(result) {
    if (result === undefined) {
        return '<div class="result-value">undefined（未设置 result 变量）</div>';
    }
    if (result === null) {
        return '<div class="result-value">null</div>';
    }

    // 工作簿
    if (result.SheetNames && result.Sheets) {
        var html = '<div class="result-label">工作簿 (Workbook)</div>';
        html += '<div class="result-value">SheetNames: [' + result.SheetNames.map(function(n) { return '"' + n + '"'; }).join(', ') + ']</div>';
        result.SheetNames.forEach(function(name) {
            var ws = result.Sheets[name];
            if (ws) {
                html += '<div class="result-label" style="margin-top:10px;">工作表: ' + name + '</div>';
                html += formatWorksheet(ws);
            }
        });
        return html;
    }

    // 工作表
    if (result['!ref'] || result['A1']) {
        return '<div class="result-label">工作表 (Worksheet)</div>' + formatWorksheet(result);
    }

    // 数组
    if (Array.isArray(result)) {
        if (result.length === 0) {
            return '<div class="result-value">[]（空数组）</div>';
        }
        // 对象数组 -> 表格
        if (typeof result[0] === 'object' && !Array.isArray(result[0])) {
            var keys = Object.keys(result[0]);
            return buildHTMLTable(keys, result.map(function(row) {
                return keys.map(function(k) { return row[k]; });
            }), 'result-table');
        }
        // 二维数组 -> 表格
        if (Array.isArray(result[0])) {
            var headers = result[0].map(function(_, i) { return '列' + (i + 1); });
            return buildHTMLTable(headers, result, 'result-table');
        }
        // 一维数组
        return '<div class="result-value">[' + result.join(', ') + ']</div>';
    }

    // 普通对象
    if (typeof result === 'object') {
        return '<div class="result-value">' + escapeHtml(JSON.stringify(result, null, 2)) + '</div>';
    }

    // 原始类型
    return '<div class="result-value">' + escapeHtml(String(result)) + '</div>';
}

function formatWorksheet(ws) {
    try {
        var data = XLSX.utils.sheet_to_json(ws, { header: 1 });
        if (!data || data.length === 0) return '<div class="result-value">（空工作表）</div>';
        var headers = data[0].map(function(v) { return v !== undefined ? String(v) : ''; });
        var rows = data.slice(1).map(function(row) {
            return headers.map(function(_, i) { return row[i] !== undefined ? row[i] : ''; });
        });
        var colInfo = '';
        if (ws['!cols']) {
            colInfo = '<div style="margin-top:6px;font-size:12px;color:rgba(255,255,255,0.4);">列宽: [' +
                ws['!cols'].map(function(c) { return c && c.wch ? c.wch : '-'; }).join(', ') + ']</div>';
        }
        return buildHTMLTable(headers, rows, 'result-table') + colInfo;
    } catch(e) {
        return '<div class="result-value">（无法解析工作表）</div>';
    }
}

// ===== UI渲染 =====
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
    document.getElementById('appInfo').style.display = '';
    renderLevelGrid();
}

function renderLevelGrid() {
    var grid = document.getElementById('levelGrid');
    var completed = getCompletedCount();

    document.getElementById('totalProgress').style.width = (completed / LEVELS.length * 100) + '%';
    document.getElementById('progressText').textContent = '已完成 ' + completed + ' / ' + LEVELS.length + ' 关';

    grid.innerHTML = LEVELS.map(function(level, idx) {
        var done = isLevelCompleted(level.id);
        var unlocked = isLevelUnlocked(idx);
        var cls = 'level-card';
        if (done) cls += ' completed';
        if (!unlocked) cls += ' locked';
        return '<div class="' + cls + '" data-idx="' + idx + '">' +
            (!unlocked ? '<div class="lock-icon">🔒</div>' : '') +
            '<div class="level-number">第 ' + level.id + ' 关</div>' +
            '<div class="level-card-title">' + level.title + '</div>' +
            '<div class="level-card-desc">' + level.description + '</div>' +
        '</div>';
    }).join('');

    grid.querySelectorAll('.level-card:not(.locked)').forEach(function(card) {
        card.addEventListener('click', function() {
            openLevel(parseInt(card.dataset.idx));
        });
    });
}

function openLevel(idx) {
    currentLevelIdx = idx;
    var level = LEVELS[idx];

    document.getElementById('levelSelect').style.display = 'none';
    document.getElementById('levelDetail').style.display = '';
    document.getElementById('appInfo').style.display = 'none';

    document.getElementById('levelTitle').textContent = '第 ' + level.id + ' 关：' + level.title;
    document.getElementById('tutorialContent').innerHTML = level.tutorial;
    document.getElementById('taskContent').innerHTML = level.task;

    // 渲染数据预览
    var dataSection = document.getElementById('dataSection');
    var dataPreview = document.getElementById('dataPreview');
    if (level.previewData) {
        dataSection.style.display = '';
        dataPreview.innerHTML = renderPreviewData(level.previewData);
    } else {
        dataSection.style.display = 'none';
        dataPreview.innerHTML = '';
    }

    // 编辑器和结果重置
    document.getElementById('codeEditor').value = '';
    document.getElementById('resultArea').innerHTML = '<p class="placeholder-text">运行代码后在此查看结果</p>';
    document.getElementById('hintBox').style.display = 'none';
    document.getElementById('expectedSection').style.display = 'none';

    // 导航按钮
    document.getElementById('btnPrevLevel').disabled = (idx === 0);
    var nextUnlocked = idx + 1 < LEVELS.length && isLevelUnlocked(idx + 1);
    document.getElementById('btnNextLevel').disabled = !nextUnlocked;
}

function renderPreviewData(previewData) {
    if (previewData.multi) {
        return previewData.multi.map(function(sheet) {
            return '<div class="data-label">工作表: ' + sheet.sheetName + '</div>' +
                buildHTMLTable(sheet.headers, sheet.rows, 'preview-table');
        }).join('');
    }
    return '<div class="data-label">' + previewData.label + '</div>' +
        buildHTMLTable(previewData.headers, previewData.rows, 'preview-table');
}

function buildHTMLTable(columns, rows, cls) {
    var html = '<table class="' + cls + '"><thead><tr>';
    columns.forEach(function(c) { html += '<th>' + c + '</th>'; });
    html += '</tr></thead><tbody>';
    rows.forEach(function(row) {
        html += '<tr>';
        row.forEach(function(v) { html += '<td>' + (v === null || v === undefined ? '' : v) + '</td>'; });
        html += '</tr>';
    });
    html += '</tbody></table>';
    return html;
}

function escapeHtml(text) {
    var div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function handleRun() {
    var level = LEVELS[currentLevelIdx];
    var code = document.getElementById('codeEditor').value.trim();
    if (!code) return;

    var resultArea = document.getElementById('resultArea');

    // 执行用户代码
    var execResult = executeUserCode(code, level.setupCode);

    if (!execResult.success) {
        resultArea.innerHTML = '<div class="error-msg">❌ 运行错误：' + escapeHtml(execResult.error) + '</div>';
        return;
    }

    // 显示结果
    var resultHTML = formatResultHTML(execResult.result);

    // 验证
    var checks = level.validate(execResult.result);
    var allPass = checks.every(function(c) { return c.pass; });

    var checkHTML = '<ul class="check-list">';
    checks.forEach(function(c) {
        var cls = c.pass ? 'pass' : 'fail';
        var icon = c.pass ? '✅' : '❌';
        checkHTML += '<li class="' + cls + '"><span class="check-icon">' + icon + '</span>' + c.msg + '</li>';
    });
    checkHTML += '</ul>';

    if (allPass) {
        resultArea.innerHTML = '<div class="success-msg">✅ 完全正确！所有检查点都通过了。</div>' + checkHTML +
            '<div style="margin-top:12px;">' + resultHTML + '</div>';
        document.getElementById('expectedSection').style.display = 'none';
        saveProgress(level.id);
        showSuccessModal(level);
    } else {
        var passCount = checks.filter(function(c) { return c.pass; }).length;
        resultArea.innerHTML = '<div class="fail-msg">⚠️ 通过 ' + passCount + '/' + checks.length + ' 项检查，请继续完善。</div>' +
            checkHTML + '<div style="margin-top:12px;">' + resultHTML + '</div>';
        var expectedSection = document.getElementById('expectedSection');
        expectedSection.style.display = '';
        document.getElementById('expectedArea').innerHTML = '<div class="answer-block">' + escapeHtml(level.answer) + '</div>';
    }
}

function showSuccessModal(level) {
    var modal = document.getElementById('successModal');
    var idx = LEVELS.indexOf(level);
    var isLast = idx === LEVELS.length - 1;

    document.getElementById('successMsg').textContent = isLast
        ? '你已完成所有关卡，Excel 处理技能已掌握！'
        : '你已掌握「' + level.title + '」，继续挑战下一关吧！';

    document.getElementById('btnNextFromModal').style.display = isLast ? 'none' : '';
    modal.style.display = 'flex';
}

function handleHint() {
    var level = LEVELS[currentLevelIdx];
    var box = document.getElementById('hintBox');
    box.textContent = level.hint;
    box.style.display = box.style.display === 'none' ? '' : 'none';
}

// ===== 事件绑定 =====
document.addEventListener('DOMContentLoaded', function() {
    showLevelSelect();

    document.getElementById('btnRun').addEventListener('click', handleRun);
    document.getElementById('btnHint').addEventListener('click', handleHint);

    document.getElementById('btnPrevLevel').addEventListener('click', function() {
        if (currentLevelIdx > 0) openLevel(currentLevelIdx - 1);
    });

    document.getElementById('btnNextLevel').addEventListener('click', function() {
        if (currentLevelIdx < LEVELS.length - 1 && isLevelUnlocked(currentLevelIdx + 1)) {
            openLevel(currentLevelIdx + 1);
        }
    });

    document.getElementById('btnBackToList').addEventListener('click', function() {
        document.getElementById('successModal').style.display = 'none';
        showLevelSelect();
    });

    document.getElementById('btnNextFromModal').addEventListener('click', function() {
        document.getElementById('successModal').style.display = 'none';
        if (currentLevelIdx < LEVELS.length - 1) {
            openLevel(currentLevelIdx + 1);
        }
    });

    // Ctrl+Enter 运行
    document.getElementById('codeEditor').addEventListener('keydown', function(e) {
        if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
            e.preventDefault();
            handleRun();
        }
        // Tab 缩进支持
        if (e.key === 'Tab') {
            e.preventDefault();
            var editor = e.target;
            var start = editor.selectionStart;
            var end = editor.selectionEnd;
            editor.value = editor.value.substring(0, start) + '    ' + editor.value.substring(end);
            editor.selectionStart = editor.selectionEnd = start + 4;
        }
    });
});

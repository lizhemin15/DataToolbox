// ===== Mock Fetch 系统 =====
function createMockEnv(mockHandler) {
    const requests = [];

    async function mockFetch(url, options = {}) {
        const method = (options.method || 'GET').toUpperCase();
        let headers = {};
        if (options.headers) {
            if (typeof options.headers.forEach === 'function') {
                options.headers.forEach((value, key) => { headers[key.toLowerCase()] = value; });
            } else if (typeof options.headers === 'object') {
                for (const [key, value] of Object.entries(options.headers)) {
                    headers[key.toLowerCase()] = value;
                }
            }
        }

        let body = options.body;
        if (typeof body === 'string') {
            try { body = JSON.parse(body); } catch {}
        }

        const req = { url, method, headers, body, rawBody: options.body };
        requests.push(req);

        if (!mockHandler) {
            return makeMockResponse(404, { error: 'Not Found' });
        }

        const res = mockHandler(req);
        if (res.networkError) {
            throw new TypeError(res.networkError);
        }
        return makeMockResponse(res.status || 200, res.body, res.headers);
    }

    function makeMockResponse(status, body, resHeaders) {
        const hdr = resHeaders || {};
        return {
            ok: status >= 200 && status < 300,
            status: status,
            statusText: status === 200 ? 'OK' : status === 201 ? 'Created' : status === 204 ? 'No Content' : status === 404 ? 'Not Found' : status === 401 ? 'Unauthorized' : status === 500 ? 'Internal Server Error' : 'Unknown',
            headers: {
                get: (name) => hdr[name.toLowerCase()] || null,
                has: (name) => name.toLowerCase() in hdr
            },
            json: async () => (typeof body === 'string' ? JSON.parse(body) : JSON.parse(JSON.stringify(body))),
            text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
            clone: function () { return makeMockResponse(status, body, resHeaders); }
        };
    }

    return { mockFetch, requests };
}

// ===== 代码执行引擎 =====
async function executeCode(level, code) {
    if (level.mode === 'json') {
        try {
            const parsed = JSON.parse(code);
            return { result: parsed, requests: [], error: null };
        } catch (e) {
            return { result: null, requests: [], error: e.message };
        }
    }

    const { mockFetch, requests } = createMockEnv(level.mockHandler);

    try {
        const asyncFn = new Function('fetch', `
            return (async () => {
                let result;
                ${level.preCode || ''}
                ${code}
                return result;
            })();
        `);
        const result = await asyncFn(mockFetch);
        return { result, requests, error: null };
    } catch (e) {
        return { result: null, requests, error: e.message };
    }
}

// ===== 关卡数据 =====
const LEVELS = [
    // ===== 第一阶段：JSON 基础 =====
    {
        id: 1,
        title: '初识 JSON 格式',
        description: '了解 JSON 的基本语法规则',
        mode: 'json',
        tutorial: `
            <p><strong>JSON</strong>（JavaScript Object Notation）是一种轻量级的数据交换格式，广泛用于网络请求中的数据传输。</p>
            <p>JSON 对象用花括号 <code>{}</code> 包裹，内部是<strong>键值对</strong>，键必须用<strong>双引号</strong>包裹：</p>
            <div class="syntax-block">{
    "键名": "值",
    "name": "张三",
    "age": 25
}</div>
            <p>注意事项：</p>
            <ul>
                <li>键名必须是<strong>双引号</strong>字符串（不能用单引号）</li>
                <li>值可以是：字符串、数字、布尔值、null、数组、对象</li>
                <li>最后一个键值对后面<strong>不能</strong>有逗号</li>
            </ul>
        `,
        task: '编写一个 JSON 对象，包含 <code>name</code>（字符串类型）和 <code>age</code>（数字类型）两个字段。',
        hint: '{\n    "name": "张三",\n    "age": 25\n}',
        context: `
            <div class="context-label">JSON 语法规则：</div>
            <div class="api-block">• 键名: 必须用双引号包裹
• 字符串值: 必须用双引号包裹
• 数字值: 直接书写，不加引号
• 示例: {"name": "张三", "age": 25}</div>
        `,
        answer: '{\n    "name": "张三",\n    "age": 25\n}',
        validate(code) {
            const checks = [];
            let parsed;
            try {
                parsed = JSON.parse(code);
                checks.push({ pass: true, msg: 'JSON 格式正确，解析成功' });
            } catch (e) {
                checks.push({ pass: false, msg: 'JSON 格式错误：' + e.message });
                return checks;
            }
            checks.push({
                pass: typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed),
                msg: '是一个 JSON 对象（非数组）'
            });
            checks.push({
                pass: parsed.hasOwnProperty('name') && typeof parsed.name === 'string',
                msg: '包含 name 字段且为字符串类型'
            });
            checks.push({
                pass: parsed.hasOwnProperty('age') && typeof parsed.age === 'number',
                msg: '包含 age 字段且为数字类型'
            });
            return checks;
        }
    },
    {
        id: 2,
        title: 'JSON 数据类型',
        description: '掌握 JSON 支持的六种数据类型',
        mode: 'json',
        tutorial: `
            <p>JSON 支持以下 <strong>6 种</strong>数据类型：</p>
            <div class="syntax-block">1. 字符串 (String):  "hello"
2. 数字 (Number):    42 或 3.14
3. 布尔 (Boolean):   true 或 false
4. 空值 (Null):      null
5. 数组 (Array):     [1, "a", true]
6. 对象 (Object):    {"key": "value"}</div>
            <p>注意：JSON 中<strong>没有</strong> undefined、函数、日期等 JavaScript 特有类型。</p>
            <p>示例：</p>
            <div class="syntax-block">{
    "name": "测试",
    "score": 98.5,
    "active": true,
    "deleted": null,
    "tags": ["a", "b"],
    "info": {"key": "value"}
}</div>
        `,
        task: '编写一个 JSON 对象，包含至少 <strong>6 个字段</strong>，分别展示 JSON 支持的所有 6 种数据类型：字符串、数字、布尔值、null、数组、对象。',
        hint: '{\n    "name": "测试",\n    "score": 98.5,\n    "active": true,\n    "deleted": null,\n    "tags": ["a", "b"],\n    "info": {"key": "value"}\n}',
        context: `
            <div class="context-label">6 种数据类型对照：</div>
            <div class="api-block">字符串: "hello"     → typeof === "string"
数字:   42          → typeof === "number"
布尔:   true/false  → typeof === "boolean"
空值:   null        → value === null
数组:   [1, 2]      → Array.isArray() === true
对象:   {"a": 1}    → typeof === "object"</div>
        `,
        answer: '{\n    "name": "测试",\n    "score": 98.5,\n    "active": true,\n    "deleted": null,\n    "tags": ["a", "b"],\n    "info": {"key": "value"}\n}',
        validate(code) {
            const checks = [];
            let parsed;
            try {
                parsed = JSON.parse(code);
                checks.push({ pass: true, msg: 'JSON 格式正确' });
            } catch (e) {
                checks.push({ pass: false, msg: 'JSON 格式错误：' + e.message });
                return checks;
            }
            const values = Object.values(parsed);
            checks.push({ pass: values.some(v => typeof v === 'string'), msg: '包含字符串类型的值' });
            checks.push({ pass: values.some(v => typeof v === 'number'), msg: '包含数字类型的值' });
            checks.push({ pass: values.some(v => typeof v === 'boolean'), msg: '包含布尔类型的值' });
            checks.push({ pass: values.some(v => v === null), msg: '包含 null 值' });
            checks.push({ pass: values.some(v => Array.isArray(v)), msg: '包含数组类型的值' });
            checks.push({ pass: values.some(v => typeof v === 'object' && v !== null && !Array.isArray(v)), msg: '包含对象类型的值' });
            return checks;
        }
    },
    {
        id: 3,
        title: 'JSON 数组与嵌套',
        description: '学习数组和嵌套对象的写法',
        mode: 'json',
        tutorial: `
            <p>JSON 数组用方括号 <code>[]</code> 表示，数组元素可以是任意 JSON 数据类型：</p>
            <div class="syntax-block">[
    {"name": "张三", "age": 20},
    {"name": "李四", "age": 22}
]</div>
            <p>对象和数组可以<strong>多层嵌套</strong>：</p>
            <div class="syntax-block">{
    "class": "三年级一班",
    "students": [
        {"name": "张三", "hobbies": ["篮球", "编程"]},
        {"name": "李四", "hobbies": ["音乐", "阅读"]}
    ]
}</div>
        `,
        task: '编写一个 JSON <strong>数组</strong>，包含至少 <strong>3 个</strong>用户对象，每个对象必须包含 <code>name</code>（字符串）、<code>age</code>（数字）和 <code>hobbies</code>（字符串数组）。',
        hint: '[\n    {"name": "张三", "age": 20, "hobbies": ["篮球", "编程"]},\n    {"name": "李四", "age": 22, "hobbies": ["音乐"]},\n    {"name": "王五", "age": 21, "hobbies": ["阅读", "游泳"]}\n]',
        context: `
            <div class="context-label">要求的数据结构：</div>
            <div class="api-block">[                        ← 顶层为数组
    {                    ← 每个元素是对象
        "name": "...",   ← 字符串
        "age": 20,       ← 数字
        "hobbies": [     ← 字符串数组
            "...", "..."
        ]
    },
    ...至少 3 个对象
]</div>
        `,
        answer: '[\n    {"name": "张三", "age": 20, "hobbies": ["篮球", "编程"]},\n    {"name": "李四", "age": 22, "hobbies": ["音乐"]},\n    {"name": "王五", "age": 21, "hobbies": ["阅读", "游泳"]}\n]',
        validate(code) {
            const checks = [];
            let parsed;
            try {
                parsed = JSON.parse(code);
                checks.push({ pass: true, msg: 'JSON 格式正确' });
            } catch (e) {
                checks.push({ pass: false, msg: 'JSON 格式错误：' + e.message });
                return checks;
            }
            checks.push({ pass: Array.isArray(parsed), msg: '顶层是 JSON 数组' });
            checks.push({ pass: Array.isArray(parsed) && parsed.length >= 3, msg: '包含至少 3 个元素' });
            if (Array.isArray(parsed) && parsed.length > 0) {
                checks.push({ pass: parsed.every(u => typeof u.name === 'string'), msg: '每个对象都有 name 字段（字符串）' });
                checks.push({ pass: parsed.every(u => typeof u.age === 'number'), msg: '每个对象都有 age 字段（数字）' });
                checks.push({ pass: parsed.every(u => Array.isArray(u.hobbies) && u.hobbies.every(h => typeof h === 'string')), msg: '每个对象都有 hobbies 字段（字符串数组）' });
            }
            return checks;
        }
    },

    // ===== 第二阶段：JSON 解析与序列化 =====
    {
        id: 4,
        title: 'JSON.parse() 解析',
        description: '将 JSON 字符串解析为 JavaScript 对象',
        mode: 'code',
        tutorial: `
            <p><code>JSON.parse()</code> 将 JSON 格式的字符串转换为 JavaScript 对象：</p>
            <div class="syntax-block">const jsonStr = '{"name": "张三", "age": 25}';
const obj = JSON.parse(jsonStr);

console.log(obj.name); // "张三"
console.log(obj.age);  // 25</div>
            <p>如果字符串不是合法的 JSON，<code>JSON.parse()</code> 会抛出错误。</p>
            <p>可以用 <code>.</code> 或 <code>[]</code> 访问解析后对象的属性：</p>
            <div class="syntax-block">obj.name       // "张三"
obj["name"]    // "张三"
obj.scores[0]  // 访问数组第一个元素</div>
        `,
        task: '变量 <code>jsonStr</code> 已定义好（见参考信息）。请使用 <code>JSON.parse()</code> 解析它，并将<strong>第 2 个用户的 name</strong> 赋值给 <code>result</code>。',
        hint: 'const data = JSON.parse(jsonStr);\nresult = data.users[1].name;',
        preCode: `const jsonStr = '{"users":[{"name":"张三","age":28},{"name":"李四","age":24},{"name":"王五","age":32}]}';`,
        context: `
            <div class="context-label">变量 jsonStr 的内容：</div>
            <div class="api-block">{
    "users": [
        {"name": "张三", "age": 28},
        {"name": "李四", "age": 24},
        {"name": "王五", "age": 32}
    ]
}</div>
            <div class="context-label" style="margin-top:12px;">提示：</div>
            <div class="endpoint-info">数组索引从 0 开始
第 2 个用户的索引是 1
用 result = xxx 赋值</div>
        `,
        answer: 'const data = JSON.parse(jsonStr);\nresult = data.users[1].name;',
        validate(code, result, requests) {
            const checks = [];
            checks.push({ pass: /JSON\.parse/.test(code), msg: '使用了 JSON.parse()' });
            checks.push({ pass: result === '李四', msg: 'result 的值为 "李四"' });
            return checks;
        }
    },
    {
        id: 5,
        title: 'JSON.stringify() 序列化',
        description: '将对象转换为 JSON 字符串',
        mode: 'code',
        tutorial: `
            <p><code>JSON.stringify()</code> 将 JavaScript 对象转换为 JSON 字符串：</p>
            <div class="syntax-block">const obj = {name: "张三", age: 25};
const str = JSON.stringify(obj);
// '{"name":"张三","age":25}'</div>
            <p>可以传入额外参数实现<strong>格式化输出</strong>：</p>
            <div class="syntax-block">JSON.stringify(obj, null, 2);
// 第 2 个参数 null 表示不过滤
// 第 3 个参数 2 表示缩进 2 个空格</div>
            <p>格式化后的结果：</p>
            <div class="syntax-block">{
  "name": "张三",
  "age": 25
}</div>
        `,
        task: '变量 <code>user</code> 已定义好。请使用 <code>JSON.stringify()</code> 将它转换为<strong>格式化的 JSON 字符串</strong>（2 空格缩进），赋值给 <code>result</code>。',
        hint: 'result = JSON.stringify(user, null, 2);',
        preCode: `const user = {name: "张三", age: 25, hobbies: ["编程", "阅读"]};`,
        context: `
            <div class="context-label">变量 user 的内容：</div>
            <div class="api-block">{
    name: "张三",
    age: 25,
    hobbies: ["编程", "阅读"]
}</div>
            <div class="context-label" style="margin-top:12px;">JSON.stringify 参数说明：</div>
            <div class="endpoint-info">JSON.stringify(value, replacer, space)
  value:    要转换的值
  replacer: 过滤器（通常传 null）
  space:    缩进空格数（如 2）</div>
        `,
        answer: 'result = JSON.stringify(user, null, 2);',
        validate(code, result, requests) {
            const checks = [];
            checks.push({ pass: /JSON\.stringify/.test(code), msg: '使用了 JSON.stringify()' });
            checks.push({ pass: typeof result === 'string', msg: 'result 是字符串类型' });
            const expected = JSON.stringify({ name: "张三", age: 25, hobbies: ["编程", "阅读"] }, null, 2);
            checks.push({ pass: result === expected, msg: '输出为格式化的 JSON 字符串（2 空格缩进）' });
            return checks;
        }
    },

    // ===== 第三阶段：GET 请求 =====
    {
        id: 6,
        title: '发起 GET 请求',
        description: '使用 fetch 发起第一个网络请求',
        mode: 'code',
        tutorial: `
            <p><code>fetch()</code> 是浏览器内置的 API，用于发起网络请求。最简单的用法：</p>
            <div class="syntax-block">const response = await fetch('/api/users');
const data = await response.json();</div>
            <p><code>fetch()</code> 返回一个 Response 对象，使用 <code>await</code> 等待请求完成。</p>
            <p><code>response.json()</code> 将响应体解析为 JSON 对象（也是异步操作，需要 <code>await</code>）。</p>
            <p>默认情况下 <code>fetch()</code> 使用 <strong>GET</strong> 方法。</p>
        `,
        task: '使用 <code>fetch</code> 请求 <code>/api/users</code>，将响应的 JSON 数据赋值给 <code>result</code>。',
        hint: 'const response = await fetch("/api/users");\nconst data = await response.json();\nresult = data;',
        mockHandler: (req) => {
            if (req.method === 'GET' && req.url === '/api/users') {
                return {
                    status: 200,
                    body: [
                        { id: 1, name: "张三", age: 28 },
                        { id: 2, name: "李四", age: 24 },
                        { id: 3, name: "王五", age: 32 }
                    ]
                };
            }
            return { status: 404, body: { error: 'Not Found' } };
        },
        context: `
            <div class="context-label">📡 可用 API：</div>
            <div class="api-block"><span class="method-tag get">GET</span> /api/users
返回用户列表数组</div>
            <div class="context-label" style="margin-top:12px;">预期响应数据：</div>
            <div class="endpoint-info">[
    {"id": 1, "name": "张三", "age": 28},
    {"id": 2, "name": "李四", "age": 24},
    {"id": 3, "name": "王五", "age": 32}
]</div>
        `,
        answer: 'const response = await fetch("/api/users");\nconst data = await response.json();\nresult = data;',
        validate(code, result, requests) {
            const checks = [];
            checks.push({ pass: /fetch\s*\(/.test(code), msg: '使用了 fetch() 函数' });
            checks.push({ pass: /\.json\s*\(/.test(code), msg: '使用了 .json() 解析响应' });
            checks.push({ pass: requests.length > 0 && requests[0].url === '/api/users', msg: '请求了 /api/users 接口' });
            checks.push({ pass: requests.length > 0 && requests[0].method === 'GET', msg: '使用了 GET 方法' });
            checks.push({ pass: Array.isArray(result) && result.length === 3, msg: 'result 包含 3 个用户数据' });
            return checks;
        }
    },
    {
        id: 7,
        title: '获取单个资源',
        description: '通过路径参数请求指定资源',
        mode: 'code',
        tutorial: `
            <p>RESTful API 通常用 URL 路径来标识不同资源。要获取指定 ID 的资源，把 ID 放在路径中：</p>
            <div class="syntax-block">// 获取所有用户
GET /api/users

// 获取 ID 为 2 的用户
GET /api/users/2

// 获取 ID 为 5 的文章
GET /api/posts/5</div>
            <p>使用 fetch 请求：</p>
            <div class="syntax-block">const res = await fetch('/api/users/2');
const user = await res.json();</div>
        `,
        task: '使用 fetch 请求 <code>/api/users/2</code>，获取 ID 为 2 的用户数据，赋值给 <code>result</code>。',
        hint: 'const res = await fetch("/api/users/2");\nresult = await res.json();',
        mockHandler: (req) => {
            if (req.method === 'GET' && req.url === '/api/users/2') {
                return { status: 200, body: { id: 2, name: "李四", age: 24, email: "lisi@example.com" } };
            }
            if (req.method === 'GET' && /^\/api\/users\/\d+$/.test(req.url)) {
                return { status: 404, body: { error: 'User not found' } };
            }
            return { status: 404, body: { error: 'Not Found' } };
        },
        context: `
            <div class="context-label">📡 可用 API：</div>
            <div class="api-block"><span class="method-tag get">GET</span> /api/users/:id
返回指定 ID 的用户详情</div>
            <div class="context-label" style="margin-top:12px;">GET /api/users/2 预期响应：</div>
            <div class="endpoint-info">{
    "id": 2,
    "name": "李四",
    "age": 24,
    "email": "lisi@example.com"
}</div>
        `,
        answer: 'const res = await fetch("/api/users/2");\nresult = await res.json();',
        validate(code, result, requests) {
            const checks = [];
            checks.push({ pass: requests.length > 0 && requests[0].url === '/api/users/2', msg: '请求了 /api/users/2' });
            checks.push({ pass: result && result.id === 2, msg: '返回数据的 id 为 2' });
            checks.push({ pass: result && result.name === '李四', msg: '返回数据的 name 为 "李四"' });
            checks.push({ pass: result && result.email === 'lisi@example.com', msg: '返回数据包含 email 字段' });
            return checks;
        }
    },
    {
        id: 8,
        title: 'URL 查询参数',
        description: '使用查询字符串过滤数据',
        mode: 'code',
        tutorial: `
            <p>查询参数（Query Parameters）跟在 URL 后面，以 <code>?</code> 开头，多个参数用 <code>&</code> 分隔：</p>
            <div class="syntax-block">// 基本格式
/api/users?key=value

// 多个参数
/api/users?gender=female&age=25

// 搜索
/api/search?keyword=hello&page=1</div>
            <p>也可以使用 <code>URLSearchParams</code> 来构建参数：</p>
            <div class="syntax-block">const params = new URLSearchParams({
    gender: 'female',
    age: '25'
});
const url = '/api/users?' + params.toString();
// "/api/users?gender=female&age=25"</div>
        `,
        task: '请求 <code>/api/users?gender=female</code> 获取所有女性用户数据，赋值给 <code>result</code>。',
        hint: 'const res = await fetch("/api/users?gender=female");\nresult = await res.json();',
        mockHandler: (req) => {
            if (req.method === 'GET' && req.url.startsWith('/api/users') && req.url.includes('gender=female')) {
                return {
                    status: 200,
                    body: [
                        { id: 2, name: "李四", age: 24, gender: "female" },
                        { id: 5, name: "孙七", age: 20, gender: "female" }
                    ]
                };
            }
            if (req.method === 'GET' && req.url === '/api/users') {
                return {
                    status: 200,
                    body: [
                        { id: 1, name: "张三", age: 28, gender: "male" },
                        { id: 2, name: "李四", age: 24, gender: "female" },
                        { id: 3, name: "王五", age: 32, gender: "male" },
                        { id: 5, name: "孙七", age: 20, gender: "female" }
                    ]
                };
            }
            return { status: 404, body: { error: 'Not Found' } };
        },
        context: `
            <div class="context-label">📡 可用 API：</div>
            <div class="api-block"><span class="method-tag get">GET</span> /api/users?gender=female
返回筛选后的女性用户列表</div>
            <div class="context-label" style="margin-top:12px;">预期响应数据：</div>
            <div class="endpoint-info">[
    {"id": 2, "name": "李四", "age": 24, "gender": "female"},
    {"id": 5, "name": "孙七", "age": 20, "gender": "female"}
]</div>
        `,
        answer: 'const res = await fetch("/api/users?gender=female");\nresult = await res.json();',
        validate(code, result, requests) {
            const checks = [];
            checks.push({ pass: requests.length > 0, msg: '发起了网络请求' });
            checks.push({ pass: requests.length > 0 && requests[0].url.includes('gender=female'), msg: 'URL 包含查询参数 gender=female' });
            checks.push({ pass: Array.isArray(result), msg: '返回结果为数组' });
            checks.push({ pass: Array.isArray(result) && result.length === 2, msg: '返回 2 条女性用户数据' });
            checks.push({ pass: Array.isArray(result) && result.every(u => u.gender === 'female'), msg: '所有用户的 gender 都是 female' });
            return checks;
        }
    },
    {
        id: 9,
        title: '设置请求头',
        description: '学习在请求中添加自定义头信息',
        mode: 'code',
        tutorial: `
            <p>HTTP 请求头（Headers）用于传递额外信息，常见的请求头包括：</p>
            <div class="syntax-block">Authorization: 认证令牌（如 Bearer token）
Content-Type:  请求体格式（如 application/json）
Accept:        期望的响应格式</div>
            <p>使用 fetch 设置请求头：</p>
            <div class="syntax-block">const res = await fetch('/api/profile', {
    headers: {
        'Authorization': 'Bearer your-token-here',
        'Accept': 'application/json'
    }
});</div>
            <p>很多 API 需要通过 <code>Authorization</code> 头传递令牌来验证身份。</p>
        `,
        task: '请求 <code>/api/profile</code>，在请求头中添加 <code>Authorization: Bearer abc123</code>，将响应数据赋值给 <code>result</code>。',
        hint: 'const res = await fetch("/api/profile", {\n    headers: {\n        "Authorization": "Bearer abc123"\n    }\n});\nresult = await res.json();',
        mockHandler: (req) => {
            if (req.method === 'GET' && req.url === '/api/profile') {
                if (req.headers['authorization'] && req.headers['authorization'].includes('Bearer')) {
                    return {
                        status: 200,
                        body: { id: 1, name: "张三", email: "zhangsan@example.com", role: "admin" }
                    };
                }
                return { status: 401, body: { error: 'Unauthorized' } };
            }
            return { status: 404, body: { error: 'Not Found' } };
        },
        context: `
            <div class="context-label">📡 可用 API：</div>
            <div class="api-block"><span class="method-tag get">GET</span> /api/profile
需要 Authorization 头，返回用户个人信息</div>
            <div class="context-label" style="margin-top:12px;">请求头要求：</div>
            <div class="endpoint-info">Authorization: Bearer abc123</div>
            <div class="context-label" style="margin-top:12px;">预期响应（认证成功）：</div>
            <div class="endpoint-info">{
    "id": 1,
    "name": "张三",
    "email": "zhangsan@example.com",
    "role": "admin"
}</div>
        `,
        answer: 'const res = await fetch("/api/profile", {\n    headers: {\n        "Authorization": "Bearer abc123"\n    }\n});\nresult = await res.json();',
        validate(code, result, requests) {
            const checks = [];
            checks.push({ pass: requests.length > 0 && requests[0].url === '/api/profile', msg: '请求了 /api/profile' });
            const auth = requests.length > 0 ? requests[0].headers['authorization'] || '' : '';
            checks.push({ pass: auth.includes('Bearer abc123'), msg: '请求头包含 Authorization: Bearer abc123' });
            checks.push({ pass: result && result.name === '张三', msg: '成功获取用户信息' });
            checks.push({ pass: result && result.role === 'admin', msg: '返回数据包含 role 字段' });
            return checks;
        }
    },

    // ===== 第四阶段：发送数据 =====
    {
        id: 10,
        title: 'POST 发送数据',
        description: '使用 POST 方法创建新资源',
        mode: 'code',
        tutorial: `
            <p><code>POST</code> 方法用于向服务器<strong>提交/创建</strong>数据。需要在 fetch 的第二个参数中指定：</p>
            <div class="syntax-block">const res = await fetch('/api/users', {
    method: 'POST',
    headers: {
        'Content-Type': 'application/json'
    },
    body: JSON.stringify({
        name: '赵六',
        age: 26
    })
});</div>
            <p>关键点：</p>
            <ul>
                <li><code>method: 'POST'</code> — 指定 HTTP 方法</li>
                <li><code>Content-Type: application/json</code> — 告诉服务器请求体是 JSON 格式</li>
                <li><code>body: JSON.stringify(...)</code> — 将数据序列化为 JSON 字符串</li>
            </ul>
        `,
        task: '使用 <code>POST</code> 方法向 <code>/api/users</code> 发送 <code>{"name": "赵六", "age": 26}</code>，将服务器返回的数据赋值给 <code>result</code>。',
        hint: 'const res = await fetch("/api/users", {\n    method: "POST",\n    headers: {\n        "Content-Type": "application/json"\n    },\n    body: JSON.stringify({name: "赵六", age: 26})\n});\nresult = await res.json();',
        mockHandler: (req) => {
            if (req.method === 'POST' && req.url === '/api/users') {
                const body = req.body || {};
                return {
                    status: 201,
                    body: { id: 4, name: body.name || '', age: body.age || 0, createdAt: '2025-01-01' }
                };
            }
            return { status: 404, body: { error: 'Not Found' } };
        },
        context: `
            <div class="context-label">📡 可用 API：</div>
            <div class="api-block"><span class="method-tag post">POST</span> /api/users
创建新用户，需要在请求体中发送 JSON 数据</div>
            <div class="context-label" style="margin-top:12px;">请求体格式：</div>
            <div class="endpoint-info">{"name": "赵六", "age": 26}</div>
            <div class="context-label" style="margin-top:12px;">成功响应（201 Created）：</div>
            <div class="endpoint-info">{
    "id": 4,
    "name": "赵六",
    "age": 26,
    "createdAt": "2025-01-01"
}</div>
        `,
        answer: 'const res = await fetch("/api/users", {\n    method: "POST",\n    headers: {\n        "Content-Type": "application/json"\n    },\n    body: JSON.stringify({name: "赵六", age: 26})\n});\nresult = await res.json();',
        validate(code, result, requests) {
            const checks = [];
            checks.push({ pass: requests.length > 0 && requests[0].method === 'POST', msg: '使用了 POST 方法' });
            checks.push({ pass: requests.length > 0 && requests[0].url === '/api/users', msg: '请求地址为 /api/users' });
            const ct = requests.length > 0 ? (requests[0].headers['content-type'] || '') : '';
            checks.push({ pass: ct.includes('application/json'), msg: '设置了 Content-Type: application/json' });
            const body = requests.length > 0 ? requests[0].body : null;
            checks.push({ pass: body && body.name === '赵六', msg: '请求体包含 name: "赵六"' });
            checks.push({ pass: body && body.age === 26, msg: '请求体包含 age: 26' });
            checks.push({ pass: result && result.id === 4, msg: '成功获取服务器返回的数据（包含 id）' });
            return checks;
        }
    },
    {
        id: 11,
        title: 'PUT 更新数据',
        description: '使用 PUT 方法完整替换资源',
        mode: 'code',
        tutorial: `
            <p><code>PUT</code> 方法用于<strong>完整替换</strong>服务器上的资源。你需要发送资源的所有字段：</p>
            <div class="syntax-block">const res = await fetch('/api/users/1', {
    method: 'PUT',
    headers: {
        'Content-Type': 'application/json'
    },
    body: JSON.stringify({
        name: '张三',
        age: 30,
        email: 'new@example.com'
    })
});</div>
            <p><code>PUT</code> vs <code>POST</code> 的区别：</p>
            <ul>
                <li><code>POST</code> — 创建新资源（发到集合地址，如 /api/users）</li>
                <li><code>PUT</code> — 替换已有资源（发到具体资源地址，如 /api/users/1）</li>
            </ul>
        `,
        task: '使用 <code>PUT</code> 方法更新 <code>/api/users/1</code>，发送完整数据 <code>{"name": "张三", "age": 30, "email": "zhangsan@new.com"}</code>，将响应赋值给 <code>result</code>。',
        hint: 'const res = await fetch("/api/users/1", {\n    method: "PUT",\n    headers: {"Content-Type": "application/json"},\n    body: JSON.stringify({\n        name: "张三",\n        age: 30,\n        email: "zhangsan@new.com"\n    })\n});\nresult = await res.json();',
        mockHandler: (req) => {
            if (req.method === 'PUT' && req.url === '/api/users/1') {
                const body = req.body || {};
                return { status: 200, body: { id: 1, ...body, updatedAt: '2025-01-02' } };
            }
            return { status: 404, body: { error: 'Not Found' } };
        },
        context: `
            <div class="context-label">📡 可用 API：</div>
            <div class="api-block"><span class="method-tag put">PUT</span> /api/users/1
完整替换 ID 为 1 的用户数据</div>
            <div class="context-label" style="margin-top:12px;">需发送的完整数据：</div>
            <div class="endpoint-info">{
    "name": "张三",
    "age": 30,
    "email": "zhangsan@new.com"
}</div>
        `,
        answer: 'const res = await fetch("/api/users/1", {\n    method: "PUT",\n    headers: {"Content-Type": "application/json"},\n    body: JSON.stringify({name: "张三", age: 30, email: "zhangsan@new.com"})\n});\nresult = await res.json();',
        validate(code, result, requests) {
            const checks = [];
            checks.push({ pass: requests.length > 0 && requests[0].method === 'PUT', msg: '使用了 PUT 方法' });
            checks.push({ pass: requests.length > 0 && requests[0].url === '/api/users/1', msg: '请求地址为 /api/users/1' });
            const body = requests.length > 0 ? requests[0].body : null;
            checks.push({ pass: body && body.name === '张三', msg: '请求体包含 name' });
            checks.push({ pass: body && body.age === 30, msg: '请求体包含 age' });
            checks.push({ pass: body && body.email === 'zhangsan@new.com', msg: '请求体包含 email' });
            checks.push({ pass: result && result.id === 1, msg: '返回更新后的数据' });
            return checks;
        }
    },
    {
        id: 12,
        title: 'PATCH 部分更新',
        description: '使用 PATCH 方法仅更新部分字段',
        mode: 'code',
        tutorial: `
            <p><code>PATCH</code> 方法用于<strong>部分更新</strong>资源，只发送需要修改的字段：</p>
            <div class="syntax-block">// PUT: 需要发送所有字段
PUT /api/users/1
{"name": "张三", "age": 30, "email": "..."}

// PATCH: 只发送要修改的字段
PATCH /api/users/1
{"age": 29}</div>
            <p>使用 fetch 发送 PATCH 请求：</p>
            <div class="syntax-block">const res = await fetch('/api/users/1', {
    method: 'PATCH',
    headers: {
        'Content-Type': 'application/json'
    },
    body: JSON.stringify({ age: 29 })
});</div>
        `,
        task: '使用 <code>PATCH</code> 方法更新 <code>/api/users/1</code>，仅修改 <code>age</code> 为 <code>29</code>，将响应赋值给 <code>result</code>。',
        hint: 'const res = await fetch("/api/users/1", {\n    method: "PATCH",\n    headers: {"Content-Type": "application/json"},\n    body: JSON.stringify({age: 29})\n});\nresult = await res.json();',
        mockHandler: (req) => {
            if (req.method === 'PATCH' && req.url === '/api/users/1') {
                const body = req.body || {};
                return {
                    status: 200,
                    body: { id: 1, name: "张三", age: body.age || 28, email: "zhangsan@example.com", ...body }
                };
            }
            return { status: 404, body: { error: 'Not Found' } };
        },
        context: `
            <div class="context-label">📡 可用 API：</div>
            <div class="api-block"><span class="method-tag patch">PATCH</span> /api/users/1
部分更新 ID 为 1 的用户数据</div>
            <div class="context-label" style="margin-top:12px;">当前用户数据：</div>
            <div class="endpoint-info">{
    "id": 1,
    "name": "张三",
    "age": 28,
    "email": "zhangsan@example.com"
}</div>
            <div class="context-label" style="margin-top:12px;">只需发送：</div>
            <div class="endpoint-info">{"age": 29}</div>
        `,
        answer: 'const res = await fetch("/api/users/1", {\n    method: "PATCH",\n    headers: {"Content-Type": "application/json"},\n    body: JSON.stringify({age: 29})\n});\nresult = await res.json();',
        validate(code, result, requests) {
            const checks = [];
            checks.push({ pass: requests.length > 0 && requests[0].method === 'PATCH', msg: '使用了 PATCH 方法' });
            checks.push({ pass: requests.length > 0 && requests[0].url === '/api/users/1', msg: '请求地址为 /api/users/1' });
            const body = requests.length > 0 ? requests[0].body : null;
            checks.push({ pass: body && body.age === 29, msg: '请求体包含 age: 29' });
            const bodyKeys = body ? Object.keys(body) : [];
            checks.push({ pass: bodyKeys.length === 1 && bodyKeys[0] === 'age', msg: '请求体仅包含 age 字段（部分更新）' });
            checks.push({ pass: result && result.age === 29, msg: '返回数据的 age 已更新为 29' });
            return checks;
        }
    },
    {
        id: 13,
        title: 'DELETE 删除数据',
        description: '使用 DELETE 方法删除资源',
        mode: 'code',
        tutorial: `
            <p><code>DELETE</code> 方法用于<strong>删除</strong>服务器上的资源：</p>
            <div class="syntax-block">const res = await fetch('/api/users/3', {
    method: 'DELETE'
});</div>
            <p>DELETE 请求通常：</p>
            <ul>
                <li>不需要请求体（body）</li>
                <li>成功时返回 200（有响应体）或 204（无响应体）</li>
                <li>可以通过 <code>response.status</code> 获取状态码</li>
            </ul>
            <div class="syntax-block">const res = await fetch('/api/users/3', {
    method: 'DELETE'
});
console.log(res.status); // 200</div>
        `,
        task: '使用 <code>DELETE</code> 方法删除 <code>/api/users/3</code>，将响应的<strong>状态码</strong>（数字）赋值给 <code>result</code>。',
        hint: 'const res = await fetch("/api/users/3", {\n    method: "DELETE"\n});\nresult = res.status;',
        mockHandler: (req) => {
            if (req.method === 'DELETE' && req.url === '/api/users/3') {
                return { status: 200, body: { message: 'User deleted successfully' } };
            }
            return { status: 404, body: { error: 'Not Found' } };
        },
        context: `
            <div class="context-label">📡 可用 API：</div>
            <div class="api-block"><span class="method-tag delete">DELETE</span> /api/users/3
删除 ID 为 3 的用户</div>
            <div class="context-label" style="margin-top:12px;">成功响应：</div>
            <div class="endpoint-info">状态码: 200
响应体: {"message": "User deleted successfully"}</div>
            <div class="context-label" style="margin-top:12px;">提示：</div>
            <div class="endpoint-info">通过 response.status 获取状态码（数字类型）</div>
        `,
        answer: 'const res = await fetch("/api/users/3", {\n    method: "DELETE"\n});\nresult = res.status;',
        validate(code, result, requests) {
            const checks = [];
            checks.push({ pass: requests.length > 0 && requests[0].method === 'DELETE', msg: '使用了 DELETE 方法' });
            checks.push({ pass: requests.length > 0 && requests[0].url === '/api/users/3', msg: '请求地址为 /api/users/3' });
            checks.push({ pass: result === 200, msg: 'result 为状态码 200' });
            return checks;
        }
    },

    // ===== 第五阶段：响应处理 =====
    {
        id: 14,
        title: '检查响应状态',
        description: '学习判断请求是否成功',
        mode: 'code',
        tutorial: `
            <p>HTTP 状态码表示请求的结果：</p>
            <div class="syntax-block">2xx: 成功（200 OK, 201 Created, 204 No Content）
3xx: 重定向
4xx: 客户端错误（400 Bad Request, 401 Unauthorized, 404 Not Found）
5xx: 服务器错误（500 Internal Server Error）</div>
            <p>Response 对象提供了便捷的属性：</p>
            <div class="syntax-block">const res = await fetch('/api/users/999');

res.ok      // true（2xx）或 false（非2xx）
res.status  // 数字状态码，如 200, 404
res.statusText // 状态描述，如 "OK", "Not Found"</div>
            <p>注意：<code>fetch</code> 只在<strong>网络错误</strong>时才会抛异常，HTTP 错误（如 404）不会抛异常！需要手动检查 <code>response.ok</code>。</p>
        `,
        task: '请求 <code>/api/users/999</code>（不存在的用户）。如果 <code>response.ok</code> 为 <code>false</code>，将 <code>result</code> 设为 <code>"用户不存在"</code>；否则设为响应数据。',
        hint: 'const res = await fetch("/api/users/999");\nif (!res.ok) {\n    result = "用户不存在";\n} else {\n    result = await res.json();\n}',
        mockHandler: (req) => {
            if (req.method === 'GET' && req.url === '/api/users/999') {
                return { status: 404, body: { error: 'User not found' } };
            }
            if (req.method === 'GET' && req.url === '/api/users/1') {
                return { status: 200, body: { id: 1, name: "张三" } };
            }
            return { status: 404, body: { error: 'Not Found' } };
        },
        context: `
            <div class="context-label">📡 可用 API：</div>
            <div class="api-block"><span class="method-tag get">GET</span> /api/users/999
该用户不存在，返回 404</div>
            <div class="context-label" style="margin-top:12px;">Response 关键属性：</div>
            <div class="endpoint-info">response.ok     → false（因为 404 不是 2xx）
response.status → 404</div>
        `,
        answer: 'const res = await fetch("/api/users/999");\nif (!res.ok) {\n    result = "用户不存在";\n} else {\n    result = await res.json();\n}',
        validate(code, result, requests) {
            const checks = [];
            checks.push({ pass: requests.length > 0 && requests[0].url === '/api/users/999', msg: '请求了 /api/users/999' });
            checks.push({ pass: /\.ok\b/.test(code) || /\.status\b/.test(code), msg: '检查了响应状态（.ok 或 .status）' });
            checks.push({ pass: result === '用户不存在', msg: 'result 为 "用户不存在"' });
            return checks;
        }
    },
    {
        id: 15,
        title: '错误处理 try/catch',
        description: '捕获网络请求中的异常',
        mode: 'code',
        tutorial: `
            <p>网络请求可能因为各种原因失败（网络断开、DNS解析失败等），这时 <code>fetch</code> 会<strong>抛出异常</strong>。</p>
            <p>使用 <code>try/catch</code> 来捕获这些错误：</p>
            <div class="syntax-block">try {
    const res = await fetch('/api/data');
    const data = await res.json();
    result = data;
} catch (error) {
    // error.message 包含错误描述
    result = "请求失败: " + error.message;
}</div>
            <p>区分两种错误：</p>
            <ul>
                <li><strong>网络错误</strong>：fetch 抛出异常（需 try/catch）</li>
                <li><strong>HTTP 错误</strong>：返回 4xx/5xx（需检查 response.ok）</li>
            </ul>
        `,
        task: '请求 <code>/api/unstable</code>（该接口会抛出网络错误）。用 <code>try/catch</code> 捕获错误，将 <code>result</code> 设为错误的 <code>message</code> 属性值。',
        hint: 'try {\n    const res = await fetch("/api/unstable");\n    result = await res.json();\n} catch (error) {\n    result = error.message;\n}',
        mockHandler: (req) => {
            if (req.url === '/api/unstable') {
                return { networkError: 'Failed to fetch' };
            }
            return { status: 200, body: {} };
        },
        context: `
            <div class="context-label">📡 可用 API：</div>
            <div class="api-block"><span class="method-tag get">GET</span> /api/unstable
⚠️ 该接口模拟网络故障，会抛出异常</div>
            <div class="context-label" style="margin-top:12px;">异常信息：</div>
            <div class="endpoint-info">TypeError: Failed to fetch</div>
            <div class="context-label" style="margin-top:12px;">提示：</div>
            <div class="endpoint-info">catch (error) 中的 error.message 为 "Failed to fetch"</div>
        `,
        answer: 'try {\n    const res = await fetch("/api/unstable");\n    result = await res.json();\n} catch (error) {\n    result = error.message;\n}',
        validate(code, result, requests) {
            const checks = [];
            checks.push({ pass: /try\s*\{/.test(code), msg: '使用了 try 块' });
            checks.push({ pass: /catch\s*\(/.test(code), msg: '使用了 catch 块' });
            checks.push({ pass: /fetch\s*\(/.test(code), msg: '发起了 fetch 请求' });
            checks.push({ pass: result === 'Failed to fetch', msg: 'result 为错误消息 "Failed to fetch"' });
            return checks;
        }
    },
    {
        id: 16,
        title: '处理不同状态码',
        description: '根据 HTTP 状态码做不同处理',
        mode: 'code',
        tutorial: `
            <p>实际开发中，我们需要根据不同的状态码做不同处理：</p>
            <div class="syntax-block">const res = await fetch('/api/data');

if (res.status === 200) {
    // 成功
} else if (res.status === 404) {
    // 资源不存在
} else if (res.status === 500) {
    // 服务器错误
}</div>
            <p>或使用 switch 语句：</p>
            <div class="syntax-block">switch (res.status) {
    case 200: /* 成功 */  break;
    case 404: /* 不存在 */ break;
    case 500: /* 服务器错误 */ break;
}</div>
        `,
        task: '依次请求 <code>/api/test/ok</code>、<code>/api/test/notfound</code>、<code>/api/test/error</code>，根据每个请求的状态码转换为中文描述，以数组形式赋值给 <code>result</code>：200→<code>"成功"</code>，404→<code>"未找到"</code>，500→<code>"服务器错误"</code>。',
        hint: 'const urls = ["/api/test/ok", "/api/test/notfound", "/api/test/error"];\nresult = [];\nfor (const url of urls) {\n    const res = await fetch(url);\n    if (res.status === 200) result.push("成功");\n    else if (res.status === 404) result.push("未找到");\n    else if (res.status === 500) result.push("服务器错误");\n}',
        mockHandler: (req) => {
            if (req.url === '/api/test/ok') return { status: 200, body: { data: 'ok' } };
            if (req.url === '/api/test/notfound') return { status: 404, body: { error: 'Not Found' } };
            if (req.url === '/api/test/error') return { status: 500, body: { error: 'Server Error' } };
            return { status: 404, body: { error: 'Not Found' } };
        },
        context: `
            <div class="context-label">📡 可用 API：</div>
            <div class="api-block"><span class="method-tag get">GET</span> /api/test/ok       → 200
<span class="method-tag get">GET</span> /api/test/notfound → 404
<span class="method-tag get">GET</span> /api/test/error    → 500</div>
            <div class="context-label" style="margin-top:12px;">期望的 result：</div>
            <div class="endpoint-info">["成功", "未找到", "服务器错误"]</div>
        `,
        answer: 'const urls = ["/api/test/ok", "/api/test/notfound", "/api/test/error"];\nresult = [];\nfor (const url of urls) {\n    const res = await fetch(url);\n    if (res.status === 200) result.push("成功");\n    else if (res.status === 404) result.push("未找到");\n    else if (res.status === 500) result.push("服务器错误");\n}',
        validate(code, result, requests) {
            const checks = [];
            checks.push({ pass: requests.length === 3, msg: '发起了 3 个请求' });
            checks.push({ pass: requests.some(r => r.url === '/api/test/ok'), msg: '请求了 /api/test/ok' });
            checks.push({ pass: requests.some(r => r.url === '/api/test/notfound'), msg: '请求了 /api/test/notfound' });
            checks.push({ pass: requests.some(r => r.url === '/api/test/error'), msg: '请求了 /api/test/error' });
            checks.push({ pass: Array.isArray(result) && result.length === 3, msg: 'result 是包含 3 个元素的数组' });
            const expected = ['成功', '未找到', '服务器错误'];
            checks.push({
                pass: Array.isArray(result) && result.length === 3 &&
                    result[0] === expected[0] && result[1] === expected[1] && result[2] === expected[2],
                msg: 'result 为 ["成功", "未找到", "服务器错误"]'
            });
            return checks;
        }
    },

    // ===== 第六阶段：进阶技巧 =====
    {
        id: 17,
        title: 'Promise.all 并发请求',
        description: '同时发送多个请求提高效率',
        mode: 'code',
        tutorial: `
            <p>当需要同时获取多个接口的数据时，逐个等待很慢：</p>
            <div class="syntax-block">// ❌ 串行：一个完成后才发下一个
const users = await (await fetch('/api/users')).json();
const products = await (await fetch('/api/products')).json();</div>
            <p>使用 <code>Promise.all</code> 可以<strong>并行</strong>发送多个请求，所有请求完成后一次性获取结果：</p>
            <div class="syntax-block">// ✅ 并行：同时发送，等全部完成
const [usersRes, productsRes] = await Promise.all([
    fetch('/api/users'),
    fetch('/api/products')
]);
const users = await usersRes.json();
const products = await productsRes.json();</div>
        `,
        task: '使用 <code>Promise.all</code> 同时请求 <code>/api/users</code> 和 <code>/api/products</code>，将结果组合为 <code>{users: [...], products: [...]}</code> 赋值给 <code>result</code>。',
        hint: 'const [usersRes, productsRes] = await Promise.all([\n    fetch("/api/users"),\n    fetch("/api/products")\n]);\nconst users = await usersRes.json();\nconst products = await productsRes.json();\nresult = { users, products };',
        mockHandler: (req) => {
            if (req.method === 'GET' && req.url === '/api/users') {
                return {
                    status: 200,
                    body: [
                        { id: 1, name: "张三" },
                        { id: 2, name: "李四" }
                    ]
                };
            }
            if (req.method === 'GET' && req.url === '/api/products') {
                return {
                    status: 200,
                    body: [
                        { id: 1, name: "笔记本电脑", price: 5999 },
                        { id: 2, name: "机械键盘", price: 399 }
                    ]
                };
            }
            return { status: 404, body: { error: 'Not Found' } };
        },
        context: `
            <div class="context-label">📡 可用 API：</div>
            <div class="api-block"><span class="method-tag get">GET</span> /api/users    → 用户列表
<span class="method-tag get">GET</span> /api/products → 商品列表</div>
            <div class="context-label" style="margin-top:12px;">期望的 result 结构：</div>
            <div class="endpoint-info">{
    "users": [{"id":1,"name":"张三"}, ...],
    "products": [{"id":1,"name":"笔记本电脑","price":5999}, ...]
}</div>
        `,
        answer: 'const [usersRes, productsRes] = await Promise.all([\n    fetch("/api/users"),\n    fetch("/api/products")\n]);\nconst users = await usersRes.json();\nconst products = await productsRes.json();\nresult = { users, products };',
        validate(code, result, requests) {
            const checks = [];
            checks.push({ pass: /Promise\.all/.test(code), msg: '使用了 Promise.all' });
            checks.push({ pass: requests.length === 2, msg: '发起了 2 个请求' });
            checks.push({ pass: requests.some(r => r.url === '/api/users'), msg: '请求了 /api/users' });
            checks.push({ pass: requests.some(r => r.url === '/api/products'), msg: '请求了 /api/products' });
            checks.push({ pass: result && Array.isArray(result.users) && result.users.length === 2, msg: 'result.users 包含 2 个用户' });
            checks.push({ pass: result && Array.isArray(result.products) && result.products.length === 2, msg: 'result.products 包含 2 个商品' });
            return checks;
        }
    },
    {
        id: 18,
        title: '综合实战：用户注册流程',
        description: '串联多个请求完成完整业务流程',
        mode: 'code',
        tutorial: `
            <p>实际开发中，经常需要<strong>串联多个请求</strong>，将上一个请求的结果用于下一个请求。</p>
            <p>典型的用户注册流程：</p>
            <div class="syntax-block">1. POST /api/register → 注册账号
2. POST /api/login    → 登录获取 token
3. GET  /api/profile  → 用 token 获取个人信息</div>
            <p>关键技巧：</p>
            <ul>
                <li>从登录响应中提取 <code>token</code></li>
                <li>在后续请求的 <code>Authorization</code> 头中使用该 token</li>
                <li>每一步都使用 <code>await</code> 等待完成后再进行下一步</li>
            </ul>
        `,
        task: `完成以下三步操作：
            <ol style="margin:8px 0 0 20px;line-height:2.2;">
                <li><code>POST /api/register</code> 发送 <code>{"username":"newuser","password":"123456"}</code></li>
                <li><code>POST /api/login</code> 发送相同的用户名密码，从响应中获取 <code>token</code></li>
                <li><code>GET /api/profile</code> 带上 <code>Authorization: Bearer &lt;token&gt;</code> 请求头</li>
            </ol>
            <p style="margin-top:8px;">将第 3 步获取的个人信息赋值给 <code>result</code>。</p>`,
        hint: '// 第1步：注册\nawait fetch("/api/register", {\n    method: "POST",\n    headers: {"Content-Type": "application/json"},\n    body: JSON.stringify({username: "newuser", password: "123456"})\n});\n\n// 第2步：登录\nconst loginRes = await fetch("/api/login", {\n    method: "POST",\n    headers: {"Content-Type": "application/json"},\n    body: JSON.stringify({username: "newuser", password: "123456"})\n});\nconst loginData = await loginRes.json();\n\n// 第3步：获取个人信息\nconst profileRes = await fetch("/api/profile", {\n    headers: {"Authorization": "Bearer " + loginData.token}\n});\nresult = await profileRes.json();',
        mockHandler: (req) => {
            if (req.method === 'POST' && req.url === '/api/register') {
                const body = req.body || {};
                if (body.username && body.password) {
                    return { status: 201, body: { id: 1, username: body.username, message: 'Registered' } };
                }
                return { status: 400, body: { error: 'Missing fields' } };
            }
            if (req.method === 'POST' && req.url === '/api/login') {
                const body = req.body || {};
                if (body.username === 'newuser' && body.password === '123456') {
                    return { status: 200, body: { token: 'xyz789', expiresIn: 3600 } };
                }
                return { status: 401, body: { error: 'Invalid credentials' } };
            }
            if (req.method === 'GET' && req.url === '/api/profile') {
                if (req.headers['authorization'] && req.headers['authorization'].includes('xyz789')) {
                    return {
                        status: 200,
                        body: { id: 1, username: 'newuser', email: 'newuser@example.com', role: 'user' }
                    };
                }
                return { status: 401, body: { error: 'Unauthorized' } };
            }
            return { status: 404, body: { error: 'Not Found' } };
        },
        context: `
            <div class="context-label">📡 可用 API（按顺序调用）：</div>
            <div class="api-block"><span class="method-tag post">POST</span> /api/register
  请求体: {"username":"newuser","password":"123456"}
  响应: {"id":1,"username":"newuser","message":"Registered"}</div>
            <div class="api-block" style="margin-top:6px;"><span class="method-tag post">POST</span> /api/login
  请求体: {"username":"newuser","password":"123456"}
  响应: {"token":"xyz789","expiresIn":3600}</div>
            <div class="api-block" style="margin-top:6px;"><span class="method-tag get">GET</span> /api/profile
  请求头: Authorization: Bearer xyz789
  响应: {"id":1,"username":"newuser","email":"newuser@example.com","role":"user"}</div>
        `,
        answer: '// 第1步：注册\nawait fetch("/api/register", {\n    method: "POST",\n    headers: {"Content-Type": "application/json"},\n    body: JSON.stringify({username: "newuser", password: "123456"})\n});\n\n// 第2步：登录\nconst loginRes = await fetch("/api/login", {\n    method: "POST",\n    headers: {"Content-Type": "application/json"},\n    body: JSON.stringify({username: "newuser", password: "123456"})\n});\nconst loginData = await loginRes.json();\n\n// 第3步：获取个人信息\nconst profileRes = await fetch("/api/profile", {\n    headers: {"Authorization": "Bearer " + loginData.token}\n});\nresult = await profileRes.json();',
        validate(code, result, requests) {
            const checks = [];
            checks.push({ pass: requests.length >= 3, msg: '发起了至少 3 个请求' });
            checks.push({
                pass: requests.length >= 1 && requests[0].method === 'POST' && requests[0].url === '/api/register',
                msg: '第 1 步：POST /api/register'
            });
            checks.push({
                pass: requests.length >= 1 && requests[0].body && requests[0].body.username === 'newuser',
                msg: '注册请求包含正确的 username'
            });
            checks.push({
                pass: requests.length >= 2 && requests[1].method === 'POST' && requests[1].url === '/api/login',
                msg: '第 2 步：POST /api/login'
            });
            checks.push({
                pass: requests.length >= 3 && requests[2].method === 'GET' && requests[2].url === '/api/profile',
                msg: '第 3 步：GET /api/profile'
            });
            const authHeader = requests.length >= 3 ? (requests[2].headers['authorization'] || '') : '';
            checks.push({
                pass: authHeader.includes('xyz789'),
                msg: '第 3 步请求头包含从登录获取的 token'
            });
            checks.push({
                pass: result && result.username === 'newuser' && result.email === 'newuser@example.com',
                msg: '成功获取个人信息'
            });
            return checks;
        }
    }
];

// ===== 进度存储 =====
const STORAGE_KEY = 'http_learn_progress';
let currentLevelIdx = -1;

function getProgress() {
    try {
        return JSON.parse(localStorage.getItem(STORAGE_KEY)) || {};
    } catch { return {}; }
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
    document.getElementById('appInfo').style.display = '';
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
    document.getElementById('appInfo').style.display = 'none';

    document.getElementById('levelTitle').textContent = `第 ${level.id} 关：${level.title}`;
    document.getElementById('tutorialContent').innerHTML = level.tutorial;
    document.getElementById('taskContent').innerHTML = level.task;
    document.getElementById('contextContent').innerHTML = level.context || '';

    // 根据模式调整编辑器
    const editor = document.getElementById('codeEditor');
    const editorTitle = document.getElementById('editorTitle');
    if (level.mode === 'json') {
        editor.placeholder = '在此输入 JSON...';
        editorTitle.textContent = '✏️ JSON 编辑器';
    } else {
        editor.placeholder = '在此输入 JavaScript 代码...\n// 将结果赋值给 result 变量';
        editorTitle.textContent = '✏️ 代码编辑器';
    }

    // 编辑器和结果重置
    editor.value = '';
    document.getElementById('resultArea').innerHTML = '<p class="placeholder-text">编写代码后点击验证查看结果</p>';
    document.getElementById('hintBox').style.display = 'none';
    document.getElementById('expectedSection').style.display = 'none';

    // 导航按钮
    document.getElementById('btnPrevLevel').disabled = (idx === 0);
    const nextUnlocked = idx + 1 < LEVELS.length && isLevelUnlocked(idx + 1);
    document.getElementById('btnNextLevel').disabled = !nextUnlocked;
}

async function handleRun() {
    const level = LEVELS[currentLevelIdx];
    const code = document.getElementById('codeEditor').value.trim();
    if (!code) return;

    const resultArea = document.getElementById('resultArea');
    resultArea.innerHTML = '<p class="placeholder-text">⏳ 执行中...</p>';

    let checks;

    if (level.mode === 'json') {
        checks = level.validate(code);
    } else {
        const execResult = await executeCode(level, code);

        if (execResult.error && !level.validate.toString().includes('error')) {
            resultArea.innerHTML = `<div class="error-msg">❌ 执行错误：${escapeHtml(execResult.error)}</div>`;
            const expectedSection = document.getElementById('expectedSection');
            expectedSection.style.display = '';
            document.getElementById('expectedArea').innerHTML = `<div class="answer-block">${escapeHtml(level.answer)}</div>`;
            return;
        }

        checks = level.validate(code, execResult.result, execResult.requests);
    }

    const allPass = checks.every(c => c.pass);

    let html = '<ul class="check-list">';
    checks.forEach(c => {
        const cls = c.pass ? 'pass' : 'fail';
        const icon = c.pass ? '✅' : '❌';
        html += `<li class="${cls}"><span class="check-icon">${icon}</span>${c.msg}</li>`;
    });
    html += '</ul>';

    if (allPass) {
        resultArea.innerHTML = '<div class="success-msg">✅ 完全正确！所有检查点都通过了。</div>' + html;
        document.getElementById('expectedSection').style.display = 'none';
        saveProgress(level.id);
        showSuccessModal(level);
    } else {
        const passCount = checks.filter(c => c.pass).length;
        resultArea.innerHTML = `<div class="fail-msg">⚠️ 通过 ${passCount}/${checks.length} 项检查，请继续完善。</div>` + html;
        const expectedSection = document.getElementById('expectedSection');
        expectedSection.style.display = '';
        document.getElementById('expectedArea').innerHTML = `<div class="answer-block">${escapeHtml(level.answer)}</div>`;
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
        ? '你已完成所有关卡，网络请求核心技能已掌握！'
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

    // Ctrl+Enter 验证
    document.getElementById('codeEditor').addEventListener('keydown', (e) => {
        if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
            e.preventDefault();
            handleRun();
        }
        // Tab 支持缩进
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

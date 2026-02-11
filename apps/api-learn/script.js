// ===== 关卡数据 =====
const LEVELS = [
    // ===== 第一阶段：基础概念 =====
    {
        id: 1,
        title: '初识信息池接口',
        description: '了解接口配置 + MyBatis 动态SQL的基本结构',
        tutorial: `
            <p><strong>信息池</strong>是一个 API 管理系统，每个接口由两部分配置组成：</p>
            <ul style="margin:8px 0 8px 20px;line-height:2;">
                <li><strong>接口配置（JSON）</strong>— 定义路径、请求方式、接收哪些参数</li>
                <li><strong>MyBatis 动态SQL</strong>— 使用接收到的参数动态生成并执行 SQL</li>
            </ul>
            <p>完整的工作流程：</p>
            <div class="syntax-block">① 前端发起请求: GET /api/users/{id}  (id=1)
② 信息池提取参数: {id: 1}
③ 注入 MyBatis SQL: SELECT * FROM user WHERE id = #{id}
④ 动态生成: SELECT * FROM user WHERE id = 1
⑤ 执行查询 → 返回 JSON 结果</div>
            <p>最简单的接口——通过路径传入 <code>id</code>，查询单个用户：</p>
            <div class="syntax-block">接口配置:
{
    "path": "/api/users/{id}",
    "method": "GET",
    "name": "根据ID查询用户",
    "params": [
        {"name":"id", "type":"Integer", "in":"path", "required":true}
    ],
    "resultType": "single"
}

MyBatis 动态SQL:
SELECT * FROM user WHERE id = #{id}</div>
            <p>其中 <code>#{id}</code> 会被安全替换为请求中传入的 id 值。</p>
        `,
        task: '编写你的第一个信息池接口：路径 <code>/api/users/{id}</code>，GET 方法，路径参数 <code>id</code>（Integer，必填），返回单条数据。MyBatis SQL 根据 id 查询 user 表。',
        context: `
            <div class="context-label">数据库表 user：</div>
            <div class="table-info">id       INT PRIMARY KEY
username VARCHAR(50)
email    VARCHAR(100)
age      INT</div>
            <div class="context-label">请求 → 响应示例：</div>
            <div class="endpoint-info">GET /api/users/1
参数提取: {id: 1}
动态SQL: SELECT * FROM user WHERE id = 1
→ {"id":1, "username":"张三", "email":"zhangsan@test.com", "age":28}</div>
        `,
        configHint: `{
    "path": "/api/users/{id}",
    "method": "GET",
    "name": "根据ID查询用户",
    "params": [
        {"name": "id", "type": "Integer", "in": "path", "required": true}
    ],
    "resultType": "single"
}`,
        sqlHint: `SELECT * FROM user WHERE id = #{id}`,
        configAnswer: `{
    "path": "/api/users/{id}",
    "method": "GET",
    "name": "根据ID查询用户",
    "params": [
        {"name": "id", "type": "Integer", "in": "path", "required": true}
    ],
    "resultType": "single"
}`,
        sqlAnswer: `SELECT * FROM user WHERE id = #{id}`,
        mockResponse: `{"id":1, "username":"张三", "email":"zhangsan@test.com", "age":28}`,
        validate(configStr, sqlStr) {
            const checks = [];
            let config;
            try { config = JSON.parse(configStr); checks.push({ pass: true, msg: 'JSON 格式正确' }); }
            catch (e) { checks.push({ pass: false, msg: 'JSON 格式错误：' + e.message }); return checks; }
            checks.push({ pass: config.path === '/api/users/{id}', msg: 'path 为 /api/users/{id}' });
            checks.push({ pass: config.method === 'GET', msg: 'method 为 GET' });
            checks.push({ pass: config.resultType === 'single', msg: 'resultType 为 single' });
            const params = config.params || [];
            const idParam = params.find(p => p.name === 'id');
            checks.push({ pass: !!idParam, msg: 'params 中包含 id 参数' });
            checks.push({ pass: idParam && idParam.type === 'Integer', msg: 'id 类型为 Integer' });
            checks.push({ pass: idParam && idParam.in === 'path', msg: 'id 来源为 path' });
            checks.push({ pass: idParam && idParam.required === true, msg: 'id 为必填' });
            checks.push({ pass: /SELECT\s.+FROM\s+user/i.test(sqlStr), msg: 'SQL 查询 user 表' });
            checks.push({ pass: /WHERE\s+id\s*=\s*#\{id\}/i.test(sqlStr), msg: '使用 #{id} 接收路径参数' });
            return checks;
        }
    },
    {
        id: 2,
        title: '查询参数过滤',
        description: '通过 URL 查询参数 ?key=value 过滤数据',
        tutorial: `
            <p>除了路径参数，还可以通过 <strong>URL 查询参数</strong>传入条件：</p>
            <div class="syntax-block">GET /api/users?gender=male
                    ↓ 提取参数
              {gender: "male"}
                    ↓ 注入 MyBatis
        SELECT * FROM user WHERE gender = #{gender}
                    ↓ 动态生成
        SELECT * FROM user WHERE gender = 'male'</div>
            <p>接口配置中，参数的 <code>in</code> 设为 <code>query</code> 表示来自 URL 查询参数：</p>
            <div class="syntax-block">"params": [
    {"name": "gender", "type": "String", "in": "query", "required": true}
]</div>
            <p>参数来源总结：</p>
            <ul style="margin:8px 0 8px 20px;line-height:2;">
                <li><code>path</code> — 路径参数（如 /users/<b>{id}</b>）</li>
                <li><code>query</code> — 查询参数（如 ?<b>gender=male</b>）</li>
                <li><code>body</code> — 请求体参数（POST/PUT 的 JSON 数据）</li>
            </ul>
        `,
        task: '编写一个按性别查询用户的接口：路径 <code>/api/users</code>，GET 方法，查询参数 <code>gender</code>（String，必填），返回列表。MyBatis SQL 使用 <code>#{gender}</code> 过滤。',
        context: `
            <div class="context-label">数据库表 user：</div>
            <div class="table-info">id INT | username VARCHAR | email VARCHAR | age INT | gender VARCHAR</div>
            <div class="context-label">请求 → 响应示例：</div>
            <div class="endpoint-info">GET /api/users?gender=female
参数: {gender: "female"}
SQL:  SELECT * FROM user WHERE gender = 'female'
→ [{"id":2,"username":"李四","gender":"female"}, ...]</div>
        `,
        configHint: `{
    "path": "/api/users",
    "method": "GET",
    "name": "按性别查询用户",
    "params": [
        {"name": "gender", "type": "String", "in": "query", "required": true}
    ],
    "resultType": "list"
}`,
        sqlHint: `SELECT * FROM user WHERE gender = #{gender}`,
        configAnswer: `{
    "path": "/api/users",
    "method": "GET",
    "name": "按性别查询用户",
    "params": [
        {"name": "gender", "type": "String", "in": "query", "required": true}
    ],
    "resultType": "list"
}`,
        sqlAnswer: `SELECT * FROM user WHERE gender = #{gender}`,
        mockResponse: `[{"id":2,"username":"李四","email":"lisi@test.com","age":24,"gender":"female"}]`,
        validate(configStr, sqlStr) {
            const checks = [];
            let config;
            try { config = JSON.parse(configStr); checks.push({ pass: true, msg: 'JSON 格式正确' }); }
            catch (e) { checks.push({ pass: false, msg: 'JSON 格式错误：' + e.message }); return checks; }
            checks.push({ pass: config.path === '/api/users', msg: 'path 为 /api/users' });
            checks.push({ pass: config.method === 'GET', msg: 'method 为 GET' });
            checks.push({ pass: config.resultType === 'list', msg: 'resultType 为 list' });
            const params = config.params || [];
            const gp = params.find(p => p.name === 'gender');
            checks.push({ pass: !!gp, msg: 'params 中包含 gender 参数' });
            checks.push({ pass: gp && gp.type === 'String', msg: 'gender 类型为 String' });
            checks.push({ pass: gp && gp.in === 'query', msg: 'gender 来源为 query' });
            checks.push({ pass: gp && gp.required === true, msg: 'gender 为必填' });
            checks.push({ pass: /WHERE\s+gender\s*=\s*#\{gender\}/i.test(sqlStr), msg: '使用 #{gender} 接收查询参数' });
            return checks;
        }
    },
    {
        id: 3,
        title: '多参数组合查询',
        description: '多个查询参数联合过滤数据',
        tutorial: `
            <p>一个接口可以同时接收<strong>多个参数</strong>，在 MyBatis SQL 中全部使用：</p>
            <div class="syntax-block">GET /api/users/filter?gender=male&minAge=20&maxAge=30
                    ↓ 提取参数
     {gender: "male", minAge: 20, maxAge: 30}
                    ↓ 注入 MyBatis
     SELECT * FROM user
     WHERE gender = #{gender}
       AND age BETWEEN #{minAge} AND #{maxAge}
                    ↓ 动态生成
     SELECT * FROM user
     WHERE gender = 'male'
       AND age BETWEEN 20 AND 30</div>
            <p>每个参数在 MyBatis SQL 中用 <code>#{参数名}</code> 引用，信息池会自动将请求参数的值安全注入。</p>
        `,
        task: '编写一个多条件筛选接口：路径 <code>/api/users/filter</code>，GET 方法，参数 <code>gender</code>（String）、<code>minAge</code>（Integer）、<code>maxAge</code>（Integer），均为必填查询参数。',
        context: `
            <div class="context-label">请求 → 动态SQL 示例：</div>
            <div class="endpoint-info">GET /api/users/filter?gender=male&minAge=20&maxAge=30
参数: {gender:"male", minAge:20, maxAge:30}
生成: SELECT * FROM user WHERE gender='male' AND age BETWEEN 20 AND 30</div>
        `,
        configHint: `{
    "path": "/api/users/filter",
    "method": "GET",
    "name": "按条件筛选用户",
    "params": [
        {"name": "gender", "type": "String", "in": "query", "required": true},
        {"name": "minAge", "type": "Integer", "in": "query", "required": true},
        {"name": "maxAge", "type": "Integer", "in": "query", "required": true}
    ],
    "resultType": "list"
}`,
        sqlHint: `SELECT * FROM user
WHERE gender = #{gender}
  AND age BETWEEN #{minAge} AND #{maxAge}`,
        configAnswer: `{
    "path": "/api/users/filter",
    "method": "GET",
    "name": "按条件筛选用户",
    "params": [
        {"name": "gender", "type": "String", "in": "query", "required": true},
        {"name": "minAge", "type": "Integer", "in": "query", "required": true},
        {"name": "maxAge", "type": "Integer", "in": "query", "required": true}
    ],
    "resultType": "list"
}`,
        sqlAnswer: `SELECT * FROM user
WHERE gender = #{gender}
  AND age BETWEEN #{minAge} AND #{maxAge}`,
        validate(configStr, sqlStr) {
            const checks = [];
            let config;
            try { config = JSON.parse(configStr); checks.push({ pass: true, msg: 'JSON 格式正确' }); }
            catch (e) { checks.push({ pass: false, msg: 'JSON 格式错误：' + e.message }); return checks; }
            checks.push({ pass: config.path === '/api/users/filter', msg: 'path 为 /api/users/filter' });
            checks.push({ pass: config.method === 'GET', msg: 'method 为 GET' });
            checks.push({ pass: config.resultType === 'list', msg: 'resultType 为 list' });
            const params = config.params || [];
            checks.push({ pass: params.length >= 3, msg: '至少定义了 3 个参数' });
            checks.push({ pass: params.some(p => p.name === 'gender' && p.in === 'query'), msg: 'gender 为查询参数' });
            checks.push({ pass: params.some(p => p.name === 'minAge' && p.type === 'Integer'), msg: 'minAge 为 Integer 类型' });
            checks.push({ pass: params.some(p => p.name === 'maxAge' && p.type === 'Integer'), msg: 'maxAge 为 Integer 类型' });
            checks.push({ pass: /#\{gender\}/.test(sqlStr), msg: 'SQL 使用 #{gender}' });
            checks.push({ pass: /#\{minAge\}/.test(sqlStr) && /#\{maxAge\}/.test(sqlStr), msg: 'SQL 使用 #{minAge} 和 #{maxAge}' });
            return checks;
        }
    },

    // ===== 第二阶段：CRUD 接口 =====
    {
        id: 4,
        title: 'POST 新增数据',
        description: '通过请求体参数写入新数据',
        tutorial: `
            <p>新增数据时，使用 <code>POST</code> 方法，参数通过<strong>请求体（body）</strong>传入：</p>
            <div class="syntax-block">POST /api/users
Body: {"username":"王五", "email":"wangwu@test.com", "age":25}
                    ↓ 提取参数
     {username:"王五", email:"wangwu@test.com", age:25}
                    ↓ 注入 MyBatis
     INSERT INTO user (username, email, age)
     VALUES (#{username}, #{email}, #{age})
                    ↓ 动态生成
     INSERT INTO user (username, email, age)
     VALUES ('王五', 'wangwu@test.com', 25)</div>
            <p>参数 <code>in</code> 设为 <code>body</code>，返回类型用 <code>affected</code>（影响行数）：</p>
            <div class="syntax-block">"resultType": "affected"  → 返回 {"affected": 1}</div>
        `,
        task: '编写新增用户接口：路径 <code>/api/users</code>，POST 方法，请求体参数 <code>username</code>（String，必填）、<code>email</code>（String，必填）、<code>age</code>（Integer，选填），返回影响行数。',
        context: `
            <div class="context-label">请求 → 动态SQL：</div>
            <div class="endpoint-info">POST /api/users
Body: {"username":"王五","email":"wangwu@test.com","age":25}
生成: INSERT INTO user (username,email,age) VALUES ('王五','wangwu@test.com',25)
→ {"affected": 1}</div>
        `,
        configHint: `{
    "path": "/api/users",
    "method": "POST",
    "name": "创建用户",
    "params": [
        {"name": "username", "type": "String", "in": "body", "required": true},
        {"name": "email", "type": "String", "in": "body", "required": true},
        {"name": "age", "type": "Integer", "in": "body", "required": false}
    ],
    "resultType": "affected"
}`,
        sqlHint: `INSERT INTO user (username, email, age)
VALUES (#{username}, #{email}, #{age})`,
        configAnswer: `{
    "path": "/api/users",
    "method": "POST",
    "name": "创建用户",
    "params": [
        {"name": "username", "type": "String", "in": "body", "required": true},
        {"name": "email", "type": "String", "in": "body", "required": true},
        {"name": "age", "type": "Integer", "in": "body", "required": false}
    ],
    "resultType": "affected"
}`,
        sqlAnswer: `INSERT INTO user (username, email, age)
VALUES (#{username}, #{email}, #{age})`,
        mockResponse: `{"affected": 1}`,
        validate(configStr, sqlStr) {
            const checks = [];
            let config;
            try { config = JSON.parse(configStr); checks.push({ pass: true, msg: 'JSON 格式正确' }); }
            catch (e) { checks.push({ pass: false, msg: 'JSON 格式错误：' + e.message }); return checks; }
            checks.push({ pass: config.path === '/api/users', msg: 'path 为 /api/users' });
            checks.push({ pass: config.method === 'POST', msg: 'method 为 POST' });
            checks.push({ pass: config.resultType === 'affected', msg: 'resultType 为 affected' });
            const params = config.params || [];
            checks.push({ pass: params.some(p => p.name === 'username' && p.in === 'body' && p.required === true), msg: 'username：body 必填' });
            checks.push({ pass: params.some(p => p.name === 'email' && p.in === 'body' && p.required === true), msg: 'email：body 必填' });
            checks.push({ pass: params.some(p => p.name === 'age' && p.in === 'body' && p.required === false), msg: 'age：body 选填' });
            checks.push({ pass: /INSERT\s+INTO\s+user/i.test(sqlStr), msg: 'SQL 包含 INSERT INTO user' });
            checks.push({ pass: /#\{username\}/.test(sqlStr) && /#\{email\}/.test(sqlStr) && /#\{age\}/.test(sqlStr), msg: '使用 #{username}、#{email}、#{age} 接收参数' });
            return checks;
        }
    },
    {
        id: 5,
        title: 'PUT 更新数据',
        description: '路径参数定位 + 请求体参数修改',
        tutorial: `
            <p>更新接口需要<strong>两类参数</strong>配合：</p>
            <ul style="margin:8px 0 8px 20px;line-height:2;">
                <li><code>path</code> 参数 — 定位要修改的记录（如 id）</li>
                <li><code>body</code> 参数 — 传入新的字段值</li>
            </ul>
            <div class="syntax-block">PUT /api/users/1
Body: {"username":"张三三","email":"new@test.com","age":30}
                    ↓ 参数合并
     {id:1, username:"张三三", email:"new@test.com", age:30}
                    ↓ 注入 MyBatis
     UPDATE user
     SET username=#{username}, email=#{email}, age=#{age}
     WHERE id = #{id}
                    ↓ 动态生成
     UPDATE user SET username='张三三'... WHERE id=1</div>
        `,
        task: '编写更新用户接口：路径 <code>/api/users/{id}</code>，PUT 方法，路径参数 <code>id</code>（Integer，必填），请求体参数 <code>username</code>、<code>email</code>、<code>age</code> 均为必填。',
        context: `
            <div class="context-label">请求 → 动态SQL：</div>
            <div class="endpoint-info">PUT /api/users/1
Body: {"username":"张三三","email":"new@test.com","age":30}
生成: UPDATE user SET username='张三三',email='new@test.com',age=30 WHERE id=1</div>
        `,
        configHint: `{
    "path": "/api/users/{id}",
    "method": "PUT",
    "name": "更新用户信息",
    "params": [
        {"name": "id", "type": "Integer", "in": "path", "required": true},
        {"name": "username", "type": "String", "in": "body", "required": true},
        {"name": "email", "type": "String", "in": "body", "required": true},
        {"name": "age", "type": "Integer", "in": "body", "required": true}
    ],
    "resultType": "affected"
}`,
        sqlHint: `UPDATE user
SET username = #{username}, email = #{email}, age = #{age}
WHERE id = #{id}`,
        configAnswer: `{
    "path": "/api/users/{id}",
    "method": "PUT",
    "name": "更新用户信息",
    "params": [
        {"name": "id", "type": "Integer", "in": "path", "required": true},
        {"name": "username", "type": "String", "in": "body", "required": true},
        {"name": "email", "type": "String", "in": "body", "required": true},
        {"name": "age", "type": "Integer", "in": "body", "required": true}
    ],
    "resultType": "affected"
}`,
        sqlAnswer: `UPDATE user
SET username = #{username}, email = #{email}, age = #{age}
WHERE id = #{id}`,
        mockResponse: `{"affected": 1}`,
        validate(configStr, sqlStr) {
            const checks = [];
            let config;
            try { config = JSON.parse(configStr); checks.push({ pass: true, msg: 'JSON 格式正确' }); }
            catch (e) { checks.push({ pass: false, msg: 'JSON 格式错误：' + e.message }); return checks; }
            checks.push({ pass: config.path === '/api/users/{id}', msg: 'path 为 /api/users/{id}' });
            checks.push({ pass: config.method === 'PUT', msg: 'method 为 PUT' });
            checks.push({ pass: config.resultType === 'affected', msg: 'resultType 为 affected' });
            const params = config.params || [];
            checks.push({ pass: params.some(p => p.name === 'id' && p.in === 'path'), msg: 'id 为路径参数' });
            checks.push({ pass: params.some(p => p.name === 'username' && p.in === 'body'), msg: 'username 为请求体参数' });
            checks.push({ pass: params.some(p => p.name === 'email' && p.in === 'body'), msg: 'email 为请求体参数' });
            checks.push({ pass: /UPDATE\s+user\s+SET/i.test(sqlStr), msg: 'SQL 包含 UPDATE user SET' });
            checks.push({ pass: /WHERE\s+id\s*=\s*#\{id\}/i.test(sqlStr), msg: '使用 #{id} 定位记录' });
            checks.push({ pass: /#\{username\}/.test(sqlStr) && /#\{email\}/.test(sqlStr), msg: '使用 #{} 接收更新字段' });
            return checks;
        }
    },
    {
        id: 6,
        title: 'DELETE 删除数据',
        description: '通过路径参数指定要删除的记录',
        tutorial: `
            <p><code>DELETE</code> 接口通过路径参数指定要删除的数据：</p>
            <div class="syntax-block">DELETE /api/users/3
              ↓ 提取参数
        {id: 3}
              ↓ 注入 MyBatis
        DELETE FROM user WHERE id = #{id}
              ↓ 动态生成
        DELETE FROM user WHERE id = 3</div>
            <p>DELETE 接口通常只需要路径参数，不需要请求体。</p>
        `,
        task: '编写删除用户接口：路径 <code>/api/users/{id}</code>，DELETE 方法，路径参数 <code>id</code>（Integer，必填），返回影响行数。',
        context: `
            <div class="context-label">请求 → 动态SQL：</div>
            <div class="endpoint-info">DELETE /api/users/3
参数: {id: 3}
生成: DELETE FROM user WHERE id = 3
→ {"affected": 1}</div>
        `,
        configHint: `{
    "path": "/api/users/{id}",
    "method": "DELETE",
    "name": "删除用户",
    "params": [
        {"name": "id", "type": "Integer", "in": "path", "required": true}
    ],
    "resultType": "affected"
}`,
        sqlHint: `DELETE FROM user WHERE id = #{id}`,
        configAnswer: `{
    "path": "/api/users/{id}",
    "method": "DELETE",
    "name": "删除用户",
    "params": [
        {"name": "id", "type": "Integer", "in": "path", "required": true}
    ],
    "resultType": "affected"
}`,
        sqlAnswer: `DELETE FROM user WHERE id = #{id}`,
        mockResponse: `{"affected": 1}`,
        validate(configStr, sqlStr) {
            const checks = [];
            let config;
            try { config = JSON.parse(configStr); checks.push({ pass: true, msg: 'JSON 格式正确' }); }
            catch (e) { checks.push({ pass: false, msg: 'JSON 格式错误：' + e.message }); return checks; }
            checks.push({ pass: config.path === '/api/users/{id}', msg: 'path 为 /api/users/{id}' });
            checks.push({ pass: config.method === 'DELETE', msg: 'method 为 DELETE' });
            checks.push({ pass: config.resultType === 'affected', msg: 'resultType 为 affected' });
            const params = config.params || [];
            checks.push({ pass: params.some(p => p.name === 'id' && p.in === 'path' && p.required === true), msg: 'id：path 必填' });
            checks.push({ pass: /DELETE\s+FROM\s+user/i.test(sqlStr), msg: 'SQL 包含 DELETE FROM user' });
            checks.push({ pass: /WHERE\s+id\s*=\s*#\{id\}/i.test(sqlStr), msg: '使用 #{id} 定位删除' });
            return checks;
        }
    },
    {
        id: 7,
        title: '新增返回自增ID',
        description: '插入数据后获取数据库生成的主键',
        tutorial: `
            <p>新增数据后，经常需要返回数据库自动生成的 ID。在接口配置中添加：</p>
            <div class="syntax-block">"useGeneratedKeys": true,
"keyProperty": "id"</div>
            <p>工作流程：</p>
            <div class="syntax-block">POST /api/users
Body: {"username":"新用户","email":"new@test.com"}
    ↓ MyBatis 执行 INSERT 后自动获取生成的 ID
→ {"affected":1, "id":5}  ← 自动包含生成的ID</div>
        `,
        task: '编写创建用户并返回ID的接口：路径 <code>/api/users</code>，POST 方法，参数 <code>username</code>（String，必填）和 <code>email</code>（String，必填），启用自增主键返回（keyProperty 为 <code>id</code>）。',
        context: `
            <div class="context-label">请求 → 动态SQL → 响应：</div>
            <div class="endpoint-info">POST /api/users
Body: {"username":"新用户","email":"new@test.com"}
生成: INSERT INTO user (username,email) VALUES ('新用户','new@test.com')
→ {"affected":1, "id":5}</div>
        `,
        configHint: `{
    "path": "/api/users",
    "method": "POST",
    "name": "创建用户并返回ID",
    "params": [
        {"name": "username", "type": "String", "in": "body", "required": true},
        {"name": "email", "type": "String", "in": "body", "required": true}
    ],
    "resultType": "affected",
    "useGeneratedKeys": true,
    "keyProperty": "id"
}`,
        sqlHint: `INSERT INTO user (username, email)
VALUES (#{username}, #{email})`,
        configAnswer: `{
    "path": "/api/users",
    "method": "POST",
    "name": "创建用户并返回ID",
    "params": [
        {"name": "username", "type": "String", "in": "body", "required": true},
        {"name": "email", "type": "String", "in": "body", "required": true}
    ],
    "resultType": "affected",
    "useGeneratedKeys": true,
    "keyProperty": "id"
}`,
        sqlAnswer: `INSERT INTO user (username, email)
VALUES (#{username}, #{email})`,
        mockResponse: `{"affected":1, "id":5}`,
        validate(configStr, sqlStr) {
            const checks = [];
            let config;
            try { config = JSON.parse(configStr); checks.push({ pass: true, msg: 'JSON 格式正确' }); }
            catch (e) { checks.push({ pass: false, msg: 'JSON 格式错误：' + e.message }); return checks; }
            checks.push({ pass: config.method === 'POST', msg: 'method 为 POST' });
            checks.push({ pass: config.useGeneratedKeys === true, msg: 'useGeneratedKeys 为 true' });
            checks.push({ pass: config.keyProperty === 'id', msg: 'keyProperty 为 id' });
            const params = config.params || [];
            checks.push({ pass: params.some(p => p.name === 'username' && p.in === 'body'), msg: 'username 为请求体参数' });
            checks.push({ pass: params.some(p => p.name === 'email' && p.in === 'body'), msg: 'email 为请求体参数' });
            checks.push({ pass: /INSERT\s+INTO\s+user/i.test(sqlStr), msg: 'SQL 包含 INSERT INTO user' });
            checks.push({ pass: /#\{username\}/.test(sqlStr) && /#\{email\}/.test(sqlStr), msg: '使用 #{} 接收参数' });
            return checks;
        }
    },

    // ===== 第三阶段：查询技巧 =====
    {
        id: 8,
        title: '安全字段查询',
        description: '只返回指定字段，避免泄露敏感数据',
        tutorial: `
            <p>接口应<strong>只返回必要字段</strong>，避免暴露密码等敏感数据：</p>
            <div class="syntax-block">GET /api/users/simple?status=active
    ↓ 参数: {status: "active"}
    ↓ MyBatis:
SELECT id, username, email FROM user WHERE status = #{status}
    ↓ 生成: SELECT id, username, email FROM user WHERE status='active'
→ [{"id":1,"username":"张三","email":"..."}]  ← 不含 password</div>
            <p>注意 SQL 中<strong>不要用 SELECT *</strong>，明确列出需要的字段。</p>
        `,
        task: '编写获取活跃用户简要信息的接口：路径 <code>/api/users/simple</code>，GET 方法，查询参数 <code>status</code>（String，必填），只查询 <code>id</code>、<code>username</code>、<code>email</code> 三个字段，返回列表。',
        context: `
            <div class="context-label">数据库表 user（全部字段）：</div>
            <div class="table-info">id, username, email, password(敏感!), age, gender, status</div>
            <div class="context-label">请求 → 动态SQL：</div>
            <div class="endpoint-info">GET /api/users/simple?status=active
生成: SELECT id,username,email FROM user WHERE status='active'</div>
        `,
        configHint: `{
    "path": "/api/users/simple",
    "method": "GET",
    "name": "获取用户简要信息",
    "params": [
        {"name": "status", "type": "String", "in": "query", "required": true}
    ],
    "resultType": "list"
}`,
        sqlHint: `SELECT id, username, email FROM user WHERE status = #{status}`,
        configAnswer: `{
    "path": "/api/users/simple",
    "method": "GET",
    "name": "获取用户简要信息",
    "params": [
        {"name": "status", "type": "String", "in": "query", "required": true}
    ],
    "resultType": "list"
}`,
        sqlAnswer: `SELECT id, username, email FROM user WHERE status = #{status}`,
        validate(configStr, sqlStr) {
            const checks = [];
            let config;
            try { config = JSON.parse(configStr); checks.push({ pass: true, msg: 'JSON 格式正确' }); }
            catch (e) { checks.push({ pass: false, msg: 'JSON 格式错误：' + e.message }); return checks; }
            checks.push({ pass: config.path === '/api/users/simple', msg: 'path 为 /api/users/simple' });
            checks.push({ pass: config.method === 'GET', msg: 'method 为 GET' });
            checks.push({ pass: config.resultType === 'list', msg: 'resultType 为 list' });
            const params = config.params || [];
            checks.push({ pass: params.some(p => p.name === 'status' && p.in === 'query'), msg: 'status 为查询参数' });
            checks.push({ pass: !/SELECT\s+\*/i.test(sqlStr), msg: '没有使用 SELECT *（安全）' });
            checks.push({ pass: !/\bpassword\b/i.test(sqlStr), msg: '没有查询 password 字段' });
            checks.push({ pass: /\bid\b/i.test(sqlStr) && /\busername\b/i.test(sqlStr) && /\bemail\b/i.test(sqlStr), msg: '查询了 id、username、email' });
            checks.push({ pass: /#\{status\}/.test(sqlStr), msg: '使用 #{status} 过滤' });
            return checks;
        }
    },
    {
        id: 9,
        title: '模糊搜索接口',
        description: '参数注入模糊查询实现关键词搜索',
        tutorial: `
            <p>模糊搜索需要在参数值两侧加 <code>%</code> 通配符。<strong>安全做法</strong>是用 <code>CONCAT</code> 函数：</p>
            <div class="syntax-block">GET /api/users/search?keyword=张
    ↓ 参数: {keyword: "张"}
    ↓ MyBatis:
SELECT * FROM user
WHERE username LIKE CONCAT('%', #{keyword}, '%')
    ↓ 动态生成:
SELECT * FROM user WHERE username LIKE '%张%'</div>
            <p><b>注意：</b>不要用 <code>\${keyword}</code> 拼接，会有 SQL 注入风险！始终用 <code>#{}</code> + <code>CONCAT</code>。</p>
        `,
        task: '编写用户搜索接口：路径 <code>/api/users/search</code>，GET 方法，查询参数 <code>keyword</code>（String，必填），用 CONCAT + <code>#{keyword}</code> 实现模糊搜索 username。',
        context: `
            <div class="context-label">请求 → 动态SQL：</div>
            <div class="endpoint-info">GET /api/users/search?keyword=张
生成: SELECT * FROM user WHERE username LIKE '%张%'
→ [{"username":"张三"},{"username":"张伟"}]</div>
        `,
        configHint: `{
    "path": "/api/users/search",
    "method": "GET",
    "name": "用户搜索",
    "params": [
        {"name": "keyword", "type": "String", "in": "query", "required": true}
    ],
    "resultType": "list"
}`,
        sqlHint: `SELECT * FROM user
WHERE username LIKE CONCAT('%', #{keyword}, '%')`,
        configAnswer: `{
    "path": "/api/users/search",
    "method": "GET",
    "name": "用户搜索",
    "params": [
        {"name": "keyword", "type": "String", "in": "query", "required": true}
    ],
    "resultType": "list"
}`,
        sqlAnswer: `SELECT * FROM user
WHERE username LIKE CONCAT('%', #{keyword}, '%')`,
        validate(configStr, sqlStr) {
            const checks = [];
            let config;
            try { config = JSON.parse(configStr); checks.push({ pass: true, msg: 'JSON 格式正确' }); }
            catch (e) { checks.push({ pass: false, msg: 'JSON 格式错误：' + e.message }); return checks; }
            checks.push({ pass: config.path === '/api/users/search', msg: 'path 为 /api/users/search' });
            checks.push({ pass: config.method === 'GET', msg: 'method 为 GET' });
            const params = config.params || [];
            checks.push({ pass: params.some(p => p.name === 'keyword' && p.in === 'query'), msg: 'keyword 为查询参数' });
            checks.push({ pass: /LIKE/i.test(sqlStr), msg: 'SQL 包含 LIKE' });
            checks.push({ pass: /CONCAT\s*\(\s*'%'\s*,\s*#\{keyword\}\s*,\s*'%'\s*\)/i.test(sqlStr), msg: '使用 CONCAT + #{keyword} 安全拼接' });
            checks.push({ pass: !/\$\{keyword\}/.test(sqlStr), msg: '没有使用 ${keyword}（避免注入）' });
            return checks;
        }
    },
    {
        id: 10,
        title: '分页查询接口',
        description: '通过参数控制分页返回数据',
        tutorial: `
            <p>分页接口接收 <code>pageSize</code>（每页条数）和 <code>offset</code>（偏移量），注入 MyBatis 的 LIMIT 子句：</p>
            <div class="syntax-block">GET /api/users?pageSize=10&offset=20
    ↓ 参数: {pageSize:10, offset:20}
    ↓ MyBatis:
SELECT * FROM user LIMIT #{pageSize} OFFSET #{offset}
    ↓ 动态生成:
SELECT * FROM user LIMIT 10 OFFSET 20  → 第3页数据</div>
            <p>前端计算偏移量：<code>offset = (page - 1) × pageSize</code></p>
        `,
        task: '编写分页查询用户的接口：路径 <code>/api/users</code>，GET 方法，查询参数 <code>pageSize</code>（Integer，必填）和 <code>offset</code>（Integer，必填），返回列表。',
        context: `
            <div class="context-label">请求 → 动态SQL：</div>
            <div class="endpoint-info">GET /api/users?pageSize=10&offset=0   → 第1页
GET /api/users?pageSize=10&offset=10  → 第2页
生成: SELECT * FROM user LIMIT 10 OFFSET 0</div>
        `,
        configHint: `{
    "path": "/api/users",
    "method": "GET",
    "name": "分页查询用户",
    "params": [
        {"name": "pageSize", "type": "Integer", "in": "query", "required": true},
        {"name": "offset", "type": "Integer", "in": "query", "required": true}
    ],
    "resultType": "list"
}`,
        sqlHint: `SELECT * FROM user LIMIT #{pageSize} OFFSET #{offset}`,
        configAnswer: `{
    "path": "/api/users",
    "method": "GET",
    "name": "分页查询用户",
    "params": [
        {"name": "pageSize", "type": "Integer", "in": "query", "required": true},
        {"name": "offset", "type": "Integer", "in": "query", "required": true}
    ],
    "resultType": "list"
}`,
        sqlAnswer: `SELECT * FROM user LIMIT #{pageSize} OFFSET #{offset}`,
        validate(configStr, sqlStr) {
            const checks = [];
            let config;
            try { config = JSON.parse(configStr); checks.push({ pass: true, msg: 'JSON 格式正确' }); }
            catch (e) { checks.push({ pass: false, msg: 'JSON 格式错误：' + e.message }); return checks; }
            checks.push({ pass: config.path === '/api/users', msg: 'path 为 /api/users' });
            checks.push({ pass: config.method === 'GET', msg: 'method 为 GET' });
            checks.push({ pass: config.resultType === 'list', msg: 'resultType 为 list' });
            const params = config.params || [];
            checks.push({ pass: params.some(p => p.name === 'pageSize' && p.type === 'Integer'), msg: 'pageSize 为 Integer' });
            checks.push({ pass: params.some(p => p.name === 'offset' && p.type === 'Integer'), msg: 'offset 为 Integer' });
            checks.push({ pass: /LIMIT\s+#\{pageSize\}/i.test(sqlStr), msg: '使用 #{pageSize} 控制条数' });
            checks.push({ pass: /OFFSET\s+#\{offset\}/i.test(sqlStr), msg: '使用 #{offset} 控制偏移' });
            return checks;
        }
    },
    {
        id: 11,
        title: '排序查询接口',
        description: '参数控制排序字段和方向',
        tutorial: `
            <p>排序字段和方向需要用 <code>\${}</code>（字符串拼接）而非 <code>#{}</code>（预编译参数），因为列名不能作为预编译参数：</p>
            <div class="syntax-block">GET /api/users?sortField=age&sortOrder=DESC
    ↓ 参数: {sortField:"age", sortOrder:"DESC"}
    ↓ MyBatis（注意用 \${}）:
SELECT * FROM user ORDER BY \${sortField} \${sortOrder}
    ↓ 动态生成:
SELECT * FROM user ORDER BY age DESC</div>
            <p><code>#{}</code> → 预编译参数，安全，<strong>用于值</strong></p>
            <p><code>\${}</code> → 字符串拼接，<strong>用于列名/关键字</strong>（需后端做白名单校验）</p>
        `,
        task: '编写排序查询接口：路径 <code>/api/users</code>，GET 方法，查询参数 <code>sortField</code>（String，必填）和 <code>sortOrder</code>（String，必填），SQL 用 <code>${}</code> 拼接排序。',
        context: `
            <div class="context-label">#{} vs \${} 对比：</div>
            <div class="table-info">#{value}  → WHERE id = ?    (预编译，安全)
\${column} → ORDER BY age    (拼接，用于列名)</div>
            <div class="context-label">请求 → 动态SQL：</div>
            <div class="endpoint-info">GET /api/users?sortField=age&sortOrder=DESC
生成: SELECT * FROM user ORDER BY age DESC</div>
        `,
        configHint: `{
    "path": "/api/users",
    "method": "GET",
    "name": "排序查询用户",
    "params": [
        {"name": "sortField", "type": "String", "in": "query", "required": true},
        {"name": "sortOrder", "type": "String", "in": "query", "required": true}
    ],
    "resultType": "list"
}`,
        sqlHint: `SELECT * FROM user ORDER BY \${sortField} \${sortOrder}`,
        configAnswer: `{
    "path": "/api/users",
    "method": "GET",
    "name": "排序查询用户",
    "params": [
        {"name": "sortField", "type": "String", "in": "query", "required": true},
        {"name": "sortOrder", "type": "String", "in": "query", "required": true}
    ],
    "resultType": "list"
}`,
        sqlAnswer: `SELECT * FROM user ORDER BY \${sortField} \${sortOrder}`,
        validate(configStr, sqlStr) {
            const checks = [];
            let config;
            try { config = JSON.parse(configStr); checks.push({ pass: true, msg: 'JSON 格式正确' }); }
            catch (e) { checks.push({ pass: false, msg: 'JSON 格式错误：' + e.message }); return checks; }
            checks.push({ pass: config.path === '/api/users', msg: 'path 为 /api/users' });
            checks.push({ pass: config.method === 'GET', msg: 'method 为 GET' });
            const params = config.params || [];
            checks.push({ pass: params.some(p => p.name === 'sortField'), msg: '包含 sortField 参数' });
            checks.push({ pass: params.some(p => p.name === 'sortOrder'), msg: '包含 sortOrder 参数' });
            checks.push({ pass: /ORDER\s+BY/i.test(sqlStr), msg: 'SQL 包含 ORDER BY' });
            checks.push({ pass: /\$\{sortField\}/.test(sqlStr), msg: '排序字段用 ${sortField}' });
            checks.push({ pass: /\$\{sortOrder\}/.test(sqlStr), msg: '排序方向用 ${sortOrder}' });
            return checks;
        }
    },

    // ===== 第四阶段：动态SQL =====
    {
        id: 12,
        title: '<if> 可选参数',
        description: '参数传了才拼接条件，实现可选过滤',
        tutorial: `
            <p>很多接口的参数是<strong>可选的</strong>——传了就过滤，没传就忽略。使用 MyBatis <code>&lt;if&gt;</code> 判断参数是否传入：</p>
            <div class="syntax-block">GET /api/users/query?username=张三      → 只按用户名查
GET /api/users/query?age=25             → 只按年龄查
GET /api/users/query?username=张三&age=25 → 两个条件都查
GET /api/users/query                     → 返回全部</div>
            <p>MyBatis 动态SQL：</p>
            <div class="syntax-block">SELECT * FROM user WHERE 1=1
&lt;if test="username != null"&gt;
    AND username = #{username}
&lt;/if&gt;
&lt;if test="age != null"&gt;
    AND age = #{age}
&lt;/if&gt;</div>
            <p>参数未传入时为 null，<code>&lt;if test="参数 != null"&gt;</code> 不成立，该段 SQL 不会生成。</p>
        `,
        task: '编写可选条件查询接口：路径 <code>/api/users/query</code>，GET 方法，查询参数 <code>username</code>（String，选填）和 <code>age</code>（Integer，选填），用 <code>&lt;if&gt;</code> 动态拼接条件。',
        context: `
            <div class="context-label">不同传参 → 不同SQL：</div>
            <div class="endpoint-info">无参数     → SELECT * FROM user WHERE 1=1
?username=张三 → ... WHERE 1=1 AND username='张三'
?age=25      → ... WHERE 1=1 AND age=25
两个都传     → ... WHERE 1=1 AND username='张三' AND age=25</div>
        `,
        configHint: `{
    "path": "/api/users/query",
    "method": "GET",
    "name": "条件查询用户",
    "params": [
        {"name": "username", "type": "String", "in": "query", "required": false},
        {"name": "age", "type": "Integer", "in": "query", "required": false}
    ],
    "resultType": "list"
}`,
        sqlHint: `SELECT * FROM user WHERE 1=1
<if test="username != null">
    AND username = #{username}
</if>
<if test="age != null">
    AND age = #{age}
</if>`,
        configAnswer: `{
    "path": "/api/users/query",
    "method": "GET",
    "name": "条件查询用户",
    "params": [
        {"name": "username", "type": "String", "in": "query", "required": false},
        {"name": "age", "type": "Integer", "in": "query", "required": false}
    ],
    "resultType": "list"
}`,
        sqlAnswer: `SELECT * FROM user WHERE 1=1
<if test="username != null">
    AND username = #{username}
</if>
<if test="age != null">
    AND age = #{age}
</if>`,
        validate(configStr, sqlStr) {
            const checks = [];
            let config;
            try { config = JSON.parse(configStr); checks.push({ pass: true, msg: 'JSON 格式正确' }); }
            catch (e) { checks.push({ pass: false, msg: 'JSON 格式错误：' + e.message }); return checks; }
            checks.push({ pass: config.path === '/api/users/query', msg: 'path 为 /api/users/query' });
            checks.push({ pass: config.method === 'GET', msg: 'method 为 GET' });
            const params = config.params || [];
            checks.push({ pass: params.some(p => p.name === 'username' && p.required === false), msg: 'username 为选填参数' });
            checks.push({ pass: params.some(p => p.name === 'age' && p.required === false), msg: 'age 为选填参数' });
            checks.push({ pass: /<if\s+test\s*=\s*"username\s*!=\s*null"/.test(sqlStr), msg: '包含 <if test="username != null">' });
            checks.push({ pass: /<if\s+test\s*=\s*"age\s*!=\s*null"/.test(sqlStr), msg: '包含 <if test="age != null">' });
            checks.push({ pass: /#\{username\}/.test(sqlStr) && /#\{age\}/.test(sqlStr), msg: '使用 #{} 接收参数' });
            return checks;
        }
    },
    {
        id: 13,
        title: '<where> 智能拼接',
        description: '用 <where> 替代 WHERE 1=1 更优雅',
        tutorial: `
            <p>上一关用 <code>WHERE 1=1</code> 来避免多余的 AND，更优雅的方式是用 <code>&lt;where&gt;</code> 标签：</p>
            <div class="syntax-block">SELECT * FROM user
&lt;where&gt;
    &lt;if test="username != null"&gt;
        AND username = #{username}
    &lt;/if&gt;
    &lt;if test="age != null"&gt;
        AND age = #{age}
    &lt;/if&gt;
&lt;/where&gt;</div>
            <p><code>&lt;where&gt;</code> 的作用：</p>
            <ul style="margin:8px 0 8px 20px;line-height:2;">
                <li>至少一个条件成立时，自动插入 WHERE</li>
                <li>自动去除开头多余的 AND/OR</li>
                <li>所有条件都不成立时，不生成 WHERE 子句</li>
            </ul>
        `,
        task: '改造第12关：路径 <code>/api/users/query</code>，用 <code>&lt;where&gt;</code> 替代 <code>WHERE 1=1</code>，支持 <code>username</code> 和 <code>age</code> 可选条件。',
        context: `
            <div class="context-label">对比：</div>
            <div class="table-info">旧: WHERE 1=1 &lt;if...&gt;AND xxx&lt;/if&gt;
新: &lt;where&gt; &lt;if...&gt;AND xxx&lt;/if&gt; &lt;/where&gt;</div>
        `,
        configHint: `{
    "path": "/api/users/query",
    "method": "GET",
    "name": "条件查询用户",
    "params": [
        {"name": "username", "type": "String", "in": "query", "required": false},
        {"name": "age", "type": "Integer", "in": "query", "required": false}
    ],
    "resultType": "list"
}`,
        sqlHint: `SELECT * FROM user
<where>
    <if test="username != null">
        AND username = #{username}
    </if>
    <if test="age != null">
        AND age = #{age}
    </if>
</where>`,
        configAnswer: `{
    "path": "/api/users/query",
    "method": "GET",
    "name": "条件查询用户",
    "params": [
        {"name": "username", "type": "String", "in": "query", "required": false},
        {"name": "age", "type": "Integer", "in": "query", "required": false}
    ],
    "resultType": "list"
}`,
        sqlAnswer: `SELECT * FROM user
<where>
    <if test="username != null">
        AND username = #{username}
    </if>
    <if test="age != null">
        AND age = #{age}
    </if>
</where>`,
        validate(configStr, sqlStr) {
            const checks = [];
            let config;
            try { config = JSON.parse(configStr); checks.push({ pass: true, msg: 'JSON 格式正确' }); }
            catch (e) { checks.push({ pass: false, msg: 'JSON 格式错误：' + e.message }); return checks; }
            checks.push({ pass: config.path === '/api/users/query', msg: 'path 为 /api/users/query' });
            const params = config.params || [];
            checks.push({ pass: params.some(p => p.name === 'username' && p.required === false), msg: 'username 为选填' });
            checks.push({ pass: params.some(p => p.name === 'age' && p.required === false), msg: 'age 为选填' });
            checks.push({ pass: /<where\s*>/.test(sqlStr) && /<\/where\s*>/.test(sqlStr), msg: '使用 <where> 标签' });
            checks.push({ pass: !(/WHERE\s+1\s*=\s*1/i.test(sqlStr)), msg: '没有使用 WHERE 1=1' });
            checks.push({ pass: /<if\s+test\s*=\s*"username\s*!=\s*null"/.test(sqlStr), msg: '包含 username 条件判断' });
            checks.push({ pass: /<if\s+test\s*=\s*"age\s*!=\s*null"/.test(sqlStr), msg: '包含 age 条件判断' });
            return checks;
        }
    },
    {
        id: 14,
        title: '<set> 动态更新',
        description: '只更新传入的字段，未传的保持不变',
        tutorial: `
            <p>部分更新接口——前端只传需要修改的字段，其余保持不变：</p>
            <div class="syntax-block">PUT /api/users/1  Body: {"username":"新名字"}
    ↓ 参数: {id:1, username:"新名字", email:null, age:null}
    ↓ MyBatis &lt;set&gt; + &lt;if&gt;:
UPDATE user
&lt;set&gt;
    &lt;if test="username != null"&gt;username = #{username},&lt;/if&gt;
    &lt;if test="email != null"&gt;email = #{email},&lt;/if&gt;
    &lt;if test="age != null"&gt;age = #{age},&lt;/if&gt;
&lt;/set&gt;
WHERE id = #{id}
    ↓ 动态生成（只更新了 username）:
UPDATE user SET username='新名字' WHERE id=1</div>
            <p><code>&lt;set&gt;</code> 自动插入 SET 关键字并去除末尾多余逗号。</p>
        `,
        task: '编写部分更新接口：路径 <code>/api/users/{id}</code>，PUT 方法，<code>id</code>（path，必填），<code>username</code>、<code>email</code>、<code>age</code> 均为 body 选填，用 <code>&lt;set&gt;</code> + <code>&lt;if&gt;</code>。',
        context: `
            <div class="context-label">不同传参 → 不同SQL：</div>
            <div class="endpoint-info">Body:{"username":"新名字"} → SET username='新名字'
Body:{"email":"a@b.com","age":30} → SET email='a@b.com',age=30</div>
        `,
        configHint: `{
    "path": "/api/users/{id}",
    "method": "PUT",
    "name": "部分更新用户",
    "params": [
        {"name": "id", "type": "Integer", "in": "path", "required": true},
        {"name": "username", "type": "String", "in": "body", "required": false},
        {"name": "email", "type": "String", "in": "body", "required": false},
        {"name": "age", "type": "Integer", "in": "body", "required": false}
    ],
    "resultType": "affected"
}`,
        sqlHint: `UPDATE user
<set>
    <if test="username != null">username = #{username},</if>
    <if test="email != null">email = #{email},</if>
    <if test="age != null">age = #{age},</if>
</set>
WHERE id = #{id}`,
        configAnswer: `{
    "path": "/api/users/{id}",
    "method": "PUT",
    "name": "部分更新用户",
    "params": [
        {"name": "id", "type": "Integer", "in": "path", "required": true},
        {"name": "username", "type": "String", "in": "body", "required": false},
        {"name": "email", "type": "String", "in": "body", "required": false},
        {"name": "age", "type": "Integer", "in": "body", "required": false}
    ],
    "resultType": "affected"
}`,
        sqlAnswer: `UPDATE user
<set>
    <if test="username != null">username = #{username},</if>
    <if test="email != null">email = #{email},</if>
    <if test="age != null">age = #{age},</if>
</set>
WHERE id = #{id}`,
        validate(configStr, sqlStr) {
            const checks = [];
            let config;
            try { config = JSON.parse(configStr); checks.push({ pass: true, msg: 'JSON 格式正确' }); }
            catch (e) { checks.push({ pass: false, msg: 'JSON 格式错误：' + e.message }); return checks; }
            checks.push({ pass: config.path === '/api/users/{id}', msg: 'path 为 /api/users/{id}' });
            checks.push({ pass: config.method === 'PUT', msg: 'method 为 PUT' });
            const params = config.params || [];
            checks.push({ pass: params.some(p => p.name === 'id' && p.in === 'path' && p.required === true), msg: 'id 为必填路径参数' });
            checks.push({ pass: params.some(p => p.name === 'username' && p.required === false), msg: 'username 为选填' });
            checks.push({ pass: params.some(p => p.name === 'email' && p.required === false), msg: 'email 为选填' });
            checks.push({ pass: /<set\s*>/.test(sqlStr) && /<\/set\s*>/.test(sqlStr), msg: '使用 <set> 标签' });
            checks.push({ pass: /<if\s+test/.test(sqlStr), msg: '包含 <if> 条件判断' });
            checks.push({ pass: /WHERE\s+id\s*=\s*#\{id\}/i.test(sqlStr), msg: '使用 #{id} 定位记录' });
            return checks;
        }
    },
    {
        id: 15,
        title: '<foreach> 批量查询',
        description: '接收 ID 列表参数，动态生成 IN 子句',
        tutorial: `
            <p>批量查询接收一个 <strong>ID 数组参数</strong>，用 <code>&lt;foreach&gt;</code> 动态生成 IN 子句：</p>
            <div class="syntax-block">POST /api/users/batch-query
Body: {"ids": [1, 3, 5]}
    ↓ 参数: {ids: [1, 3, 5]}
    ↓ MyBatis &lt;foreach&gt;:
SELECT * FROM user WHERE id IN
&lt;foreach collection="ids" item="id" open="(" separator="," close=")"&gt;
    #{id}
&lt;/foreach&gt;
    ↓ 动态生成:
SELECT * FROM user WHERE id IN (1, 3, 5)</div>
            <p>用 POST 而非 GET，因为 ID 列表可能很长。</p>
        `,
        task: '编写批量查询接口：路径 <code>/api/users/batch-query</code>，POST 方法，body 参数 <code>ids</code>（Array，必填），用 <code>&lt;foreach&gt;</code> 生成 IN 查询。',
        context: `
            <div class="context-label">请求 → 动态SQL：</div>
            <div class="endpoint-info">POST /api/users/batch-query
Body: {"ids":[1,3,5]}
生成: SELECT * FROM user WHERE id IN (1,3,5)
→ [{"id":1,...},{"id":3,...},{"id":5,...}]</div>
        `,
        configHint: `{
    "path": "/api/users/batch-query",
    "method": "POST",
    "name": "批量查询用户",
    "params": [
        {"name": "ids", "type": "Array", "in": "body", "required": true}
    ],
    "resultType": "list"
}`,
        sqlHint: `SELECT * FROM user WHERE id IN
<foreach collection="ids" item="id" open="(" separator="," close=")">
    #{id}
</foreach>`,
        configAnswer: `{
    "path": "/api/users/batch-query",
    "method": "POST",
    "name": "批量查询用户",
    "params": [
        {"name": "ids", "type": "Array", "in": "body", "required": true}
    ],
    "resultType": "list"
}`,
        sqlAnswer: `SELECT * FROM user WHERE id IN
<foreach collection="ids" item="id" open="(" separator="," close=")">
    #{id}
</foreach>`,
        validate(configStr, sqlStr) {
            const checks = [];
            let config;
            try { config = JSON.parse(configStr); checks.push({ pass: true, msg: 'JSON 格式正确' }); }
            catch (e) { checks.push({ pass: false, msg: 'JSON 格式错误：' + e.message }); return checks; }
            checks.push({ pass: config.path === '/api/users/batch-query', msg: 'path 正确' });
            checks.push({ pass: config.method === 'POST', msg: 'method 为 POST' });
            const params = config.params || [];
            checks.push({ pass: params.some(p => p.name === 'ids' && p.required === true), msg: 'ids 为必填参数' });
            checks.push({ pass: /<foreach\s/.test(sqlStr), msg: '使用 <foreach> 标签' });
            checks.push({ pass: /collection\s*=\s*"ids"/.test(sqlStr), msg: 'collection 为 ids' });
            checks.push({ pass: /open\s*=\s*"\("/.test(sqlStr), msg: 'open="("' });
            checks.push({ pass: /separator\s*=\s*","/.test(sqlStr), msg: 'separator=","' });
            checks.push({ pass: /close\s*=\s*"\)"/.test(sqlStr), msg: 'close=")"' });
            return checks;
        }
    },
    {
        id: 16,
        title: '<choose> 多分支搜索',
        description: '根据传入参数选择不同的查询策略',
        tutorial: `
            <p><code>&lt;choose&gt;</code> 类似 switch-case，<strong>只执行第一个匹配的分支</strong>：</p>
            <div class="syntax-block">GET /api/users/smart-search?id=1
    → WHERE id = 1       (优先按 id 精确查)

GET /api/users/smart-search?username=张三
    → WHERE username = '张三' (其次按用户名)

GET /api/users/smart-search?email=test@test.com
    → WHERE email = 'test@test.com' (最后按邮箱)</div>
            <p>MyBatis 动态SQL：</p>
            <div class="syntax-block">SELECT * FROM user
&lt;where&gt;
    &lt;choose&gt;
        &lt;when test="id != null"&gt;AND id = #{id}&lt;/when&gt;
        &lt;when test="username != null"&gt;AND username = #{username}&lt;/when&gt;
        &lt;otherwise&gt;AND email = #{email}&lt;/otherwise&gt;
    &lt;/choose&gt;
&lt;/where&gt;</div>
        `,
        task: '编写智能搜索接口：路径 <code>/api/users/smart-search</code>，GET 方法，<code>id</code>、<code>username</code>、<code>email</code> 均为选填查询参数，用 <code>&lt;choose&gt;</code> 实现优先级搜索。',
        context: `
            <div class="context-label">搜索优先级：</div>
            <div class="table-info">1. 传了 id     → WHERE id = #{id}
2. 传了 username → WHERE username = #{username}
3. 否则         → WHERE email = #{email}</div>
        `,
        configHint: `{
    "path": "/api/users/smart-search",
    "method": "GET",
    "name": "智能搜索用户",
    "params": [
        {"name": "id", "type": "Integer", "in": "query", "required": false},
        {"name": "username", "type": "String", "in": "query", "required": false},
        {"name": "email", "type": "String", "in": "query", "required": false}
    ],
    "resultType": "list"
}`,
        sqlHint: `SELECT * FROM user
<where>
    <choose>
        <when test="id != null">
            AND id = #{id}
        </when>
        <when test="username != null">
            AND username = #{username}
        </when>
        <otherwise>
            AND email = #{email}
        </otherwise>
    </choose>
</where>`,
        configAnswer: `{
    "path": "/api/users/smart-search",
    "method": "GET",
    "name": "智能搜索用户",
    "params": [
        {"name": "id", "type": "Integer", "in": "query", "required": false},
        {"name": "username", "type": "String", "in": "query", "required": false},
        {"name": "email", "type": "String", "in": "query", "required": false}
    ],
    "resultType": "list"
}`,
        sqlAnswer: `SELECT * FROM user
<where>
    <choose>
        <when test="id != null">
            AND id = #{id}
        </when>
        <when test="username != null">
            AND username = #{username}
        </when>
        <otherwise>
            AND email = #{email}
        </otherwise>
    </choose>
</where>`,
        validate(configStr, sqlStr) {
            const checks = [];
            let config;
            try { config = JSON.parse(configStr); checks.push({ pass: true, msg: 'JSON 格式正确' }); }
            catch (e) { checks.push({ pass: false, msg: 'JSON 格式错误：' + e.message }); return checks; }
            checks.push({ pass: config.path === '/api/users/smart-search', msg: 'path 正确' });
            const params = config.params || [];
            checks.push({ pass: params.some(p => p.name === 'id' && p.required === false), msg: 'id 为选填' });
            checks.push({ pass: params.some(p => p.name === 'username' && p.required === false), msg: 'username 为选填' });
            checks.push({ pass: params.some(p => p.name === 'email' && p.required === false), msg: 'email 为选填' });
            checks.push({ pass: /<choose\s*>/.test(sqlStr), msg: '使用 <choose> 标签' });
            checks.push({ pass: /<when\s+test\s*=\s*"id\s*!=\s*null"/.test(sqlStr), msg: '第一分支：id' });
            checks.push({ pass: /<when\s+test\s*=\s*"username\s*!=\s*null"/.test(sqlStr), msg: '第二分支：username' });
            checks.push({ pass: /<otherwise\s*>/.test(sqlStr), msg: '包含 <otherwise>' });
            return checks;
        }
    },

    // ===== 第五阶段：高级接口 =====
    {
        id: 17,
        title: '动态模糊+条件组合',
        description: '可选的模糊搜索 + 精确过滤组合',
        tutorial: `
            <p>实际接口经常需要组合多种动态条件——<strong>可选的模糊搜索 + 可选的精确过滤</strong>：</p>
            <div class="syntax-block">GET /api/users/query?keyword=张&gender=male
    ↓ 参数: {keyword:"张", gender:"male"}
    ↓ MyBatis:
SELECT * FROM user
&lt;where&gt;
    &lt;if test="keyword != null"&gt;
        AND username LIKE CONCAT('%', #{keyword}, '%')
    &lt;/if&gt;
    &lt;if test="gender != null"&gt;
        AND gender = #{gender}
    &lt;/if&gt;
&lt;/where&gt;
    ↓ 动态生成:
SELECT * FROM user WHERE username LIKE '%张%' AND gender='male'</div>
        `,
        task: '编写组合查询接口：路径 <code>/api/users/query</code>，POST 方法，body 参数 <code>keyword</code>（String，选填，模糊搜索 username）和 <code>gender</code>（String，选填，精确过滤），用 <code>&lt;where&gt;</code> + <code>&lt;if&gt;</code>。',
        context: `
            <div class="context-label">不同传参 → 不同SQL：</div>
            <div class="endpoint-info">{"keyword":"张"}          → WHERE username LIKE '%张%'
{"gender":"male"}         → WHERE gender = 'male'
{"keyword":"张","gender":"male"} → 两个条件 AND 组合
{}                        → 无 WHERE，返回全部</div>
        `,
        configHint: `{
    "path": "/api/users/query",
    "method": "POST",
    "name": "组合条件查询",
    "params": [
        {"name": "keyword", "type": "String", "in": "body", "required": false},
        {"name": "gender", "type": "String", "in": "body", "required": false}
    ],
    "resultType": "list"
}`,
        sqlHint: `SELECT * FROM user
<where>
    <if test="keyword != null">
        AND username LIKE CONCAT('%', #{keyword}, '%')
    </if>
    <if test="gender != null">
        AND gender = #{gender}
    </if>
</where>`,
        configAnswer: `{
    "path": "/api/users/query",
    "method": "POST",
    "name": "组合条件查询",
    "params": [
        {"name": "keyword", "type": "String", "in": "body", "required": false},
        {"name": "gender", "type": "String", "in": "body", "required": false}
    ],
    "resultType": "list"
}`,
        sqlAnswer: `SELECT * FROM user
<where>
    <if test="keyword != null">
        AND username LIKE CONCAT('%', #{keyword}, '%')
    </if>
    <if test="gender != null">
        AND gender = #{gender}
    </if>
</where>`,
        validate(configStr, sqlStr) {
            const checks = [];
            let config;
            try { config = JSON.parse(configStr); checks.push({ pass: true, msg: 'JSON 格式正确' }); }
            catch (e) { checks.push({ pass: false, msg: 'JSON 格式错误：' + e.message }); return checks; }
            checks.push({ pass: config.method === 'POST', msg: 'method 为 POST' });
            const params = config.params || [];
            checks.push({ pass: params.some(p => p.name === 'keyword' && p.required === false), msg: 'keyword 为选填' });
            checks.push({ pass: params.some(p => p.name === 'gender' && p.required === false), msg: 'gender 为选填' });
            checks.push({ pass: /<where\s*>/.test(sqlStr), msg: '使用 <where> 标签' });
            checks.push({ pass: /<if\s+test\s*=\s*"keyword\s*!=\s*null"/.test(sqlStr), msg: 'keyword 条件判断' });
            checks.push({ pass: /LIKE\s+CONCAT/i.test(sqlStr), msg: '模糊搜索用 CONCAT' });
            checks.push({ pass: /<if\s+test\s*=\s*"gender\s*!=\s*null"/.test(sqlStr), msg: 'gender 条件判断' });
            return checks;
        }
    },
    {
        id: 18,
        title: '关联查询接口',
        description: 'JOIN 多表查询，参数定位关联数据',
        tutorial: `
            <p>通过参数查询关联数据——用 <code>JOIN</code> 连接多张表：</p>
            <div class="syntax-block">GET /api/orders/1
    ↓ 参数: {id: 1}
    ↓ MyBatis:
SELECT o.id AS order_id, o.order_no, o.amount,
       u.username, u.email
FROM orders o
LEFT JOIN user u ON o.user_id = u.id
WHERE o.id = #{id}
    ↓ 返回包含用户信息的订单详情</div>
        `,
        task: '编写订单详情接口：路径 <code>/api/orders/{id}</code>，GET 方法，路径参数 <code>id</code>（Integer，必填），使用 LEFT JOIN 关联 user 表查询，返回单条。',
        context: `
            <div class="context-label">数据库表：</div>
            <div class="table-info">orders: id, order_no, amount, user_id → 关联 user.id
user:   id, username, email</div>
            <div class="context-label">请求 → 动态SQL → 响应：</div>
            <div class="endpoint-info">GET /api/orders/1
生成: SELECT ... FROM orders o LEFT JOIN user u ON o.user_id=u.id WHERE o.id=1
→ {"order_id":1,"order_no":"ORD001","username":"张三",...}</div>
        `,
        configHint: `{
    "path": "/api/orders/{id}",
    "method": "GET",
    "name": "查询订单详情",
    "params": [
        {"name": "id", "type": "Integer", "in": "path", "required": true}
    ],
    "resultType": "single"
}`,
        sqlHint: `SELECT o.id AS order_id, o.order_no, o.amount,
       u.username, u.email
FROM orders o
LEFT JOIN user u ON o.user_id = u.id
WHERE o.id = #{id}`,
        configAnswer: `{
    "path": "/api/orders/{id}",
    "method": "GET",
    "name": "查询订单详情",
    "params": [
        {"name": "id", "type": "Integer", "in": "path", "required": true}
    ],
    "resultType": "single"
}`,
        sqlAnswer: `SELECT o.id AS order_id, o.order_no, o.amount,
       u.username, u.email
FROM orders o
LEFT JOIN user u ON o.user_id = u.id
WHERE o.id = #{id}`,
        validate(configStr, sqlStr) {
            const checks = [];
            let config;
            try { config = JSON.parse(configStr); checks.push({ pass: true, msg: 'JSON 格式正确' }); }
            catch (e) { checks.push({ pass: false, msg: 'JSON 格式错误：' + e.message }); return checks; }
            checks.push({ pass: config.path === '/api/orders/{id}', msg: 'path 正确' });
            checks.push({ pass: config.resultType === 'single', msg: 'resultType 为 single' });
            const params = config.params || [];
            checks.push({ pass: params.some(p => p.name === 'id' && p.in === 'path'), msg: 'id 为路径参数' });
            checks.push({ pass: /LEFT\s+JOIN\s+user/i.test(sqlStr), msg: 'SQL 包含 LEFT JOIN user' });
            checks.push({ pass: /ON\s+.*user_id\s*=\s*.*\.id/i.test(sqlStr), msg: '包含 JOIN 条件' });
            checks.push({ pass: /#\{id\}/.test(sqlStr), msg: '使用 #{id} 参数查询' });
            return checks;
        }
    },
    {
        id: 19,
        title: '统计聚合接口',
        description: '可选条件下的分组统计查询',
        tutorial: `
            <p>统计接口通常支持<strong>可选的过滤条件</strong>后再聚合：</p>
            <div class="syntax-block">GET /api/statistics/users?minAge=20
    ↓ 参数: {minAge: 20}
    ↓ MyBatis:
SELECT gender, COUNT(*) AS total, AVG(age) AS avg_age
FROM user
&lt;where&gt;
    &lt;if test="minAge != null"&gt;AND age &gt;= #{minAge}&lt;/if&gt;
&lt;/where&gt;
GROUP BY gender
    ↓ 生成: ... WHERE age >= 20 GROUP BY gender
→ [{"gender":"male","total":10,"avg_age":28}...]</div>
        `,
        task: '编写用户统计接口：路径 <code>/api/statistics/users</code>，GET 方法，查询参数 <code>minAge</code>（Integer，选填），按 gender 分组统计 total 和 avg_age，使用 <code>&lt;where&gt;</code> + <code>&lt;if&gt;</code> 可选过滤。',
        context: `
            <div class="context-label">请求 → 动态SQL → 响应：</div>
            <div class="endpoint-info">GET /api/statistics/users
→ 无条件聚合全部

GET /api/statistics/users?minAge=20
→ 只统计 age>=20 的用户

返回: [{"gender":"male","total":15,"avg_age":28.5}, ...]</div>
        `,
        configHint: `{
    "path": "/api/statistics/users",
    "method": "GET",
    "name": "用户统计",
    "params": [
        {"name": "minAge", "type": "Integer", "in": "query", "required": false}
    ],
    "resultType": "list"
}`,
        sqlHint: `SELECT gender, COUNT(*) AS total, AVG(age) AS avg_age
FROM user
<where>
    <if test="minAge != null">
        AND age &gt;= #{minAge}
    </if>
</where>
GROUP BY gender`,
        configAnswer: `{
    "path": "/api/statistics/users",
    "method": "GET",
    "name": "用户统计",
    "params": [
        {"name": "minAge", "type": "Integer", "in": "query", "required": false}
    ],
    "resultType": "list"
}`,
        sqlAnswer: `SELECT gender, COUNT(*) AS total, AVG(age) AS avg_age
FROM user
<where>
    <if test="minAge != null">
        AND age >= #{minAge}
    </if>
</where>
GROUP BY gender`,
        validate(configStr, sqlStr) {
            const checks = [];
            let config;
            try { config = JSON.parse(configStr); checks.push({ pass: true, msg: 'JSON 格式正确' }); }
            catch (e) { checks.push({ pass: false, msg: 'JSON 格式错误：' + e.message }); return checks; }
            checks.push({ pass: config.path === '/api/statistics/users', msg: 'path 正确' });
            checks.push({ pass: config.resultType === 'list', msg: 'resultType 为 list' });
            const params = config.params || [];
            checks.push({ pass: params.some(p => p.name === 'minAge' && p.required === false), msg: 'minAge 为选填参数' });
            checks.push({ pass: /GROUP\s+BY\s+gender/i.test(sqlStr), msg: '按 gender 分组' });
            checks.push({ pass: /COUNT\s*\(\s*\*\s*\)/i.test(sqlStr), msg: '使用 COUNT(*)' });
            checks.push({ pass: /AVG\s*\(\s*age\s*\)/i.test(sqlStr), msg: '使用 AVG(age)' });
            checks.push({ pass: /<if\s+test\s*=\s*"minAge\s*!=\s*null"/.test(sqlStr), msg: '包含 minAge 条件判断' });
            checks.push({ pass: /#\{minAge\}/.test(sqlStr), msg: '使用 #{minAge} 过滤' });
            return checks;
        }
    },
    {
        id: 20,
        title: '综合挑战：高级搜索',
        description: '动态条件 + 模糊搜索 + 分页的完整接口',
        tutorial: `
            <p>综合运用所学，设计一个<strong>高级搜索接口</strong>——这是实际项目中最常见的列表页接口：</p>
            <div class="syntax-block">POST /api/users/advanced-search
Body: {"keyword":"张", "gender":"male", "minAge":20, "pageSize":10, "offset":0}
    ↓ 参数全部注入 MyBatis 动态SQL
    ↓ &lt;if&gt; 判断哪些参数传了，动态拼接
    ↓ 最后加 LIMIT/OFFSET 分页
    ↓ 生成:
SELECT ... FROM user
WHERE username LIKE '%张%' AND gender='male' AND age>=20
LIMIT 10 OFFSET 0</div>
            <p>需要组合：<code>&lt;where&gt;</code> + <code>&lt;if&gt;</code> + LIKE + 比较 + 分页</p>
        `,
        task: `编写高级搜索接口：路径 <code>/api/users/advanced-search</code>，POST 方法，body 参数：
            <ul style="margin:8px 0 8px 20px;line-height:2;">
                <li><code>keyword</code>（String，选填）— 模糊搜索 username</li>
                <li><code>gender</code>（String，选填）— 精确过滤</li>
                <li><code>minAge</code>（Integer，选填）— 最小年龄</li>
                <li><code>maxAge</code>（Integer，选填）— 最大年龄</li>
                <li><code>pageSize</code>（Integer，必填）— 每页条数</li>
                <li><code>offset</code>（Integer，必填）— 偏移量</li>
            </ul>
            <p>MyBatis 动态SQL 使用 <code>&lt;where&gt;</code> + <code>&lt;if&gt;</code> + LIMIT 分页。</p>`,
        context: `
            <div class="context-label">请求 → 动态SQL：</div>
            <div class="endpoint-info">POST /api/users/advanced-search
Body: {"keyword":"张","gender":"male","minAge":20,"pageSize":10,"offset":0}
生成: SELECT ... FROM user
      WHERE username LIKE '%张%' AND gender='male' AND age>=20
      LIMIT 10 OFFSET 0</div>
        `,
        configHint: `{
    "path": "/api/users/advanced-search",
    "method": "POST",
    "name": "高级搜索用户",
    "params": [
        {"name": "keyword", "type": "String", "in": "body", "required": false},
        {"name": "gender", "type": "String", "in": "body", "required": false},
        {"name": "minAge", "type": "Integer", "in": "body", "required": false},
        {"name": "maxAge", "type": "Integer", "in": "body", "required": false},
        {"name": "pageSize", "type": "Integer", "in": "body", "required": true},
        {"name": "offset", "type": "Integer", "in": "body", "required": true}
    ],
    "resultType": "list"
}`,
        sqlHint: `SELECT id, username, email, age, gender FROM user
<where>
    <if test="keyword != null">
        AND username LIKE CONCAT('%', #{keyword}, '%')
    </if>
    <if test="gender != null">
        AND gender = #{gender}
    </if>
    <if test="minAge != null">
        AND age &gt;= #{minAge}
    </if>
    <if test="maxAge != null">
        AND age &lt;= #{maxAge}
    </if>
</where>
LIMIT #{pageSize} OFFSET #{offset}`,
        configAnswer: `{
    "path": "/api/users/advanced-search",
    "method": "POST",
    "name": "高级搜索用户",
    "params": [
        {"name": "keyword", "type": "String", "in": "body", "required": false},
        {"name": "gender", "type": "String", "in": "body", "required": false},
        {"name": "minAge", "type": "Integer", "in": "body", "required": false},
        {"name": "maxAge", "type": "Integer", "in": "body", "required": false},
        {"name": "pageSize", "type": "Integer", "in": "body", "required": true},
        {"name": "offset", "type": "Integer", "in": "body", "required": true}
    ],
    "resultType": "list"
}`,
        sqlAnswer: `SELECT id, username, email, age, gender FROM user
<where>
    <if test="keyword != null">
        AND username LIKE CONCAT('%', #{keyword}, '%')
    </if>
    <if test="gender != null">
        AND gender = #{gender}
    </if>
    <if test="minAge != null">
        AND age >= #{minAge}
    </if>
    <if test="maxAge != null">
        AND age <= #{maxAge}
    </if>
</where>
LIMIT #{pageSize} OFFSET #{offset}`,
        validate(configStr, sqlStr) {
            const checks = [];
            let config;
            try { config = JSON.parse(configStr); checks.push({ pass: true, msg: 'JSON 格式正确' }); }
            catch (e) { checks.push({ pass: false, msg: 'JSON 格式错误：' + e.message }); return checks; }
            checks.push({ pass: config.path === '/api/users/advanced-search', msg: 'path 正确' });
            checks.push({ pass: config.method === 'POST', msg: 'method 为 POST' });
            checks.push({ pass: config.resultType === 'list', msg: 'resultType 为 list' });
            const params = config.params || [];
            checks.push({ pass: params.some(p => p.name === 'keyword' && p.required === false), msg: 'keyword 选填' });
            checks.push({ pass: params.some(p => p.name === 'gender' && p.required === false), msg: 'gender 选填' });
            checks.push({ pass: params.some(p => p.name === 'minAge' && p.required === false), msg: 'minAge 选填' });
            checks.push({ pass: params.some(p => p.name === 'maxAge' && p.required === false), msg: 'maxAge 选填' });
            checks.push({ pass: params.some(p => p.name === 'pageSize' && p.required === true), msg: 'pageSize 必填' });
            checks.push({ pass: params.some(p => p.name === 'offset' && p.required === true), msg: 'offset 必填' });
            checks.push({ pass: /<where\s*>/.test(sqlStr), msg: '使用 <where> 标签' });
            checks.push({ pass: /<if\s+test\s*=\s*"keyword\s*!=\s*null"/.test(sqlStr), msg: 'keyword 条件' });
            checks.push({ pass: /LIKE/i.test(sqlStr), msg: '模糊搜索 LIKE' });
            checks.push({ pass: /<if\s+test\s*=\s*"gender\s*!=\s*null"/.test(sqlStr), msg: 'gender 条件' });
            checks.push({ pass: /LIMIT\s+#\{pageSize\}/i.test(sqlStr), msg: 'LIMIT 分页' });
            checks.push({ pass: /OFFSET\s+#\{offset\}/i.test(sqlStr), msg: 'OFFSET 偏移' });
            return checks;
        }
    }
];

// ===== 全局状态 =====
let currentLevelIdx = -1;
const STORAGE_KEY = 'api_learn_progress';

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

    document.getElementById('configEditor').value = '';
    document.getElementById('sqlEditor').value = '';
    document.getElementById('resultArea').innerHTML = '<p class="placeholder-text">填写接口配置和 MyBatis 动态SQL 后点击验证</p>';
    document.getElementById('hintBox').style.display = 'none';
    document.getElementById('expectedSection').style.display = 'none';

    document.getElementById('btnPrevLevel').disabled = (idx === 0);
    const nextUnlocked = idx + 1 < LEVELS.length && isLevelUnlocked(idx + 1);
    document.getElementById('btnNextLevel').disabled = !nextUnlocked;
}

function handleRun() {
    const level = LEVELS[currentLevelIdx];
    const configStr = document.getElementById('configEditor').value.trim();
    const sqlStr = document.getElementById('sqlEditor').value.trim();
    if (!configStr && !sqlStr) return;

    const resultArea = document.getElementById('resultArea');
    const checks = level.validate(configStr, sqlStr);
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

        if (level.mockResponse) {
            let config;
            try { config = JSON.parse(configStr); } catch {}
            if (config) {
                let mockHtml = '<div class="mock-result"><div class="mock-result-title">📡 模拟调用演示</div>';
                mockHtml += '<div class="mock-request"><div class="mock-label">① 请求</div>';
                mockHtml += `<div class="mock-value">${escapeHtml(config.method + ' ' + config.path)}</div></div>`;
                mockHtml += '<div class="mock-sql"><div class="mock-label">② MyBatis 动态SQL → 生成最终SQL</div>';
                mockHtml += `<div class="mock-value">${escapeHtml(sqlStr)}</div></div>`;
                mockHtml += '<div class="mock-response"><div class="mock-label">③ 返回 JSON</div>';
                try {
                    const formatted = JSON.stringify(JSON.parse(level.mockResponse), null, 2);
                    mockHtml += `<div class="mock-value">${escapeHtml(formatted)}</div>`;
                } catch {
                    mockHtml += `<div class="mock-value">${escapeHtml(level.mockResponse)}</div>`;
                }
                mockHtml += '</div></div>';
                resultArea.innerHTML += mockHtml;
            }
        }

        document.getElementById('expectedSection').style.display = 'none';
        saveProgress(level.id);
        showSuccessModal(level);
    } else {
        const passCount = checks.filter(c => c.pass).length;
        resultArea.innerHTML = `<div class="fail-msg">⚠️ 通过 ${passCount}/${checks.length} 项检查，请继续完善。</div>` + html;
        const expectedSection = document.getElementById('expectedSection');
        expectedSection.style.display = '';
        document.getElementById('expectedArea').innerHTML =
            '<div class="answer-label">接口配置：</div>' +
            `<div class="answer-block">${escapeHtml(level.configAnswer)}</div>` +
            '<div class="answer-label">MyBatis 动态SQL：</div>' +
            `<div class="answer-block">${escapeHtml(level.sqlAnswer)}</div>`;
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
        ? '你已完成所有关卡，信息池接口编写技能已掌握！'
        : `你已掌握「${level.title}」，继续挑战下一关吧！`;

    document.getElementById('btnNextFromModal').style.display = isLast ? 'none' : '';
    modal.style.display = 'flex';
}

function handleHint() {
    const level = LEVELS[currentLevelIdx];
    const box = document.getElementById('hintBox');
    box.innerHTML = '<strong>接口配置提示：</strong>\n' + escapeHtml(level.configHint) + '\n\n<strong>MyBatis 动态SQL 提示：</strong>\n' + escapeHtml(level.sqlHint);
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

    ['configEditor', 'sqlEditor'].forEach(editorId => {
        document.getElementById(editorId).addEventListener('keydown', (e) => {
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
});

# Skill: 基于接口创建应用

## 触发条件
用户要求创建应用、制作应用、基于某个接口/数据生成应用、可视化数据等。

## 工作流程

### 1. 理解需求
- 确认应用类型：数据展示、图表可视化、表单工具、仪表盘等
- 确认数据来源：已有接口、新建接口、静态数据
- 确认交互需求：筛选、搜索、分页、编辑等

### 2. 准备数据接口
如果需要基于已有接口：
1. 调用 `list_databases` 获取数据库列表
2. 调用 `get_tables` 获取表结构
3. 如需创建接口，调用 `create_api`（需先 ask_user 确认）

### 3. 生成应用代码
**关键规则：**
- `html` 字段：只写 body 内容片段（div、表单等），**不要**写完整 HTML 文档（不要 DOCTYPE/html/head/body）
- `css` 字段：写 CSS 样式
- `js` 字段：写 JavaScript 逻辑
- **API 调用必须用 `fetchWithAuth(url)` 而不是 `fetch(url)`**，这样才能带认证 token
- `fetchWithAuth` 由平台自动注入，无需自己定义
- `slug` 只能包含字母数字和连字符

### 4. 人在环路确认
调用 `ask_user` 工具，展示：
- 应用标题和描述
- 功能说明
- 涉及的接口
让用户确认后再调用 `create_app`。

### 5. 创建应用
调用 `create_app` 工具，参数示例：
```json
{
  "title": "用户管理",
  "slug": "user-management",
  "description": "用户列表展示与搜索",
  "icon": "👥",
  "html": "<div class=\"container\">...</div>",
  "css": ".container { ... }",
  "js": "async function loadUsers() { const res = await fetchWithAuth('/api/v1/...'); ... }",
  "is_public": true
}
```

## 代码模板

### 基本数据展示
```js
async function loadData() {
  try {
    const res = await fetchWithAuth('/api/v1/xxx');
    const data = await res.json();
    if (data.success) {
      // 渲染数据
    }
  } catch(e) {
    console.error(e);
  }
}
```

### API 路径
- 数据库接口：`/api/v1/databases/{db}/query` (POST)
- 自定义接口：通过 `list_apis` 获取接口列表

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

### 3. 选择设计风格
根据应用类型选择合适的预设风格：

| 风格 | 适用场景 | 关键词 |
|------|---------|--------|
| `linear` | 开发者工具、项目管理、仪表盘 | 暗色极简、紫色强调、精密工程感 |
| `supabase` | 数据管理、数据库工具、API 平台 | 暗色+绿色品牌、终端美学 |
| `stripe` | 金融数据、支付、表单 | 浅色优雅、紫色渐变、专业感 |
| `notion` | 文档、知识库、内容管理 | 暖色极简、衬线标题、柔软表面 |
| `sentry` | 监控、日志、错误追踪 | 暗色数据密集、粉紫强调 |

### 4. 生成应用代码
**关键规则：**
- `html` 字段：只写 body 内容片段（div、表单等），**不要**写完整 HTML 文档（不要 DOCTYPE/html/head/body）
- `css` 字段：写 CSS 样式，**必须使用对应风格的 CSS 变量**（见下方预设）
- `js` 字段：写 JavaScript 逻辑
- **API 调用必须用 `fetchWithAuth(url)` 而不是 `fetch(url)`**
- `fetchWithAuth` 由平台自动注入，无需自己定义
- `slug` 只能包含字母数字和连字符
- **离线部署**：不能用外部 CDN、Google Fonts 等，字体用系统 fallback

### 5. 人在环路确认
调用 `ask_user` 工具，展示：
- 应用标题和描述
- 选择的设计风格
- 功能说明和涉及的接口
让用户确认后再调用 `create_app`。

### 6. 创建应用
调用 `create_app` 工具，参数示例：
```json
{
  "title": "用户管理",
  "slug": "user-management",
  "description": "用户列表展示与搜索",
  "icon": "👥",
  "html": "<div class=\"app-root\">...</div>",
  "css": ":root { --app-style: linear; ... } .app-root { ... }",
  "js": "async function loadData() { const res = await fetchWithAuth('/api/v1/...'); ... }",
  "is_public": true
}
```

---

## 预设设计风格 CSS 变量

### Linear 风格（暗色极简）
```css
:root {
  --bg: #08090a;
  --bg-panel: #0f1011;
  --bg-surface: #191a1b;
  --bg-hover: #28282c;
  --text-primary: #f7f8f8;
  --text-secondary: #d0d6e0;
  --text-muted: #8a8f98;
  --text-dim: #62666d;
  --accent: #5e6ad2;
  --accent-bright: #7170ff;
  --accent-hover: #828fff;
  --success: #27a644;
  --border: rgba(255,255,255,0.08);
  --border-subtle: rgba(255,255,255,0.05);
  --radius: 6px;
  --radius-lg: 12px;
  --font: 'Inter', system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
  --font-mono: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
}
```
组件风格：卡片用 `rgba(255,255,255,0.02)` 背景 + `var(--border)` 边框；按钮用半透明背景；强调色仅用于 CTA。

### Supabase 风格（暗色+绿色品牌）
```css
:root {
  --bg: #171717;
  --bg-surface: #1c1c1c;
  --bg-elevated: #242424;
  --text-primary: #fafafa;
  --text-secondary: #b4b4b4;
  --text-muted: #898989;
  --accent: #3ecf8e;
  --accent-link: #00c573;
  --accent-border: rgba(62, 207, 142, 0.3);
  --border: #2e2e2e;
  --border-subtle: #242424;
  --border-hover: #363636;
  --radius: 6px;
  --radius-lg: 16px;
  --radius-pill: 9999px;
  --font: system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
  --font-mono: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
}
```
组件风格：深度靠边框色差（#242424→#2e2e2e→#363636）；主按钮 pill 形；绿色仅用于品牌标识。

### Stripe 风格（浅色优雅）
```css
:root {
  --bg: #f6f9fc;
  --bg-surface: #ffffff;
  --bg-elevated: #ffffff;
  --text-primary: #1a1f36;
  --text-secondary: #424770;
  --text-muted: #8898aa;
  --accent: #635bff;
  --accent-hover: #7a73ff;
  --accent-light: rgba(99, 91, 255, 0.1);
  --success: #24b47e;
  --border: #e3e8ee;
  --border-hover: #cfd7df;
  --radius: 6px;
  --radius-lg: 12px;
  --shadow: 0 2px 6px rgba(50,50,93,0.08), 0 1px 3px rgba(0,0,0,0.05);
  --shadow-lg: 0 6px 16px rgba(50,50,93,0.12), 0 3px 8px rgba(0,0,0,0.08);
  --font: system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
  --font-mono: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
}
```
组件风格：白色卡片 + 柔和阴影；紫色渐变 CTA；专业金融感。

### Notion 风格（暖色极简）
```css
:root {
  --bg: #ffffff;
  --bg-surface: #f7f7f5;
  --bg-elevated: #f0f0ee;
  --text-primary: #37352f;
  --text-secondary: #6b6b63;
  --text-muted: #9b9a97;
  --accent: #2eaadc;
  --accent-hover: #1e8fc2;
  --success: #0f7b6c;
  --border: #e3e2df;
  --border-hover: #d3d2cf;
  --radius: 6px;
  --radius-lg: 10px;
  --font: system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
  --font-serif: Georgia, 'Times New Roman', serif;
}
```
组件风格：暖灰背景；衬线字体标题；柔软无阴影表面。

### Sentry 风格（暗色数据密集）
```css
:root {
  --bg: #1c1c22;
  --bg-surface: #252530;
  --bg-elevated: #2e2e3a;
  --text-primary: #e8e8ec;
  --text-secondary: #a0a0b0;
  --text-muted: #6e6e80;
  --accent: #f6624d;
  --accent-secondary: #7b5dff;
  --success: #2ecc71;
  --warning: #f5a623;
  --border: #3a3a48;
  --border-subtle: #2e2e3a;
  --radius: 4px;
  --radius-lg: 8px;
  --font: system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
  --font-mono: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
}
```
组件风格：数据密集表格；红/紫双强调色；紧凑间距。

---

## 通用组件模板

### 数据表格（所有风格通用）
```html
<div class="app-root">
  <div class="app-header">
    <h1>📊 {标题}</h1>
    <div class="app-actions">
      <input type="text" id="searchInput" placeholder="搜索..." class="search-input">
      <button onclick="loadData()" class="btn-primary">刷新</button>
    </div>
  </div>
  <div id="dataTable" class="data-table"></div>
  <div id="pagination" class="pagination"></div>
</div>
```

```css
.app-root { padding: 24px; color: var(--text-primary); font-family: var(--font); }
.app-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 24px; }
.app-header h1 { font-size: 24px; font-weight: 600; }
.search-input { background: var(--bg-surface); border: 1px solid var(--border); color: var(--text-primary); padding: 8px 12px; border-radius: var(--radius); }
.btn-primary { background: var(--accent); color: #fff; padding: 8px 16px; border-radius: var(--radius); border: none; cursor: pointer; }
.btn-primary:hover { background: var(--accent-hover); }
.data-table { background: var(--bg-surface); border: 1px solid var(--border); border-radius: var(--radius-lg); overflow: hidden; }
.data-table table { width: 100%; border-collapse: collapse; }
.data-table th { background: var(--bg-elevated); color: var(--text-secondary); font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; padding: 12px 16px; text-align: left; }
.data-table td { padding: 12px 16px; border-top: 1px solid var(--border); color: var(--text-primary); }
.data-table tr:hover td { background: var(--bg-hover, var(--bg-elevated)); }
```

### 卡片网格
```css
.card-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 16px; }
.card { background: var(--bg-surface); border: 1px solid var(--border); border-radius: var(--radius-lg); padding: 20px; }
.card:hover { border-color: var(--border-hover); }
.card h3 { font-size: 16px; font-weight: 600; margin-bottom: 8px; }
.card p { color: var(--text-secondary); font-size: 14px; line-height: 1.5; }
```

### API 调用模板
```js
async function loadData() {
  try {
    const res = await fetchWithAuth('/api/v1/xxx');
    const data = await res.json();
    if (data.success) { /* 渲染 */ }
  } catch(e) { console.error(e); }
}
```

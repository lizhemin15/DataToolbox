# Skill: 创建应用（深度设计版）

## 触发条件
用户要求创建应用、制作应用、基于某个接口/数据生成应用、可视化数据等。

## 核心理念（借鉴 Dyad/OpenDesign）

**美学优先，功能并重。** 每个应用都必须视觉出色且功能完备。不允许输出"默认模样"的应用。

**蓝图先行。** 创建前必须生成结构化蓝图，用户审核确认后再动手写代码。蓝图 = 需求理解 + 设计方向 + 功能规划的一体化确认。

**设计驱动。** 先定设计方向（行业、受众、色调、氛围），再决定组件风格。CSS 变量系统确保一致性。

---

## 工作流程

### Step 1: 需求理解 + 蓝图生成

如果用户需求**明确具体**（如"给 users 表做个 CRUD 页面"），直接生成蓝图。

如果用户需求**模糊或多种解读**，先用 `ask_user` 工具（interaction_type="form"）问 1-3 个关键问题：
- 应用类型/核心功能？（radio: 2-3 个选项）
- 视觉风格偏好？（radio: 2-3 个风格方向）
- 需要哪些交互？（checkbox: 2-3 个功能）

**蓝图内容（全部通过 ask_user 展示给用户确认）：**

```
📋 应用蓝图
┌─────────────────────────────────────┐
│ 应用名称: {创意名称，1-3 词}          │
│ 设计方向: {1-2 句描述行业+受众+氛围}  │
│ 主色调: #{6位hex，基于行业选择}        │
│ 风格: {从8种预设中选}                 │
│ 功能: {3-5 个核心功能点}              │
│ 数据: {涉及的接口/表}                 │
└─────────────────────────────────────┘
```

### Step 2: 准备数据接口（如需要）

1. 调用 `list_databases` 获取数据库列表
2. 调用 `get_tables` 获取表结构
3. 如需创建接口，调用 `create_api`（需先 ask_user 确认）

### Step 3: 选择设计风格

根据蓝图中的行业/受众/氛围，从 8 种预设中选择最匹配的风格：

| 风格 | 色调 | 适用场景 | 氛围关键词 |
|------|------|---------|-----------|
| `linear` | 暗色+紫 | 开发工具、项目管理、仪表盘 | 精密工程、极简 |
| `supabase` | 暗色+绿 | 数据管理、数据库工具 | 终端美学、极客 |
| `stripe` | 浅色+紫 | 金融、支付、表单 | 专业优雅 |
| `notion` | 暖白+蓝 | 文档、知识库、内容 | 柔软温暖 |
| `sentry` | 暗色+红紫 | 监控、日志、追踪 | 数据密集 |
| `vercel` | 纯黑白 | 展示页、Landing、作品集 | 极致简约 |
| `figma` | 暗色+多彩 | 设计工具、协作、创意 | 活力现代 |
| `custom` | 基于primary_color | 不匹配以上时 | 按蓝图定制 |

**主色调选择指南：**
- 金融/商务 → 蓝 #3B82F6 或 紫 #635BFF
- 餐饮/生活 → 橙 #E85D04 或 红 #EF4444
- 健康/环保 → 绿 #22C55E 或 青 #14B8A6
- 教育/知识 → 蓝 #2EAADC 或 靛 #5E6AD2
- 创意/社交 → 粉 #EC4899 或 黄 #F59E0B
- 科技/工具 → 紫 #7C3AED 或 青 #06B6D4

### Step 4: 预制组件组装（优先方式）

**优先使用预制组件而非手写 HTML。** 预制组件保证视觉一致性、交互完整性和代码质量。

1. 调用 `list_components` 工具获取可用预制组件列表
2. 根据蓝图选择需要的组件（chart-bar, chart-line, chart-pie, kpi-card, data-table, map-scatter, filter-bar）
3. 调用 `create_app` 工具（confirmed=false）生成预览，传入组件列表 + 配置 + 蓝图设计风格
4. 调用 `ask_user` 工具（interaction_type="preview"），传入：
   - `blueprint`: create_app 返回的 blueprint 对象（**不要传 preview_html**，服务器会自动从 blueprint 生成）
   - `config_fields`: 可交互修改的配置项（标题、颜色、图表类型等）
5. 用户确认后，再次调用 `create_app` 工具（confirmed=true）正式创建应用

**组件配置示例（chart-bar）：**
```json
{
  "component_id": "chart-bar",
  "config": {
    "title": "月度销售趋势",
    "x_field": "month",
    "y_fields": ["sales", "profit"],
    "mode": "grouped",
    "colors": ["#4F46E5", "#10B981"]
  }
}
```

**如果预制组件不满足需求（如复杂定制页面），可以回退到 Step 4B 手写方式。**

### Step 4B: 手写应用代码（回退方式）

仅在预制组件无法满足需求时使用。

**严格的代码质量规则：**

#### HTML 规则
- `html` 字段：只写 `<body>` 内容片段，**禁止** DOCTYPE/html/head/body 标签
- 语义化标签优先：`<header>/<main>/<section>/<nav>/<article>/<aside>`
- 所有交互元素必须有 `aria-label` 或可见文本
- 图片使用 `loading="lazy"`，图标用 emoji 或内联 SVG

#### CSS 规则（关键！）
- **必须**先定义 `:root` CSS 变量（使用所选风格预设 + 蓝图中的 primary_color）
- 所有颜色引用 `var(--xxx)`，**禁止**硬编码颜色值
- 所有组件必须用 CSS 变量，不能出现 `#xxx` 或 `rgb()` 在组件样式中
- `primary_color` 替换预设中的 `--accent` 值
- 响应式：必须包含移动端适配（`@media (max-width: 768px)`）
- 动效克制：只用于关键交互反馈（hover、modal 进入），禁止纯装饰动画
- **禁止**外部 CDN/Google Fonts，字体用系统 fallback

#### JS 规则
- API 调用**必须**用 `fetchWithAuth(url)`，不能用裸 `fetch`
- `fetchWithAuth` 由平台自动注入，无需定义
- 错误处理必须完整：`try/catch` + 用户可见错误提示
- 加载状态必须有：skeleton 或 spinner，不能空白等待
- 分页必须实现（数据量 > 20 条时）

#### 美学硬规则（借鉴 Dyad Default Theme）
1. **禁止默认样式** — 不能直接输出未定制的组件，每个元素都必须有定制间距/圆角/颜色
2. **圆角优先** — 优先使用 `var(--radius)` 或更大圆角，避免直角
3. **对比度强制** — 前景色与背景色亮度差 ≥ 40%，禁止浅灰字+白底
4. **色彩集中** — 强调色（accent）只用于 CTA、活跃状态、关键图标，其余用中性色
5. **禁止渐变背景** — 纯色背景 + 局部渐变点缀可以，全页渐变不行
6. **禁止纯文字墙** — 每个视图必须有视觉层次：图标、色彩块、间距变化
7. **移动优先** — 先设计手机布局，再增强桌面端

### Step 5: 人在环路确认

调用 `ask_user` 工具（interaction_type="form"），展示完整蓝图：

```
📋 应用蓝图确认
应用名称: FreshBite
设计方向: 温暖亲和的餐厅点餐体验，强调食物摄影和简洁操作流程
主色调: #E85D04
风格: stripe（浅色优雅）
功能: 菜品浏览、购物车、下单、订单状态
数据: /api/v1/databases/db1/tables/menu

请确认以上蓝图，或提出修改意见。
```

**必须等用户确认后才调用 create_app。**

### Step 6: 创建应用

调用 `create_app` 工具，参数示例：
```json
{
  "title": "FreshBite - 在线点餐",
  "slug": "freshbite",
  "description": "温暖亲和的在线点餐应用，支持菜品浏览、购物车和下单",
  "icon": "🍽️",
  "style": "stripe",
  "primary_color": "#E85D04",
  "design_direction": "温暖亲和的餐厅点餐体验，强调食物摄影和简洁操作流程",
  "html": "<div class=\"app-root\">...</div>",
  "css": ":root { --bg: #f6f9fc; --accent: #E85D04; ... } .app-root { ... }",
  "js": "async function loadMenu() { const res = await fetchWithAuth('/api/v1/...'); ... }",
  "is_public": true
}
```

---

## 8 种预设设计风格 CSS 变量

### Linear 风格（暗色极简）
```css
:root {
  --bg: #08090a; --bg-panel: #0f1011; --bg-surface: #191a1b; --bg-hover: #28282c;
  --text-primary: #f7f8f8; --text-secondary: #d0d6e0; --text-muted: #8a8f98; --text-dim: #62666d;
  --accent: #5e6ad2; --accent-bright: #7170ff; --accent-hover: #828fff; --success: #27a644;
  --border: rgba(255,255,255,0.08); --border-subtle: rgba(255,255,255,0.05);
  --radius: 6px; --radius-lg: 12px;
  --font: system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
  --font-mono: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
}
```
卡片：`rgba(255,255,255,0.02)` 背景 + `var(--border)` 边框；按钮半透明；accent 仅 CTA。

### Supabase 风格（暗色+绿色品牌）
```css
:root {
  --bg: #171717; --bg-surface: #1c1c1c; --bg-elevated: #242424;
  --text-primary: #fafafa; --text-secondary: #b4b4b4; --text-muted: #898989;
  --accent: #3ecf8e; --accent-link: #00c573; --accent-border: rgba(62,207,142,0.3);
  --border: #2e2e2e; --border-subtle: #242424; --border-hover: #363636;
  --radius: 6px; --radius-lg: 16px; --radius-pill: 9999px;
  --font: system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
  --font-mono: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
}
```
边框色差体现深度；主按钮 pill 形；绿色仅品牌标识。

### Stripe 风格（浅色优雅）
```css
:root {
  --bg: #f6f9fc; --bg-surface: #ffffff; --bg-elevated: #ffffff;
  --text-primary: #1a1f36; --text-secondary: #424770; --text-muted: #8898aa;
  --accent: #635bff; --accent-hover: #7a73ff; --accent-light: rgba(99,91,255,0.1); --success: #24b47e;
  --border: #e3e8ee; --border-hover: #cfd7df;
  --radius: 6px; --radius-lg: 12px;
  --shadow: 0 2px 6px rgba(50,50,93,0.08), 0 1px 3px rgba(0,0,0,0.05);
  --shadow-lg: 0 6px 16px rgba(50,50,93,0.12), 0 3px 8px rgba(0,0,0,0.08);
  --font: system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
  --font-mono: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
}
```
白卡 + 柔和阴影；紫色 CTA；专业金融感。

### Notion 风格（暖色极简）
```css
:root {
  --bg: #ffffff; --bg-surface: #f7f7f5; --bg-elevated: #f0f0ee;
  --text-primary: #37352f; --text-secondary: #6b6b63; --text-muted: #9b9a97;
  --accent: #2eaadc; --accent-hover: #1e8fc2; --success: #0f7b6c;
  --border: #e3e2df; --border-hover: #d3d2cf;
  --radius: 6px; --radius-lg: 10px;
  --font: system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
  --font-serif: Georgia, 'Times New Roman', serif;
}
```
暖灰背景；衬线标题；柔软无阴影。

### Sentry 风格（暗色数据密集）
```css
:root {
  --bg: #1c1c22; --bg-surface: #252530; --bg-elevated: #2e2e3a;
  --text-primary: #e8e8ec; --text-secondary: #a0a0b0; --text-muted: #6e6e80;
  --accent: #f6624d; --accent-secondary: #7b5dff; --success: #2ecc71; --warning: #f5a623;
  --border: #3a3a48; --border-subtle: #2e2e3a;
  --radius: 4px; --radius-lg: 8px;
  --font: system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
  --font-mono: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
}
```
数据密集表格；红/紫双强调色；紧凑间距。

### Vercel 风格（极致黑白）
```css
:root {
  --bg: #000000; --bg-surface: #111111; --bg-elevated: #1a1a1a;
  --text-primary: #ededed; --text-secondary: #888888; --text-muted: #555555;
  --accent: #ededed; --accent-hover: #ffffff;
  --border: #222222; --border-hover: #333333;
  --radius: 6px; --radius-lg: 8px;
  --font: system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
  --font-mono: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
}
```
极致黑白；线条为主；信息密度高。

### Figma 风格（暗色+多彩）
```css
:root {
  --bg: #1e1e1e; --bg-surface: #2c2c2c; --bg-elevated: #383838;
  --text-primary: #ffffff; --text-secondary: #b3b3b3; --text-muted: #7a7a7a;
  --accent: #0d99ff; --accent-secondary: #a259ff; --success: #14ae5c; --warning: #ffcd29;
  --border: #3e3e3e; --border-hover: #4e4e4e;
  --radius: 6px; --radius-lg: 10px;
  --font: system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
  --font-mono: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
}
```
活力多彩；强调协作感；暗底彩色点缀。

### Custom 风格（用户蓝图驱动）
当 7 种预设都不匹配时，基于 `design_direction` + `primary_color` 动态生成：
- 从主色调推导出 hover（+10% 亮度）和 light（10% 透明度）变体
- 根据 `design_direction` 决定明/暗基调
- 复用 CSS 变量体系，替换对应值

---

## 高质量组件模板

### 数据表格（带搜索、分页、排序）
```html
<div class="app-root">
  <header class="app-header">
    <div class="app-title">
      <span class="app-icon">{icon}</span>
      <h1>{title}</h1>
    </div>
    <div class="app-toolbar">
      <div class="search-box">
        <span class="search-icon">🔍</span>
        <input type="text" id="searchInput" placeholder="搜索..." oninput="handleSearch()">
      </div>
      <button onclick="loadData()" class="btn-ghost">↻ 刷新</button>
    </div>
  </header>
  <main class="app-main">
    <div id="loadingState" class="skeleton-grid"></div>
    <div id="dataTable" class="data-table-wrap" style="display:none">
      <table><thead id="tableHead"></thead><tbody id="tableBody"></tbody></table>
    </div>
    <div id="emptyState" class="empty-state" style="display:none">
      <span class="empty-icon">📭</span>
      <p>暂无数据</p>
    </div>
  </main>
  <footer id="pagination" class="pagination" style="display:none"></footer>
</div>
```

```css
.app-root { min-height: 100vh; background: var(--bg); color: var(--text-primary); font-family: var(--font); }
.app-header { display: flex; justify-content: space-between; align-items: center; padding: 20px 24px; border-bottom: 1px solid var(--border); }
.app-title { display: flex; align-items: center; gap: 12px; }
.app-title h1 { font-size: 20px; font-weight: 600; }
.app-icon { font-size: 24px; }
.search-box { display: flex; align-items: center; gap: 8px; background: var(--bg-surface); border: 1px solid var(--border); border-radius: var(--radius); padding: 0 12px; }
.search-box input { background: transparent; border: none; color: var(--text-primary); padding: 8px 0; outline: none; width: 200px; }
.btn-ghost { background: transparent; color: var(--text-secondary); border: 1px solid var(--border); padding: 8px 14px; border-radius: var(--radius); cursor: pointer; font-size: 13px; }
.btn-ghost:hover { border-color: var(--border-hover); color: var(--text-primary); }
.data-table-wrap { margin: 0 24px; border: 1px solid var(--border); border-radius: var(--radius-lg); overflow: hidden; }
table { width: 100%; border-collapse: collapse; }
th { background: var(--bg-elevated, var(--bg-surface)); color: var(--text-secondary); font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; padding: 10px 16px; text-align: left; }
td { padding: 12px 16px; border-top: 1px solid var(--border); font-size: 13px; }
tbody tr:hover td { background: var(--bg-hover, var(--bg-elevated, var(--bg-surface))); }
.skeleton-grid { padding: 24px; display: grid; gap: 12px; }
.skeleton-row { height: 40px; background: var(--bg-surface); border-radius: var(--radius); animation: pulse 1.5s ease-in-out infinite; }
@keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }
.empty-state { text-align: center; padding: 60px 24px; color: var(--text-muted); }
.empty-icon { font-size: 48px; display: block; margin-bottom: 12px; }
.pagination { display: flex; justify-content: center; align-items: center; gap: 8px; padding: 16px; }
.pagination button { background: var(--bg-surface); border: 1px solid var(--border); color: var(--text-secondary); padding: 6px 12px; border-radius: var(--radius); cursor: pointer; }
.pagination button.active { background: var(--accent); color: #fff; border-color: var(--accent); }
.pagination button:disabled { opacity: 0.4; cursor: not-allowed; }
@media (max-width: 768px) {
  .app-header { flex-direction: column; gap: 12px; align-items: flex-start; }
  .search-box input { width: 140px; }
  .data-table-wrap { margin: 0 12px; overflow-x: auto; }
  td, th { padding: 8px 12px; }
}
```

### 卡片网格（带 hover 效果）
```css
.card-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 16px; padding: 24px; }
.card { background: var(--bg-surface); border: 1px solid var(--border); border-radius: var(--radius-lg); padding: 20px; transition: all 0.2s ease; cursor: default; }
.card:hover { border-color: var(--border-hover); transform: translateY(-2px); box-shadow: var(--shadow, 0 4px 12px rgba(0,0,0,0.1)); }
.card-header { display: flex; align-items: center; gap: 10px; margin-bottom: 12px; }
.card-icon { font-size: 20px; }
.card-title { font-size: 15px; font-weight: 600; }
.card-body { color: var(--text-secondary); font-size: 13px; line-height: 1.5; }
.card-footer { display: flex; justify-content: flex-end; margin-top: 16px; padding-top: 12px; border-top: 1px solid var(--border); }
```

### CRUD 模态框
```css
.modal-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.5); display: flex; align-items: center; justify-content: center; z-index: 100; }
.modal { background: var(--bg-surface); border: 1px solid var(--border); border-radius: var(--radius-lg); padding: 24px; width: 90%; max-width: 480px; }
.modal h2 { font-size: 18px; font-weight: 600; margin-bottom: 20px; }
.form-group { margin-bottom: 16px; }
.form-group label { display: block; font-size: 12px; font-weight: 600; color: var(--text-secondary); margin-bottom: 6px; text-transform: uppercase; letter-spacing: 0.3px; }
.form-input { width: 100%; background: var(--bg); border: 1px solid var(--border); color: var(--text-primary); padding: 10px 12px; border-radius: var(--radius); font-size: 14px; outline: none; box-sizing: border-box; }
.form-input:focus { border-color: var(--accent); }
.modal-actions { display: flex; gap: 10px; justify-content: flex-end; margin-top: 24px; }
.btn-primary { background: var(--accent); color: #fff; padding: 8px 20px; border-radius: var(--radius); border: none; cursor: pointer; font-weight: 500; font-size: 14px; }
.btn-primary:hover { background: var(--accent-hover); }
.btn-secondary { background: transparent; color: var(--text-secondary); padding: 8px 20px; border-radius: var(--radius); border: 1px solid var(--border); cursor: pointer; font-size: 14px; }
```

### API 调用模板（完整错误处理 + 加载态）
```js
let isLoading = false;
let currentData = [];
let currentPage = 1;
const PAGE_SIZE = 20;

async function loadData(page = 1) {
  if (isLoading) return;
  isLoading = true;
  showLoading(true);
  try {
    const res = await fetchWithAuth(`/api/v1/xxx?page=${page}&size=${PAGE_SIZE}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (data.success) {
      currentData = data.data;
      currentPage = page;
      renderTable(currentData);
      renderPagination(data.total || currentData.length, page);
    } else {
      showError(data.message || '请求失败');
    }
  } catch (e) {
    console.error(e);
    showError('加载失败，请稍后重试');
  } finally {
    isLoading = false;
    showLoading(false);
  }
}

function showLoading(show) {
  document.getElementById('loadingState').style.display = show ? '' : 'none';
  document.getElementById('dataTable').style.display = show ? 'none' : '';
}

function showError(msg) {
  const el = document.createElement('div');
  el.className = 'error-toast';
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 3000);
}

// 页面加载时自动拉数据
document.addEventListener('DOMContentLoaded', () => loadData(1));
```

---

## 陷阱与规则

1. **优先使用预制组件** — 预制组件有经过测试的视觉效果和交互逻辑，不要重新造轮子
2. **绝不能跳过蓝图确认直接创建** — 即使需求很简单
3. **CSS 变量必须完整** — 不能只写一半，缺少的变量会导致组件用默认值
4. **`primary_color` 必须替换 `--accent`** — 这是蓝图中的核心视觉决策
5. **禁止 CDN 引用** — DataToolbox 必须支持离线部署，ECharts/Leaflet 必须本地化
6. **`fetchWithAuth` 不是 `fetch`** — 写错了会 401
7. **slug 只允许 `[a-z0-9-]`** — 中文、大写、下划线都不行
8. **表格数据 > 20 条必须分页** — 不分页 = 性能灾难
9. **每个视图必须有加载态** — skeleton/spinner，不能白屏等待
10. **ask_user(preview) 必须传 blueprint，不要传 preview_html** — 服务器会自动从 blueprint 生成 preview_html。preview_html 有 10KB+，LLM 传参时经常截断或丢失
11. **组件 data_source 必须是真实 API 路径** — 不能硬编码假数据
9. **错误必须有用户可见反馈** — toast/banner，不能静默失败
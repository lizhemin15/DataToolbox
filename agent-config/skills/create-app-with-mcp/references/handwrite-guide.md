# 手写应用指南

仅在预制组件无法满足需求时使用。

## CSS 变量预设

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

### Supabase 风格（暗色+绿）
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

### Stripe 风格（浅色优雅）
```css
:root {
  --bg: #f6f9fc; --bg-surface: #ffffff; --bg-elevated: #ffffff;
  --text-primary: #1a1f36; --text-secondary: #424770; --text-muted: #8898aa;
  --accent: #635bff; --accent-hover: #7a73ff; --accent-light: rgba(99,91,255,0.1); --success: #24b47e;
  --border: #e3e8ee; --border-hover: #cfd7df;
  --radius: 6px; --radius-lg: 12px;
  --shadow: 0 2px 6px rgba(50,50,93,0.08), 0 1px 3px rgba(0,0,0,0.05);
  --font: system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
  --font-mono: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
}
```

### Notion 风格（暖色极简）
```css
:root {
  --bg: #ffffff; --bg-surface: #f7f7f5; --bg-elevated: #f0f0ee;
  --text-primary: #37352f; --text-secondary: #6b6b63; --text-muted: #9b9a97;
  --accent: #2eaadc; --accent-hover: #1e8fc2; --success: #0f7b6c;
  --border: #e3e2df; --border-hover: #d3d2cf;
  --radius: 6px; --radius-lg: 10px;
  --font: system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
}
```

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

### Vercel 风格（极致黑白）
```css
:root {
  --bg: #000000; --bg-surface: #111111; --bg-elevated: #1a1a1a;
  --text-primary: #ededed; --text-secondary: #888888; --text-muted: #555555;
  --accent: #ededed; --accent-hover: #ffffff;
  --border: #222222; --border-hover: #333333;
  --radius: 6px; --radius-lg: 8px;
  --font: system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
}
```

### Figma 风格（暗色+多彩）
```css
:root {
  --bg: #1e1e1e; --bg-surface: #2c2c2c; --bg-elevated: #383838;
  --text-primary: #ffffff; --text-secondary: #b3b3b3; --text-muted: #7a7a7a;
  --accent: #0d99ff; --accent-secondary: #a259ff; --success: #14ae5c; --warning: #ffcd29;
  --border: #3e3e3e; --border-hover: #4e4e4e;
  --radius: 6px; --radius-lg: 10px;
  --font: system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
}
```

## 代码规则

### HTML
- 只写 `<body>` 内容片段，禁止 DOCTYPE/html/head/body 标签
- 语义化标签优先
- 图片用 `loading="lazy"`，图标用 emoji 或内联 SVG

### CSS
- 必须先定义 `:root` CSS 变量（使用预设 + primary_color）
- 所有颜色引用 `var(--xxx)`，禁止硬编码
- 响应式：必须包含 `@media (max-width: 768px)`
- 禁止外部 CDN/Google Fonts

### JS
- API 调用必须用 `fetchWithAuth(url)`
- 错误处理必须完整：try/catch + 用户可见提示
- 加载状态必须有：skeleton 或 spinner
- 数据量 > 20 条必须分页

### 美学规则
1. 禁止默认样式 — 每个元素必须定制
2. 圆角优先 — 用 var(--radius)
3. 对比度 — 前景与背景亮度差 ≥ 40%
4. 强调色只用于 CTA、活跃状态
5. 禁止渐变背景
6. 禁止纯文字墙 — 必须有视觉层次
7. 移动优先

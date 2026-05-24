# Skill: 创建应用

## 触发条件
用户要求创建应用、制作应用、基于接口/数据生成应用、可视化数据等。

## 工作流程

### Step 1: 数据准备
1. 调用 `list_apis` 查看可用接口
2. 调用 `get_api_detail` 获取字段详情
3. 调用 `execute_api` 确认数据格式和样本

### Step 2: 用预制组件创建应用（优先方式）

**优先使用预制组件，不要手写 HTML/CSS/JS。** 预制组件保证视觉一致性和功能完整。

1. 调用 `create_app`(confirmed=false) 传入组件列表+配置，生成预览
2. 调用 `ask_user`(interaction_type="preview") 展示预览给用户确认
   - **必须传 `blueprint`**（从 create_app 返回的对象），**不要传 preview_html**
   - 传 `config_fields` 让用户可交互修改配置
3. 用户确认后，调用 `create_app`(confirmed=true) 正式创建

### 可用预制组件

| 组件 ID | 用途 | 必要配置 |
|---------|------|---------|
| chart-bar | 柱状图 | title, data_source, x_field, y_fields |
| chart-line | 折线图 | title, data_source, x_field, y_fields |
| chart-pie | 饼图 | title, data_source, name_field, value_field |
| kpi-card | KPI指标卡 | title, data_source, metrics[{label,field,format}] |
| data-table | 数据表格 | title, data_source, columns[{field,label}] |
| map-scatter | 地图散点 | title, data_source, latitude_field, longitude_field |
| filter-bar | 筛选条件 | title, data_source, fields[{id,type,label,options}] |

### 设计风格参数
create_app 可选参数：`style`(预设名), `primary_color`(#hex), `design_direction`(描述), `icon`(emoji)

预设风格: linear(暗色紫), supabase(暗色绿), stripe(浅色紫), notion(暖白蓝), sentry(暗色红紫), vercel(纯黑白), figma(暗色多彩), custom

### Step 2B: 手写应用（仅当预制组件不满足时）
参考 references/handwrite-guide.md 的模板和 CSS 变量。

## 陷阱
1. **优先预制组件**，不要重新造轮子
2. **ask_user(preview) 必须传 blueprint，不要传 preview_html** — 服务器自动生成
3. **组件 data_source 必须是真实 API 路径**
4. **slug 只允许 `[a-z0-9-]`**
5. **禁止 CDN 引用** — 必须离线部署
6. **fetchWithAuth 不是 fetch** — 写错会 401

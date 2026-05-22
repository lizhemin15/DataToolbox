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
1. 调用 `list_apis` 查看可用接口
2. 调用 `get_api_detail` 获取接口详情（SQL、参数、字段）
3. 让用户确认使用哪个接口

如果需要新建接口：
1. 使用 `create-api-with-mcp` skill 创建接口
2. 确保接口测试通过

### 3. 设计应用结构
根据应用类型生成代码框架：

**数据展示类**：
```html
<!-- 表格展示 -->
<div id="app"></div>
```
```js
// 调用接口获取数据
const resp = await fetch('/api/v1/apis/{api_id}/execute?params...');
const data = await resp.json();
// 渲染表格
```

**图表可视化类**：
```html
<!-- 使用 Chart.js（CDN） -->
<canvas id="chart"></canvas>
```
```js
// 调用接口 + Chart.js 渲染
```

### 4. 人在环路确认
**必须先调用 ask_user 工具让用户确认！**

调用 `ask_user`（interaction_type="form"），让用户审核：
- 应用标题
- Slug（URL 标识）
- 功能描述
- 图标（emoji）
- HTML/CSS/JS 代码预览
- 是否公开

### 5. 创建应用
用户确认后，调用 `create_app` 工具：
```json
{
  "title": "应用标题",
  "slug": "app-slug",
  "description": "功能描述",
  "icon": "📊",
  "html": "...",
  "css": "...",
  "js": "...",
  "is_public": false
}
```

### 6. 验证和交付
- 返回应用访问链接：`/a/{slug}`
- 提示用户可以继续修改

## 示例对话

**用户**：帮我基于用户表创建一个用户管理应用

**智能体**：
1. 调用 `get_tables` 找到用户表
2. 调用 `describe_table` 获取字段结构
3. 设计表格展示 + CRUD 操作界面
4. 调用 `ask_user` 让用户确认代码
5. 调用 `create_app` 创建应用
6. 返回访问链接

## 注意事项

1. **强制 HITL**：必须先调用 `ask_user`，否则 `create_app` 会报错
2. **Slug 规范**：只能包含字母、数字、中划线，建议用英文
3. **代码规范**：
   - 使用 `fetchWithAuth` 调用接口（自动带认证）
   - CSS 使用 scoped 样式避免冲突
   - JS 使用 `DOMContentLoaded` 确保 DOM 就绪
4. **离线部署**：不依赖外部 CDN，所有资源必须本地化

## 相关工具
- `list_apis` - 列出可用接口
- `get_api_detail` - 获取接口详情
- `ask_user` - 人在环路确认
- `create_app` - 创建应用
- `update_app` - 更新应用

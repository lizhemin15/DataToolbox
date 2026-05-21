# 应用广场模块设计文档

## 1. 功能概述

应用广场是一个用于管理和发布纯前端应用的模块。用户可以上传 HTML+CSS+JS 文件作为应用，每个应用有唯一网址可访问。核心特性：

- **纯前端应用**：HTML + CSS + JS，无需后端支持
- **唯一网址**：每个应用有独立访问路径
- **MCP 开放**：智能助手可通过 MCP 一句话创建应用
- **接口集成**：基于已有的接口分发模块快速构建应用

## 2. 数据模型

### 2.1 应用表 (apps)

```sql
CREATE TABLE IF NOT EXISTS apps (
    id TEXT PRIMARY KEY,              -- 应用ID (UUID)
    owner TEXT NOT NULL,              -- 所有者用户名
    name TEXT NOT NULL,               -- 应用名称
    slug TEXT UNIQUE NOT NULL,        -- URL友好的唯一标识
    title TEXT DEFAULT '',            -- 显示标题
    description TEXT DEFAULT '',      -- 应用描述
    icon TEXT DEFAULT '',             -- 应用图标 (emoji或URL)
    html TEXT DEFAULT '',             -- HTML内容
    css TEXT DEFAULT '',              -- CSS内容
    js TEXT DEFAULT '',               -- JavaScript内容
    files TEXT DEFAULT '[]',          -- 附加文件列表 (JSON)
    config TEXT DEFAULT '{}',         -- 应用配置 (JSON)
    tags TEXT DEFAULT '[]',           -- 标签 (JSON)
    is_public INTEGER DEFAULT 0,      -- 是否公开
    view_count INTEGER DEFAULT 0,     -- 访问次数
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

### 2.2 应用访问路径

- **管理界面**：`/apps` - 应用广场管理页面
- **应用访问**：`/a/{slug}` - 公开访问应用
- **API接口**：`/api/v1/apps` - 应用CRUD API

## 3. API设计

### 3.1 应用管理 API

```
GET    /api/v1/apps              # 列出用户的所有应用
POST   /api/v1/apps              # 创建新应用
GET    /api/v1/apps/{id}         # 获取应用详情
PUT    /api/v1/apps/{id}         # 更新应用
DELETE /api/v1/apps/{id}         # 删除应用
GET    /api/v1/apps/{id}/preview  # 预览应用
PUT    /api/v1/apps/{id}/slug    # 更新slug
```

### 3.2 MCP工具

```go
// create_app - 创建应用
{
    "name": "create_app",
    "description": "创建一个新的前端应用",
    "inputSchema": {
        "type": "object",
        "properties": {
            "name": {"type": "string", "description": "应用名称"},
            "title": {"type": "string", "description": "显示标题"},
            "description": {"type": "string", "description": "应用描述"},
            "html": {"type": "string", "description": "HTML代码"},
            "css": {"type": "string", "description": "CSS代码"},
            "js": {"type": "string", "description": "JavaScript代码"},
            "is_public": {"type": "boolean", "description": "是否公开"},
            "use_api": {"type": "string", "description": "使用的接口ID，自动生成调用代码"}
        },
        "required": ["name"]
    }
}

// list_apps - 列出应用
{
    "name": "list_apps",
    "description": "列出用户的所有应用",
    "inputSchema": {
        "type": "object",
        "properties": {}
    }
}

// update_app - 更新应用
{
    "name": "update_app",
    "description": "更新应用内容或配置",
    "inputSchema": {
        "type": "object",
        "properties": {
            "id": {"type": "string", "description": "应用ID"},
            "title": {"type": "string", "description": "新标题"},
            "slug": {"type": "string", "description": "新slug"},
            "html": {"type": "string", "description": "HTML代码"},
            "css": {"type": "string", "description": "CSS代码"},
            "js": {"type": "string", "description": "JavaScript代码"}
        },
        "required": ["id"]
    }
}
```

## 4. 前端界面

### 4.1 应用广场页面 (`/apps`)

**布局**：
- 左侧：应用列表（卡片视图）
- 右侧：编辑器（代码编辑 + 预览）

**功能**：
- 创建应用：填写名称、标题、描述
- 编辑代码：HTML/CSS/JS 分栏编辑器
- 实时预览：iframe 实时渲染
- 发布管理：设置公开/私有、修改slug
- 模板市场：预置模板快速创建

### 4.2 应用访问页面 (`/a/{slug}`)

- 纯静态HTML渲染
- 支持API调用（通过 fetchWithAuth）
- 响应式布局

## 5. 智能助手集成

### 5.1 一句话创建应用

用户可以说：
- "创建一个用户管理应用，使用用户列表接口"
- "帮我做一个数据看板，展示订单统计"
- "生成一个表单应用，调用创建订单接口"

智能助手会：
1. 解析用户意图
2. 查询可用接口（通过 MCP list_apis）
3. 生成 HTML/CSS/JS 代码
4. 调用 create_app MCP 工具创建应用
5. 返回应用访问链接

### 5.2 接口集成模板

当用户指定使用某个接口时，自动生成调用代码：

```javascript
// 自动生成的接口调用代码
async function callAPI(apiId, params) {
    const res = await fetchWithAuth(`/api/v1/openapis/${apiId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params)
    });
    return res.json();
}
```

## 6. 技术实现

### 6.1 后端实现

**文件结构**：
```
DataToolbox/
├── apps_api.go          # 应用API handlers
├── apps_mcp.go          # 应用MCP工具
├── apps_page.go         # 应用页面渲染
└── apps/
    └── index.html       # 应用广场管理界面
```

**关键点**：
- 应用代码存储在 SQLite（已有架构）
- 应用访问路由在 main.go 注册
- MCP 工具在 mcp.go 注册

### 6.2 前端实现

**管理界面**：
- 复用现有编辑器组件（Monaco Editor 或 CodeMirror）
- iframe 沙箱预览
- 实时保存（防丢失）

**应用渲染**：
- 动态生成完整HTML页面
- 注入 fetchWithAuth 函数
- CSP 安全策略

## 7. 安全考虑

1. **代码隔离**：应用在 iframe 中运行，sandbox 属性限制
2. **API访问**：应用只能调用 DataToolbox 的 API
3. **XSS防护**：用户代码不直接操作主页面DOM
4. **权限控制**：私有应用需要登录才能访问

## 8. 开发计划

### Phase 1: 基础功能
- [ ] 数据库表创建
- [ ] API handlers 实现
- [ ] 基础管理界面
- [ ] 应用访问路由

### Phase 2: 编辑器
- [ ] 代码编辑器集成
- [ ] 实时预览
- [ ] 保存/发布功能

### Phase 3: MCP集成
- [ ] MCP工具注册
- [ ] 智能助手调用测试
- [ ] 接口集成模板

### Phase 4: 高级功能
- [ ] 模板市场
- [ ] 应用分享
- [ ] 访问统计

## 9. 参考资料

由于无法找到 Open Design 项目，将参考以下设计系统：
- **Ant Design**：企业级UI设计语言
- **Tailwind UI**：实用优先的组件库
- **shadcn/ui**：现代React组件库

设计风格：
- 深色主题（与 DataToolbox 一致）
- 卡片式布局
- 流畅的动画过渡
- 响应式设计

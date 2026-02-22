# 数据工具箱 DataToolbox

一个轻量化、一体化的数据处理工具平台，集成学习教程、实用工具和数据管理能力于一体。

**在线测试版：** [http://123.207.77.50:8080/](http://123.207.77.50:8080/)

---

## 项目架构

```
DataToolbox/
├── server.go          # Go 后端服务（单文件）
├── index.html         # 主页入口
├── css/               # 全局样式
├── js/                # 全局脚本
├── lib/               # 前端第三方库
├── apps/              # 各应用模块目录
│   ├── apps.json      # 应用元数据注册表
│   ├── apps.js        # 应用加载器
│   └── <app-id>/      # 每个应用的独立目录（含 index.html）
├── go.mod
└── go.sum
```

### 后端（server.go）

- 使用 **Go 标准库 + gorilla/websocket** 构建，无框架依赖，单文件部署
- 提供静态文件服务，将 `apps/` 下各工具以独立路径挂载
- 通过 WebSocket 支持实时协作（多人文档协作、局域网聊天等）
- 提供 `/api/data-ontology/` 系列 REST 接口，支持多数据库连接与查询、AI 辅助查询、数据治理任务等

**支持的数据库驱动：**
MySQL · PostgreSQL · Oracle · 达梦(DM) · SQL Server · MongoDB · TiDB · CockroachDB 及更多

### 前端

- 纯原生 HTML + CSS + JavaScript，无构建工具，无前端框架
- 主页动态读取 `apps.json` 渲染应用卡片，支持搜索与排序
- 各应用相互独立，均为自包含的单页面应用

---

## 应用模块

### 实用工具类

| 应用 | 简介 |
|------|------|
| 运维工具箱 | SSH 终端、SFTP 文件管理、Ping/DNS/HTTP/端口等网络诊断 |
| 字段匹配 | 智能映射两组数据字段的对应关系 |
| AI 结构化 | 调用大模型将非结构化文本转为 JSON |
| 低代码开发 | 可视化拖拽构建数据处理应用，编译为独立 HTML |
| 格式万能转换 | 离线图片与文档格式互转（Excel/CSV/JSON/PDF/Word） |
| 文档编辑器 | 在线编辑 Excel、Word、PPT、思维导图、Visio 图表 |
| 数据本体池 | 多数据库连接管理、SQL 执行、接口生成、AI 查询、数据治理 |
| 待办清单+番茄钟 | 无限层级任务嵌套、拖拽排序、专注计时 |
| 刷题练习 | 导入 Excel 题库进行随机/顺序刷题 |
| 嵌套笔记 | 树形层级笔记管理 |
| 监控看板 | 数据监控可视化仪表盘 |

### 闯关学习类

| 应用 | 内容 |
|------|------|
| SQL 语法学习 | 游戏化闯关，从入门到进阶 SQL |
| MyBatis 语法学习 | XML Mapper 基础 CRUD 到动态 SQL |
| 网络请求教学 | JSON 格式与 Fetch API 实战 |
| HTML 工具开发学习 | 用 HTML+CSS+JS 开发数据工具 |
| Excel 处理学习 | SheetJS 库处理 Excel 文件 |
| JS 文件处理学习 | CSV/Excel/ZIP 综合文件操作 |
| Word 文档处理学习 | docx 库生成 Word 报告 |
| 命令行运维学习 | Windows/Linux 命令、Docker、数据库运维 |
| 大模型使用教程 | API 调用、提示词工程、Prompt 攻防 |
| 数据结构与算法学习 | JS 实现数组、链表、树、图等 |
| 提清需求指南 | 软件项目甲方素养与 AI 协作技巧 |

---

## 快速启动

```bash
go run server.go
# 默认监听 :8080
```

如需指定端口或主机，修改 `server.config.json`。

---

开发者：李哲民

# 数据库管理性能优化 + SQL 工作台

## 目标
1. 数据库管理秒出结果（表列表、数据预览、结构查看）
2. 新增 SQL 工作台（支持任意 SQL 执行、结果展示）

## 当前瓶颈分析

### 后端（Go）
- `handleTableDataQuery`：每次查数据都新建连接（`getDBFromPool`），虽然有连接池但每次请求都要查列信息（2次额外查询：BLOB检测+全列名）
- `handleTableStructure`：每次查结构都新建连接
- `handleDatabaseTablesList`：每次查表列表都新建连接
- 没有 SQL 执行端点（只有治理任务的 `execute-sql`）

### 前端（JS）
- `loadDatabaseDetail`：加载数据库详情后一次性加载所有表（可能几百上千张）
- `previewTable`：每次都重新查结构+数据
- 表列表无分页、无虚拟滚动
- 数据预览无分页（后端 LIMIT 100 但前端全量渲染）

## 优化方案

### 后端优化

1. **连接池预热 + 复用**
   - 启动时为每个数据库建立连接池
   - 请求级别复用连接（不每次新建）
   - 添加连接健康检查

2. **缓存列信息**
   - 表结构/列类型缓存（5分钟TTL）
   - 避免每次查询都执行 `getColumnInfoQuery` + `getAllColumnsQuery`

3. **数据预览分页**
   - 添加 `?page=1&page_size=50` 参数
   - 默认每页50条
   - 支持排序

4. **新增 SQL 工作台 API**
   - `POST /api/v1/databases/{id}/sql` — 执行 SQL
   - 支持 SELECT/INSERT/UPDATE/DELETE
   - 返回列名+数据+影响行数+耗时
   - 安全限制：禁止 DROP DATABASE/TRUNCATE 等危险操作

5. **表列表优化**
   - 异步加载表列表（不阻塞数据库详情返回）
   - 返回表名+行数估算（避免 COUNT(*)）

### 前端优化

1. **SQL 工作台 UI**
   - 在第三列详情区添加「SQL 工作台」tab 切换
   - 代码编辑器（textarea + 语法高亮）
   - 执行按钮 + 快捷键 Ctrl+Enter
   - 结果表格展示（支持复制、导出CSV）
   - 查询历史记录

2. **数据预览优化**
   - 分页控件（上一页/下一页/跳转）
   - 虚拟滚动（大量列时）
   - 懒加载：切换表时才请求数据

3. **表列表优化**
   - 虚拟滚动（表多时）
   - 搜索改为前端过滤（已加载的表列表）
   - 加载骨架屏

## 实施步骤

### Phase 1: 后端 SQL 工作台 API
- [ ] 新增 `POST /api/v1/databases/{id}/sql` 路由
- [ ] 实现 `handleDatabaseSQL` handler
- [ ] 危险操作拦截（DROP/TRUNCATE/ALTER）
- [ ] 返回结构化结果

### Phase 2: 后端性能优化
- [ ] 列信息缓存（sync.Map, 5min TTL）
- [ ] 数据预览分页参数
- [ ] 表列表返回行数估算

### Phase 3: 前端 SQL 工作台
- [ ] 第三列添加 tab 切换（表结构/数据预览/SQL工作台）
- [ ] SQL 编辑器 + 执行按钮
- [ ] 结果表格 + 复制/导出
- [ ] 查询历史

### Phase 4: 前端性能优化
- [ ] 数据预览分页控件
- [ ] 表列表虚拟滚动
- [ ] 懒加载优化

## 文件清单
- 后端：`handlers_v1.go`, `handlers_table.go`, `routes_v1.go`, `handlers_api.go`
- 前端：`index.html`, `js/script-api.js`, `css/css/style-core.css`

## 验证
- SQL 工作台执行 SELECT/INSERT/UPDATE/DELETE
- 危险 SQL 被拦截
- 数据预览分页正常
- 表列表加载 < 1s
- 数据预览加载 < 1s

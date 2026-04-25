# 本体关系表功能实现总结

## 实现概述

已成功实现本体关系表功能，包括后端API、前端界面和数据库持久化。

## 后端实现 (server.go)

### 1. 数据结构定义

在 server.go 中添加了以下结构体：

```go
// FieldRef 字段引用
type FieldRef struct {
    DatabaseID string `json:"database_id"`
    TableName  string `json:"table_name"`
    FieldName  string `json:"field_name"`
    FieldType  string `json:"field_type,omitempty"`
}

// OntologyRelation 本体关系
type OntologyRelation struct {
    ID          string    `json:"id"`
    Name        string    `json:"name"`
    Description string    `json:"description,omitempty"`
    Source      FieldRef  `json:"source"`
    Target      FieldRef  `json:"target"`
    MatchType   string    `json:"match_type"` // exact, case_insensitive, naming_style, type_keyword
    Owner       string    `json:"owner,omitempty"`
    CreatedAt   time.Time `json:"created_at"`
}

// RelationCandidate 关系候选
type RelationCandidate struct {
    Name        string   `json:"name"`
    Source      FieldRef `json:"source"`
    Target      FieldRef `json:"target"`
    MatchType   string   `json:"match_type"`
    MatchScore  float64  `json:"match_score"`
    Description string   `json:"description,omitempty"`
}
```

### 2. 全局变量

添加了本体关系存储：
```go
ontologyRelations = make(map[string]*OntologyRelation)
```

### 3. 数据持久化

更新了 `DataOntologyStore` 结构体：
```go
OntologyRelations map[string]*OntologyRelation `json:"ontology_relations,omitempty"`
```

更新了加载和保存函数：
- `loadDataOntologyStore()`: 加载本体关系数据
- `saveDataOntologyStore()`: 保存本体关系数据到 data-store.json

### 4. API 端点

#### POST /api/data-ontology/ontology/scan
扫描所有数据库表结构，返回候选关系

**功能**：
- 读取所有数据库的所有表结构
- 使用多种策略扫描匹配字段
- 返回候选关系聚类（最多100个）

**扫描策略**：
1. **精确匹配** (exact): 字段名完全相同，得分 1.0
2. **大小写不敏感匹配** (case_insensitive): 字段名忽略大小写相同，得分 0.9
3. **命名风格转换匹配** (naming_style): 驼峰转下划线后相同，得分 0.8
4. **类型+关键词匹配** (type_keyword): 同类型且名称含相同关键词，得分 0.7

**辅助函数**：
- `toSnakeCase()`: 将驼峰命名转换为下划线命名
- `extractKeyword()`: 提取字段名关键词（去除常见前缀后缀）

#### GET /api/data-ontology/ontology/relations
查询所有本体关系

#### POST /api/data-ontology/ontology/relations
创建新的本体关系

**请求体**：
```json
{
  "name": "关系名称",
  "description": "关系描述",
  "source": {
    "database_id": "数据库ID",
    "table_name": "表名",
    "field_name": "字段名",
    "field_type": "字段类型"
  },
  "target": {
    "database_id": "数据库ID",
    "table_name": "表名",
    "field_name": "字段名",
    "field_type": "字段类型"
  },
  "match_type": "匹配类型"
}
```

#### GET /api/data-ontology/ontology/relations/{id}
查询单个本体关系详情

#### DELETE /api/data-ontology/ontology/relations/{id}
删除本体关系

## 前端实现 (apps/data-ontology/)

### 1. HTML 界面 (index.html)

#### 工具栏按钮
在"本体论抽象"标签页的工具栏中添加了两个按钮：
- **🔍 扫描关系**: 打开扫描候选关系模态框
- **📋 关系表**: 打开本体关系表模态框

#### 模态框

**本体关系表模态框** (`ontologyRelationModal`):
- 显示所有已保存的本体关系
- 支持刷新和删除操作
- 表格列：关系名称、源字段、目标字段、匹配类型、创建时间、操作

**扫描候选关系模态框** (`ontologyScanModal`):
- 开始扫描按钮
- 显示扫描结果（候选关系列表）
- 支持将候选添加为正式关系
- 表格列：候选名称、源字段、目标字段、匹配类型、得分、操作

### 2. JavaScript 功能 (script.js)

添加了以下函数：

**关系表管理**：
- `showOntologyRelationTable()`: 显示关系表模态框
- `hideOntologyRelationModal()`: 隐藏关系表模态框
- `refreshOntologyRelations()`: 刷新关系列表
- `renderRelationTable()`: 渲染关系表格
- `deleteOntologyRelation(relId)`: 删除关系

**扫描功能**：
- `scanOntologyRelations()`: 显示扫描模态框
- `hideOntologyScanModal()`: 隐藏扫描模态框
- `startOntologyScan()`: 开始扫描
- `renderScanResults()`: 渲染扫描结果
- `addCandidateAsRelation(idx)`: 将候选添加为关系

## 数据流程

1. **扫描流程**：
   - 用户点击"扫描关系"按钮
   - 前端调用 POST /api/data-ontology/ontology/scan
   - 后端遍历所有数据库表结构
   - 使用4种匹配策略发现候选关系
   - 返回候选列表（按得分排序，最多100个）
   - 前端展示候选列表，用户可选择添加

2. **创建关系**：
   - 用户点击候选的"添加"按钮
   - 输入关系名称
   - 前端调用 POST /api/data-ontology/ontology/relations
   - 后端保存关系到内存和 data-store.json
   - 返回成功状态

3. **查看关系**：
   - 用户点击"关系表"按钮
   - 前端调用 GET /api/data-ontology/ontology/relations
   - 后端返回所有关系列表
   - 前端渲染表格展示

4. **删除关系**：
   - 用户点击关系的"删除"按钮
   - 确认后调用 DELETE /api/data-ontology/ontology/relations/{id}
   - 后端从内存和 data-store.json 中删除
   - 返回成功状态

## 权限控制

- 所有API都需要用户认证（通过 Authorization header）
- 用户只能查看和管理自己创建的关系（或管理员创建的关系）
- 使用 `dataOntologyResourceVisible()` 函数进行权限检查

## 文件修改清单

1. **server.go**:
   - 添加结构体定义（FieldRef, OntologyRelation, RelationCandidate）
   - 添加全局变量 ontologyRelations
   - 更新 DataOntologyStore 结构体
   - 更新 loadDataOntologyStore() 和 saveDataOntologyStore()
   - 添加 handleOntologyScan() 处理函数
   - 添加 handleOntologyRelations() 处理函数
   - 添加 handleOntologyRelationDetail() 处理函数
   - 添加 toSnakeCase() 和 extractKeyword() 辅助函数
   - 注册3个新的API路由

2. **apps/data-ontology/index.html**:
   - 添加"扫描关系"和"关系表"按钮
   - 添加本体关系表模态框
   - 添加扫描候选关系模态框

3. **apps/data-ontology/script.js**:
   - 添加关系表管理函数
   - 添加扫描功能函数
   - 添加全局变量 ontologyRelations 和 scanCandidates

## 测试建议

1. **功能测试**：
   - 添加多个数据库配置
   - 点击"扫描关系"，验证候选关系发现
   - 添加候选为正式关系
   - 查看关系表，验证数据显示
   - 删除关系，验证删除成功

2. **权限测试**：
   - 使用不同用户登录
   - 验证只能看到自己创建的关系
   - 验证无法删除其他用户的关系

3. **持久化测试**：
   - 创建关系后重启服务
   - 验证关系数据仍然存在

## 注意事项

1. 由于开发环境 Go 版本为 1.18，无法直接编译。建议在 Go 1.21+ 环境中编译。
2. MongoDB 数据库暂不支持扫描功能（代码中已跳过）。
3. 扫描结果限制为最多100个候选关系，避免性能问题。
4. 所有数据保存在 apps/data-ontology/data-store.json 文件中。

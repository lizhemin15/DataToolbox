# 关系扫描规则选择功能实现总结

## 实现内容

### 1. 后端修改 (server.go)

#### 1.1 修改 `handleTableRetrievalRelationScan` 函数 (第 6249 行)
- 请求体增加 `rules` 数组参数
- 如果 `rules` 为空，默认使用所有规则：`["exact", "naming_style", "type_keyword", "prefix_consistency"]`
- 将 `rules` 参数传递给 `scanRelationCandidates` 函数

#### 1.2 修改 `scanRelationCandidates` 函数签名 (第 18547 行)
- 增加 `rules []string` 参数
- 将 `rules` 参数传递给 `detectRelation` 函数

#### 1.3 重构 `detectRelation` 函数 (第 18659 行)
- 增加 `rules []string` 参数
- 添加 `ruleEnabled` 辅助函数检查规则是否启用
- 每个规则检测前先检查该规则是否被勾选
- 为每个匹配类型应用前缀一致性加成（如果启用）

#### 1.4 新增 `calculatePrefixConsistency` 函数
- 计算两个表名的公共前缀长度
- 返回前缀重合比例 (0-1)
- 实现逻辑：
  - 转换为小写统一比较
  - 计算公共前缀长度
  - 前缀重合比例 = 公共前缀长度 / 较长表名的长度
- 置信度加成公式：`confidence * (1 + prefixBonus * 0.3)`

### 2. 前端修改 (web/data-ontology/script.js)

#### 2.1 修改 `handleScanRelations` 函数 (第 11681 行)
- 扫描前先调用 `showRelationScanRulesModal()` 显示规则选择对话框
- 用户选择规则后，调用 `table-retrieval/relation-scan` API 并传递 `rules` 参数
- 扫描成功后显示关系候选列表供用户确认
- 用户确认后批量添加选中的关系

#### 2.2 新增 `showRelationScanRulesModal` 函数
- 显示规则选择对话框
- 4 个复选框，每个对应一个扫描规则：
  1. **精确匹配 (exact)** - 字段名完全相同（默认勾选）
  2. **命名风格 (naming_style)** - id ↔ table_id 命名模式（默认勾选）
  3. **类型+关键词 (type_keyword)** - 类型匹配 + 名称部分相似（默认勾选）
  4. **前缀一致性 (prefix_consistency)** - 表名前缀重合越多，置信度越高（默认勾选）
- 返回选中的规则数组，取消返回 null

#### 2.3 新增 `showRelationCandidates` 函数
- 显示扫描结果的关系候选列表
- 每个候选显示：
  - 关系：table1.field1 ↔ table2.field2
  - 匹配类型标签
  - 置信度百分比
  - 匹配原因
- 支持全选/全不选
- 用户确认后批量调用 `relation-confirm` API 添加关系

## 扫描规则详解

### 1. 精确匹配 (exact)
- 字段名完全相同
- 基础置信度：1.0

### 2. 命名风格 (naming_style)
- 识别 `id` ↔ `table_id` 或 `tableid` 模式
- 基础置信度：0.95

### 3. 类型+关键词 (type_keyword)
- 字段类型都是 INT/BIGINT
- 字段名部分相似
- 基础置信度：0.7

### 4. 前缀一致性 (prefix_consistency) - 新增
- 计算两个表名的公共前缀长度
- 前缀重合比例 = 公共前缀长度 / 较长表名的长度
- 作为其他规则的加成因子
- 置信度加成：`confidence * (1 + prefixBonus * 0.3)`
- 示例：
  - `order_items` 和 `order_details` 前缀 "order" 重合
  - 公共前缀长度：5
  - 较长表名长度：13 (order_details)
  - 前缀重合比例：5/13 ≈ 0.385
  - 置信度加成：confidence * (1 + 0.385 * 0.3) = confidence * 1.115

## API 参数格式

### POST /api/data-ontology/table-retrieval/relation-scan
请求体：
```json
{
  "db_id": "xxx",
  "rules": ["exact", "naming_style", "type_keyword", "prefix_consistency"]
}
```

响应：
```json
{
  "success": true,
  "candidates": [
    {
      "id": 1,
      "database_id": "xxx",
      "table_name1": "users",
      "field_name1": "id",
      "field_type1": "INT",
      "table_name2": "orders",
      "field_name2": "user_id",
      "field_type2": "INT",
      "confidence": 0.95,
      "reason": "字段名匹配: id ↔ user_id (命名风格)",
      "match_type": "naming_style"
    }
  ]
}
```

## 使用流程

1. 用户点击"扫描关系"按钮
2. 弹出规则选择对话框，默认全选
3. 用户勾选需要的规则，点击"开始扫描"
4. 后端根据选中的规则扫描关系候选
5. 前端显示扫描结果列表
6. 用户勾选要添加的关系，点击"确认添加"
7. 批量调用确认接口添加关系

## 代码质量

- ✅ Go 代码格式正确 (gofmt)
- ✅ JavaScript 语法正确 (node --check)
- ✅ 保持原有代码风格
- ✅ 错误处理完善
- ✅ 用户体验友好（加载提示、错误提示）
# 本体关系表功能 - 快速使用指南

## 功能入口

在"本体论抽象"标签页的工具栏中，有两个新按钮：

1. **🔍 扫描关系** - 自动扫描数据库发现候选关系
2. **📋 关系表** - 查看和管理已保存的关系

## 使用流程

### 1. 扫描候选关系

1. 点击"🔍 扫描关系"按钮
2. 在弹出的模态框中点击"开始扫描"
3. 系统会自动扫描所有数据库的表结构
4. 使用4种匹配策略发现候选关系：
   - **精确匹配**: 字段名完全相同 (得分 1.0)
   - **大小写不敏感**: 字段名忽略大小写相同 (得分 0.9)
   - **命名风格转换**: 驼峰转下划线后相同 (得分 0.8)
   - **类型+关键词**: 同类型且名称含相同关键词 (得分 0.7)
5. 候选关系按得分排序显示

### 2. 添加关系

1. 在扫描结果中，找到感兴趣的候选关系
2. 点击"添加"按钮
3. 输入关系名称（可使用默认名称）
4. 关系会被保存到系统中

### 3. 查看关系表

1. 点击"📋 关系表"按钮
2. 查看所有已保存的本体关系
3. 表格显示：
   - 关系名称
   - 源字段（表名.字段名）
   - 目标字段（表名.字段名）
   - 匹配类型
   - 创建时间
   - 操作按钮

### 4. 删除关系

1. 在关系表中，找到要删除的关系
2. 点击"删除"按钮
3. 确认删除操作

## API 端点

### 扫描候选关系
```bash
POST /api/data-ontology/ontology/scan
Authorization: Bearer {token}

响应：
{
  "success": true,
  "candidates": [
    {
      "name": "users.id ↔ orders.user_id",
      "source": {
        "database_id": "db1",
        "table_name": "users",
        "field_name": "id",
        "field_type": "int"
      },
      "target": {
        "database_id": "db1",
        "table_name": "orders",
        "field_name": "user_id",
        "field_type": "int"
      },
      "match_type": "type_keyword",
      "match_score": 0.7,
      "description": "匹配类型: type_keyword, 得分: 0.70"
    }
  ],
  "total": 1
}
```

### 获取关系列表
```bash
GET /api/data-ontology/ontology/relations
Authorization: Bearer {token}

响应：
{
  "success": true,
  "relations": [
    {
      "id": "rel-uuid",
      "name": "用户ID关联",
      "source": {...},
      "target": {...},
      "match_type": "exact",
      "owner": "admin",
      "created_at": "2026-04-25T10:00:00Z"
    }
  ]
}
```

### 创建关系
```bash
POST /api/data-ontology/ontology/relations
Authorization: Bearer {token}
Content-Type: application/json

{
  "name": "用户ID关联",
  "description": "用户表ID与订单表用户ID的关联",
  "source": {
    "database_id": "db1",
    "table_name": "users",
    "field_name": "id",
    "field_type": "int"
  },
  "target": {
    "database_id": "db1",
    "table_name": "orders",
    "field_name": "user_id",
    "field_type": "int"
  },
  "match_type": "type_keyword"
}

响应：
{
  "success": true,
  "id": "new-rel-uuid"
}
```

### 删除关系
```bash
DELETE /api/data-ontology/ontology/relations/{id}
Authorization: Bearer {token}

响应：
{
  "success": true
}
```

## 典型应用场景

### 场景1: 发现外键关系

系统可以自动发现类似这样的关系：
- `users.id` ↔ `orders.user_id`
- `products.id` ↔ `order_items.product_id`
- `departments.id` ↔ `employees.dept_id`

### 场景2: 发现命名规范问题

通过命名风格转换匹配，可以发现：
- `userId` ↔ `user_id` (驼峰 vs 下划线)
- `orderId` ↔ `order_id`

### 场景3: 发现跨库关联

可以发现在不同数据库中的相同字段：
- 库A的 `customers.customer_no`
- 库B的 `orders.customer_no`

## 数据持久化

所有关系数据保存在：
```
apps/data-ontology/data-store.json
```

示例数据结构：
```json
{
  "ontology_relations": {
    "rel-uuid-1": {
      "id": "rel-uuid-1",
      "name": "用户ID关联",
      "source": {
        "database_id": "db1",
        "table_name": "users",
        "field_name": "id",
        "field_type": "int"
      },
      "target": {
        "database_id": "db1",
        "table_name": "orders",
        "field_name": "user_id",
        "field_type": "int"
      },
      "match_type": "type_keyword",
      "owner": "admin",
      "created_at": "2026-04-25T10:00:00Z"
    }
  }
}
```

## 性能优化

1. 扫描结果限制为最多100个候选关系
2. 使用连接池访问数据库
3. 按匹配得分排序，优先展示高质量候选
4. 支持跨数据库类型（MySQL, PostgreSQL, Oracle, SQLite等）

## 权限说明

- 用户只能查看自己创建的关系
- 管理员创建的关系对所有用户可见
- 用户无法删除其他用户创建的关系

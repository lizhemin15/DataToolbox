# 数据本体池 - 后端API规范

## 表格数据管理接口

### 保存表格数据

**端点**: `POST /api/data-ontology/databases/{dbId}/tables/{tableName}/data`

**请求头**:
```
Authorization: Bearer {token}
Content-Type: application/json
```

**请求体**:
```json
{
  "updates": [
    {
      "index": 0,
      "data": {
        "column1": "value1",
        "column2": "value2"
      }
    }
  ],
  "inserts": [
    {
      "column1": "new_value1",
      "column2": "new_value2"
    }
  ],
  "deletes": [5, 6]  // 要删除的行索引数组
}
```

**响应体**:
```json
{
  "success": true,
  "message": "保存成功",
  "updated": 5,    // 实际更新的行数
  "inserted": 0,   // 实际插入的行数
  "deleted": 2     // 实际删除的行数
}
```

### 重要说明

1. **删除操作**: `deletes` 数组包含的是要删除的行索引（从0开始）
   - 前端会按照表格当前显示的顺序发送行索引
   - 后端应该按照索引删除对应的行
   - 例如：`[5, 6]` 表示删除第6行和第7行（索引从0开始）

2. **更新操作**: `updates` 数组包含行索引和新数据
   - `index`: 要更新的行索引
   - `data`: 新的列值（只包含表格中的列）

3. **插入操作**: `inserts` 数组包含要插入的新行数据
   - 每个对象包含所有列的值
   - NULL值用 `null` 表示

4. **响应要求**:
   - 必须返回 `success: true/false`
   - 建议返回实际影响的行数（`updated`, `inserted`, `deleted`）
   - 如果失败，返回 `message` 说明原因

### 示例实现（伪代码）

```javascript
async function handleTableDataUpdate(dbId, tableName, data) {
  const { updates, inserts, deletes } = data;
  
  let updated = 0, inserted = 0, deleted = 0;
  
  try {
    // 1. 处理删除（从后往前删，避免索引混乱）
    const sortedDeletes = deletes.sort((a, b) => b - a);
    for (const index of sortedDeletes) {
      await db.deleteRow(tableName, index);
      deleted++;
    }
    
    // 2. 处理更新
    for (const update of updates) {
      await db.updateRow(tableName, update.index, update.data);
      updated++;
    }
    
    // 3. 处理插入
    for (const row of inserts) {
      await db.insertRow(tableName, row);
      inserted++;
    }
    
    return {
      success: true,
      updated,
      inserted,
      deleted
    };
  } catch (error) {
    return {
      success: false,
      message: error.message
    };
  }
}
```

### 获取表格结构

**端点**: `GET /api/data-ontology/databases/{dbId}/tables/{tableName}/structure`

**响应体**:
```json
{
  "success": true,
  "columns": [
    {
      "name": "id",
      "type": "INT",
      "nullable": false,
      "primary_key": true
    },
    {
      "name": "name",
      "type": "VARCHAR",
      "size": 255,
      "nullable": true
    }
  ]
}
```

### 创建表

**端点**: `POST /api/data-ontology/databases/{dbId}/tables`

**请求体**:
```json
{
  "name": "users",
  "columns": [
    {
      "name": "id",
      "type": "INT",
      "not_null": true,
      "primary_key": true,
      "auto_increment": true
    },
    {
      "name": "name",
      "type": "VARCHAR",
      "size": "255",
      "not_null": false
    }
  ]
}
```

### 删除表

**端点**: `DELETE /api/data-ontology/databases/{dbId}/tables/{tableName}`

**响应体**:
```json
{
  "success": true,
  "message": "表删除成功"
}
```

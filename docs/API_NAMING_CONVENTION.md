# API 命名规范

## JSON 字段命名统一使用 snake_case（下划线）

**原因**：
1. Go 的 JSON tag 习惯用 snake_case
2. 前端 JavaScript 也习惯用 snake_case（Python/Ruby 风格）
3. 数据库字段也是 snake_case，保持一致性

## 正确示例

```go
// Go 后端
json.NewEncoder(w).Encode(map[string]interface{}{
    "success":       true,
    "success_count": 10,
    "fail_count":    2,
    "total_rules":   12,
    "session_id":    "abc123",
    "current_path":  "/home/user",
    "is_dir":        true,
    "mod_time":      "2024-01-01 12:00",
    "db_id":         "db-001",
    "edge_count":    5,
})
```

```javascript
// JavaScript 前端
const successCount = result.success_count;
const sessionId = data.session_id;
const isDir = file.is_dir;
```

## 错误示例（禁止使用）

```go
// ❌ 驼峰命名
"successCount": 10
"sessionId": "abc123"
"isDir": true
```

```javascript
// ❌ 驼峰命名
const successCount = result.successCount;
const sessionId = data.sessionId;
```

## 检查清单

新增 API 时检查：
- [ ] 后端 JSON 字段全部使用 snake_case
- [ ] 前端读取字段使用相同的 snake_case
- [ ] Go struct 的 JSON tag 使用 snake_case

## 已修复的字段

| 旧字段（驼峰） | 新字段（下划线） | 位置 |
|--------------|----------------|------|
| successCount | success_count | 用户批量导入 |
| failCount | fail_count | 用户批量导入 |
| successList | success_list | 用户批量导入 |
| failList | fail_list | 用户批量导入 |
| errorCode | error_code | 通用错误响应 |
| dbType | db_type | 表血缘查询 |
| edgeCount | edge_count | 表血缘查询 |
| dbId | db_id | AI SQL 确认写操作 |
| sessionId | session_id | SFTP 连接 |
| currentPath | current_path | SFTP 连接 |
| isDir | is_dir | SFTP 文件列表 |
| modTime | mod_time | SFTP 文件列表 |

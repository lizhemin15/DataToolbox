# 关系扫描规则选择功能测试指南

## 测试准备

### 1. 启动服务
```bash
cd /root/projects/DataToolbox
./datatoolbox-server
```

### 2. 访问前端
打开浏览器访问：http://localhost:8080/data-ontology/

## 功能测试步骤

### 测试 1: 规则选择对话框显示
1. 选择一个数据库
2. 点击"🔍 扫描关系"按钮
3. **预期结果**：弹出规则选择对话框
4. **验证点**：
   - 标题显示"选择扫描规则"
   - 4 个规则选项全部显示
   - 所有规则默认勾选
   - 每个规则有说明文字

### 测试 2: 取消扫描
1. 点击"扫描关系"按钮
2. 在规则选择对话框点击"取消"
3. **预期结果**：对话框关闭，不执行扫描

### 测试 3: 至少选择一个规则
1. 点击"扫描关系"按钮
2. 取消所有规则的勾选
3. 点击"开始扫描"
4. **预期结果**：提示"请至少选择一个扫描规则"

### 测试 4: 单个规则扫描 - 精确匹配
1. 点击"扫描关系"按钮
2. 只勾选"精确匹配 (exact)"
3. 点击"开始扫描"
4. **预期结果**：
   - 显示扫描进度
   - 扫描完成后显示关系候选列表
   - 所有候选的 match_type 都是 "exact"
   - 字段名完全相同的字段对

### 测试 5: 单个规则扫描 - 命名风格
1. 点击"扫描关系"按钮
2. 只勾选"命名风格 (naming_style)"
3. 点击"开始扫描"
4. **预期结果**：
   - 扫描完成后显示关系候选列表
   - 所有候选的 match_type 都是 "naming_style"
   - 字段对符合 id ↔ table_id 模式

### 测试 6: 单个规则扫描 - 类型+关键词
1. 点击"扫描关系"按钮
2. 只勾选"类型+关键词 (type_keyword)"
3. 点击"开始扫描"
4. **预期结果**：
   - 扫描完成后显示关系候选列表
   - 所有候选的 match_type 都是 "type_keyword"
   - 字段类型都是 INT/BIGINT
   - 字段名部分相似

### 测试 7: 前缀一致性加成
1. 点击"扫描关系"按钮
2. 勾选"精确匹配"和"前缀一致性"
3. 点击"开始扫描"
4. **预期结果**：
   - 表名前缀相同的字段对置信度更高
   - 例如：order_items.id 和 order_details.id 的置信度 > users.id 和 products.id

### 测试 8: 多规则组合扫描
1. 点击"扫描关系"按钮
2. 勾选所有规则
3. 点击"开始扫描"
4. **预期结果**：
   - 扫描完成后显示关系候选列表
   - 候选包含各种 match_type
   - 前缀相同的表字段置信度更高

### 测试 9: 关系候选列表交互
1. 扫描完成后，查看关系候选列表
2. **验证点**：
   - 显示关系：table1.field1 ↔ table2.field2
   - 显示匹配类型标签
   - 显示置信度百分比
   - 显示匹配原因
   - 全选/全不选按钮工作正常

### 测试 10: 确认添加关系
1. 在关系候选列表中勾选部分关系
2. 点击"确认添加"
3. **预期结果**：
   - 显示添加进度
   - 添加成功后显示成功消息
   - 关系被保存到数据库

### 测试 11: 无关系候选
1. 选择一个没有关系的数据库
2. 执行扫描
3. **预期结果**：
   - 显示"扫描完成：未发现关系候选"
   - 不弹出候选列表

### 测试 12: 错误处理
1. 模拟网络错误或后端错误
2. **预期结果**：
   - 显示友好的错误消息
   - 按钮恢复可点击状态

## API 测试

### 测试 API 端点
```bash
# 测试关系扫描 API
curl -X POST http://localhost:8080/api/data-ontology/table-retrieval/relation-scan \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -d '{
    "db_id": "test_db",
    "rules": ["exact", "naming_style"]
  }'
```

### 预期响应格式
```json
{
  "success": true,
  "candidates": [
    {
      "id": 1,
      "database_id": "test_db",
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

## 性能测试

### 测试大规模数据库
1. 选择包含大量表的数据库（100+ 表）
2. 执行全规则扫描
3. **验证点**：
   - 扫描时间合理（< 30 秒）
   - 候选列表渲染流畅
   - 内存占用正常

## 边界测试

### 测试空规则数组
```bash
curl -X POST http://localhost:8080/api/data-ontology/table-retrieval/relation-scan \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -d '{
    "db_id": "test_db",
    "rules": []
  }'
```
**预期结果**：使用所有默认规则扫描

### 测试无效规则名称
```bash
curl -X POST http://localhost:8080/api/data-ontology/table-retrieval/relation-scan \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -d '{
    "db_id": "test_db",
    "rules": ["invalid_rule"]
  }'
```
**预期结果**：不匹配任何关系，返回空候选列表

## 回归测试

### 确保原有功能不受影响
1. 测试其他数据库管理功能
2. 测试表检索功能
3. 测试向量同步功能
4. **验证点**：所有功能正常工作

## 测试检查清单

- [ ] 规则选择对话框正常显示
- [ ] 所有规则默认勾选
- [ ] 取消按钮工作正常
- [ ] 至少选择一个规则验证
- [ ] 精确匹配规则扫描正确
- [ ] 命名风格规则扫描正确
- [ ] 类型+关键词规则扫描正确
- [ ] 前缀一致性加成生效
- [ ] 多规则组合扫描正确
- [ ] 关系候选列表显示正确
- [ ] 全选/全不选功能正常
- [ ] 确认添加关系成功
- [ ] 无候选时提示正确
- [ ] 错误处理友好
- [ ] API 响应格式正确
- [ ] 性能表现良好
- [ ] 边界情况处理正确
- [ ] 原有功能未受影响
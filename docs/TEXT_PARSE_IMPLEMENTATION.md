# 文本结构化解析 API 实现总结

## 实现内容

在 `server.go` 中成功实现了文本结构化解析 API，具体包括：

### 1. 数据结构定义

```go
type TextSection struct {
    Level    int           `json:"level"`     // 标题层级 (1-5)
    Number   string        `json:"number"`    // 标题编号
    Title    string        `json:"title"`     // 标题文本
    Content  string        `json:"content"`   // 正文内容
    Children []TextSection `json:"children"`  // 子节点
}

type TextParseRequest struct {
    Text    string                 `json:"text"`
    Format  string                 `json:"format"`
    Options map[string]interface{} `json:"options"`
}
```

### 2. 核心函数

#### parseOfficialDocument
- 功能：解析公文格式文本
- 参数：
  - `text`: 原始文本内容
  - `minLevel`: 最小标题层级 (1-5)
  - `maxLevel`: 最大标题层级 (1-5)
  - `detectNumbering`: 是否检测编号标题
  - `includeContent`: 是否包含正文内容
- 返回：树形结构的标题列表和元数据

#### handleGovParseText
- 功能：处理 HTTP 请求
- 路由：POST `/api/data-ontology/gov/parse-text`
- 支持的格式：`official`（公文格式）

### 3. 标题层级识别规则

使用正则表达式识别五种标题层级：

1. **一级标题**: `^[一二三四五六七八九十]+、`
   - 示例：一、二、三、

2. **二级标题**: `^[（(][一二三四五六七八九十]+[)）]`
   - 示例：（一）（二）或 (一)(二)

3. **三级标题**: `^\d+[.、]`
   - 示例：1. 2. 或 1、2、

4. **四级标题**: `^[（(]\d+[)）]`
   - 示例：（1）（2）或 (1)(2)

5. **五级标题**: `^[①②③④⑤⑥⑦⑧⑨⑩]|^\d+\)`
   - 示例：①②③ 或 1) 2) 3)

### 4. 树形结构构建算法

使用栈结构构建层级树：

1. 遍历文本的每一行
2. 检测是否为标题行（匹配正则表达式）
3. 如果是标题：
   - 创建新的 TextSection 节点
   - 弹出栈中所有级别 >= 当前级别的节点
   - 将新节点添加到栈顶节点的 children（或作为顶级节点）
   - 将新节点压入栈
4. 如果是正文：
   - 添加到栈顶节点的 content 字段

### 5. 元数据统计

返回以下统计信息：
- `total_sections`: 总标题数量
- `max_depth`: 最大层级深度
- `format_detected`: 检测到的格式类型

## 测试验证

### 测试用例

测试文本包含：
- 一级标题：一、总则
- 二级标题：（一）基本原则、（二）适用范围
- 三级标题：1. 数据安全第一、2. 效率优先
- 四级标题：（1）合法性原则、（2）必要性原则
- 五级标题：① 自动采集、② 手动录入

### 测试结果

```
✓ 成功识别所有 5 个层级的标题
✓ 正确构建树形结构
✓ 正确提取正文内容
✓ 元数据统计准确（total_sections: 13, max_depth: 5）
```

## 文件修改

### server.go
- 添加位置：第 13779 行之前（main 函数之前）
- 添加内容：
  - TextSection 结构体定义
  - TextParseRequest 结构体定义
  - parseOfficialDocument 函数实现
  - handleGovParseText 函数实现
- 路由注册：第 14117 行之后添加
  ```go
  mux.HandleFunc("/api/data-ontology/gov/parse-text", handleGovParseText)
  ```

### 新增文件
- `docs/TEXT_PARSE_API.md`: API 使用文档
- `test_parse_text.sh`: API 测试脚本

## API 使用示例

```bash
curl -X POST http://localhost:8080/api/data-ontology/gov/parse-text \
  -H "Content-Type: application/json" \
  -d '{
    "text": "一、总则\n\n第一条 为了规范数据管理，特制定本规定。\n\n（一）基本原则\n\n1. 数据安全第一\n2. 效率优先",
    "format": "official",
    "options": {
      "min_level": 1,
      "max_level": 5,
      "detect_numbering": true,
      "include_content": true
    }
  }'
```

## 扩展性

系统设计支持未来扩展：
- 可添加新的格式解析器（如 `meeting`、`contract`、`custom`）
- 可扩展标题识别规则
- 可添加更多解析选项

## 注意事项

1. 项目需要 Go 1.23 或更高版本
2. 当前系统 Go 版本为 1.18.1，需要升级才能编译运行
3. 代码语法检查已通过（gofmt）
4. 功能逻辑已通过独立测试验证
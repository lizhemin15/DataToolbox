# 文本结构化解析 API 文档

## API 端点

**POST** `/api/data-ontology/gov/parse-text`

解析文本内容并返回结构化的层级数据。

## 请求格式

### 请求体

```json
{
  "text": "原始文本内容",
  "format": "official",
  "options": {
    "min_level": 1,
    "max_level": 5,
    "detect_numbering": true,
    "include_content": true
  }
}
```

### 参数说明

| 参数 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| text | string | 是 | - | 待解析的原始文本内容 |
| format | string | 否 | "official" | 文本格式类型，目前仅支持 "official"（公文格式） |
| options | object | 否 | 见下方 | 解析选项 |

### options 参数说明

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| min_level | int | 1 | 最小标题层级（1-5） |
| max_level | int | 5 | 最大标题层级（1-5） |
| detect_numbering | bool | true | 是否检测编号标题 |
| include_content | bool | true | 是否包含正文内容 |

## 响应格式

### 成功响应

```json
{
  "success": true,
  "data": {
    "sections": [
      {
        "level": 1,
        "number": "一、",
        "title": "总则",
        "content": "第一条 为了规范...",
        "children": [
          {
            "level": 2,
            "number": "（一）",
            "title": "基本原则",
            "content": "...",
            "children": []
          }
        ]
      }
    ],
    "metadata": {
      "total_sections": 10,
      "max_depth": 3,
      "format_detected": "official"
    }
  }
}
```

### 错误响应

```json
{
  "success": false,
  "message": "错误信息描述"
}
```

## 公文格式标题层级识别规则

系统支持识别以下五种标题层级：

| 层级 | 编号格式 | 示例 |
|------|----------|------|
| 一级标题 | 中文数字 + 、 | 一、二、三、四、五、六、七、八、九、十 |
| 二级标题 | 括号 + 中文数字 | （一）（二）（三）或 (一)(二)(三) |
| 三级标题 | 阿拉伯数字 + .或、 | 1. 2. 3. 或 1、2、3、 |
| 四级标题 | 括号 + 阿拉伯数字 | （1）（2）（3）或 (1)(2)(3) |
| 五级标题 | 圈数字或数字+括号 | ①②③ 或 1) 2) 3) |

## 使用示例

### 示例 1: 解析公文文本

**请求:**

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

**响应:**

```json
{
  "success": true,
  "data": {
    "sections": [
      {
        "level": 1,
        "number": "一、",
        "title": "总则",
        "content": "第一条 为了规范数据管理，特制定本规定。",
        "children": [
          {
            "level": 2,
            "number": "（一）",
            "title": "基本原则",
            "content": "",
            "children": [
              {
                "level": 3,
                "number": "1.",
                "title": "数据安全第一",
                "content": "",
                "children": null
              },
              {
                "level": 3,
                "number": "2.",
                "title": "效率优先",
                "content": "",
                "children": null
              }
            ]
          }
        ]
      }
    ],
    "metadata": {
      "total_sections": 4,
      "max_depth": 3,
      "format_detected": "official"
    }
  }
}
```

### 示例 2: 仅解析特定层级

**请求:**

```bash
curl -X POST http://localhost:8080/api/data-ontology/gov/parse-text \
  -H "Content-Type: application/json" \
  -d '{
    "text": "一、总则\n\n（一）基本原则\n\n1. 数据安全第一",
    "format": "official",
    "options": {
      "min_level": 1,
      "max_level": 2,
      "include_content": false
    }
  }'
```

**响应:**

```json
{
  "success": true,
  "data": {
    "sections": [
      {
        "level": 1,
        "number": "一、",
        "title": "总则",
        "content": "",
        "children": [
          {
            "level": 2,
            "number": "（一）",
            "title": "基本原则",
            "content": "",
            "children": null
          }
        ]
      }
    ],
    "metadata": {
      "total_sections": 2,
      "max_depth": 2,
      "format_detected": "official"
    }
  }
}
```

## 实现说明

1. **树形结构**: 解析结果为树形结构，`children` 字段包含子节点
2. **正文内容**: 正文内容为该标题下到下一个同级或更高级标题之前的所有文本
3. **层级识别**: 使用正则表达式匹配不同层级的标题编号
4. **格式支持**: 目前仅支持 `official`（公文格式），未来可扩展支持其他格式

## 错误处理

API 可能返回以下错误：

- **400 Bad Request**: 请求体格式错误或缺少必填字段
- **405 Method Not Allowed**: 使用了非 POST 请求方法
- **422 Unprocessable Entity**: 不支持的格式类型

## 测试

可以使用项目根目录下的测试脚本：

```bash
./test_parse_text.sh
```

或使用独立测试程序：

```bash
go run test_parse_standalone.go
```
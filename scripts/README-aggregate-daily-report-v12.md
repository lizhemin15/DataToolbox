# 综合日报生成器 v12 - 使用说明

## 概述

v12 版本对综合日报生成器进行了重构，提供了更灵活的模板占位符替换机制和子文档 JSON 化功能。

## 主要特性

### 1. 多格式支持
- 支持 `.doc`、`.docx`、`.wps` 三种格式
- 通过 `gov.parseWordStructure()` 自动识别并解析

### 2. 模板占位符提取
- 自动识别模板中的 `{占位符}` 格式
- 提取为 `module` 字典，初始值为空字符串
- 示例：
  ```javascript
  module = {
      "报告标题": "",
      "报告日期": "",
      "工作概述": "",
      // ...
  }
  ```

### 3. 子文档 JSON 化
- 每个子文档解析为树状结构化数据
- 存入 `jsons` 字典，可通过文档名访问
- 数据结构：
  ```javascript
  jsons["单位A日报"] = [
      {
          level: 1,
          title: "一、工作概述",
          content: "具体内容...",
          paragraphs: ["段落1", "段落2"],
          children: [
              {
                  level: 2,
                  title: "（一）重点项目",
                  content: "...",
                  children: []
              }
          ]
      },
      // ...
  ]
  ```

### 4. 灵活的替换规则
- 用户可自定义如何从 JSON 数据生成替换内容
- 支持格式化选项（加粗、缩进等）
- 示例：
  ```javascript
  // 简单替换
  module["报告标题"] = "数据治理综合日报";

  // 格式化文本
  module["日期"] = gov.word(jsons["单位A日报"][0][2], { bold: true });

  // 合并多个文档内容
  module["工作概述"] = 
      jsons["单位A日报"][0].content + "\n" + 
      jsons["单位B日报"][0].content;
  ```

## 使用方法

### 步骤1：上传文件
上传 1 个模板文件 + 至少 1 份单位日报

### 步骤2：查看解析结果
脚本会自动：
1. 提取模板占位符
2. 解析子文档为 JSON
3. 显示可用文档和数据结构

### 步骤3：编写替换规则
在脚本的"用户自定义替换规则区域"编写逻辑：

```javascript
// ===== 用户自定义替换规则区域 =====

// 基础信息
module["报告标题"] = "数据治理综合日报";
module["报告日期"] = gov.parseFilename(Object.keys(jsons)[0]).date;

// 合并工作概述
const overviewParts = [];
for (const [docName, tree] of Object.entries(jsons)) {
    if (tree && tree.length > 0) {
        const workOverview = findNodeByKeyword(tree, "工作概述");
        if (workOverview) {
            overviewParts.push(`【${docName}】\n${workOverview.content}`);
        }
    }
}
module["工作概述"] = overviewParts.join('\n\n');

// 合并风险问题
const risksParts = [];
for (const [docName, tree] of Object.entries(jsons)) {
    const risks = findNodeByKeyword(tree, ["问题", "风险", "隐患"]);
    if (risks) {
        risksParts.push(`【${docName}】\n${risks.content}`);
    }
}
module["存在问题"] = risksParts.join('\n\n') || '>暂无';
```

### 步骤4：生成文档
脚本会使用 `module` 字典替换模板占位符，生成最终文档。

## 辅助函数

### `buildTree(sections)`
将 `parseWordStructure` 返回的扁平 sections 数组转换为树状结构。

### `gov.word(text, options)`
格式化文本：
- `text`: 原始文本
- `options`: 格式选项
  - `bold: true` - 加粗
  - `indent: true` - 首行缩进

示例：
```javascript
gov.word("重要内容", { bold: true, indent: true })
// 输出: ">**重要内容**"
```

### `findNodeByKeyword(tree, keywords)`
在树状结构中查找匹配关键词的节点：
- `tree`: 树状结构数组
- `keywords`: 关键词字符串或数组

示例：
```javascript
const node = findNodeByKeyword(jsons["单位A日报"], "工作概述");
const nodes = findNodeByKeyword(jsons["单位A日报"], ["问题", "风险"]);
```

## 数据结构说明

### parseWordStructure 返回结构
```javascript
{
    title: "文档标题",
    sections: [
        {
            level: 1,          // 标题层级 (1-4)
            title: "一、工作概述",
            paragraphs: [       // 该标题下的段落
                "完成项目A",
                "推进项目B"
            ]
        }
    ],
    tables: [],              // 表格数据
    rawText: "原始文本..."
}
```

### buildTree 转换后的结构
```javascript
[
    {
        level: 1,
        title: "一、工作概述",
        content: "完成项目A\n推进项目B",  // 段落合并
        paragraphs: ["完成项目A", "推进项目B"],
        children: [                        // 子节点
            {
                level: 2,
                title: "（一）重点项目",
                content: "...",
                paragraphs: [...],
                children: []
            }
        ]
    }
]
```

## 访问方式

### 通过数组索引访问
```javascript
jsons["单位A日报"][0]        // 第一个一级节点
jsons["单位A日报"][0].title   // 第一个节点的标题
jsons["单位A日报"][0].content // 第一个节点的内容
```

### 通过关键词查找
```javascript
const node = findNodeByKeyword(jsons["单位A日报"], "工作概述");
if (node) {
    console.log(node.content);
}
```

### 访问子节点
```javascript
jsons["单位A日报"][0].children[0]  // 第一个节点的第一个子节点
```

## 完整示例

```javascript
// ===== 用户自定义替换规则区域 =====

// 1. 基础信息
module["报告标题"] = "数据治理综合日报";
const firstDocName = Object.keys(jsons)[0];
const meta = gov.parseFilename(firstDocName);
module["报告日期"] = meta.date;

// 2. 统计单位数量
module["单位数量"] = Object.keys(jsons).length;

// 3. 合并工作概述
const overviewParts = [];
for (const [docName, tree] of Object.entries(jsons)) {
    const node = findNodeByKeyword(tree, "工作概述");
    if (node) {
        overviewParts.push(`【${docName}】\n${node.content}`);
    }
}
module["工作概述"] = overviewParts.join('\n\n');

// 4. 合并存在问题
const risksParts = [];
for (const [docName, tree] of Object.entries(jsons)) {
    const node = findNodeByKeyword(tree, ["问题", "风险", "隐患"]);
    if (node) {
        risksParts.push(`【${docName}】\n${node.content}`);
    }
}
module["存在问题"] = risksParts.join('\n\n') || '>暂无';

// 5. 合并下一步计划
const planParts = [];
for (const [docName, tree] of Object.entries(jsons)) {
    const node = findNodeByKeyword(tree, ["计划", "下一步", "后续"]);
    if (node) {
        planParts.push(`【${docName}】\n${node.content}`);
    }
}
module["下一步计划"] = planParts.join('\n\n') || '>暂无';
```

## 注意事项

1. **占位符格式**：模板中的占位符必须使用 `{占位符名称}` 格式
2. **文档名作为 key**：`jsons` 字典的 key 是文件名（不含扩展名）
3. **树状结构**：使用 `buildTree` 转换后，数据按层级组织
4. **空值处理**：建议使用 `|| '默认值'` 处理可能为空的情况
5. **性能考虑**：大文档可能解析较慢，建议限制文档大小

## 与 v11 版本的区别

| 特性 | v11 | v12 |
|------|-----|-----|
| 模板占位符 | 固定字段 | 动态提取 |
| 数据结构 | 扁平数组 | 树状 JSON |
| 替换规则 | 硬编码 | 用户自定义 |
| 灵活性 | 低 | 高 |
| 学习曲线 | 简单 | 中等 |

## 故障排查

### 问题：占位符未被替换
- 检查模板中的占位符格式是否正确
- 确认 `module` 字典中是否有对应的 key

### 问题：JSON 数据为空
- 检查文档格式是否受支持
- 查看 `parseWordStructure` 是否成功解析

### 问题：找不到节点
- 使用 `console.log(JSON.stringify(jsons, null, 2))` 查看完整结构
- 确认关键词是否正确

## 扩展建议

1. **添加更多辅助函数**：如 `mergeNodes()`, `formatList()` 等
2. **支持条件逻辑**：根据内容动态决定是否包含某些部分
3. **表格处理**：扩展支持表格数据的提取和合并
4. **AI 辅助**：使用 `gov.callAI()` 自动生成摘要或提炼要点

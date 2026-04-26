#!/bin/bash

# 测试文本结构化解析 API

echo "测试文本结构化解析 API"
echo "================================"

# 测试公文格式解析
curl -X POST http://localhost:8080/api/data-ontology/gov/parse-text \
  -H "Content-Type: application/json" \
  -d '{
    "text": "一、总则\n\n第一条 为了规范数据管理，特制定本规定。\n\n（一）基本原则\n\n1. 数据安全第一\n2. 效率优先\n\n（二）适用范围\n\n本规定适用于所有部门。\n\n二、具体规定\n\n（一）数据采集\n\n1. 采集原则\n\n（1）合法性原则\n（2）必要性原则\n\n2. 采集方式\n\n① 自动采集\n② 手动录入",
    "format": "official",
    "options": {
      "min_level": 1,
      "max_level": 5,
      "detect_numbering": true,
      "include_content": true
    }
  }' | jq .

echo ""
echo "================================"
echo "测试完成"
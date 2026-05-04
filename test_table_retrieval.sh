#!/bin/bash

# 测试表检索 SQLite FTS5 功能

set -e

echo "=== 构建项目 ==="
export PATH=/usr/local/go/bin:$PATH
go build -tags nogov -o datatoolbox_test .

echo ""
echo "=== 启动服务器（后台运行）==="
./datatoolbox_test -port 18080 &
SERVER_PID=$!
echo "服务器 PID: $SERVER_PID"

# 等待服务器启动
echo "等待服务器启动..."
sleep 3

# 清理函数
cleanup() {
    echo ""
    echo "=== 停止服务器 ==="
    kill $SERVER_PID 2>/dev/null || true
    wait $SERVER_PID 2>/dev/null || true
    rm -f datatoolbox_test
}
trap cleanup EXIT

echo ""
echo "=== 测试表检索状态 API ==="
curl -s http://127.0.0.1:18080/api/data-ontology/table-retrieval/status | jq .

echo ""
echo "=== 测试表检索同步 API（同步所有数据库）==="
curl -s -X POST http://127.0.0.1:18080/api/data-ontology/table-retrieval/sync \
  -H "Content-Type: application/json" \
  -d '{}' | jq .

echo ""
echo "等待同步完成..."
sleep 5

echo ""
echo "=== 再次检查表检索状态 ==="
curl -s http://127.0.0.1:18080/api/data-ontology/table-retrieval/status | jq .

echo ""
echo "=== 测试完成 ==="

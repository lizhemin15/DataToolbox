package main

import (
	"os"
	"path/filepath"
	"testing"
)

func TestInitTableRetrievalDB(t *testing.T) {
	// 创建临时目录
	tmpDir, err := os.MkdirTemp("", "table_retrieval_test")
	if err != nil {
		t.Fatalf("创建临时目录失败: %v", err)
	}
	defer os.RemoveAll(tmpDir)

	dbPath := filepath.Join(tmpDir, "test-retrieval.db")

	// 测试初始化
	manager, err := initTableRetrievalDB(dbPath)
	if err != nil {
		t.Fatalf("初始化数据库失败: %v", err)
	}
	defer manager.close()

	// 验证表存在
	var count int
	err = manager.db.QueryRow("SELECT count(*) FROM sqlite_master WHERE type='table' AND name='tables'").Scan(&count)
	if err != nil {
		t.Fatalf("查询表失败: %v", err)
	}
	if count != 1 {
		t.Errorf("期望 tables 表存在, 得到 count=%d", count)
	}

	// 验证 FTS5 虚拟表存在
	err = manager.db.QueryRow("SELECT count(*) FROM sqlite_master WHERE type='table' AND name='tables_fts'").Scan(&count)
	if err != nil {
		t.Fatalf("查询 FTS5 表失败: %v", err)
	}
	if count != 1 {
		t.Errorf("期望 tables_fts 表存在, 得到 count=%d", count)
	}

	// 验证触发器存在
	err = manager.db.QueryRow("SELECT count(*) FROM sqlite_master WHERE type='trigger' AND name LIKE 'tables_%'").Scan(&count)
	if err != nil {
		t.Fatalf("查询触发器失败: %v", err)
	}
	if count != 3 {
		t.Errorf("期望 3 个触发器, 得到 count=%d", count)
	}
}

func TestFTS5InsertAndSearch(t *testing.T) {
	tmpDir, err := os.MkdirTemp("", "table_retrieval_test")
	if err != nil {
		t.Fatalf("创建临时目录失败: %v", err)
	}
	defer os.RemoveAll(tmpDir)

	dbPath := filepath.Join(tmpDir, "test-retrieval.db")
	manager, err := initTableRetrievalDB(dbPath)
	if err != nil {
		t.Fatalf("初始化数据库失败: %v", err)
	}
	defer manager.close()

	// 插入测试数据
	testData := []struct {
		tableID    string
		databaseID string
		name       string
		comment    string
		colNames   string
	}{
		{"db1:user_info", "db1", "user_info", "用户信息表", "id,name,age,email,phone"},
		{"db1:order_detail", "db1", "order_detail", "订单明细表", "id,order_id,product_name,quantity,price"},
		{"db1:product_category", "db1", "product_category", "产品分类表", "id,category_name,parent_id"},
		{"db2:sys_config", "db2", "sys_config", "系统配置表", "id,config_key,config_value"},
		{"db2:user_role", "db2", "user_role", "用户角色关联表", "id,user_id,role_id"},
	}

	for _, d := range testData {
		_, err := manager.db.Exec(
			"INSERT INTO tables (table_id, database_id, name, comment, column_names, updated_at) VALUES (?, ?, ?, ?, ?, 0)",
			d.tableID, d.databaseID, d.name, d.comment, d.colNames,
		)
		if err != nil {
			t.Fatalf("插入数据失败: %v", err)
		}
	}

	// 测试 FTS5 检索 - 搜索 "user"
	results, err := manager.fts5RetrieveTables("user", "", 10)
	if err != nil {
		t.Fatalf("FTS5 检索失败: %v", err)
	}

	// user 应该匹配 user_info 和 user_role
	if len(results) == 0 {
		t.Error("期望找到结果，但没有找到")
	}
	t.Logf("搜索 'user' 找到 %d 个结果", len(results))
	for _, r := range results {
		t.Logf("  - %s (score: %.4f, reason: %s)", r.TableName, r.RelevanceScore, r.MatchReason)
	}

	// 验证 user_info 或 user_role 在结果中
	foundUserInfo := false
	foundUserRole := false
	for _, r := range results {
		if r.TableName == "user_info" {
			foundUserInfo = true
		}
		if r.TableName == "user_role" {
			foundUserRole = true
		}
	}
	if !foundUserInfo {
		t.Error("期望找到 user_info，但未找到")
	}
	if !foundUserRole {
		t.Error("期望找到 user_role，但未找到")
	}

	// 测试按数据库过滤 - 搜索 "user" 在 db1 中
	results2, err := manager.fts5RetrieveTables("user", "db1", 10)
	if err != nil {
		t.Fatalf("FTS5 检索失败: %v", err)
	}

	// 应该只返回 db1 中的结果（user_info）
	for _, r := range results2 {
		t.Logf("  db1 filter - %s (score: %.4f)", r.TableName, r.RelevanceScore)
	}

	// 测试中文检索（注意：FTS5 unicode61 按字符分词，支持单字匹配）
	results3, err := manager.fts5RetrieveTables("用户", "", 10)
	if err != nil {
		t.Fatalf("FTS5 中文检索失败: %v", err)
	}
	t.Logf("搜索 '用户' 找到 %d 个结果", len(results3))
	for _, r := range results3 {
		t.Logf("  - %s (score: %.4f, reason: %s)", r.TableName, r.RelevanceScore, r.MatchReason)
	}

	// 测试产品相关检索
	results4, err := manager.fts5RetrieveTables("product", "", 10)
	if err != nil {
		t.Fatalf("FTS5 检索失败: %v", err)
	}
	if len(results4) == 0 {
		t.Error("期望找到 product 相关结果，但没有找到")
	}
	t.Logf("搜索 'product' 找到 %d 个结果", len(results4))
	for _, r := range results4 {
		t.Logf("  - %s (score: %.4f, reason: %s)", r.TableName, r.RelevanceScore, r.MatchReason)
	}

	// 验证相关度分数在合理范围内 (0-1)
	for _, r := range results {
		if r.RelevanceScore < 0 || r.RelevanceScore > 1 {
			t.Errorf("相关度分数超出范围: %s = %.4f", r.TableName, r.RelevanceScore)
		}
	}
}

func TestSyncTablesToSQLite(t *testing.T) {
	// 这个测试需要数据库连接，仅测试 SQLite 操作逻辑
	tmpDir, err := os.MkdirTemp("", "table_retrieval_test")
	if err != nil {
		t.Fatalf("创建临时目录失败: %v", err)
	}
	defer os.RemoveAll(tmpDir)

	dbPath := filepath.Join(tmpDir, "test-sync.db")
	manager, err := initTableRetrievalDB(dbPath)
	if err != nil {
		t.Fatalf("初始化数据库失败: %v", err)
	}
	defer manager.close()

	// 直接插入数据测试同步逻辑
	testData := []struct {
		tableID    string
		databaseID string
		name       string
		comment    string
		colNames   string
	}{
		{"testdb1:table_a", "testdb1", "table_a", "表A注释", "id,name,value"},
		{"testdb1:table_b", "testdb1", "table_b", "表B注释", "id,code,desc"},
	}

	for _, d := range testData {
		_, err := manager.db.Exec(
			"INSERT INTO tables (table_id, database_id, name, comment, column_names, updated_at) VALUES (?, ?, ?, ?, ?, 0)",
			d.tableID, d.databaseID, d.name, d.comment, d.colNames,
		)
		if err != nil {
			t.Fatalf("插入数据失败: %v", err)
		}
	}

	// 验证数据已写入
	var count int
	err = manager.db.QueryRow("SELECT count(*) FROM tables WHERE database_id = 'testdb1'").Scan(&count)
	if err != nil {
		t.Fatalf("查询失败: %v", err)
	}
	if count != 2 {
		t.Errorf("期望 2 条记录, 得到 %d 条", count)
	}

	// 验证 FTS5 触发器工作 - 通过 FTS5 查询验证
	results, err := manager.fts5RetrieveTables("table", "testdb1", 10)
	if err != nil {
		t.Fatalf("FTS5 检索失败: %v", err)
	}
	t.Logf("搜索 'table' 在 testdb1 中找到 %d 个结果", len(results))
	for _, r := range results {
		t.Logf("  - %s (score: %.4f)", r.TableName, r.RelevanceScore)
	}
}

func TestSigmoidFunction(t *testing.T) {
	testCases := []struct {
		input    float64
		expected float64
		delta    float64
	}{
		{0, 0.5, 0.01},      // sigmoid(0) = 0.5
		{1, 0.7311, 0.01},   // sigmoid(1) ≈ 0.73
		{5, 0.9933, 0.01},   // sigmoid(5) ≈ 0.99
		{10, 0.9999, 0.001}, // sigmoid(10) ≈ 1.0
		{-1, 0.2689, 0.01},  // sigmoid(-1) ≈ 0.27
	}

	for _, tc := range testCases {
		result := sigmoid(tc.input)
		delta := result - tc.expected
		if delta < 0 {
			delta = -delta
		}
		if delta > tc.delta {
			t.Errorf("sigmoid(%v): 期望 %.4f, 得到 %.4f", tc.input, tc.expected, result)
		}
	}
}

func TestDeleteAndResync(t *testing.T) {
	tmpDir, err := os.MkdirTemp("", "table_retrieval_test")
	if err != nil {
		t.Fatalf("创建临时目录失败: %v", err)
	}
	defer os.RemoveAll(tmpDir)

	dbPath := filepath.Join(tmpDir, "test-resync.db")
	manager, err := initTableRetrievalDB(dbPath)
	if err != nil {
		t.Fatalf("初始化数据库失败: %v", err)
	}
	defer manager.close()

	// 插入数据
	manager.db.Exec(
		"INSERT INTO tables (table_id, database_id, name, comment, column_names, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
		"db1:old_table", "db1", "old_table", "旧表", "id,name", 0,
	)

	// 验证数据存在
	var count int
	manager.db.QueryRow("SELECT count(*) FROM tables WHERE database_id = 'db1'").Scan(&count)
	if count != 1 {
		t.Errorf("期望 1 条记录, 得到 %d 条", count)
	}

	// 删除并重新插入
	manager.db.Exec("DELETE FROM tables WHERE database_id = 'db1'")
	manager.db.Exec(
		"INSERT INTO tables (table_id, database_id, name, comment, column_names, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
		"db1:new_table", "db1", "new_table", "新表", "id,name,value", 1,
	)

	// 验证新数据
	manager.db.QueryRow("SELECT count(*) FROM tables WHERE database_id = 'db1'").Scan(&count)
	if count != 1 {
		t.Errorf("期望 1 条记录, 得到 %d 条", count)
	}

	// 验证 FTS5 查询
	results, err := manager.fts5RetrieveTables("new", "db1", 10)
	if err != nil {
		t.Fatalf("FTS5 检索失败: %v", err)
	}

	if len(results) == 0 {
		t.Error("期望找到 new_table，但没有找到")
	} else if results[0].TableName != "new_table" {
		t.Errorf("期望 new_table, 得到 %s", results[0].TableName)
	}
}
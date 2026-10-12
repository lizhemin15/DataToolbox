package main

import (
	"context"
	"database/sql"
	"fmt"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// ---------------------------------------------------------------------------
// ① 审核结果顺序 = 结构树顺序（XH）
// ---------------------------------------------------------------------------

// 乱序结果（并发完成次序）排完必须回到结构树顺序；同一 XH 按 NM 定序。
func TestQASortResultRowsByXHFollowsStructureTreeOrder(t *testing.T) {
	rows := []map[string]interface{}{
		{"nm": "030200", "xh": "0302"},
		{"nm": "010000", "xh": "01"},
		{"nm": "020100", "xh": "0201"},
		{"nm": "010200", "xh": "0102"},
		{"nm": "020000", "xh": "02"},
		{"nm": "010100", "xh": "0101"},
		{"nm": "030100", "xh": "0301"},
		{"nm": "030000", "xh": "03"},
	}
	qaSortResultRowsByXH(rows)
	want := []string{"01", "0101", "0102", "02", "0201", "03", "0301", "0302"}
	got := make([]string, 0, len(rows))
	for _, r := range rows {
		got = append(got, r["xh"].(string))
	}
	if strings.Join(got, ",") != strings.Join(want, ",") {
		t.Errorf("结果顺序与结构树不一致\n got: %v\nwant: %v", got, want)
	}

	// 同一 XH：按 NM 定序（历史脏数据里 XH 重复过，顺序不能随并发抖动）
	dup := []map[string]interface{}{
		{"nm": "020000", "xh": "02"},
		{"nm": "010000", "xh": "02"},
	}
	qaSortResultRowsByXH(dup)
	if dup[0]["nm"] != "010000" || dup[1]["nm"] != "020000" {
		t.Errorf("同 XH 未按 NM 定序: %v, %v", dup[0]["nm"], dup[1]["nm"])
	}
}

// 排序必须和结构树用同一把尺子：结构树的顺序来自库里的 ORDER BY XH（XH 是 TEXT）。
// 这个用例把两边摆一起比 —— 如果谁把排序换成「更聪明」的按层切段序，
// 非补零的 XH 上两边就会分叉，用例变红。
func TestQASortResultRowsByXHMatchesSQLOrderByXH(t *testing.T) {
	dir := t.TempDir()
	meta, err := sql.Open("sqlite", filepath.Join(dir, "meta.db"))
	if err != nil {
		t.Fatalf("打开元数据库失败: %v", err)
	}
	defer meta.Close()
	if _, err := meta.Exec(`CREATE TABLE rules (NM TEXT PRIMARY KEY, XH TEXT NOT NULL, NAME TEXT)`); err != nil {
		t.Fatalf("建表失败: %v", err)
	}
	// 混入非补零 / 空 XH：这些正是「聪明排序」会走偏的地方
	xhs := []string{"01", "0101", "0102", "02", "0201", "03", "1", "10", "102", "2", ""}
	for i, xh := range xhs {
		if _, err := meta.Exec(`INSERT INTO rules (NM, XH, NAME) VALUES (?,?,?)`,
			fmt.Sprintf("%06d", 900000+i), xh, "规则"+xh); err != nil {
			t.Fatalf("插入失败: %v", err)
		}
	}

	// 结构树顺序 = 库里 ORDER BY XH（loadRulesFlat / buildRuleTree 用的就是这个序）
	treeRows, err := meta.Query(`SELECT XH FROM rules ORDER BY XH`)
	if err != nil {
		t.Fatalf("查询结构树顺序失败: %v", err)
	}
	defer treeRows.Close()
	var want []string
	for treeRows.Next() {
		var xh string
		if err := treeRows.Scan(&xh); err != nil {
			t.Fatalf("scan 失败: %v", err)
		}
		want = append(want, xh)
	}

	// 审核结果按反序喂进去，模拟「并发谁先跑完谁先进」的最坏情况
	got := make([]map[string]interface{}, 0, len(xhs))
	for i := len(xhs) - 1; i >= 0; i-- {
		got = append(got, map[string]interface{}{
			"nm": fmt.Sprintf("%06d", 900000+i),
			"xh": xhs[i],
		})
	}
	qaSortResultRowsByXH(got)
	var gotXH []string
	for _, r := range got {
		gotXH = append(gotXH, r["xh"].(string))
	}
	if strings.Join(gotXH, "|") != strings.Join(want, "|") {
		t.Errorf("审核结果顺序与结构树（ORDER BY XH）不一致\n got: %q\nwant: %q", gotXH, want)
	}
}

// 端到端：并发跑完的结果，从 qaExecuteRules 出来就已经是结构树顺序。
// 故意让 XH 最小的那条规则 SQL 变慢（其余秒回），所以「不排序」时它必然排在最后 ——
// 这个用例就是那条回归防线。
func TestQAExecuteRulesReturnsResultsInStructureTreeOrder(t *testing.T) {
	t.Setenv("DT_QA_RULE_TIMEOUT_SEC", "120") // 慢规则是故意的，别让它被超时打断
	t.Setenv("DT_QA_RULE_RETRIES", "0")

	// 慢规则的 SQL 故意写成「一条汇总行」：既强制把递归 CTE 全跑一遍（够慢），
	// 又只吐 1 行结果（不撑爆样例数据）。被测的是「完成次序 ≠ XH 次序」。
	slowSQL := fmt.Sprintf(
		`WITH RECURSIVE c(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM c WHERE x < %d) SELECT count(*) AS N FROM c`,
		qaOrderTestSlowN)
	fastSQL := `SELECT * FROM T_ORDER WHERE 1 = 0`

	// XH 故意做成结构树里的顺序：9101 → 9102 → 92 → 9201 → 93
	rules := []struct{ nm, xh, name, sql string }{
		{"990101", "9101", "慢查询规则", slowSQL},
		{"990102", "9102", "快查询规则A", fastSQL},
		{"990200", "92", "分类节点", fastSQL},
		{"990201", "9201", "快查询规则B", fastSQL},
		{"990300", "93", "快查询规则C", fastSQL},
	}
	seedQATestRules(t, rules)

	target := newSQLiteTargetDB(t, `CREATE TABLE T_ORDER (ORDER_ID TEXT)`, "")
	// 传参顺序故意倒着给（最低 XH 放最后），更接近并发场景的真实抖动
	nms := []string{"990300", "990201", "990200", "990102", "990101"}

	var retryMsgs []string
	t0 := time.Now()
	rows, passed, failed, err := qaExecuteRules(context.Background(), "db-order-test", target, "sqlite",
		nms, "tester", t0, nil, func(msg string) { retryMsgs = append(retryMsgs, msg) })
	if err != nil {
		t.Fatalf("执行失败: %v", err)
	}
	if len(retryMsgs) != 0 {
		t.Errorf("不该发生重试（超时阈值已放宽到 120 秒），实际收到: %v", retryMsgs)
	}
	if len(rows) != len(rules) {
		t.Fatalf("结果条数应为 %d，实际 %d", len(rules), len(rows))
	}
	var got []string
	for _, r := range rows {
		got = append(got, r["xh"].(string))
	}
	want := []string{"9101", "9102", "92", "9201", "93"}
	if strings.Join(got, ",") != strings.Join(want, ",") {
		t.Errorf("qaExecuteRules 返回顺序不是结构树顺序\n got: %v\nwant: %v\n（慢规则排在最后 = 没排序）", got, want)
	}
	if passed+failed != len(rules) {
		t.Errorf("通过/不通过计数不对：passed=%d failed=%d", passed, failed)
	}
	for _, r := range rows {
		if _, ok := r["xh"]; !ok {
			t.Errorf("结果缺少 xh 字段，界面无法按结构树对齐: %v", r["nm"])
		}
	}
}

// 慢查询的递归轮数：够慢（＞0.2s）但不会拖垮测试。
const qaOrderTestSlowN = 3000000

// seedQATestRules 往（测试二进制旁边的）审核元数据库里塞规则，跑完删掉。
func seedQATestRules(t *testing.T, rules []struct{ nm, xh, name, sql string }) {
	t.Helper()
	db, err := openQualityAuditDB()
	if err != nil {
		t.Fatalf("打开审核元数据库失败: %v", err)
	}
	for _, r := range rules {
		if _, err := db.Exec(
			`INSERT OR REPLACE INTO rules (NM, XH, NAME, SQL, CATEGORY, PARAMS, AI_REVIEW_PROMPT, UPDATED_AT)
			 VALUES (?,?,?,?,?,?,?,?)`,
			r.nm, r.xh, r.name, r.sql, "测试", "", "", time.Now().Format(time.RFC3339)); err != nil {
			t.Fatalf("插入规则 %s 失败: %v", r.nm, err)
		}
	}
	t.Cleanup(func() {
		for _, r := range rules {
			_, _ = db.Exec(`DELETE FROM rules WHERE NM = ?`, r.nm)
			_, _ = db.Exec(`DELETE FROM audit_errors WHERE rule_nm = ?`, r.nm)
		}
	})
}

// ---------------------------------------------------------------------------
// ② 单条规则 context deadline exceeded → 重试
// ---------------------------------------------------------------------------

// 超时必须重试：3 次尝试（首次 + 2 次重试），阈值逐次放宽，重试过程要回调出去。
func TestExecuteRuleQueryRetryRetriesOnTimeout(t *testing.T) {
	t.Setenv("DT_QA_RULE_TIMEOUT_SEC", "1")
	t.Setenv("DT_QA_RULE_RETRIES", "2")

	db, err := sql.Open("sqlite", filepath.Join(t.TempDir(), "slow.db"))
	if err != nil {
		t.Fatalf("打开库失败: %v", err)
	}
	defer db.Close()

	// 永远跑不完的查询：每次尝试都只能被超时打断
	heavy := `WITH RECURSIVE c(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM c WHERE x < 100000000) SELECT count(*) FROM c`

	var attempts []int
	var nexts []time.Duration
	start := time.Now()
	_, _, retried, err := executeRuleQueryRetry(context.Background(), db, heavy, func(attempt int, next time.Duration) {
		attempts = append(attempts, attempt)
		nexts = append(nexts, next)
	})
	elapsed := time.Since(start)

	if err == nil {
		t.Fatal("查询跑不完，必须报超时错误")
	}
	if !qaIsQueryTimeout(err) {
		t.Errorf("错误应被识别为超时（便于上层决定重试）: %v", err)
	}
	if retried != 2 {
		t.Errorf("应重试 2 次，实际 %d", retried)
	}
	if len(attempts) != 2 || attempts[0] != 1 || attempts[1] != 2 {
		t.Errorf("重试回调次数/序号不对: %v", attempts)
	}
	if len(nexts) != 2 || nexts[0] != 2*time.Second || nexts[1] != 4*time.Second {
		t.Errorf("超时阈值未逐次放宽，实际 %v", nexts)
	}
	// 1 + 2 + 4 秒的执行 + 两次退避 2 秒 = 约 11 秒；给足余量，只防「秒回 = 没真重试」
	if elapsed < 10*time.Second {
		t.Errorf("总耗时 %v 太短，看起来并没有真的重跑三次", elapsed)
	}
	if note := qaRetryNote(retried, false); !strings.Contains(note, "已重试 2 次") {
		t.Errorf("重试文案不对: %s", note)
	}
}

// 只对超时重试：语法/权限这类错误重试多少次都一样，必须立刻返回（不能白等）。
func TestExecuteRuleQueryRetryDoesNotRetryNonTimeoutErrors(t *testing.T) {
	t.Setenv("DT_QA_RULE_TIMEOUT_SEC", "1")
	t.Setenv("DT_QA_RULE_RETRIES", "3")

	db, err := sql.Open("sqlite", filepath.Join(t.TempDir(), "bad.db"))
	if err != nil {
		t.Fatalf("打开库失败: %v", err)
	}
	defer db.Close()

	called := 0
	start := time.Now()
	_, _, retried, err := executeRuleQueryRetry(context.Background(), db, `SELECT * FROM no_such_table_xyz`, func(int, time.Duration) {
		called++
	})
	elapsed := time.Since(start)

	if err == nil {
		t.Fatal("表不存在，必须报错")
	}
	if qaIsQueryTimeout(err) {
		t.Errorf("这不是超时错误，不该被误判: %v", err)
	}
	if retried != 0 || called != 0 {
		t.Errorf("非超时错误不该重试：retried=%d 回调=%d", retried, called)
	}
	if elapsed > 900*time.Millisecond {
		t.Errorf("非超时错误应立刻返回，实际耗时 %v（像是白等了一次超时）", elapsed)
	}
}

// 父上下文已结束（用户点了取消 / 整轮超时）：绝不能再重试，
// 否则「已取消的任务」还会在后台继续打数据库。
func TestExecuteRuleQueryRetryStopsWhenParentCanceled(t *testing.T) {
	t.Setenv("DT_QA_RULE_TIMEOUT_SEC", "1")
	t.Setenv("DT_QA_RULE_RETRIES", "2")

	db, err := sql.Open("sqlite", filepath.Join(t.TempDir(), "cancel.db"))
	if err != nil {
		t.Fatalf("打开库失败: %v", err)
	}
	defer db.Close()

	parent, cancel := context.WithCancel(context.Background())
	cancel()

	called := 0
	start := time.Now()
	_, _, retried, err := executeRuleQueryRetry(parent, db, `WITH RECURSIVE c(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM c WHERE x < 100000000) SELECT count(*) FROM c`, func(int, time.Duration) {
		called++
	})
	elapsed := time.Since(start)

	if err == nil {
		t.Fatal("上下文已取消，必须报错")
	}
	if retried != 0 || called != 0 {
		t.Errorf("父上下文已结束不该重试：retried=%d 回调=%d", retried, called)
	}
	if elapsed > time.Second {
		t.Errorf("已取消时应立刻返回，实际 %v", elapsed)
	}
}

// 阈值放宽策略：base、2×base、4×base 封顶，别把单条规则拖成半小时。
func TestQARetryTimeoutEscalation(t *testing.T) {
	base := 30 * time.Second
	cases := []struct {
		attempt int
		want    time.Duration
	}{
		{0, 30 * time.Second},
		{1, 60 * time.Second},
		{2, 120 * time.Second},
		{3, 120 * time.Second},
		{9, 120 * time.Second},
	}
	for _, c := range cases {
		if got := qaRetryTimeout(base, c.attempt); got != c.want {
			t.Errorf("第 %d 次超时阈值应为 %v，实际 %v", c.attempt, c.want, got)
		}
	}
}

// 超时判定：包装过的、只剩字符串的都要认出来（驱动/方言不同，错误形态不一样）；
// 别的错误一律不认，否则会变成「什么都重试」。
func TestQAIsQueryTimeout(t *testing.T) {
	cases := []struct {
		name string
		err  error
		want bool
	}{
		{"nil", nil, false},
		{"裸 deadline", context.DeadlineExceeded, true},
		{"包装 deadline", fmt.Errorf("执行规则超时: %w", context.DeadlineExceeded), true},
		{"只剩文案", fmt.Errorf("context deadline exceeded"), true},
		{"cancel 不算超时", context.Canceled, false},
		{"语法错误", fmt.Errorf("no such table: T_X"), false},
	}
	for _, c := range cases {
		if got := qaIsQueryTimeout(c.err); got != c.want {
			t.Errorf("%s: qaIsQueryTimeout=%v，期望 %v", c.name, got, c.want)
		}
	}
}

// 重试次数支持显式配 0（=只跑一次，不重试）。
// 这条守的是「别把这个开关当成 qaEnvMS 那种 0 即默认值的解析器」——
// 0 必须是「关掉重试」，而不是被悄悄换回默认的 2。
func TestQARuleRetryTimesAllowsExplicitZero(t *testing.T) {
	t.Setenv("DT_QA_RULE_RETRIES", "0")
	if got := qaRuleRetryTimes(); got != 0 {
		t.Errorf("配 0 应等于不重试，实际 %d", got)
	}
	t.Setenv("DT_QA_RULE_RETRIES", "")
	if got := qaRuleRetryTimes(); got != qaRuleRetryDefault {
		t.Errorf("未配置应取默认值 %d，实际 %d", qaRuleRetryDefault, got)
	}
	t.Setenv("DT_QA_RULE_RETRIES", "-1")
	if got := qaRuleRetryTimes(); got != qaRuleRetryDefault {
		t.Errorf("负数应回落到默认值 %d，实际 %d", qaRuleRetryDefault, got)
	}
}

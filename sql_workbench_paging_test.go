package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// ---------------------------------------------------------------------------
// SQL 工作台分页 —— 防止「一次拉全表把服务拖垮」回归
//
// 为什么这些断言必须存在：分页是「跳过前 N 行、只物化一页」的写法，
// 行号算错不会报错，只会**静默返回错误的数据切片**（比如第 2 页返回第 1 页的内容，
// 或者中间少了几十行）。这种 bug 用户极难发现，所以必须逐行钉死。
// ---------------------------------------------------------------------------

// 注册一个 sqlite 目标库到连接池，返回 config。
// getDBFromPool 会优先用池里已有的连接（Ping 成功即返回），所以直接塞进去即可。
func registerSQLiteDBForTest(t *testing.T, ddl, seed string) *DatabaseConfig {
	t.Helper()
	dir := t.TempDir()
	path := filepath.Join(dir, "wb.db")
	db, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatalf("打开 sqlite 失败: %v", err)
	}
	if _, err := db.Exec(ddl); err != nil {
		t.Fatalf("建表失败: %v", err)
	}
	if seed != "" {
		if _, err := db.Exec(seed); err != nil {
			t.Fatalf("写入数据失败: %v", err)
		}
	}
	t.Cleanup(func() { _ = db.Close() })

	id := "test-wb-" + filepath.Base(dir)
	dbPool.Lock()
	dbPool.connections[id] = db
	dbPool.Unlock()
	t.Cleanup(func() {
		dbPool.Lock()
		delete(dbPool.connections, id)
		dbPool.Unlock()
	})

	return &DatabaseConfig{ID: id, Name: "wb", Type: "sqlite", Path: path}
}

type sqlWBResponse struct {
	Success  bool                     `json:"success"`
	Columns  []string                 `json:"columns"`
	Data     []map[string]interface{} `json:"data"`
	Count    int                      `json:"count"`
	Page     int                      `json:"page"`
	PageSize int                      `json:"page_size"`
	HasMore  bool                     `json:"has_more"`
	HasPrev  bool                     `json:"has_prev"`
	Paged    bool                     `json:"paged"`
	Warning  string                   `json:"warning"`
	Message  string                   `json:"message"`
}

// callSQLWorkbench 走真实的 handler（含 JSON 解码、分页归一化、扫描循环），
// 不做任何替身 —— 单测直接打生产路径才拦得住回归。
func callSQLWorkbench(t *testing.T, config *DatabaseConfig, body string, ctx context.Context) (*httptest.ResponseRecorder, sqlWBResponse) {
	t.Helper()
	req := httptest.NewRequest(http.MethodPost, "/api/v1/databases/x/sql", strings.NewReader(body))
	if ctx != nil {
		req = req.WithContext(ctx)
	}
	rec := httptest.NewRecorder()
	handleDatabaseSQL(rec, req, config)
	var out sqlWBResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil {
		t.Fatalf("响应不是合法 JSON: %v\n原文: %s", err, rec.Body.String())
	}
	return rec, out
}

// 250 行：100 + 100 + 50，三页刚好卡在「整除」与「不整除」的边界上。
const wbSeed250 = `INSERT INTO T_N (ID, NAME) VALUES ` +
	`(1,'n1'),(2,'n2'),(3,'n3'),(4,'n4'),(5,'n5'),(6,'n6'),(7,'n7'),(8,'n8'),(9,'n9'),(10,'n10'),` +
	`(11,'n11'),(12,'n12'),(13,'n13'),(14,'n14'),(15,'n15'),(16,'n16'),(17,'n17'),(18,'n18'),(19,'n19'),(20,'n20'),` +
	`(21,'n21'),(22,'n22'),(23,'n23'),(24,'n24'),(25,'n25'),(26,'n26'),(27,'n27'),(28,'n28'),(29,'n29'),(30,'n30'),` +
	`(31,'n31'),(32,'n32'),(33,'n33'),(34,'n34'),(35,'n35'),(36,'n36'),(37,'n37'),(38,'n38'),(39,'n39'),(40,'n40'),` +
	`(41,'n41'),(42,'n42'),(43,'n43'),(44,'n44'),(45,'n45'),(46,'n46'),(47,'n47'),(48,'n48'),(49,'n49'),(50,'n50'),` +
	`(51,'n51'),(52,'n52'),(53,'n53'),(54,'n54'),(55,'n55'),(56,'n56'),(57,'n57'),(58,'n58'),(59,'n59'),(60,'n60'),` +
	`(61,'n61'),(62,'n62'),(63,'n63'),(64,'n64'),(65,'n65'),(66,'n66'),(67,'n67'),(68,'n68'),(69,'n69'),(70,'n70'),` +
	`(71,'n71'),(72,'n72'),(73,'n73'),(74,'n74'),(75,'n75'),(76,'n76'),(77,'n77'),(78,'n78'),(79,'n79'),(80,'n80'),` +
	`(81,'n81'),(82,'n82'),(83,'n83'),(84,'n84'),(85,'n85'),(86,'n86'),(87,'n87'),(88,'n88'),(89,'n89'),(90,'n90'),` +
	`(91,'n91'),(92,'n92'),(93,'n93'),(94,'n94'),(95,'n95'),(96,'n96'),(97,'n97'),(98,'n98'),(99,'n99'),(100,'n100'),` +
	`(101,'n101'),(102,'n102'),(103,'n103'),(104,'n104'),(105,'n105'),(106,'n106'),(107,'n107'),(108,'n108'),(109,'n109'),(110,'n110'),` +
	`(111,'n111'),(112,'n112'),(113,'n113'),(114,'n114'),(115,'n115'),(116,'n116'),(117,'n117'),(118,'n118'),(119,'n119'),(120,'n120'),` +
	`(121,'n121'),(122,'n122'),(123,'n123'),(124,'n124'),(125,'n125'),(126,'n126'),(127,'n127'),(128,'n128'),(129,'n129'),(130,'n130'),` +
	`(131,'n131'),(132,'n132'),(133,'n133'),(134,'n134'),(135,'n135'),(136,'n136'),(137,'n137'),(138,'n138'),(139,'n139'),(140,'n140'),` +
	`(141,'n141'),(142,'n142'),(143,'n143'),(144,'n144'),(145,'n145'),(146,'n146'),(147,'n147'),(148,'n148'),(149,'n149'),(150,'n150'),` +
	`(151,'n151'),(152,'n152'),(153,'n153'),(154,'n154'),(155,'n155'),(156,'n156'),(157,'n157'),(158,'n158'),(159,'n159'),(160,'n160'),` +
	`(161,'n161'),(162,'n162'),(163,'n163'),(164,'n164'),(165,'n165'),(166,'n166'),(167,'n167'),(168,'n168'),(169,'n169'),(170,'n170'),` +
	`(171,'n171'),(172,'n172'),(173,'n173'),(174,'n174'),(175,'n175'),(176,'n176'),(177,'n177'),(178,'n178'),(179,'n179'),(180,'n180'),` +
	`(181,'n181'),(182,'n182'),(183,'n183'),(184,'n184'),(185,'n185'),(186,'n186'),(187,'n187'),(188,'n188'),(189,'n189'),(190,'n190'),` +
	`(191,'n191'),(192,'n192'),(193,'n193'),(194,'n194'),(195,'n195'),(196,'n196'),(197,'n197'),(198,'n198'),(199,'n199'),(200,'n200'),` +
	`(201,'n201'),(202,'n202'),(203,'n203'),(204,'n204'),(205,'n205'),(206,'n206'),(207,'n207'),(208,'n208'),(209,'n209'),(210,'n210'),` +
	`(211,'n211'),(212,'n212'),(213,'n213'),(214,'n214'),(215,'n215'),(216,'n216'),(217,'n217'),(218,'n218'),(219,'n219'),(220,'n220'),` +
	`(221,'n221'),(222,'n222'),(223,'n223'),(224,'n224'),(225,'n225'),(226,'n226'),(227,'n227'),(228,'n228'),(229,'n229'),(230,'n230'),` +
	`(231,'n231'),(232,'n232'),(233,'n233'),(234,'n234'),(235,'n235'),(236,'n236'),(237,'n237'),(238,'n238'),(239,'n239'),(240,'n240'),` +
	`(241,'n241'),(242,'n242'),(243,'n243'),(244,'n244'),(245,'n245'),(246,'n246'),(247,'n247'),(248,'n248'),(249,'n249'),(250,'n250')`

func TestSQLWorkbenchPagingDefaultAndCaps(t *testing.T) {
	// 纯函数：所有非法输入都必须收敛到合法区间，否则 (page-1)*pageSize 会溢出或一次拉爆内存
	cases := []struct {
		name                   string
		page, pageSize         int
		wantPage, wantPageSize int
	}{
		{"都缺省 → 第 1 页 / 100 条", 0, 0, 1, 100},
		{"页码给 0 → 收敛到 1", 0, 50, 1, 50},
		{"页码给负数 → 收敛到 1", -7, 50, 1, 50},
		{"每页超上限 → 截到 1000", 1, 999999, 1, 1000},
		{"每页负数 → 回到默认 100", 1, -5, 1, 100},
		{"页码极大 → 不溢出成负数", 1 << 30, 100, 1<<31/100 + 1, 100},
	}
	for _, c := range cases {
		gotPage, gotSize := sqlWorkbenchPaging(c.page, c.pageSize)
		if gotPage != c.wantPage || gotSize != c.wantPageSize {
			t.Errorf("%s: sqlWorkbenchPaging(%d,%d) = (%d,%d)，期望 (%d,%d)",
				c.name, c.page, c.pageSize, gotPage, gotSize, c.wantPage, c.wantPageSize)
		}
		if gotSize <= 0 || gotSize > sqlWorkbenchMaxPageSize {
			t.Errorf("%s: 每页条数 %d 越界", c.name, gotSize)
		}
		if gotPage <= 1<<31/gotSize {
			// 只要求不溢出：skip 必须是正数或 0
			if skip := (gotPage - 1) * gotSize; skip < 0 {
				t.Errorf("%s: skip 溢出为负数 %d", c.name, skip)
			}
		}
	}
}

// 核心回归：三页数据必须首尾相接、不重不漏。
func TestSQLWorkbenchPagingSlicesRowsNoOverlapNoGap(t *testing.T) {
	config := registerSQLiteDBForTest(t,
		`CREATE TABLE T_N (ID INTEGER, NAME TEXT)`, wbSeed250)

	type want struct {
		page    int
		count   int
		firstID string
		lastID  string
		hasMore bool
		hasPrev bool
	}
	wants := []want{
		{1, 100, "n1", "n100", true, false},
		{2, 100, "n101", "n200", true, true},
		{3, 50, "n201", "n250", false, true},
	}

	seen := map[string]bool{}
	total := 0
	for _, w := range wants {
		body := fmt.Sprintf(`{"sql":"SELECT ID, NAME FROM T_N ORDER BY ID","page":%d,"page_size":100}`, w.page)
		_, resp := callSQLWorkbench(t, config, body, nil)

		if !resp.Success {
			t.Fatalf("第 %d 页执行失败: %s", w.page, resp.Message)
		}
		if resp.Page != w.page {
			t.Errorf("第 %d 页: 返回 page=%d", w.page, resp.Page)
		}
		if resp.PageSize != 100 {
			t.Errorf("第 %d 页: 返回 page_size=%d，期望 100", w.page, resp.PageSize)
		}
		if resp.Count != w.count || len(resp.Data) != w.count {
			t.Fatalf("第 %d 页: 拿到 %d 行（count=%d），期望 %d 行 —— 分页行数算错，用户会看不到数据",
				w.page, len(resp.Data), resp.Count, w.count)
		}
		if resp.HasMore != w.hasMore {
			t.Errorf("第 %d 页: has_more=%v，期望 %v", w.page, resp.HasMore, w.hasMore)
		}
		if resp.HasPrev != w.hasPrev {
			t.Errorf("第 %d 页: has_prev=%v，期望 %v", w.page, resp.HasPrev, w.hasPrev)
		}
		if !resp.Paged {
			t.Errorf("第 %d 页: paged 标记缺失，前端不会显示分页条", w.page)
		}

		first := fmt.Sprint(resp.Data[0]["NAME"])
		last := fmt.Sprint(resp.Data[len(resp.Data)-1]["NAME"])
		if first != w.firstID || last != w.lastID {
			t.Errorf("第 %d 页: 数据切片是 %s..%s，期望 %s..%s —— 跳行偏移错了",
				w.page, first, last, w.firstID, w.lastID)
		}

		// 逐行查重：分页最常见的坑就是页与页之间有重叠（同一行出现两次）
		for _, row := range resp.Data {
			id := fmt.Sprint(row["NAME"])
			if seen[id] {
				t.Errorf("第 %d 页: %s 重复出现（页间重叠）", w.page, id)
			}
			seen[id] = true
		}
		total += len(resp.Data)
	}

	if total != 250 {
		t.Errorf("三页合计 %d 行，期望 250（有漏行）", total)
	}
	if len(seen) != 250 {
		t.Errorf("去重后 %d 行，期望 250", len(seen))
	}
}

// 默认（不传 page/page_size）也必须分页，否则「默认自动分页」这个需求根本没生效。
func TestSQLWorkbenchDefaultsToPagedWithoutParams(t *testing.T) {
	config := registerSQLiteDBForTest(t,
		`CREATE TABLE T_N (ID INTEGER, NAME TEXT)`, wbSeed250)

	_, resp := callSQLWorkbench(t, config, `{"sql":"SELECT ID, NAME FROM T_N ORDER BY ID"}`, nil)
	if !resp.Success {
		t.Fatalf("执行失败: %s", resp.Message)
	}
	if len(resp.Data) != sqlWorkbenchDefaultPageSize {
		t.Fatalf("不传参数时拿到 %d 行，期望默认 %d 行 —— 说明默认分页没生效，大表还是会被一次性拉全",
			len(resp.Data), sqlWorkbenchDefaultPageSize)
	}
	if !resp.HasMore {
		t.Error("250 行的表第一页应当 has_more=true（还有第 2 页）")
	}
}

// 越界页：不能报错、不能返回错数据，就是干净的空页。
func TestSQLWorkbenchOutOfRangePageReturnsEmpty(t *testing.T) {
	config := registerSQLiteDBForTest(t,
		`CREATE TABLE T_N (ID INTEGER, NAME TEXT)`, wbSeed250)

	_, resp := callSQLWorkbench(t, config, `{"sql":"SELECT ID, NAME FROM T_N","page":99,"page_size":100}`, nil)
	if !resp.Success {
		t.Fatalf("越界页不该报错，却失败了: %s", resp.Message)
	}
	if len(resp.Data) != 0 {
		t.Errorf("越界页返回了 %d 行，期望 0", len(resp.Data))
	}
	if resp.HasMore {
		t.Error("越界页 has_more 应为 false")
	}
	if !resp.HasPrev {
		t.Error("第 99 页 has_prev 应为 true")
	}
}

// 非查询语句不该带分页条（前端靠 paged 字段判断），避免 INSERT 也弹一条分页 UI。
func TestSQLWorkbenchNonQueryHasNoPagerFlag(t *testing.T) {
	config := registerSQLiteDBForTest(t, `CREATE TABLE T_N (ID INTEGER, NAME TEXT)`, "")

	_, resp := callSQLWorkbench(t, config, `{"sql":"INSERT INTO T_N (ID, NAME) VALUES (1,'a')"}`, nil)
	if !resp.Success {
		t.Fatalf("INSERT 失败: %s", resp.Message)
	}
	if resp.Paged {
		t.Error("非查询语句不应返回 paged=true（前端会显示无意义的分页条）")
	}
}

// 取消：请求 ctx 被取消时，不能挂着跑到超时，要说人话。
func TestSQLWorkbenchCanceledContextIsReported(t *testing.T) {
	config := registerSQLiteDBForTest(t,
		`CREATE TABLE T_N (ID INTEGER, NAME TEXT)`, wbSeed250)

	ctx, cancel := context.WithCancel(context.Background())
	cancel() // 已经取消

	_, resp := callSQLWorkbench(t, config, `{"sql":"SELECT ID, NAME FROM T_N"}`, ctx)
	if resp.Success {
		t.Fatal("请求 ctx 已取消，不该返回 success")
	}
	if !strings.Contains(resp.Message, "取消") {
		t.Errorf("取消场景的提示是 %q，期望含「取消」字样，用户才知道是自己点的/页面关了", resp.Message)
	}
}

// 超时/取消的错误文案必须翻成人话，不能把 driver 的英文原样甩给用户。
func TestSQLWorkbenchErrMsgsAreHumanReadable(t *testing.T) {
	timeout := 60 * time.Second
	if got := sqlWorkbenchQueryErrMsg(context.DeadlineExceeded, timeout); !strings.Contains(got, "超时") {
		t.Errorf("DeadlineExceeded 文案 = %q，期望说明是超时并给出建议", got)
	}
	if got := sqlWorkbenchQueryErrMsg(context.Canceled, timeout); got != "查询已取消" {
		t.Errorf("Canceled 文案 = %q", got)
	}
	if got := sqlWorkbenchQueryErrMsg(errors.New("db down"), timeout); !strings.Contains(got, "db down") {
		t.Errorf("其它错误的文案应保留原始信息，实际 %q", got)
	}
	if got := sqlWorkbenchQueryErrMsg(nil, timeout); got != "" {
		t.Errorf("nil 错误应返回空串，实际 %q", got)
	}
}

// 超时值可用环境变量覆盖（内网慢库现场要能调，不能改代码）
func TestSQLWorkbenchTimeoutEnvOverride(t *testing.T) {
	if got := sqlWorkbenchTimeout(); got != sqlWorkbenchDefaultTimeout {
		t.Errorf("默认超时 = %v，期望 %v", got, sqlWorkbenchDefaultTimeout)
	}
	t.Setenv("DTB_SQL_TIMEOUT_SEC", "7")
	if got := sqlWorkbenchTimeout(); got != 7*time.Second {
		t.Errorf("环境变量覆盖后 = %v，期望 7s", got)
	}
	t.Setenv("DTB_SQL_TIMEOUT_SEC", "abc")
	if got := sqlWorkbenchTimeout(); got != sqlWorkbenchDefaultTimeout {
		t.Errorf("非法环境变量应回退默认值，实际 %v", got)
	}
}

// 每页条数也支持环境变量覆盖
func TestSQLWorkbenchPageSizeEnvOverride(t *testing.T) {
	t.Setenv("DTB_SQL_PAGE_SIZE", "37")
	page, size := sqlWorkbenchPaging(0, 0)
	if size != 37 {
		t.Errorf("环境变量覆盖后每页 = %d，期望 37", size)
	}
	if page != 1 {
		t.Errorf("缺省页码应为 1，实际 %d", page)
	}
}

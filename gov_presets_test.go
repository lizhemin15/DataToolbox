package main

import "testing"

// 内置示例（预置任务）定义必须包含两个「公文Word转Excel」，否则全新安装看不到它们。
func TestGovernancePresetDefinitionsIncludeDocxToExcel(t *testing.T) {
	defs := governancePresetDefinitions()
	for _, name := range []string{"公文Word转Excel（正则抽取）", "公文Word转Excel（AI抽取）"} {
		d, ok := defs[name]
		if !ok {
			t.Fatalf("预置定义里缺少 %s", name)
		}
		if len(d.ExampleFiles) == 0 {
			t.Errorf("%s 没有配样例文件", name)
		}
		if d.RunMode != "frontend" || d.ExecutionMode != "frontend" {
			t.Errorf("%s 应为前端执行模式，实际 run=%q exec=%q", name, d.RunMode, d.ExecutionMode)
		}
		if d.InputType != "file" {
			t.Errorf("%s 输入类型应为 file，实际 %q", name, d.InputType)
		}
	}
}

// 全新安装：硬编码的 7 个示例之外，新增的内置示例要能被补齐（且幂等、不自动启用）。
func TestCreateMissingGovernancePresetsFillsNewExamples(t *testing.T) {
	orig := governanceTasks
	defer func() { governanceTasks = orig }()

	governanceTasks = map[string]*GovernanceTask{}
	for _, n := range []string{"数据库表行数统计", "Excel数据解析入库", "CSV文本解析", "数据完整性检查", "Word文档内容提取", "综合日报生成器", "国际新闻入库"} {
		governanceTasks["id-"+n] = &GovernanceTask{ID: "id-" + n, Name: n, Owner: "admin"}
	}

	if n := createMissingGovernancePresets(); n != 2 {
		t.Fatalf("应补齐 2 个新内置示例，实际 %d", n)
	}
	if again := createMissingGovernancePresets(); again != 0 {
		t.Fatalf("补齐应幂等，第二次实际创建 %d 个", again)
	}

	seen := 0
	for _, task := range governanceTasks {
		if task == nil {
			continue
		}
		if task.Name == "公文Word转Excel（正则抽取）" || task.Name == "公文Word转Excel（AI抽取）" {
			seen++
			if task.Enabled {
				t.Errorf("新增的预置任务不应自动启用：%s", task.Name)
			}
			if task.ID == "" {
				t.Errorf("新增的预置任务应有 id：%s", task.Name)
			}
			if task.Status != "idle" {
				t.Errorf("新增的预置任务状态应为 idle：%s -> %s", task.Name, task.Status)
			}
		}
	}
	if seen != 2 {
		t.Fatalf("应创建 2 个公文Word转Excel 任务，实际 %d", seen)
	}
}

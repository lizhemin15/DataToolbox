package main

import (
	"archive/zip"
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"github.com/google/uuid"
	"github.com/pkg/sftp"
	"io"
	"log"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"
	gossh "golang.org/x/crypto/ssh"
)

func handleGovernanceTaskDetail(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	pathParts := strings.Split(strings.TrimPrefix(r.URL.Path, "/api/governance/tasks/"), "/")
	if len(pathParts) == 0 || pathParts[0] == "" {
		json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "message": "缺少任务ID"})
		return
	}
	taskID := pathParts[0]

	// 子路由分发
	if len(pathParts) >= 2 {
		switch pathParts[1] {
		case "run":
			handleGovernanceTaskRun(w, r, taskID)
			return
		case "toggle":
			handleGovernanceTaskToggle(w, r, taskID)
			return
		case "logs":
			if len(pathParts) > 2 {
				// DELETE /api/governance/tasks/{taskID}/logs/{logID}
				handleGovernanceTaskLogDelete(w, r, taskID, pathParts[2])
				return
			}
			handleGovernanceTaskLogs(w, r, taskID)
			return
		case "logs-clear":
			handleGovernanceTaskLogsClear(w, r, taskID)
			return
		case "upload":
			handleGovernanceTaskUpload(w, r, taskID)
			return
		case "save-log":
			handleGovernanceTaskSaveLog(w, r, taskID)
			return
		case "frontend-run":
			// 前端执行完成后通知后端保存结果并同步到分享页
			handleGovernanceTaskFrontendRun(w, r, taskID)
			return
		case "progress":
			handleGovernanceTaskProgress(w, r, taskID)
			return
		case "share":
			// 分享相关操作
			if len(pathParts) >= 3 {
				switch pathParts[2] {
				case "enable":
					handleGovernanceTaskShareEnable(w, r, taskID)
					return
				case "disable":
					handleGovernanceTaskShareDisable(w, r, taskID)
					return
				}
			}
			// POST /api/governance/tasks/{id}/share - 开启分享
			// DELETE /api/governance/tasks/{id}/share - 关闭分享
			if r.Method == http.MethodPost {
				handleGovernanceTaskShareEnable(w, r, taskID)
			} else if r.Method == http.MethodDelete {
				handleGovernanceTaskShareDisable(w, r, taskID)
			} else {
				json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "message": "不支持的方法"})
			}
			return
		}
	}

	switch r.Method {
	case http.MethodGet:
		task, _, ok := requireGovernanceTaskAccess(w, r, taskID)
		if !ok {
			return
		}
		json.NewEncoder(w).Encode(map[string]interface{}{"success": true, "task": task})

	case http.MethodPut:
		_, username, ok := requireGovernanceTaskAccess(w, r, taskID)
		if !ok {
			return
		}
		var update GovernanceTask
		if err := json.NewDecoder(r.Body).Decode(&update); err != nil {
			json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "message": "请求格式错误"})
			return
		}
		dataOntologyMu.Lock()
		task, exists := governanceTasks[taskID]
		if !exists {
			dataOntologyMu.Unlock()
			json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "message": "任务不存在"})
			return
		}
		// Direct assignments - frontend always sends all fields, including empty strings
		task.Name = update.Name
		task.Type = update.Type
		task.Description = update.Description
		task.JsCode = update.JsCode
		// DatabaseID: allow empty string to clear, validate non-empty values
		if update.DatabaseID != "" {
			dc, dcOk := dataOntologyDatabases[update.DatabaseID]
			if !dcOk || !dataOntologyResourceVisible(dc.Owner, username) {
				dataOntologyMu.Unlock()
				json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "message": "数据库不存在"})
				return
			}
		}
		task.DatabaseID = update.DatabaseID
		task.Runtime = update.Runtime
		task.RunMode = update.RunMode
		task.ExecutionMode = update.ExecutionMode
		// Backfill run_mode/execution_mode only if BOTH are empty (legacy compatibility)
		if task.RunMode == "" && task.ExecutionMode == "" {
			task.RunMode = task.Runtime
			task.ExecutionMode = task.RunMode
		}
		task.CronExpr = update.CronExpr
		task.InputType = update.InputType
		task.AcceptExts = update.AcceptExts
		task.FileBatchMode = update.FileBatchMode
		task.Enabled = update.Enabled
		// API 注册字段 - 只在明确传值时更新
		// JSON 解码时未传的字段会是零值（bool 为 false），需要区分"未传"和"传了 false"
		// 前端约定：更新时总是传完整数据，所以直接赋值
		task.RegisterAsAPI = update.RegisterAsAPI
		// APIPath/APIMethod 允许清空，直接赋值
		task.APIPath = update.APIPath
		task.APIMethod = update.APIMethod
		// 分享字段 - 与编辑界面的 checkbox 和外面的分享按钮共用同一状态
		// 任意一处开启/关闭，另一处也要同步
		if update.ShareEnabled {
			// 如果前端传了 share_token，使用前端的（允许自定义）
			if update.ShareToken != "" {
				// 检查是否冲突
				conflict := false
				for id, existing := range governanceTasks {
					if id == taskID {
						continue
					}
					if existing.ShareToken == update.ShareToken {
						conflict = true
						break
					}
				}
				if conflict {
					// 冲突，自动重新生成
					task.ShareToken = uuid.New().String()
					log.Printf("[治理任务] share_token 冲突，自动重新生成: %s", task.ShareToken)
				} else {
					task.ShareToken = update.ShareToken
				}
			} else if task.ShareToken == "" {
				// 如果没有传且原来也没有，自动生成
				task.ShareToken = uuid.New().String()
			}
			task.ShareEnabled = true
		} else {
			// 前端明确关闭分享：清除 token，与 DELETE /share API 行为一致
			task.ShareEnabled = false
			task.ShareToken = ""
		}
		// API 路径冲突检测
		if update.RegisterAsAPI && update.APIPath != "" {
			conflict := false
			for id, existing := range governanceTasks {
				if id == taskID {
					continue
				}
				if existing.APIPath == update.APIPath {
					conflict = true
					break
				}
			}
			if conflict {
				// 冲突，自动重新生成
				task.APIPath = update.APIPath + "-" + uuid.New().String()[:8]
				log.Printf("[治理任务] api_path 冲突，自动重新生成: %s", task.APIPath)
			} else {
				task.APIPath = update.APIPath
			}
		}
		// 不自动关闭分享：如果前端没传 share_enabled 或传了 false，保持原状态
		task.UpdatedAt = time.Now().Format(time.RFC3339)
		dataOntologyMu.Unlock()

		if err := saveDataOntologyStore(); err != nil {
			log.Printf("保存治理任务更新失败: %v", err)
		}
		json.NewEncoder(w).Encode(map[string]interface{}{"success": true, "task": task})

	case http.MethodDelete:
		_, _, ok := requireGovernanceTaskAccess(w, r, taskID)
		if !ok {
			return
		}
		dataOntologyMu.Lock()
		delete(governanceTasks, taskID)
		delete(governanceTaskLogs, taskID)
		dataOntologyMu.Unlock()

		if err := saveDataOntologyStore(); err != nil {
			log.Printf("保存治理任务删除失败: %v", err)
		}
		json.NewEncoder(w).Encode(map[string]interface{}{"success": true, "message": "删除成功"})

	default:
		json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "message": "不支持的方法"})
	}
}

// handleGovernanceTaskToggle 启用/禁用定时任务

func handleGovernanceTaskToggle(w http.ResponseWriter, r *http.Request, taskID string) {
	w.Header().Set("Content-Type", "application/json")
	if r.Method != http.MethodPost {
		json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "message": "只支持POST"})
		return
	}
	_, _, ok := requireGovernanceTaskAccess(w, r, taskID)
	if !ok {
		return
	}
	dataOntologyMu.Lock()
	task, exists := governanceTasks[taskID]
	if !exists {
		dataOntologyMu.Unlock()
		json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "message": "任务不存在"})
		return
	}
	task.Enabled = !task.Enabled
	task.UpdatedAt = time.Now().Format(time.RFC3339)
	dataOntologyMu.Unlock()

	if err := saveDataOntologyStore(); err != nil {
		log.Printf("保存治理任务状态失败: %v", err)
	}
	json.NewEncoder(w).Encode(map[string]interface{}{"success": true, "enabled": task.Enabled})
}

// handleGovernanceTaskLogs 获取或删除任务执行日志

func handleGovernanceTaskLogs(w http.ResponseWriter, r *http.Request, taskID string) {
	w.Header().Set("Content-Type", "application/json")
	_, _, ok := requireGovernanceTaskAccess(w, r, taskID)
	if !ok {
		return
	}

	// DELETE: 删除指定日志
	if r.Method == http.MethodDelete {
		var req struct {
			LogID string `json:"log_id"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "message": "解析请求失败"})
			return
		}
		if req.LogID == "" {
			json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "message": "缺少 log_id"})
			return
		}
		dataOntologyMu.Lock()
		logs := governanceTaskLogs[taskID]
		newLogs := make([]*GovernanceTaskLog, 0, len(logs))
		for _, l := range logs {
			if l != nil && l.ID != req.LogID {
				newLogs = append(newLogs, l)
			}
		}
		governanceTaskLogs[taskID] = newLogs
		saveDataOntologyStore()
		dataOntologyMu.Unlock()
		json.NewEncoder(w).Encode(map[string]interface{}{"success": true, "message": "日志已删除"})
		return
	}

	// GET: 获取日志
	if r.Method != http.MethodGet {
		json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "message": "只支持GET和DELETE"})
		return
	}
	dataOntologyMu.RLock()
	logs := governanceTaskLogs[taskID]
	task, hasTask := governanceTasks[taskID]
	dataOntologyMu.RUnlock()

	if logs == nil {
		logs = make([]*GovernanceTaskLog, 0)
	}
	// 运行中任务：把 last_output 合并进「运行中」日志条目；若尚无日志行（竞态或历史数据），则合成一条便于展示
	if hasTask && task != nil && task.Status == "running" {
		if len(logs) == 0 {
			st := task.StartedAt
			if st == "" {
				st = time.Now().Format(time.RFC3339)
			}
			in := "（无输入）"
			if task.TotalFiles > 0 {
				in = fmt.Sprintf("文件: %d 个", task.TotalFiles)
			}
			logs = []*GovernanceTaskLog{{
				ID:        uuid.New().String(),
				TaskID:    taskID,
				RunID:     task.RunID,
				StartTime: st,
				Status:    "running",
				Output:    task.LastOutput,
				Input:     in,
			}}
		} else if strings.TrimSpace(task.LastOutput) != "" {
			out := make([]*GovernanceTaskLog, 0, len(logs))
			for _, l := range logs {
				if l == nil {
					continue
				}
				cp := *l
				if cp.Status == "running" && (cp.RunID == "" || cp.RunID == task.RunID) {
					cp.Output = task.LastOutput
				}
				out = append(out, &cp)
			}
			logs = out
		}
	}
	json.NewEncoder(w).Encode(map[string]interface{}{"success": true, "logs": logs})
}

// handleGovernanceTaskLogDelete 删除单条任务执行日志

func handleGovernanceTaskLogDelete(w http.ResponseWriter, r *http.Request, taskID string, logID string) {
	w.Header().Set("Content-Type", "application/json")
	if r.Method != http.MethodDelete {
		json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "message": "只支持DELETE"})
		return
	}
	_, _, ok := requireGovernanceTaskAccess(w, r, taskID)
	if !ok {
		return
	}

	dataOntologyMu.Lock()
	defer dataOntologyMu.Unlock()

	logs := governanceTaskLogs[taskID]
	if logs == nil {
		json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "message": "日志不存在"})
		return
	}

	// 找到并删除指定日志
	found := false
	newLogs := make([]*GovernanceTaskLog, 0, len(logs))
	for _, l := range logs {
		if l != nil && l.ID == logID {
			found = true
			continue // 跳过要删除的
		}
		newLogs = append(newLogs, l)
	}

	if !found {
		json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "message": "日志ID不存在"})
		return
	}

	governanceTaskLogs[taskID] = newLogs

	// 持久化
	store := DataOntologyStore{
		Users:       dataOntologyUsers,
		Databases:   dataOntologyDatabases,
		Apis:        dataOntologyApis,
		AIConfig:    dataOntologyAIConfig,
		Tasks:       governanceTasks,
		TaskLogs:    governanceTaskLogs,
		MCPEnabled:  dataOntologyMCPEnabled,
		LLMModels:   llmModels,
		SmallModels: smallModels,
	}
	storePath := getDataOntologyStorePathFn()
	storeData, _ := json.MarshalIndent(store, "", "  ")
	os.WriteFile(storePath, storeData, 0644)

	json.NewEncoder(w).Encode(map[string]interface{}{"success": true, "message": "日志已删除"})
}

// handleGovernanceTaskLogsClear 清空任务所有执行日志

func handleGovernanceTaskLogsClear(w http.ResponseWriter, r *http.Request, taskID string) {
	w.Header().Set("Content-Type", "application/json")
	if r.Method != http.MethodDelete {
		json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "message": "只支持DELETE"})
		return
	}
	task, _, ok := requireGovernanceTaskAccess(w, r, taskID)
	if !ok {
		return
	}

	dataOntologyMu.Lock()
	defer dataOntologyMu.Unlock()

	// 清空任务日志
	governanceTaskLogs[taskID] = []*GovernanceTaskLog{}

	// 清空该任务关联的分享记录
	shareToken := task.ShareToken
	if shareToken != "" {
		governanceShareRunsMu.Lock()
		// 删除该 shareToken 下的所有 run 记录
		for runID, run := range governanceShareRuns {
			if run.ShareToken == shareToken {
				delete(governanceShareRuns, runID)
			}
		}
		governanceShareRunsMu.Unlock()
	}

	// 持久化
	store := DataOntologyStore{
		Users:       dataOntologyUsers,
		Databases:   dataOntologyDatabases,
		Apis:        dataOntologyApis,
		AIConfig:    dataOntologyAIConfig,
		Tasks:       governanceTasks,
		TaskLogs:    governanceTaskLogs,
		MCPEnabled:  dataOntologyMCPEnabled,
		LLMModels:   llmModels,
		SmallModels: smallModels,
	}
	storePath := getDataOntologyStorePathFn()
	storeData, _ := json.MarshalIndent(store, "", "  ")
	os.WriteFile(storePath, storeData, 0644)

	json.NewEncoder(w).Encode(map[string]interface{}{"success": true, "message": "日志已清空"})
}

// handleGovernanceTaskRun 执行治理任务（后端异步执行）

func handleGovernanceTaskRun(w http.ResponseWriter, r *http.Request, taskID string) {
	w.Header().Set("Content-Type", "application/json")
	if r.Method != http.MethodPost {
		json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "message": "只支持POST"})
		return
	}

	task, _, ok := requireGovernanceTaskAccess(w, r, taskID)
	if !ok {
		return
	}
	token := ""
	if auth := r.Header.Get("Authorization"); strings.HasPrefix(auth, "Bearer ") {
		token = strings.TrimPrefix(auth, "Bearer ")
	}
	if token == "" {
		json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "message": "未授权"})
		return
	}
	// 解析请求（支持 multipart 和 JSON）
	var inputText string
	var filePaths []string

	contentType := r.Header.Get("Content-Type")
	if strings.Contains(contentType, "multipart/form-data") {
		// multipart 上传
		maxSize := int64(100 * 1024 * 1024) // 100MB
		r.Body = http.MaxBytesReader(w, r.Body, maxSize)
		if err := r.ParseMultipartForm(maxSize); err != nil {
			json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "message": "解析表单失败: " + err.Error()})
			return
		}
		inputText = r.FormValue("input_text")

		// 保存上传的文件（须在循环内立即 Close，勿 defer：否则返回响应后才会刷盘，
		// 后台 governanceWorker 可能先读到未落盘的空/截断文件）
		files := r.MultipartForm.File["files"]
		for _, fileHeader := range files {
			// 安全验证：清理文件名，防止路径遍历攻击
			safeFilename, err := sanitizeFilename(fileHeader.Filename)
			if err != nil {
				log.Printf("[Governance] 文件名无效: %v", err)
				continue
			}
			file, err := fileHeader.Open()
			if err != nil {
				continue
			}
			tmpDir := filepath.Join(os.TempDir(), "gov-tasks", taskID)
			if err := os.MkdirAll(tmpDir, 0755); err != nil {
				file.Close()
				continue
			}
			tmpPath := filepath.Join(tmpDir, safeFilename)
			dst, err := os.Create(tmpPath)
			if err != nil {
				file.Close()
				continue
			}
			_, copyErr := io.Copy(dst, file)
			file.Close()
			closeErr := dst.Close()
			if copyErr != nil {
				os.Remove(tmpPath)
				continue
			}
			if closeErr != nil {
				os.Remove(tmpPath)
				continue
			}
			filePaths = append(filePaths, tmpPath)
		}
	} else {
		// JSON 请求
		var req struct {
			InputText string `json:"input_text"`
		}
		json.NewDecoder(r.Body).Decode(&req)
		inputText = req.InputText
	}

	// 创建任务
	runID := uuid.New().String()
	startedAt := time.Now().Format(time.RFC3339)
	job := &GovernanceJob{
		TaskID:     taskID,
		RunID:      runID,
		Token:      token,
		InputFiles: filePaths,
		InputText:  inputText,
		ShareToken: task.ShareToken,
	}

	// 更新任务状态
	dataOntologyMu.Lock()
	task.Status = "running"
	task.RunID = runID
	task.StartedAt = startedAt
	task.TotalFiles = len(filePaths)
	task.ProcessedFiles = 0
	task.Percent = 0
	task.CurrentFile = ""
	dataOntologyMu.Unlock()

	// 先入队前写入「运行中」日志并落库；勿在日志落库之前单独 save 任务，否则刷新页面可能只见 running 而无执行记录
	governanceAppendRunningLog(taskID, job, startedAt)

	// 入队
	select {
	case governanceJobQueue <- job:
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": true,
			"run_id":  runID,
			"message": "任务已入队，正在后台执行",
		})
	default:
		// 队列已满，回滚状态，避免残留 running
		dataOntologyMu.Lock()
		if t, ok := governanceTasks[taskID]; ok {
			t.Status = "idle"
			t.RunID = ""
			t.LastError = "任务队列已满，请稍后重试"
		}
		dataOntologyMu.Unlock()
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"message": "任务队列已满，请稍后重试",
		})
	}
}

// handleGovernanceTaskProgress 获取任务执行进度

func handleGovernanceTaskProgress(w http.ResponseWriter, r *http.Request, taskID string) {
	w.Header().Set("Content-Type", "application/json")
	_, _, ok := requireGovernanceTaskAccess(w, r, taskID)
	if !ok {
		return
	}
	dataOntologyMu.RLock()
	task, exists := governanceTasks[taskID]
	dataOntologyMu.RUnlock()

	if !exists {
		json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "message": "任务不存在"})
		return
	}

	json.NewEncoder(w).Encode(map[string]interface{}{
		"success":         true,
		"status":          task.Status,
		"run_id":          task.RunID,
		"total_files":     task.TotalFiles,
		"processed_files": task.ProcessedFiles,
		"percent":         task.Percent,
		"current_file":    task.CurrentFile,
		"started_at":      task.StartedAt,
		"last_output":     task.LastOutput,
		"last_error":      task.LastError,
	})
}

// handleGovernanceTaskUpload 不再需要，交互任务在前端直接处理文件

func handleGovernanceTaskUpload(w http.ResponseWriter, r *http.Request, taskID string) {
	json.NewEncoder(w).Encode(map[string]interface{}{"success": true, "message": "请在前端直接处理文件"})
}

// handleGovernanceTaskSaveLog 保存客户端执行日志

func handleGovernanceTaskSaveLog(w http.ResponseWriter, r *http.Request, taskID string) {
	w.Header().Set("Content-Type", "application/json")
	if r.Method != http.MethodPost {
		json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "message": "只支持POST"})
		return
	}
	_, _, ok := requireGovernanceTaskAccess(w, r, taskID)
	if !ok {
		return
	}

	var req struct {
		Status      string   `json:"status"`
		Output      string   `json:"output"`
		Error       string   `json:"error"`
		Input       string   `json:"input"`
		InputFiles  []string `json:"input_files"`
		ResultFiles []string `json:"result_files"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "message": "请求格式错误"})
		return
	}

	now := time.Now().Format(time.RFC3339)
	logEntry := &GovernanceTaskLog{
		ID:          uuid.New().String(),
		TaskID:      taskID,
		StartTime:   now,
		EndTime:     now,
		Status:      req.Status,
		Output:      req.Output,
		Error:       req.Error,
		Input:       req.Input,
		InputFiles:  req.InputFiles,
		ResultFiles: req.ResultFiles,
	}

	dataOntologyMu.Lock()
	task, exists := governanceTasks[taskID]
	if !exists {
		dataOntologyMu.Unlock()
		json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "message": "任务不存在"})
		return
	}
	task.Status = req.Status
	task.LastRunAt = now
	task.LastOutput = req.Output
	task.LastError = req.Error

	governanceTaskLogs[taskID] = append(governanceTaskLogs[taskID], logEntry)
	if len(governanceTaskLogs[taskID]) > 50 {
		governanceTaskLogs[taskID] = governanceTaskLogs[taskID][len(governanceTaskLogs[taskID])-50:]
	}
	dataOntologyMu.Unlock()

	if err := saveDataOntologyStore(); err != nil {
		log.Printf("保存治理任务执行日志失败: %v", err)
	}
	json.NewEncoder(w).Encode(map[string]interface{}{"success": true})
}

// sanitizeGovernanceExampleFilename 仅允许治理示例目录下的单个文件名（无路径穿越）

func sanitizeGovernanceExampleFilename(s string) string {
	s = strings.TrimSpace(s)
	if s == "" {
		return ""
	}
	// 允许前端/历史数据传入相对路径，但最终必须归一化为纯文件名。
	base := filepath.Base(s)
	if base == "." || base == string(filepath.Separator) || base == "" {
		return ""
	}
	if base != s {
		// 只接受纯 basename；任何目录穿越/子目录都拒绝。
		return ""
	}
	if strings.Contains(base, "..") || strings.Contains(base, "/") || strings.Contains(base, "\\") {
		return ""
	}
	return base
}

func getGovernanceExampleFile(safe string) ([]byte, error) {
	// 只从磁盘读取，不再使用 embed fallback
	dataDir := filepath.Dir(getDataOntologyStorePath())
	diskPath := filepath.Join(dataDir, "example_files", safe)
	return os.ReadFile(diskPath)
}

type ExampleFile struct {
	Name string `json:"name"`
	Size int64  `json:"size"`
}

// 只从磁盘读取示例文件列表
func listGovernanceExampleFiles() ([]ExampleFile, error) {
	dataDir := filepath.Dir(getDataOntologyStorePath())
	exampleDir := filepath.Join(dataDir, "example_files")
	var examples []ExampleFile
	entries, err := os.ReadDir(exampleDir)
	if err != nil {
		return nil, err
	}
	for _, entry := range entries {
		if entry.IsDir() || !strings.HasSuffix(strings.ToLower(entry.Name()), ".docx") {
			continue
		}
		info, err := entry.Info()
		size := int64(0)
		if err == nil {
			size = info.Size()
		}
		examples = append(examples, ExampleFile{Name: entry.Name(), Size: size})
	}
	return examples, nil
}

// handleGovernanceExamplesList GET …/examples 返回示例文件列表

func handleGovernanceExamplesList(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "message": "只支持GET"})
		return
	}
	username, authOK := getDataOntologyUserFromRequest(r)
	if !authOK {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "message": "未授权"})
		return
	}
	_ = username

	examples, err := listGovernanceExampleFiles()
	if err != nil {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "message": "读取示例目录失败"})
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success":  true,
		"examples": examples,
	})
}

// handleGovernanceExampleDownload GET …/examples/{filename}；POST …/examples/reload 为预置示例热更新

func handleGovernanceExampleDownload(w http.ResponseWriter, r *http.Request) {
	rawPath := strings.TrimPrefix(r.URL.Path, "/api/governance/examples/")
	if rawPath == r.URL.Path {
		rawPath = strings.TrimPrefix(r.URL.Path, "/api/governance/examples/")
	}
	rawPath = strings.TrimPrefix(rawPath, "/")

	// POST /api/governance/examples/download → 批量打包下载
	if r.Method == http.MethodPost && rawPath == "download" {
		handleGovernanceExamplesZipDownload(w, r)
		return
	}

	// POST /api/governance/examples/reload → 热更新
	if r.Method == http.MethodPost && rawPath == "reload" {
		handleGovernanceExamplesReload(w, r)
		return
	}

	if r.Method != http.MethodGet {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "message": "只支持GET"})
		return
	}
	username, authOK := getDataOntologyUserFromRequest(r)
	if !authOK {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "message": "未授权"})
		return
	}
	_ = username
	// 空路径返回示例文件列表
	if rawPath == "" {
		handleGovernanceExamplesList(w, r)
		return
	}
	safe := sanitizeGovernanceExampleFilename(rawPath)
	if safe == "" {
		http.Error(w, "Bad Request", http.StatusBadRequest)
		return
	}
	data, err := getGovernanceExampleFile(safe)
	if err != nil {
		http.Error(w, "Not Found", http.StatusNotFound)
		return
	}
	w.Header().Set("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document")
	w.Header().Set("Content-Disposition", `attachment; filename="`+safe+`"`)
	w.Write(data)
}

// handleGovernanceExamplesZipDownload POST body: {"paths":["a.docx","b.docx"]}

func handleGovernanceExamplesZipDownload(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "message": "只支持POST"})
		return
	}
	username, authOK := getDataOntologyUserFromRequest(r)
	if !authOK {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "message": "未授权"})
		return
	}
	_ = username
	var req struct {
		Files []struct {
			Name string `json:"name"`
			Path string `json:"path"`
		} `json:"files"`
		Paths   []string `json:"paths"`
		ZipName string   `json:"zip_name"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "message": "请求格式错误"})
		return
	}
	type zipItem struct {
		entryName string
		diskPath  string
	}
	var items []zipItem
	if len(req.Files) > 0 {
		for _, it := range req.Files {
			pathInput := strings.TrimSpace(it.Path)
			if pathInput == "" {
				pathInput = strings.TrimSpace(it.Name)
			}
			safe := sanitizeGovernanceExampleFilename(pathInput)
			if safe == "" {
				w.Header().Set("Content-Type", "application/json")
				json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "message": "非法路径"})
				return
			}
			name := strings.TrimSpace(it.Name)
			if name == "" {
				name = safe
			}
			if strings.Contains(name, "/") || strings.Contains(name, "\\") || strings.Contains(name, "..") {
				w.Header().Set("Content-Type", "application/json")
				json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "message": "非法文件名"})
				return
			}
			items = append(items, zipItem{entryName: name, diskPath: safe})
		}
	} else {
		for _, p := range req.Paths {
			safe := sanitizeGovernanceExampleFilename(p)
			if safe == "" {
				w.Header().Set("Content-Type", "application/json")
				json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "message": "非法路径"})
				return
			}
			items = append(items, zipItem{entryName: safe, diskPath: safe})
		}
	}
	if len(items) == 0 {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "message": "paths 或 files 不能为空"})
		return
	}
	var buf bytes.Buffer
	zw := zip.NewWriter(&buf)
	for _, it := range items {
		data, err := getGovernanceExampleFile(it.diskPath)
		if err != nil {
			zw.Close()
			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "message": "文件不存在"})
			return
		}
		f, err := zw.Create(it.entryName)
		if err != nil {
			zw.Close()
			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "message": err.Error()})
			return
		}
		if _, err := f.Write(data); err != nil {
			zw.Close()
			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "message": err.Error()})
			return
		}
	}
	if err := zw.Close(); err != nil {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "message": err.Error()})
		return
	}
	zipName := req.ZipName
	if zipName == "" {
		zipName = "governance-examples.zip"
	}
	if !strings.HasSuffix(strings.ToLower(zipName), ".zip") {
		zipName += ".zip"
	}
	// URL 编码文件名（解决中文乱码问题）
	// filename 部分用 ASCII 安全字符（避免某些浏览器/代理读旧字段显示乱码）
	// filename* 部分用 UTF-8 编码（现代浏览器优先读取）
	encodedZipName := url.PathEscape(zipName)
	safeASCII := strings.Map(func(r rune) rune {
		if r < 128 {
			return r
		}
		return '_'
	}, zipName)
	w.Header().Set("Content-Type", "application/zip")
	w.Header().Set("Content-Disposition", `attachment; filename="`+safeASCII+`"; filename*=UTF-8''`+encodedZipName)
	w.Write(buf.Bytes())
}

// handleGovernanceExamplesReload POST /api/governance/examples/reload
// 从当前进程内的 embed FS 将预置任务的 example_files（及可选的「综合日报生成器」js_code）同步到 data-store.json。
// 仅匹配内置任务名称，不修改用户自建任务。需管理员。

func handleGovernanceExamplesReload(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	if r.Method != http.MethodPost {
		json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "message": "只支持POST"})
		return
	}
	if _, ok := requireDataOntologyAdmin(w, r); !ok {
		return
	}
	var body struct {
		IncludeJS bool `json:"include_js"`
	}
	_ = json.NewDecoder(r.Body).Decode(&body)

	dataOntologyMu.Lock()
	n := syncGovernancePresetExamplesFromEmbed(body.IncludeJS)
	if n > 0 {
		if err := saveDataOntologyStore(); err != nil {
			dataOntologyMu.Unlock()
			log.Printf("保存治理预置示例同步失败: %v", err)
			json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "message": "保存失败"})
			return
		}
	}
	dataOntologyMu.Unlock()

	json.NewEncoder(w).Encode(map[string]interface{}{"success": true, "updated_tasks": n})
}

// handleGovernanceExecuteSQL 治理任务执行SQL（供前端JS调用）
// handleGovernanceDownloadOutput 下载单次任务生成的输出文件（gov-runner output_files）

func handleGovernanceDownloadOutput(w http.ResponseWriter, r *http.Request) {
	username, authOK := getDataOntologyUserFromRequest(r)
	if !authOK {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "message": "未授权"})
		return
	}
	if r.Method != http.MethodGet {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "message": "只支持GET"})
		return
	}
	runID := r.URL.Query().Get("run_id")
	safeName := sanitizeGovOutputFilename(r.URL.Query().Get("name"))
	if runID == "" || safeName == "" {
		http.Error(w, "Bad Request", http.StatusBadRequest)
		return
	}
	dataOntologyMu.RLock()
	var owner string
	var found bool
	for _, t := range governanceTasks {
		if t.RunID == runID {
			owner = t.Owner
			found = true
			break
		}
	}
	dataOntologyMu.RUnlock()
	if !found || !dataOntologyResourceVisible(owner, username) {
		http.Error(w, "Forbidden", http.StatusForbidden)
		return
	}
	path := filepath.Join(os.TempDir(), "gov-output-downloads", runID, safeName)
	if _, err := os.Stat(path); err != nil {
		http.Error(w, "Not Found", http.StatusNotFound)
		return
	}
	w.Header().Set("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document")
	w.Header().Set("Content-Disposition", `attachment; filename="`+safeName+`"`)
	http.ServeFile(w, r, path)
}

// handleGovernanceDownloadAPIOutput 下载 API 调用治理任务生成的输出文件（免鉴权）
func handleGovernanceDownloadAPIOutput(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "message": "只支持GET"})
		return
	}
	taskID := r.URL.Query().Get("task_id")
	runID := r.URL.Query().Get("run_id")
	safeName := sanitizeGovOutputFilename(r.URL.Query().Get("name"))
	if taskID == "" || runID == "" || safeName == "" {
		http.Error(w, "Bad Request: task_id, run_id, name required", http.StatusBadRequest)
		return
	}
	// 安全：防止路径遍历
	if strings.Contains(taskID, "..") || strings.Contains(runID, "..") || strings.Contains(safeName, "..") {
		http.Error(w, "Bad Request", http.StatusBadRequest)
		return
	}
	path := filepath.Join("data", "api-outputs", taskID, runID, safeName)
	if _, err := os.Stat(path); err != nil {
		http.Error(w, "Not Found", http.StatusNotFound)
		return
	}
	// 根据文件扩展名设置 Content-Type
	contentType := "application/octet-stream"
	switch strings.ToLower(filepath.Ext(safeName)) {
	case ".docx":
		contentType = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
	case ".pdf":
		contentType = "application/pdf"
	case ".xlsx":
		contentType = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
	case ".csv":
		contentType = "text/csv"
	case ".txt", ".log":
		contentType = "text/plain; charset=utf-8"
	case ".json":
		contentType = "application/json"
	case ".html":
		contentType = "text/html; charset=utf-8"
	}
	w.Header().Set("Content-Type", contentType)
	w.Header().Set("Content-Disposition", `attachment; filename="`+safeName+`"`)
	http.ServeFile(w, r, path)
}

func handleGovernanceExecuteSQL(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	username, authOK := getDataOntologyUserFromRequest(r)
	if !authOK {
		json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "message": "未授权"})
		return
	}
	if r.Method != http.MethodPost {
		json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "message": "只支持POST"})
		return
	}

	var req struct {
		DatabaseID string        `json:"database_id"`
		SQL        string        `json:"sql"`
		Params     []interface{} `json:"params"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "message": "请求格式错误"})
		return
	}
	if req.DatabaseID == "" || req.SQL == "" {
		json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "message": "database_id 和 sql 不能为空"})
		return
	}

	dataOntologyMu.RLock()
	dbConfig, exists := dataOntologyDatabases[req.DatabaseID]
	dataOntologyMu.RUnlock()
	if !exists || !dataOntologyResourceVisible(dbConfig.Owner, username) {
		json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "message": "数据库不存在"})
		return
	}

	// 使用连接池
	db, err := getDBFromPool(dbConfig)
	if err != nil {
		json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "message": "连接失败: " + err.Error()})
		return
	}

	sqlUpper := strings.TrimSpace(strings.ToUpper(req.SQL))
	if strings.HasPrefix(sqlUpper, "SELECT") || strings.HasPrefix(sqlUpper, "SHOW") || strings.HasPrefix(sqlUpper, "DESCRIBE") || strings.HasPrefix(sqlUpper, "EXPLAIN") {
		rows, err := db.Query(req.SQL, req.Params...)
		if err != nil {
			json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "message": "查询失败: " + err.Error()})
			return
		}
		defer rows.Close()

		columns, _ := rows.Columns()
		var results []map[string]interface{}
		for rows.Next() {
			values := make([]interface{}, len(columns))
			valuePtrs := make([]interface{}, len(columns))
			for i := range values {
				valuePtrs[i] = &values[i]
			}
			rows.Scan(valuePtrs...)
			row := make(map[string]interface{})
			for i, col := range columns {
				val := values[i]
				if b, ok := val.([]byte); ok {
					row[col] = string(b)
				} else {
					row[col] = val
				}
			}
			results = append(results, row)
		}
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": true,
			"data":    results,
			"columns": columns,
			"count":   len(results),
		})
	} else {
		result, err := db.Exec(req.SQL, req.Params...)
		if err != nil {
			json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "message": "执行失败: " + err.Error()})
			return
		}
		affected, _ := result.RowsAffected()
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success":       true,
			"rows_affected": affected,
		})
	}
}

// ==================== 治理任务调度器 ====================

// reconcileStuckGovernanceRuns 服务启动时将仍处于 running 的任务视为已中断（队列与工作者状态不会在重启后保留）

func reconcileStuckGovernanceRuns() {
	dataOntologyMu.Lock()
	changed := false
	for id, t := range governanceTasks {
		if t == nil || t.Status != "running" {
			continue
		}
		t.Status = "idle"
		if t.LastError == "" {
			t.LastError = "上次执行未正常结束（服务重启或进程退出）"
		}
		rid := t.RunID
		t.RunID = ""
		t.TotalFiles = 0
		t.ProcessedFiles = 0
		t.Percent = 0
		t.CurrentFile = ""
		for _, l := range governanceTaskLogs[id] {
			if l != nil && l.Status == "running" && (rid == "" || l.RunID == rid) {
				l.Status = "error"
				l.Error = "执行中断（服务重启或进程退出）"
				l.EndTime = time.Now().Format(time.RFC3339)
				changed = true
				break
			}
		}
		changed = true
	}
	dataOntologyMu.Unlock()
	if changed {
		if err := saveDataOntologyStore(); err != nil {
			log.Printf("收尾中断中的治理任务失败: %v", err)
		}
	}
}

// governanceJobInputSummary 生成异步任务输入摘要（供执行日志展示）

func governanceJobInputSummary(job *GovernanceJob) string {
	var parts []string
	if strings.TrimSpace(job.InputText) != "" {
		t := strings.TrimSpace(job.InputText)
		runes := []rune(t)
		if len(runes) > 200 {
			t = string(runes[:200]) + "…"
		}
		parts = append(parts, "文本: "+t)
	}
	if len(job.InputFiles) > 0 {
		names := make([]string, 0, len(job.InputFiles))
		for _, p := range job.InputFiles {
			names = append(names, filepath.Base(p))
		}
		parts = append(parts, "文件: "+strings.Join(names, ", "))
	}
	if len(parts) == 0 {
		return "（无输入）"
	}
	return strings.Join(parts, "；")
}

// governanceAppendRunningLog 异步任务开始时写入一条「运行中」日志（便于刷新页面后仍能看到执行记录）

func governanceAppendRunningLog(taskID string, job *GovernanceJob, startedAt string) {
	if startedAt == "" {
		startedAt = time.Now().Format(time.RFC3339)
	}
	// 提取输入文件名（不含路径）
	var inputFileNames []string
	for _, p := range job.InputFiles {
		inputFileNames = append(inputFileNames, filepath.Base(p))
	}
	dataOntologyMu.Lock()
	logEntry := &GovernanceTaskLog{
		ID:         uuid.New().String(),
		TaskID:     taskID,
		RunID:      job.RunID,
		StartTime:  startedAt,
		Status:     "running",
		Input:      governanceJobInputSummary(job),
		InputFiles: inputFileNames,
	}
	governanceTaskLogs[taskID] = append(governanceTaskLogs[taskID], logEntry)
	if len(governanceTaskLogs[taskID]) > 50 {
		governanceTaskLogs[taskID] = governanceTaskLogs[taskID][len(governanceTaskLogs[taskID])-50:]
	}
	dataOntologyMu.Unlock()
	if err := saveDataOntologyStore(); err != nil {
		log.Printf("保存治理任务运行中日志失败: %v", err)
	}
}

// handleGovernanceTaskFrontendRun 处理前端执行完成后的回调，用于同步任务结果到分享页

func handleGovernanceTaskFrontendRun(w http.ResponseWriter, r *http.Request, taskID string) {
	log.Printf("[DEBUG] handleGovernanceTaskFrontendRun called: taskID=%s", taskID)
	
	w.Header().Set("Content-Type", "application/json")
	if r.Method != http.MethodPost {
		json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "message": "只支持POST"})
		return
	}

	task, _, ok := requireGovernanceTaskAccess(w, r, taskID)
	if !ok {
		return
	}

	// 先生成 runID，用于文件保存目录
	runID := uuid.New().String()

	// 从请求中读取分享配置（前端可能会传）
	shareEnabledFromReq := false
	shareTokenFromReq := ""
	inputFileNames := []string{}

	contentType := r.Header.Get("Content-Type")

	// 解析上传的文件（支持 multipart/form-data）
	if strings.Contains(contentType, "multipart/form-data") {
		maxSize := int64(100 * 1024 * 1024) // 100MB
		r.Body = http.MaxBytesReader(w, r.Body, maxSize)
		if err := r.ParseMultipartForm(maxSize); err == nil {
			// 优先使用请求参数中的分享配置，，如果没有则用任务配置
			if v := r.FormValue("share_enabled"); v == "true" {
				shareEnabledFromReq = true
			}
			if v := r.FormValue("share_token"); v != "" {
				shareTokenFromReq = v
			}

			// 如果前端传了 input_files 参数，优先使用它（原始文件名）
			if v := r.FormValue("input_files"); v != "" {
				if err := json.Unmarshal([]byte(v), &inputFileNames); err != nil {
					inputFileNames = []string{} // 解析失败则回退到从文件提取
				}
			}

			// 如果请求参数没有提供分享配置，使用任务配置
			if !shareEnabledFromReq && shareTokenFromReq == "" {
				shareEnabledFromReq = task.ShareEnabled
				shareTokenFromReq = task.ShareToken
			}

			// 如果分享功能开启，保存文件到 share-uploads
			if shareEnabledFromReq && shareTokenFromReq != "" {
				dataDir := filepath.Dir(getDataOntologyStorePath())
				uploadDir := filepath.Join(dataDir, "share-uploads", shareTokenFromReq, runID)
				if err := os.MkdirAll(uploadDir, 0755); err == nil {
					files := r.MultipartForm.File["files"]
					for _, fileHeader := range files {
						safeFilename, err := sanitizeFilename(fileHeader.Filename)
						if err != nil {
							continue
						}
						file, err := fileHeader.Open()
						if err != nil {
							continue
						}
						tmpPath := filepath.Join(uploadDir, safeFilename)
						dst, err := os.Create(tmpPath)
						if err != nil {
							file.Close()
							continue
						}
						_, copyErr := io.Copy(dst, file)
						file.Close()
						closeErr := dst.Close()
						if copyErr != nil || closeErr != nil {
							os.Remove(tmpPath)
							continue
						}
						inputFileNames = append(inputFileNames, safeFilename)
					}
				}
			}
		}
	}

	// 如果没有上传文件，解析 JSON 请求体获取文件名
	if len(inputFileNames) == 0 {
		var req struct {
			RunID       string   `json:"run_id"`
			Status      string   `json:"status"`
			Output      string   `json:"output"`
			Error       string   `json:"error"`
			InputText   string   `json:"input_text"`
			InputFiles  []string `json:"input_files"`
			ShareEnabled bool    `json:"share_enabled"`
			ShareToken  string   `json:"share_token"`
		}
		// 重新构造请求体（因为上面可能已经读取了 multipart）
		if err := json.NewDecoder(r.Body).Decode(&req); err == nil {
			runID = req.RunID
			if runID == "" {
				runID = uuid.New().String()
			}
			inputFileNames = req.InputFiles

		// 优先使用请求中的分享配置
		if req.ShareEnabled {
			shareEnabledFromReq = true
		}
		if req.ShareToken != "" {
			shareTokenFromReq = req.ShareToken
		} else if req.ShareEnabled {
			// 前端传了 share_enabled=true 但没有 share_token，用任务配置的
			shareTokenFromReq = task.ShareToken
		}

		// 如果请求参数没有提供分享配置，使用任务配置
		if !shareEnabledFromReq && shareTokenFromReq == "" {
			shareEnabledFromReq = task.ShareEnabled
			shareTokenFromReq = task.ShareToken
		}

			// 更新任务状态
			dataOntologyMu.Lock()
			task.Status = req.Status
			task.LastOutput = req.Output
			task.LastError = req.Error
			task.LastRunAt = time.Now().Format(time.RFC3339)
			task.RunID = runID
			dataOntologyMu.Unlock()
		} else {
			// 无法解析，直接返回错误
			json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "message": "解析请求失败: " + err.Error()})
			return
		}
	} else {
		// 有文件上传，更新任务状态为成功
		dataOntologyMu.Lock()
		task.Status = "success"
		task.LastRunAt = time.Now().Format(time.RFC3339)
		task.RunID = runID
		dataOntologyMu.Unlock()
	}

	// 保存任务日志并同步到分享页（使用从请求或任务中获取的分享配置）
	governanceFinalizeRunLogFromTaskWithShare(taskID, runID, inputFileNames, shareEnabledFromReq, shareTokenFromReq)

	json.NewEncoder(w).Encode(map[string]interface{}{
		"success":     true,
		"run_id":      runID,
		"input_files": inputFileNames,
		"message":     "前端执行结果已保存并同步到分享页",
	})
}

// governanceFinalizeRunLog 将对应 run_id 的「运行中」日志更新为结束状态；若无则追加一条完成记录

func governanceFinalizeRunLog(taskID, runID, status, output, errStr string) {
	governanceFinalizeRunLogWithFiles(taskID, runID, status, output, errStr, nil, nil)
}

// governanceFinalizeRunLogWithFiles 带文件列表的版本

func governanceFinalizeRunLogWithFiles(taskID, runID, status, output, errStr string, inputFiles, resultFiles []string) {
	if runID == "" {
		runID = uuid.New().String()
	}
	now := time.Now().Format(time.RFC3339)
	dataOntologyMu.Lock()
	logs := governanceTaskLogs[taskID]
	found := false
	for _, l := range logs {
		if l.RunID == runID && l.Status == "running" {
			l.Status = status
			l.Output = output
			l.Error = errStr
			l.EndTime = now
			if len(inputFiles) > 0 {
				l.InputFiles = inputFiles
				log.Printf("[DEBUG] governanceFinalizeRunLogWithFiles: 更新日志 inputFiles=%v", inputFiles)
			}
			if len(resultFiles) > 0 {
				l.ResultFiles = resultFiles
				log.Printf("[DEBUG] governanceFinalizeRunLogWithFiles: 更新日志 resultFiles=%v", resultFiles)
			}
			found = true
			log.Printf("[DEBUG] governanceFinalizeRunLogWithFiles: 找到 running 日志并更新, runID=%s, inputFiles=%v, resultFiles=%v", runID, l.InputFiles, l.ResultFiles)
			break
		}
	}
	if !found {
		governanceTaskLogs[taskID] = append(governanceTaskLogs[taskID], &GovernanceTaskLog{
			ID:          uuid.New().String(),
			TaskID:      taskID,
			RunID:       runID,
			StartTime:   now,
			EndTime:     now,
			Status:      status,
			Output:      output,
			Error:       errStr,
			InputFiles:  inputFiles,
			ResultFiles: resultFiles,
		})
		log.Printf("[DEBUG] governanceFinalizeRunLogWithFiles: 创建新日志, runID=%s, inputFiles=%v, resultFiles=%v", runID, inputFiles, resultFiles)
	}
	if len(governanceTaskLogs[taskID]) > 50 {
		governanceTaskLogs[taskID] = governanceTaskLogs[taskID][len(governanceTaskLogs[taskID])-50:]
	}
	dataOntologyMu.Unlock()
	if err := saveDataOntologyStore(); err != nil {
		log.Printf("保存治理任务完成日志失败: %v", err)
	}
}

// governanceFinalizeRunLogFromTask 根据任务当前状态将本次 run 的执行日志落库

func governanceFinalizeRunLogFromTask(taskID, runID string, inputFiles []string) {
	dataOntologyMu.RLock()
	var outStr, errStr string
	status := "error"
	shareToken := ""
	if t, ok := governanceTasks[taskID]; ok {
		if t.Status == "success" {
			status = "success"
		}
		outStr = t.LastOutput
		errStr = t.LastError
		shareToken = t.ShareToken
	}
	dataOntologyMu.RUnlock()
	if status == "success" {
		governanceFinalizeRunLog(taskID, runID, "success", outStr, "")
	} else {
		governanceFinalizeRunLog(taskID, runID, "error", outStr, errStr)
	}
	if shareToken != "" {
		shareStatus := "completed"
		shareOutput := outStr
		if status != "success" {
			shareStatus = "failed"
			if errStr != "" {
				if shareOutput != "" {
					shareOutput = errStr + "\n" + shareOutput
				} else {
					shareOutput = errStr
				}
			}
		}
		governanceShareRunsMu.Lock()
		if run, exists := governanceShareRuns[runID]; exists {
			run.Status = shareStatus
			run.Progress = 100
			run.Output = shareOutput
			if inputFiles != nil {
				run.InputFiles = append([]string(nil), inputFiles...)
			}
			run.UpdatedAt = time.Now()
		} else {
			now := time.Now()
			clonedInputs := append([]string(nil), inputFiles...)
			// 扫描输出文件
			_, resultFiles := scanShareRunFiles(shareToken, runID)
			governanceShareRuns[runID] = &GovernanceShareRun{
				ID:          runID,
				TaskID:      taskID,
				ShareToken:  shareToken,
				Status:      shareStatus,
				Progress:    100,
				Output:      shareOutput,
				InputFiles:  clonedInputs,
				ResultFiles: resultFiles,
				CreatedAt:   now,
				UpdatedAt:   now,
			}
		}
		governanceShareRunsMu.Unlock()
		if err := saveDataOntologyStore(); err != nil {
			log.Printf("[TaskRun] 保存分享执行记录失败: %v", err)
		}
	}
}

// governanceFinalizeRunLogFromTaskWithShare 带分享配置的版本，允许从请求参数传入分享信息

func governanceFinalizeRunLogFromTaskWithShare(taskID, runID string, inputFiles []string, shareEnabled bool, shareToken string) {
	dataOntologyMu.RLock()
	var outStr, errStr string
	status := "error"
	if t, ok := governanceTasks[taskID]; ok {
		if t.Status == "success" {
			status = "success"
		}
		outStr = t.LastOutput
		errStr = t.LastError
		// 如果请求参数没有提供分享配置，则使用任务配置
		if !shareEnabled && shareToken == "" {
			shareEnabled = t.ShareEnabled
			shareToken = t.ShareToken
		} else if shareEnabled && shareToken == "" {
			// 前端传了 share_enabled=true 但没有 share_token，用任务配置
			shareToken = t.ShareToken
		}
	}
	dataOntologyMu.RUnlock()
	
	// 提取输入文件名（不含路径）
	var inputFileNames []string
	for _, f := range inputFiles {
		inputFileNames = append(inputFileNames, filepath.Base(f))
	}
	
	// 扫描输出文件（如果有分享 token）
	var resultFileNames []string
	if shareToken != "" {
		_, files := scanShareRunFiles(shareToken, runID)
		for _, f := range files {
			resultFileNames = append(resultFileNames, filepath.Base(f))
		}
	}
	
	if status == "success" {
		governanceFinalizeRunLogWithFiles(taskID, runID, "success", outStr, "", inputFileNames, resultFileNames)
	} else {
		governanceFinalizeRunLogWithFiles(taskID, runID, "error", outStr, errStr, inputFileNames, resultFileNames)
	}
	// 使用传入的分享配置或任务配置来保存分享记录
	log.Printf("[DEBUG] 最终分享配置: shareEnabled=%v, shareToken=%s, inputFiles=%v, len(shareToken)=%d", shareEnabled, shareToken, inputFiles, len(shareToken))
	if shareEnabled && shareToken != "" {
		log.Printf("[DEBUG] 进入分享记录保存分支")
		shareStatus := "completed"
		shareOutput := outStr
		if status != "success" {
			shareStatus = "failed"
			if errStr != "" {
				if shareOutput != "" {
					shareOutput = errStr + "\n" + shareOutput
				} else {
					shareOutput = errStr
				}
			}
		}
		governanceShareRunsMu.Lock()
		if run, exists := governanceShareRuns[runID]; exists {
			run.Status = shareStatus
			run.Progress = 100
			run.Output = shareOutput
			// 更新 ShareToken
			run.ShareToken = shareToken
			if inputFiles != nil {
				run.InputFiles = append([]string(nil), inputFiles...)
			}
			// 扫描输出文件并更新
			_, resultFiles := scanShareRunFiles(shareToken, runID)
			if len(resultFiles) > 0 {
				run.ResultFiles = resultFiles
			}
			run.UpdatedAt = time.Now()
		} else {
			now := time.Now()
			clonedInputs := append([]string(nil), inputFiles...)
			// 扫描输出文件
			_, resultFiles := scanShareRunFiles(shareToken, runID)
			governanceShareRuns[runID] = &GovernanceShareRun{
				ID:          runID,
				TaskID:      taskID,
				ShareToken:  shareToken,
				Status:      shareStatus,
				Progress:    100,
				Output:      shareOutput,
				InputFiles:  clonedInputs,
				ResultFiles: resultFiles,
				CreatedAt:   now,
				UpdatedAt:   now,
			}
		}
		governanceShareRunsMu.Unlock()
		if err := saveDataOntologyStore(); err != nil {
			log.Printf("[TaskRun] 保存分享执行记录失败: %v", err)
		}
	}
}

// governanceWorker 任务执行器，从队列取出任务并执行

func governanceWorker() {
	for job := range governanceJobQueue {
		executeGovernanceJob(job)
	}
}

// executeGovernanceTaskForAPI 为 API 调用执行任务（同步返回结果）
// 返回结果包含 output（文本输出）和 output_files（生成的文件下载链接）

func executeGovernanceTaskForAPI(task *GovernanceTask, params map[string]interface{}) (interface{}, error) {
	// 获取任务信息
	dataOntologyMu.RLock()
	dbID := task.DatabaseID
	dbType := ""
	if db, ok := dataOntologyDatabases[dbID]; ok {
		dbType = db.Type
	}
	// 构建数据库列表
	var databases []map[string]string
	for id, db := range dataOntologyDatabases {
		if !dataOntologyResourceVisible(db.Owner, task.Owner) {
			continue
		}
		databases = append(databases, map[string]string{
			"id":   id,
			"name": db.Name,
			"type": db.Type,
		})
	}
	dataOntologyMu.RUnlock()

	// 生成 runID 用于输出文件目录
	runID := uuid.New().String()

	// 准备任务参数
	taskData := map[string]interface{}{
		"code":        task.JsCode,
		"token":       "", // API 调用不需要 token
		"database_id": dbID,
		"db_type":     dbType,
		"databases":   databases,
		"input_text":  "", // 默认空，下面会根据参数填充
		"api_params":  params, // 传入 API 参数
	}

	// 将 api_params 序列化为 JSON 字符串注入到 INPUT_DATA
	if len(params) > 0 {
		if paramsJSON, err := json.Marshal(params); err == nil {
			taskData["input_text"] = string(paramsJSON)
		}
	}

	// 处理文件参数
	// 多文件模式：params["files"] 可能是 []map[string]interface{} 或 []interface{}
	if filesVal, ok := params["files"]; ok {
		switch fv := filesVal.(type) {
		case []map[string]interface{}:
			if len(fv) > 0 {
				taskData["files"] = fv
			}
		case []interface{}:
			var filePayloads []map[string]interface{}
			for _, fRaw := range fv {
				fMap, ok := fRaw.(map[string]interface{})
				if !ok {
					continue
				}
				filePayloads = append(filePayloads, fMap)
			}
			if len(filePayloads) > 0 {
				taskData["files"] = filePayloads
			}
		}
	}
	// 单文件模式：file_base64 + file_name
	if fileBase64, ok := params["file_base64"].(string); ok {
		taskData["file_base64"] = fileBase64
	}
	if fileName, ok := params["file_name"].(string); ok {
		taskData["file_name"] = fileName
	}
	if inputText, ok := params["input_text"].(string); ok {
		taskData["input_text"] = inputText
	}

	// 执行任务
	result := callGovRunner(taskData)
	if !result.Success {
		return nil, fmt.Errorf("%s", result.Error)
	}

	// 构建返回结果
	resp := map[string]interface{}{
		"output":       result.Output,
		"output_files": []map[string]string{},
	}

	// 落盘输出文件并生成下载链接
	if len(result.OutputFiles) > 0 {
		dir := filepath.Join("data", "api-outputs", task.ID, runID)
		_ = os.MkdirAll(dir, 0755)
		var outputFiles []map[string]string
		for _, f := range result.OutputFiles {
			if f.Name == "" || f.ContentBase64 == "" {
				continue
			}
			safe := sanitizeGovOutputFilename(f.Name)
			data, err := base64.StdEncoding.DecodeString(f.ContentBase64)
			if err != nil {
				continue
			}
			path := filepath.Join(dir, safe)
			if err := os.WriteFile(path, data, 0644); err != nil {
				continue
			}
			// 生成下载链接
			q := url.Values{}
			q.Set("task_id", task.ID)
			q.Set("run_id", runID)
			q.Set("name", safe)
			downloadURL := "/api/governance/download-api-output?" + q.Encode()
			outputFiles = append(outputFiles, map[string]string{
				"name":         safe,
				"download_url": downloadURL,
			})
		}
		resp["output_files"] = outputFiles
	}

	// 兼容：如果只有一条文本输出且无文件，直接返回文本
	if len(result.Output) == 1 && len(result.OutputFiles) == 0 {
		return result.Output[0], nil
	}
	return resp, nil
}

// GovOutputFile gov-runner 生成的二进制输出

type GovOutputFile struct {
	Name          string `json:"name"`
	ContentBase64 string `json:"content_base64"`
}

// GovRunnerResult gov-runner 执行结果

type GovRunnerResult struct {
	Success     bool            `json:"success"`
	Output      []string        `json:"output"`
	Error       string          `json:"error"`
	OutputFiles []GovOutputFile `json:"output_files,omitempty"`
}

func sanitizeGovOutputFilename(name string) string {
	base := filepath.Base(name)
	if base == "." || base == "" {
		return "output.docx"
	}
	return base
}

// governanceWriteOutputFilesForShare 将分享任务的输出文件落盘到 share-outputs 目录

func governanceWriteOutputFilesForShare(shareToken string, runID string, files []GovOutputFile) []string {
	if shareToken == "" || runID == "" || len(files) == 0 {
		return nil
	}
	dir := filepath.Join("data", "share-outputs", shareToken, runID)
	_ = os.MkdirAll(dir, 0755)
	var lines []string
	for _, f := range files {
		if f.Name == "" || f.ContentBase64 == "" {
			continue
		}
		safe := sanitizeGovOutputFilename(f.Name)
		data, err := base64.StdEncoding.DecodeString(f.ContentBase64)
		if err != nil {
			continue
		}
		path := filepath.Join(dir, safe)
		if err := os.WriteFile(path, data, 0644); err != nil {
			continue
		}
		lines = append(lines, fmt.Sprintf("输出文件: %s", safe))
	}
	return lines
}

// governanceWriteOutputFiles 将 gov-runner 输出的文件落盘并返回日志行（含下载路径）

func governanceWriteOutputFiles(runID string, files []GovOutputFile) []string {
	if runID == "" || len(files) == 0 {
		return nil
	}
	dir := filepath.Join(os.TempDir(), "gov-output-downloads", runID)
	_ = os.MkdirAll(dir, 0755)
	var lines []string
	for _, f := range files {
		if f.Name == "" || f.ContentBase64 == "" {
			continue
		}
		safe := sanitizeGovOutputFilename(f.Name)
		data, err := base64.StdEncoding.DecodeString(f.ContentBase64)
		if err != nil {
			continue
		}
		path := filepath.Join(dir, safe)
		if err := os.WriteFile(path, data, 0644); err != nil {
			continue
		}
		q := url.Values{}
		q.Set("run_id", runID)
		q.Set("name", safe)
		lines = append(lines, fmt.Sprintf("输出文件 %s — 下载: /api/governance/download-output?%s", safe, q.Encode()))
	}
	return lines
}

// executeGovernanceJob 执行单个治理任务

func executeGovernanceJob(job *GovernanceJob) {
	taskID := job.TaskID
	runID := job.RunID
	isShare := job.ShareToken != ""

	// 获取任务信息
	dataOntologyMu.RLock()
	task, exists := governanceTasks[taskID]
	if !exists {
		dataOntologyMu.RUnlock()
		if isShare {
			updateShareRun(runID, "failed", 0, "任务不存在", nil, nil)
		}
		return
	}
	code := task.JsCode
	dbID := task.DatabaseID
	batchMode := task.FileBatchMode
	if batchMode == "" {
		batchMode = "per_file"
	}
	dbType := ""
	if db, ok := dataOntologyDatabases[dbID]; ok {
		dbType = db.Type
	}
	// 构建数据库列表（仅包含任务所属用户可见的配置，避免泄露他人连接信息）
	var databases []map[string]string
	for id, db := range dataOntologyDatabases {
		if !dataOntologyResourceVisible(db.Owner, task.Owner) {
			continue
		}
		databases = append(databases, map[string]string{
			"id":   id,
			"name": db.Name,
			"type": db.Type,
		})
	}
	dataOntologyMu.RUnlock()

	// 如果是分享任务，初始化执行记录
	if isShare {
		updateShareRun(runID, "running", 0, "开始执行...", nil, nil)
	}

	// 准备任务参数
	// 构建 currentGovTask 对象（手动构建确保字段正确序列化）
	currentGovTask := map[string]interface{}{
		"id":              task.ID,
		"name":            task.Name,
		"database_id":     task.DatabaseID,
		"type":            task.Type,
		"description":     task.Description,
		"js_code":         task.JsCode,
		"cron_expr":       task.CronExpr,
		"enabled":         task.Enabled,
		"input_type":      task.InputType,
		"accept_exts":     task.AcceptExts,
		"register_as_api": task.RegisterAsAPI,
		"api_path":        task.APIPath,
		"api_method":      task.APIMethod,
		"file_batch_mode": task.FileBatchMode,
		"runtime":         task.Runtime,
		"run_mode":        task.RunMode,
		"execution_mode":  task.ExecutionMode,
		"owner":           task.Owner,
		"created_at":      task.CreatedAt,
	}

	taskData := map[string]interface{}{
		"code":             code,
		"token":            job.Token,
		"database_id":      dbID,
		"db_type":          dbType,
		"databases":        databases,
		"input_text":       job.InputText,
		"current_gov_task": currentGovTask,
	}
	// 如果是分享任务，传入 share_token 让 runner 使用免鉴权端点
	if isShare {
		taskData["share_token"] = job.ShareToken
	}

	// 如果有文件，读取并转为 base64
	if len(job.InputFiles) > 0 {
		// "single" 或 "multi" 模式：多文件合并执行
		if batchMode == "single" || batchMode == "multi" {
			var filePayloads []map[string]interface{}
			for _, filePath := range job.InputFiles {
				data, err := os.ReadFile(filePath)
				if err != nil {
					log.Printf("读取文件失败: %v", err)
					errMsg := "读取文件失败: " + err.Error()
				if isShare {
					updateShareRun(runID, "failed", 100, errMsg, nil, nil)
				} else {
						dataOntologyMu.Lock()
						if t, ok := governanceTasks[taskID]; ok {
							t.Status = "error"
							t.LastError = errMsg
							t.LastRunAt = time.Now().Format(time.RFC3339)
							t.ProcessedFiles = len(job.InputFiles)
							t.Percent = 100
						}
						dataOntologyMu.Unlock()
						saveDataOntologyStore()
						governanceFinalizeRunLogFromTaskWithShare(taskID, runID, job.InputFiles, isShare, job.ShareToken)
					}
					tmpDir := filepath.Join(os.TempDir(), "gov-tasks", taskID)
					os.RemoveAll(tmpDir)
					return
				}
				filePayloads = append(filePayloads, map[string]interface{}{
					"file_name":   filepath.Base(filePath),
					"file_base64": base64.StdEncoding.EncodeToString(data),
				})
			}
			// 分享任务保留输入文件供用户下载，普通任务读取后删除节省空间
			if !isShare {
				for _, filePath := range job.InputFiles {
					os.Remove(filePath)
				}
			}
			taskData["files"] = filePayloads

			if isShare {
				updateShareRun(runID, "running", 50, "合并执行...", nil, nil)
			} else {
				dataOntologyMu.Lock()
				if t, ok := governanceTasks[taskID]; ok {
					t.ProcessedFiles = 0
					t.Percent = 50
					t.CurrentFile = "合并执行"
				}
				dataOntologyMu.Unlock()
				saveDataOntologyStore()
			}

			result := callGovRunner(taskData)
			var extraLines []string
			if len(result.OutputFiles) > 0 {
				if isShare {
					// 分享任务：写入到 share-outputs 目录
					extraLines = governanceWriteOutputFilesForShare(job.ShareToken, runID, result.OutputFiles)
				} else {
					extraLines = governanceWriteOutputFiles(job.RunID, result.OutputFiles)
				}
			}
			if !result.Success {
				log.Printf("任务 %s 合并执行失败: %s", taskID, result.Error)
			} else {
				log.Printf("任务 %s 合并执行成功", taskID)
			}

		if isShare {
			var resultFiles []string
			for _, f := range result.OutputFiles {
				resultFiles = append(resultFiles, f.Name)
			}
			status := "completed"
			output := strings.Join(result.Output, "\n")
			if len(extraLines) > 0 {
				output += "\n" + strings.Join(extraLines, "\n")
			}
			if !result.Success {
				status = "failed"
				output = result.Error + "\n" + output
			}
			updateShareRun(runID, status, 100, output, job.InputFiles, resultFiles)
			// 分享任务也要更新任务本身的状态
			dataOntologyMu.Lock()
			if t, ok := governanceTasks[taskID]; ok {
				if result.Success {
					t.Status = "success"
					out := strings.Join(result.Output, "\n")
					if len(extraLines) > 0 {
						out += "\n" + strings.Join(extraLines, "\n")
					}
					t.LastOutput = out
				} else {
					t.Status = "error"
					t.LastError = result.Error
					if len(result.Output) > 0 {
						t.LastOutput = strings.Join(result.Output, "\n")
					}
				}
				t.LastRunAt = time.Now().Format(time.RFC3339)
				t.ProcessedFiles = len(job.InputFiles)
				t.Percent = 100
				t.CurrentFile = ""
			}
			dataOntologyMu.Unlock()
			saveDataOntologyStore()
			// 分享任务也要更新日志记录
			governanceFinalizeRunLogFromTaskWithShare(taskID, runID, job.InputFiles, isShare, job.ShareToken)
		} else {
			dataOntologyMu.Lock()
			if t, ok := governanceTasks[taskID]; ok {
				if result.Success {
					t.Status = "success"
					out := strings.Join(result.Output, "\n")
					if len(extraLines) > 0 {
						out += "\n" + strings.Join(extraLines, "\n")
					}
					t.LastOutput = out
				} else {
					t.Status = "error"
					t.LastError = result.Error
					if len(result.Output) > 0 {
						t.LastOutput = strings.Join(result.Output, "\n")
					}
				}
				t.LastRunAt = time.Now().Format(time.RFC3339)
				t.ProcessedFiles = len(job.InputFiles)
				t.Percent = 100
				t.CurrentFile = ""
			}
			dataOntologyMu.Unlock()
			saveDataOntologyStore()
			governanceFinalizeRunLogFromTaskWithShare(taskID, runID, job.InputFiles, isShare, job.ShareToken)
		}
	} else {
			var allOutput []string
			var lastError string

			for i, filePath := range job.InputFiles {
				data, err := os.ReadFile(filePath)
				if err != nil {
					log.Printf("读取文件失败: %v", err)
					lastError = "读取文件失败: " + err.Error()
					continue
				}
				taskData["file_base64"] = base64.StdEncoding.EncodeToString(data)
				taskData["file_name"] = filepath.Base(filePath)

				// 更新进度
			progress := (i * 100) / len(job.InputFiles)
			if isShare {
				updateShareRun(runID, "running", progress, fmt.Sprintf("处理文件: %s", filepath.Base(filePath)), nil, nil)
			} else {
					dataOntologyMu.Lock()
					if t, ok := governanceTasks[taskID]; ok {
						t.ProcessedFiles = i
						t.Percent = progress
						t.CurrentFile = filepath.Base(filePath)
					}
					dataOntologyMu.Unlock()
					saveDataOntologyStore()
				}

				// 执行单个文件
				result := callGovRunner(taskData)
				var extraLines []string
				if len(result.OutputFiles) > 0 {
					if isShare {
						extraLines = governanceWriteOutputFilesForShare(job.ShareToken, runID, result.OutputFiles)
					} else {
						extraLines = governanceWriteOutputFiles(job.RunID, result.OutputFiles)
					}
				}
				if !result.Success {
					log.Printf("任务 %s 文件 %s 执行失败: %s", taskID, filePath, result.Error)
					lastError = result.Error
					if len(result.Output) > 0 {
						allOutput = append(allOutput, result.Output...)
					}
					if len(extraLines) > 0 {
						allOutput = append(allOutput, extraLines...)
					}
				} else {
					log.Printf("任务 %s 文件 %s 执行成功", taskID, filePath)
					allOutput = append(allOutput, result.Output...)
					if len(extraLines) > 0 {
						allOutput = append(allOutput, extraLines...)
					}
				}

				// 清理临时文件
				os.Remove(filePath)

				// 每处理完一个文件更新输出
				if isShare {
					updateShareRun(runID, "running", progress, strings.Join(allOutput, "\n"), nil, nil)
				} else {
					dataOntologyMu.Lock()
					if t, ok := governanceTasks[taskID]; ok {
						if len(allOutput) > 0 {
							t.LastOutput = strings.Join(allOutput, "\n")
						}
						if lastError != "" {
							t.LastError = lastError
						}
					}
					dataOntologyMu.Unlock()
					saveDataOntologyStore()
				}
			}

			// 更新最终状态
			if isShare {
				var resultFiles []string
				// 收集所有输出文件名
				outputDir := filepath.Join("data", "share-outputs", job.ShareToken, runID)
				if files, err := os.ReadDir(outputDir); err == nil {
					for _, f := range files {
						if !f.IsDir() {
							resultFiles = append(resultFiles, f.Name())
						}
					}
				}
				status := "completed"
				output := strings.Join(allOutput, "\n")
			if lastError != "" {
				status = "failed"
				output = lastError + "\n" + output
			}
			updateShareRun(runID, status, 100, output, job.InputFiles, resultFiles)
		} else {
				dataOntologyMu.Lock()
				if t, ok := governanceTasks[taskID]; ok {
					if lastError == "" {
						t.Status = "success"
						t.LastOutput = strings.Join(allOutput, "\n")
					} else {
						t.Status = "error"
						t.LastError = lastError
						if len(allOutput) > 0 {
							t.LastOutput = strings.Join(allOutput, "\n")
						}
					}
					t.LastRunAt = time.Now().Format(time.RFC3339)
					t.ProcessedFiles = len(job.InputFiles)
					t.Percent = 100
				}
				dataOntologyMu.Unlock()
				saveDataOntologyStore()
				governanceFinalizeRunLogFromTaskWithShare(taskID, runID, job.InputFiles, isShare, job.ShareToken)
			}
		}
	} else {
		// 无文件，直接执行
		result := callGovRunner(taskData)
		if !result.Success {
			log.Printf("任务 %s 执行失败: %s", taskID, result.Error)
		} else {
			log.Printf("任务 %s 执行成功，输出: %v", taskID, result.Output)
		}

		// 更新任务状态
		if isShare {
			var resultFiles []string
			var extraLines []string
			if len(result.OutputFiles) > 0 {
				extraLines = governanceWriteOutputFilesForShare(job.ShareToken, runID, result.OutputFiles)
				for _, f := range result.OutputFiles {
					resultFiles = append(resultFiles, f.Name)
				}
		}
		status := "completed"
		output := strings.Join(result.Output, "\n")
		if len(extraLines) > 0 {
			output += "\n" + strings.Join(extraLines, "\n")
		}
		if !result.Success {
			status = "failed"
			output = result.Error + "\n" + output
		}
		updateShareRun(runID, status, 100, output, nil, resultFiles)
	} else {
			dataOntologyMu.Lock()
			if t, ok := governanceTasks[taskID]; ok {
				if result.Success {
					t.Status = "success"
					t.LastOutput = strings.Join(result.Output, "\n")
				} else {
					t.Status = "error"
					t.LastError = result.Error
				}
				t.LastRunAt = time.Now().Format(time.RFC3339)
			}
			dataOntologyMu.Unlock()
			saveDataOntologyStore()
			governanceFinalizeRunLogFromTaskWithShare(taskID, runID, job.InputFiles, isShare, job.ShareToken)
		}
	}

	// 清理临时目录
	if len(job.InputFiles) > 0 {
		tmpDir := filepath.Join(os.TempDir(), "gov-tasks", taskID)
		os.RemoveAll(tmpDir)
	}
}

// callGovRunner 调用 gov-runner 执行任务

func callGovRunner(taskData map[string]interface{}) *GovRunnerResult {
	runnerPath, err := resolveGovRunnerPath()
	if err != nil {
		return &GovRunnerResult{
			Success: false,
			Error:   err.Error(),
		}
	}

	// 写入临时任务文件
	taskJSON, _ := json.Marshal(taskData)
	// DEBUG: 打印 current_gov_task 内容
	if cgTask, ok := taskData["current_gov_task"]; ok {
		log.Printf("[DEBUG] current_gov_task before marshal: %+v", cgTask)
	}
	log.Printf("[DEBUG] taskJSON sample: %s", string(taskJSON[:min(500, len(taskJSON))]))
	tmpFile := filepath.Join(os.TempDir(), fmt.Sprintf("gov-task-%d.json", time.Now().UnixNano()))
	// DEBUG: 保留临时文件用于调试
	debugFile := filepath.Join(os.TempDir(), "gov-task-debug.json")
	os.WriteFile(debugFile, taskJSON, 0644)
	if err := os.WriteFile(tmpFile, taskJSON, 0644); err != nil {
		return &GovRunnerResult{
			Success: false,
			Error:   "写入任务文件失败: " + err.Error(),
		}
	}
	defer os.Remove(tmpFile)

	// 执行 gov-runner
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Minute)
	defer cancel()

	cmd := exec.CommandContext(ctx, runnerPath, tmpFile)
	apiBase := govRunnerAPIBase
	if apiBase == "" {
		apiBase = "http://127.0.0.1:8080"
	}
	cmd.Env = append(os.Environ(), "GOV_RUNNER_CLI=true", "API_BASE="+apiBase)
	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr
	runErr := cmd.Run()
	outBytes := bytes.TrimSpace(stdout.Bytes())
	errBytes := bytes.TrimSpace(stderr.Bytes())

	if len(outBytes) == 0 {
		if runErr != nil {
			errMsg := runErr.Error()
			if len(errBytes) > 0 {
				errMsg += " | stderr: " + string(errBytes)
			}
			return &GovRunnerResult{Success: false, Error: "执行失败: " + errMsg}
		}
		errMsg := "gov-runner 无输出"
		if len(errBytes) > 0 {
			errMsg += " | stderr: " + string(errBytes)
		}
		return &GovRunnerResult{Success: false, Error: errMsg}
	}

	var result GovRunnerResult
	if err := json.Unmarshal(outBytes, &result); err != nil {
		return &GovRunnerResult{
			Success: false,
			Error:   "解析结果失败: " + err.Error(),
		}
	}
	return &result
}

func governanceScheduler() {
	for {
		time.Sleep(30 * time.Second)
		now := time.Now()

		dataOntologyMu.RLock()
		var tasksToRun []struct {
			id   string
			code string
			dbID string
		}
		for _, task := range governanceTasks {
			if task.Type == "scheduled" && task.Enabled && task.Status != "running" {
				if cronMatch(task.CronExpr, now) {
					tasksToRun = append(tasksToRun, struct {
						id   string
						code string
						dbID string
					}{task.ID, task.JsCode, task.DatabaseID})
				}
			}
		}
		dataOntologyMu.RUnlock()

		for _, t := range tasksToRun {
			log.Printf("定时任务触发: %s (需在前端执行)", t.id)
			_ = t.code
			_ = t.dbID
		}
	}
}

// cronMatch 简易 cron 表达式匹配 "分 时 日 月 周"

func cronMatch(expr string, t time.Time) bool {
	if expr == "" {
		return false
	}
	fields := strings.Fields(expr)
	if len(fields) != 5 {
		return false
	}
	values := []int{t.Minute(), t.Hour(), t.Day(), int(t.Month()), int(t.Weekday())}
	for i, field := range fields {
		if !cronFieldMatch(field, values[i]) {
			return false
		}
	}
	return true
}

func cronFieldMatch(field string, value int) bool {
	if field == "*" {
		return true
	}
	// 支持逗号分隔
	for _, part := range strings.Split(field, ",") {
		part = strings.TrimSpace(part)
		// 支持 */n 步进
		if strings.HasPrefix(part, "*/") {
			step, err := strconv.Atoi(strings.TrimPrefix(part, "*/"))
			if err == nil && step > 0 && value%step == 0 {
				return true
			}
			continue
		}
		// 支持 a-b 范围
		if strings.Contains(part, "-") {
			rangeParts := strings.Split(part, "-")
			if len(rangeParts) == 2 {
				low, err1 := strconv.Atoi(rangeParts[0])
				high, err2 := strconv.Atoi(rangeParts[1])
				if err1 == nil && err2 == nil && value >= low && value <= high {
					return true
				}
			}
			continue
		}
		// 精确匹配
		v, err := strconv.Atoi(part)
		if err == nil && v == value {
			return true
		}
	}
	return false
}

// ===== SSH/SFTP 运维支持 =====

// SFTPSession 保存一个 SFTP 会话的 SSH+SFTP 客户端

type SFTPSession struct {
	ID         string
	SSHClient  *gossh.Client
	SFTPClient *sftp.Client
	LastUsed   time.Time
}

var (
	sftpSessionsMu  sync.RWMutex
	sftpSessionsMap = make(map[string]*SFTPSession)
)

// getSFTPSession 线程安全地获取并刷新会话最后使用时间

// handleGovernanceTaskAPI 处理注册为 API 的治理任务调用
// 路由: POST /api/tasks/{api_path}
func handleGovernanceTaskAPI(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")
	
	if r.Method == http.MethodOptions {
		w.WriteHeader(http.StatusOK)
		return
	}
	
	if r.Method != http.MethodPost {
		json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "message": "只支持POST"})
		return
	}
	
	// 提取 api_path
	pathParts := strings.Split(strings.TrimPrefix(r.URL.Path, "/api/tasks/"), "/")
	if len(pathParts) == 0 || pathParts[0] == "" {
		json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "message": "缺少API路径"})
		return
	}
	apiPath := pathParts[0]
	
	// 根据 api_path 查找任务
	dataOntologyMu.RLock()
	var matchedTask *GovernanceTask
	for _, task := range governanceTasks {
		if task.APIPath == "/api/tasks/"+apiPath && task.RegisterAsAPI {
			matchedTask = task
			break
		}
	}
	dataOntologyMu.RUnlock()
	
	if matchedTask == nil {
		json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "message": "API不存在"})
		return
	}
	
	// 检查任务是否启用
	if !matchedTask.Enabled {
		json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "message": "该任务已禁用", "error_code": "FORBIDDEN"})
		return
	}
	
	// 复用 handleGovernanceTaskRun 的逻辑
	// 但 API 调用可能不需要鉴权（根据任务配置）
	token := ""
	if auth := r.Header.Get("Authorization"); strings.HasPrefix(auth, "Bearer ") {
		token = strings.TrimPrefix(auth, "Bearer ")
	}
	// API 调用允许无 token（公开 API）或使用内部调用鉴权
	if token == "" {
		// 检查是否是内部调用
		if r.Header.Get("X-Internal-Call") == "" {
			// 公开 API，使用 admin token
			token = "internal-api-call"
		}
	}
	
	// 解析请求
	var inputText string
	var filePaths []string
	
	contentType := r.Header.Get("Content-Type")
	if strings.Contains(contentType, "multipart/form-data") {
		maxSize := int64(100 * 1024 * 1024)
		r.Body = http.MaxBytesReader(w, r.Body, maxSize)
		if err := r.ParseMultipartForm(maxSize); err != nil {
			json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "message": "解析表单失败: " + err.Error()})
			return
		}
		inputText = r.FormValue("input_text")
		
		files := r.MultipartForm.File["files"]
		for _, fileHeader := range files {
			safeFilename, err := sanitizeFilename(fileHeader.Filename)
			if err != nil {
				continue
			}
			file, err := fileHeader.Open()
			if err != nil {
				continue
			}
			tmpDir := filepath.Join(os.TempDir(), "gov-tasks", matchedTask.ID)
			if err := os.MkdirAll(tmpDir, 0755); err != nil {
				file.Close()
				continue
			}
			tmpPath := filepath.Join(tmpDir, safeFilename)
			dst, err := os.Create(tmpPath)
			if err != nil {
				file.Close()
				continue
			}
			io.Copy(dst, file)
			file.Close()
			dst.Close()
			filePaths = append(filePaths, tmpPath)
		}
	} else {
		var req struct {
			InputText string `json:"input_text"`
		}
		json.NewDecoder(r.Body).Decode(&req)
		inputText = req.InputText
	}
	
	// 创建任务
	runID := uuid.New().String()
	startedAt := time.Now().Format(time.RFC3339)
	job := &GovernanceJob{
		TaskID:     matchedTask.ID,
		RunID:      runID,
		Token:      token,
		InputFiles: filePaths,
		InputText:  inputText,
		ShareToken: matchedTask.ShareToken,
	}
	
	// 更新任务状态
	dataOntologyMu.Lock()
	matchedTask.Status = "running"
	matchedTask.RunID = runID
	matchedTask.StartedAt = startedAt
	matchedTask.TotalFiles = len(filePaths)
	matchedTask.ProcessedFiles = 0
	matchedTask.Percent = 0
	dataOntologyMu.Unlock()
	
	// 写入运行中日志
	governanceAppendRunningLog(matchedTask.ID, job, startedAt)
	
	// 入队
	select {
	case governanceJobQueue <- job:
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": true,
			"run_id":  runID,
			"message": "任务已入队，正在后台执行",
		})
	default:
		dataOntologyMu.Lock()
		if t, ok := governanceTasks[matchedTask.ID]; ok {
			t.Status = "idle"
			t.RunID = ""
		}
		dataOntologyMu.Unlock()
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"message": "任务队列已满，请稍后重试",
		})
	}
}

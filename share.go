package main

import (
	"encoding/json"
	"fmt"
	"github.com/google/uuid"
	"io"
	"log"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

func handleGovernanceShareInfo(w http.ResponseWriter, r *http.Request, task *GovernanceTask) {
	w.Header().Set("Content-Type", "application/json")
	if r.Method != http.MethodGet {
		json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "message": "只支持GET"})
		return
	}

	// 兼容旧数据：scheduled 类型任务默认使用 backend 执行模式
	executionMode := task.ExecutionMode
	if executionMode == "" && task.Type == "scheduled" {
		executionMode = "backend"
	}

	json.NewEncoder(w).Encode(map[string]interface{}{
		"success":        true,
		"name":           task.Name,
		"description":    task.Description,
		"type":           task.Type,
		"input_type":     task.InputType,
		"accept_exts":    task.AcceptExts,
		"example_files":  task.ExampleFiles,
		"execution_mode": executionMode,
	})
}

// handleGovernanceShareExampleDownload 免鉴权下载分享任务的示例文件

func handleGovernanceShareExampleDownload(w http.ResponseWriter, r *http.Request, task *GovernanceTask, filename string) {
	if r.Method != http.MethodGet {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "message": "只支持GET"})
		return
	}

	// URL 解码文件名
	decodedFilename, err := url.PathUnescape(filename)
	if err != nil {
		decodedFilename = filename
	}

	// 验证文件名在任务的 example_files 中
	found := false
	var actualPath string
	for _, ef := range task.ExampleFiles {
		if ef.Path == decodedFilename || ef.Name == decodedFilename {
			found = true
			actualPath = ef.Path
			break
		}
	}
	if !found {
		http.Error(w, "Not Found", http.StatusNotFound)
		return
	}

	// 安全检查
	safe := sanitizeGovernanceExampleFilename(actualPath)
	if safe == "" {
		http.Error(w, "Bad Request", http.StatusBadRequest)
		return
	}

	// 优先从磁盘读取，fallback 到 embed
	data, err := getGovernanceExampleFile(safe)
	if err != nil {
		http.Error(w, "Not Found", http.StatusNotFound)
		return
	}

	// 设置响应头
	w.Header().Set("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document")
	w.Header().Set("Content-Disposition", `attachment; filename="`+safe+`"`)
	w.Write(data)
}

// handleGovernanceShareRun 执行分享任务

func handleGovernanceShareRun(w http.ResponseWriter, r *http.Request, task *GovernanceTask, shareToken string) {
	w.Header().Set("Content-Type", "application/json")
	if r.Method != http.MethodPost {
		json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "message": "只支持POST"})
		return
	}

	// 解析上传的文件
	var filePaths []string
	var inputFileNames []string
	contentType := r.Header.Get("Content-Type")
	if strings.Contains(contentType, "multipart/form-data") {
		maxSize := int64(100 * 1024 * 1024) // 100MB
		r.Body = http.MaxBytesReader(w, r.Body, maxSize)
		if err := r.ParseMultipartForm(maxSize); err != nil {
			json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "message": "解析表单失败: " + err.Error()})
			return
		}

		// 先生成 runID，所有文件保存到同一个目录
		runID := uuid.New().String()
		uploadDir := filepath.Join("apps", "data-ontology", "share-uploads", shareToken, runID)
		if err := os.MkdirAll(uploadDir, 0755); err != nil {
			json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "message": "创建上传目录失败"})
			return
		}

		files := r.MultipartForm.File["files"]
		for _, fileHeader := range files {
			safeFilename, err := sanitizeFilename(fileHeader.Filename)
			if err != nil {
				log.Printf("[GovernanceShare] 文件名无效: %v", err)
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
			filePaths = append(filePaths, tmpPath)
			inputFileNames = append(inputFileNames, safeFilename)
		}

		// 保存 runID 供后续使用
		r.URL.RawQuery = r.URL.RawQuery + "&_runID=" + runID
	}

	// 对于定时任务（scheduled类型）或后端执行模式，可以不需要上传文件
	isScheduledTask := task.Type == "scheduled" || task.ExecutionMode == "backend"
	if len(filePaths) == 0 && !isScheduledTask {
		json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "message": "未上传文件"})
		return
	}

	// 获取 runID（从上面保存的参数中提取）
	runID := r.URL.Query().Get("_runID")
	if runID == "" {
		runID = uuid.New().String()
	}

	// 创建执行记录
	now := time.Now()
	shareRun := &GovernanceShareRun{
		ID:          runID,
		TaskID:      task.ID,
		ShareToken:  shareToken,
		Status:      "pending",
		Progress:    0,
		Output:      "",
		InputFiles:  inputFileNames,
		ResultFiles: []string{},
		CreatedAt:   now,
		UpdatedAt:   now,
	}

	governanceShareRunsMu.Lock()
	governanceShareRuns[runID] = shareRun
	governanceShareRunsMu.Unlock()

	// 持久化新创建的执行记录
	if err := saveDataOntologyStore(); err != nil {
		log.Printf("保存分享执行记录失败: %v", err)
	}

	// 创建任务并入队（分享任务不依赖用户 token，AI 调用走免鉴权端点）
	job := &GovernanceJob{
		TaskID:     task.ID,
		RunID:      runID,
		Token:      "", // 分享任务不需要用户 token
		InputFiles: filePaths,
		InputText:  "",
		ShareToken: shareToken,
	}

	select {
	case governanceJobQueue <- job:
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": true,
			"run_id":  runID,
			"message": "任务已入队，正在后台执行",
		})
	default:
		governanceShareRunsMu.Lock()
		delete(governanceShareRuns, runID)
		governanceShareRunsMu.Unlock()
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"message": "任务队列已满，请稍后重试",
		})
	}
}

// handleGovernanceShareRunStatus 查询分享任务执行状态

func handleGovernanceShareRunStatus(w http.ResponseWriter, r *http.Request, task *GovernanceTask, runID string) {
	w.Header().Set("Content-Type", "application/json")
	if r.Method != http.MethodGet {
		json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "message": "只支持GET"})
		return
	}

	// 优先从 governanceShareRuns 读取（任务入队时即创建，包含 pending/running 状态）
	governanceShareRunsMu.RLock()
	shareRun, shareRunExists := governanceShareRuns[runID]
	governanceShareRunsMu.RUnlock()

	// 从 governanceTaskLogs 读取（任务执行完成后写入）
	dataOntologyMu.RLock()
	logs := governanceTaskLogs[task.ID]
	dataOntologyMu.RUnlock()

	var taskLog *GovernanceTaskLog
	for _, l := range logs {
		if l != nil && l.RunID == runID {
			taskLog = l
			break
		}
	}

	// 如果 log 存在，以 log 为准（任务已完成）
	if taskLog != nil {
		status := "completed"
		output := taskLog.Output
		if taskLog.Status == "error" {
			status = "failed"
			if taskLog.Error != "" {
				if output != "" {
					output = taskLog.Error + "\n" + output
				} else {
					output = taskLog.Error
				}
			}
		}

		// 扫描该运行的文件列表
		inputFiles, outputFiles := scanShareRunFiles(task.ShareToken, runID)

		json.NewEncoder(w).Encode(map[string]interface{}{
			"success":      true,
			"status":       status,
			"progress":     100,
			"output":       output,
			"input_files":  inputFiles,
			"result_files": outputFiles,
			"created_at":   taskLog.StartTime,
			"updated_at":   taskLog.EndTime,
		})
		return
	}

	// log 不存在，检查 shareRun（任务还在队列中或正在执行）
	if shareRunExists {
		// 扫描输出文件（执行过程中可能有中间输出）
		_, outputFiles := scanShareRunFiles(task.ShareToken, runID)

		json.NewEncoder(w).Encode(map[string]interface{}{
			"success":      true,
			"status":       shareRun.Status,   // pending / running
			"progress":     shareRun.Progress,  // 0-100
			"output":       shareRun.Output,
			"input_files":  shareRun.InputFiles,
			"result_files": outputFiles,
			"created_at":   shareRun.CreatedAt,
			"updated_at":   shareRun.UpdatedAt,
		})
		return
	}

	// 两者都不存在
	json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "message": "执行记录不存在"})
}

// scanShareRunFiles 扫描分享任务的输入/输出文件
// 返回 inputFiles 和 outputFiles 两个列表

func scanShareRunFiles(shareToken, runID string) (inputFiles, outputFiles []string) {
	dataDir := filepath.Dir(getDataOntologyStorePath())
	
	// 初始化为空切片（避免返回 nil）
	inputFiles = []string{}
	outputFiles = []string{}
	
	// 扫描输入文件目录: share-uploads/{shareToken}/{runID}/
	uploadDir := filepath.Join(dataDir, "share-uploads", shareToken, runID)
	log.Printf("[DEBUG] scanShareRunFiles: uploadDir=%s", uploadDir)
	if entries, err := os.ReadDir(uploadDir); err == nil {
		for _, entry := range entries {
			if !entry.IsDir() {
				// 返回完整路径
				inputFiles = append(inputFiles, filepath.Join(uploadDir, entry.Name()))
			}
		}
	} else {
		log.Printf("[DEBUG] scanShareRunFiles: uploadDir read error: %v", err)
	}
	
	// 扫描输出文件目录: share-outputs/{shareToken}/{runID}/
	outputDir := filepath.Join(dataDir, "share-outputs", shareToken, runID)
	log.Printf("[DEBUG] scanShareRunFiles: outputDir=%s", outputDir)
	if entries, err := os.ReadDir(outputDir); err == nil {
		for _, entry := range entries {
			if !entry.IsDir() {
				// 返回完整路径
				outputFiles = append(outputFiles, filepath.Join(outputDir, entry.Name()))
			}
		}
	} else {
		log.Printf("[DEBUG] scanShareRunFiles: outputDir read error: %v", err)
	}
	
	log.Printf("[DEBUG] scanShareRunFiles: found %d input files, %d output files", len(inputFiles), len(outputFiles))
	return inputFiles, outputFiles
}

// handleGovernanceShareRuns 列出分享任务的所有执行记录

func handleGovernanceShareRuns(w http.ResponseWriter, r *http.Request, task *GovernanceTask) {
	log.Printf("[DEBUG] handleGovernanceShareRuns called: shareToken=%s", task.ShareToken)
	w.Header().Set("Content-Type", "application/json")
	if r.Method != http.MethodGet {
		json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "message": "只支持GET"})
		return
	}

	// 优先从 governanceShareRuns 读取（前端执行会保存到这里）
	governanceShareRunsMu.RLock()
	var shareRuns []*GovernanceShareRun
	log.Printf("[DEBUG] 开始遍历 governanceShareRuns, 总数: %d", len(governanceShareRuns))
	for runID, run := range governanceShareRuns {
		log.Printf("[DEBUG] 检查 run: id=%s, run.ShareToken=%s, task.ShareToken=%s, inputFiles=%v", runID[:8], run.ShareToken, task.ShareToken, run.InputFiles)
		if run.ShareToken == task.ShareToken {
			shareRuns = append(shareRuns, run)
			log.Printf("[DEBUG] 找到匹配 run: id=%s, inputFiles=%v, resultFiles=%v", run.ID[:8], run.InputFiles, run.ResultFiles)
		}
	}
	governanceShareRunsMu.RUnlock()
	log.Printf("[DEBUG] governanceShareRuns 匹配记录数: %d, task.ShareToken: %s", len(shareRuns), task.ShareToken)

	// 如果有分享记录，直接使用
	if len(shareRuns) > 0 {
		// 按创建时间倒序排列
		sort.Slice(shareRuns, func(i, j int) bool {
			return shareRuns[i].CreatedAt.After(shareRuns[j].CreatedAt)
		})

		// 转换为前端格式
		result := make([]map[string]interface{}, len(shareRuns))
		for i, run := range shareRuns {
			status := run.Status
			output := run.Output
			if status == "failed" {
				status = "failed"
			} else if status != "completed" {
				status = "pending"
			}
		// 提取文件名（去掉路径前缀）
		inputFileNames := make([]string, 0, len(run.InputFiles))
		for _, f := range run.InputFiles {
			inputFileNames = append(inputFileNames, filepath.Base(f))
		}
		resultFileNames := make([]string, 0, len(run.ResultFiles))
		for _, f := range run.ResultFiles {
			resultFileNames = append(resultFileNames, filepath.Base(f))
		}
		result[i] = map[string]interface{}{
			"id":           run.ID,
			"status":       status,
			"progress":     run.Progress,
			"output":       output,
			"input_files":  inputFileNames,
			"result_files": resultFileNames,
			"created_at":   run.CreatedAt.Format(time.RFC3339),
			"updated_at":   run.UpdatedAt.Format(time.RFC3339),
		}
		}

		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": true,
			"runs":    result,
		})
		return
	}

	// 兼容旧数据：从 governanceTaskLogs 读取
	dataOntologyMu.RLock()
	logs := governanceTaskLogs[task.ID]
	dataOntologyMu.RUnlock()

	// 过滤掉运行中的日志，只返回已完成的
	var completedLogs []*GovernanceTaskLog
	for _, log := range logs {
		if log != nil && log.Status != "running" {
			completedLogs = append(completedLogs, log)
		}
	}

	// 按开始时间倒序排列
	sort.Slice(completedLogs, func(i, j int) bool {
		return completedLogs[i].StartTime > completedLogs[j].StartTime
	})

	// 转换为前端需要的格式
	result := make([]map[string]interface{}, len(completedLogs))
	for i, log := range completedLogs {
		status := "completed"
		output := log.Output
		if log.Status == "error" {
			status = "failed"
			if log.Error != "" {
				if output != "" {
					output = log.Error + "\n" + output
				} else {
					output = log.Error
				}
			}
		}
		// 优先使用日志中保存的文件列表，为空时才扫描文件目录
		inputFiles := log.InputFiles
		outputFiles := log.ResultFiles
		if len(inputFiles) == 0 || len(outputFiles) == 0 {
			scannedInputs, scannedOutputs := scanShareRunFiles(task.ShareToken, log.RunID)
			if len(inputFiles) == 0 {
				inputFiles = scannedInputs
			}
			if len(outputFiles) == 0 {
				outputFiles = scannedOutputs
			}
		}
		// 提取文件名（如果存的是完整路径）
		inputFileNames := make([]string, 0, len(inputFiles))
		for _, f := range inputFiles {
			inputFileNames = append(inputFileNames, filepath.Base(f))
		}
		outputFileNames := make([]string, 0, len(outputFiles))
		for _, f := range outputFiles {
			outputFileNames = append(outputFileNames, filepath.Base(f))
		}
		result[i] = map[string]interface{}{
			"id":           log.RunID,
			"status":       status,
			"progress":     100,
			"output":       output,
			"input_files":  inputFileNames,
			"result_files": outputFileNames,
			"created_at":   log.StartTime,
			"updated_at":   log.EndTime,
		}
	}

	json.NewEncoder(w).Encode(map[string]interface{}{
		"success": true,
		"runs":    result,
	})
}

// handleGovernanceShareRunDownload 下载分享任务文件（输入/输出）

func handleGovernanceShareRunDownload(w http.ResponseWriter, r *http.Request, task *GovernanceTask, runID string) {
	if r.Method != http.MethodGet {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "message": "只支持GET"})
		return
	}

	// 直接从 governanceTaskLogs 读取（单一数据源）
	dataOntologyMu.RLock()
	logs := governanceTaskLogs[task.ID]
	dataOntologyMu.RUnlock()

	// 查找对应 run_id 的日志
	var log *GovernanceTaskLog
	for _, l := range logs {
		if l != nil && l.RunID == runID {
			log = l
			break
		}
	}

	if log == nil {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "message": "执行记录不存在"})
		return
	}

	// 确定下载类型：input 或 output（默认 output）
	downloadType := r.URL.Query().Get("type")
	if downloadType == "" {
		downloadType = "output"
	}

	// 根据类型选择目录（使用 task.ShareToken）
	var baseDir string
	if downloadType == "input" {
		baseDir = filepath.Join("apps", "data-ontology", "share-uploads", task.ShareToken, runID)
	} else {
		baseDir = filepath.Join("apps", "data-ontology", "share-outputs", task.ShareToken, runID)
	}

	// 获取要下载的文件名
	filename := r.URL.Query().Get("file")
	if filename == "" {
		// 无 file 参数 — 返回错误，前端应逐个下载
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "message": "请指定 file 参数"})
		return
	}

	// 安全检查：防止路径遍历
	safeName, err := sanitizeFilename(filename)
	if err != nil {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "message": "文件名无效"})
		return
	}

	filePath := filepath.Join(baseDir, safeName)
	if _, err := os.Stat(filePath); os.IsNotExist(err) {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "message": "文件不存在"})
		return
	}

	w.Header().Set("Content-Type", "application/octet-stream")
	w.Header().Set("Content-Disposition", fmt.Sprintf(`attachment; filename="%s"`, safeName))
	http.ServeFile(w, r, filePath)
}

// handleGovernanceTaskShareEnable 开启任务分享

func handleGovernanceTaskShareEnable(w http.ResponseWriter, r *http.Request, taskID string) {
	w.Header().Set("Content-Type", "application/json")
	if r.Method != http.MethodPost {
		json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "message": "只支持POST"})
		return
	}

	dataOntologyMu.Lock()
	task, exists := governanceTasks[taskID]
	if !exists {
		dataOntologyMu.Unlock()
		json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "message": "任务不存在"})
		return
	}

	task.ShareEnabled = true
	if task.ShareToken == "" {
		task.ShareToken = uuid.New().String()
	}
	dataOntologyMu.Unlock()

	if err := saveDataOntologyStore(); err != nil {
		log.Printf("保存分享设置失败: %v", err)
	}

	json.NewEncoder(w).Encode(map[string]interface{}{
		"success":     true,
		"share_token": task.ShareToken,
		"message":     "分享已开启",
	})
}

// handleGovernanceTaskShareDisable 关闭任务分享

func handleGovernanceTaskShareDisable(w http.ResponseWriter, r *http.Request, taskID string) {
	w.Header().Set("Content-Type", "application/json")
	if r.Method != http.MethodDelete {
		json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "message": "只支持DELETE"})
		return
	}

	dataOntologyMu.Lock()
	task, exists := governanceTasks[taskID]
	if !exists {
		dataOntologyMu.Unlock()
		json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "message": "任务不存在"})
		return
	}

	task.ShareEnabled = false
	task.ShareToken = ""
	dataOntologyMu.Unlock()

	if err := saveDataOntologyStore(); err != nil {
		log.Printf("保存分享设置失败: %v", err)
	}

	json.NewEncoder(w).Encode(map[string]interface{}{
		"success": true,
		"message": "分享已关闭",
	})
}

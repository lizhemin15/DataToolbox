package main

import (
	"archive/zip"
	"database/sql"
	"encoding/json"
	"fmt"
	"github.com/google/uuid"
	"io"
	"io/ioutil"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"time"
)

func getDataOntologyStorePath() string {
	// 获取可执行文件所在目录
	exePath, err := os.Executable()
	if err != nil {
		log.Printf("获取可执行文件路径失败: %v", err)
		return "data/data-store.json"
	}
	rootDir := filepath.Dir(exePath)
	return filepath.Join(rootDir, "data", "data-store.json")
}

// saveDataOntologyStoreJSON JSON 保存（fallback，SQLite 未初始化时使用）
func saveDataOntologyStoreJSON() error {
	storePath := getDataOntologyStorePathFn()
	storeDir := filepath.Dir(storePath)
	if err := os.MkdirAll(storeDir, 0755); err != nil {
		return fmt.Errorf("创建目录失败: %v", err)
	}
	dataOntologyMu.RLock()
	governanceShareRunsMu.RLock()
	shareRunsByToken := make(map[string]map[string]*GovernanceShareRun)
	for runID, run := range governanceShareRuns {
		if _, ok := shareRunsByToken[run.ShareToken]; !ok {
			shareRunsByToken[run.ShareToken] = make(map[string]*GovernanceShareRun)
		}
		shareRunsByToken[run.ShareToken][runID] = run
	}
	governanceShareRunsMu.RUnlock()
	store := DataOntologyStore{
		Users: dataOntologyUsers, Databases: dataOntologyDatabases, Apis: dataOntologyApis,
		AIConfig: dataOntologyAIConfig, AICapabilities: dataOntologyAICapabilities,
		Tasks: governanceTasks, TaskLogs: governanceTaskLogs,
		MCPEnabled: dataOntologyMCPEnabled, MCPSafeConfig: dataOntologyMCPSafeConfig,
		LLMModels: llmModels, SmallModels: smallModels, ShareRuns: shareRunsByToken,
	}
	dataOntologyMu.RUnlock()
	data, err := json.MarshalIndent(store, "", "  ")
	if err != nil {
		return fmt.Errorf("序列化数据失败: %v", err)
	}
	if err := os.WriteFile(storePath, data, 0644); err != nil {
		return fmt.Errorf("写入文件失败: %v", err)
	}
	log.Printf("数据已保存到: %s", storePath)
	return nil
}

// saveDataOntologyStoreJSONNoLock JSON 保存不加锁版本（fallback）
func saveDataOntologyStoreJSONNoLock() error {
	storePath := getDataOntologyStorePathFn()
	storeDir := filepath.Dir(storePath)
	if err := os.MkdirAll(storeDir, 0755); err != nil {
		return fmt.Errorf("创建目录失败: %v", err)
	}
	governanceShareRunsMu.RLock()
	shareRunsByToken := make(map[string]map[string]*GovernanceShareRun)
	for runID, run := range governanceShareRuns {
		if _, ok := shareRunsByToken[run.ShareToken]; !ok {
			shareRunsByToken[run.ShareToken] = make(map[string]*GovernanceShareRun)
		}
		shareRunsByToken[run.ShareToken][runID] = run
	}
	governanceShareRunsMu.RUnlock()
	store := DataOntologyStore{
		Users: dataOntologyUsers, Databases: dataOntologyDatabases, Apis: dataOntologyApis,
		AIConfig: dataOntologyAIConfig, AICapabilities: dataOntologyAICapabilities,
		Tasks: governanceTasks, TaskLogs: governanceTaskLogs,
		MCPEnabled: dataOntologyMCPEnabled, MCPSafeConfig: dataOntologyMCPSafeConfig,
		LLMModels: llmModels, SmallModels: smallModels, ShareRuns: shareRunsByToken,
	}
	data, err := json.MarshalIndent(store, "", "  ")
	if err != nil {
		return fmt.Errorf("序列化数据失败: %v", err)
	}
	if err := os.WriteFile(storePath, data, 0644); err != nil {
		return fmt.Errorf("写入文件失败: %v", err)
	}
	log.Printf("数据已保存到: %s", storePath)
	return nil
}

// 加载持久化数据

func loadDataOntologyStore() error {
	storePath := getDataOntologyStorePathFn()
	dir := filepath.Dir(storePath)
	baseName := filepath.Base(storePath)

	// 检查是否存在大小写不一致的同名文件，自动修正
	// 例如：data-Store.json -> data-store.json
	files, _ := os.ReadDir(dir)
	for _, f := range files {
		if strings.ToLower(f.Name()) == strings.ToLower(baseName) && f.Name() != baseName {
			oldPath := filepath.Join(dir, f.Name())
			newPath := filepath.Join(dir, baseName)
			log.Printf("[自动修正] 检测到文件名大小写不一致: %s -> %s", oldPath, newPath)
			if err := os.Rename(oldPath, newPath); err != nil {
				log.Printf("[自动修正] 重命名失败: %v", err)
			} else {
				log.Printf("[自动修正] 重命名成功")
			}
			break
		}
	}

	// 检查文件是否存在
	if _, err := os.Stat(storePath); os.IsNotExist(err) {
		log.Printf("持久化文件不存在，将创建新文件: %s", storePath)
		return nil
	}

	// 读取文件
	data, err := os.ReadFile(storePath)
	if err != nil {
		return fmt.Errorf("读取持久化文件失败: %v", err)
	}

	// 解析JSON
	var store DataOntologyStore
	if err := json.Unmarshal(data, &store); err != nil {
		return fmt.Errorf("解析持久化数据失败: %v", err)
	}

	// 加载数据到内存
	dataOntologyMu.Lock()
	defer dataOntologyMu.Unlock()

	if store.Users != nil {
		dataOntologyUsers = store.Users
		log.Printf("已加载 %d 个用户", len(dataOntologyUsers))
	}

	if store.Databases != nil {
		dataOntologyDatabases = store.Databases
		log.Printf("已加载 %d 个数据库配置", len(dataOntologyDatabases))
	}

	if store.Apis != nil {
		dataOntologyApis = store.Apis
		log.Printf("已加载 %d 个接口配置", len(dataOntologyApis))
		// 调试：打印每个接口的 default_params
		for id, api := range dataOntologyApis {
			if api.DefaultParams != nil {
				log.Printf("[DEBUG] API %s (%s) default_params: %v", id, api.Name, api.DefaultParams)
			}
		}
	}

	if store.AIConfig != nil {
		dataOntologyAIConfig = store.AIConfig
		log.Printf("已加载AI配置")
	}

	if store.AICapabilities != nil {
		dataOntologyAICapabilities = store.AICapabilities
		log.Printf("已加载AI能力检测结果")
	}

	if store.Tasks != nil {
		governanceTasks = store.Tasks
		log.Printf("已加载 %d 个治理任务", len(governanceTasks))
		for _, t := range governanceTasks {
			if t.RegisterAsAPI {
				log.Printf("[API注册] %s: path=%s, method=%s", t.Name, t.APIPath, t.APIMethod)
			}
		}
	}

	if store.TaskLogs != nil {
		governanceTaskLogs = store.TaskLogs
		log.Printf("已加载治理任务日志")
	}
	if store.MCPEnabled != nil {
		dataOntologyMCPEnabled = store.MCPEnabled
	}
	if store.MCPSafeConfig != nil {
		dataOntologyMCPSafeConfig = store.MCPSafeConfig
		dataOntologyMCPPort = store.MCPSafeConfig.Port
		log.Printf("已加载 MCP 安全配置: read_only=%v, block_dangerous=%v, port=%d", store.MCPSafeConfig.ReadOnlyMode, store.MCPSafeConfig.BlockDangerous, store.MCPSafeConfig.Port)
	}
	// 模型管理
	if store.LLMModels != nil {
		llmModels = store.LLMModels
		log.Printf("已加载 %d 个大模型配置", len(llmModels))
	}
	if store.SmallModels != nil {
		smallModels = store.SmallModels
		log.Printf("已加载 %d 个小模型配置", len(smallModels))
	}
	// 加载分享任务执行记录（强制加载，兼容 nil）
	governanceShareRunsMu.Lock()
	if store.ShareRuns != nil {
		for _, runs := range store.ShareRuns {
			for runID, run := range runs {
				governanceShareRuns[runID] = run
			}
		}
	}
	// 统计当前内存中的记录数
	memRuns := len(governanceShareRuns)
	governanceShareRunsMu.Unlock()
	if memRuns > 0 {
		log.Printf("已加载 %d 条分享任务执行记录", memRuns)
	}
	// 历史数据无 Owner 时视为管理员资源，避免泄露给普通用户
	for _, c := range dataOntologyDatabases {
		if c != nil && c.Owner == "" {
			c.Owner = "admin"
		}
	}
	for _, t := range governanceTasks {
		if t != nil && t.Owner == "" {
			t.Owner = "admin"
		}
	}
	// 向后兼容：将旧的 Token 字段迁移到 Tokens 列表
	for _, user := range dataOntologyUsers {
		if user != nil && user.Token != "" {
			// 将旧 Token 迁移到 Tokens 列表（避免重复）
			found := false
			for _, t := range user.Tokens {
				if t == user.Token {
					found = true
					break
				}
			}
			if !found {
				user.Tokens = append(user.Tokens, user.Token)
			}
			// 注意：不立即清空 user.Token，避免影响未更新的客户端
		}
	}
	return nil
}

// 保存持久化数据（SQLite 模式：写入 SQLite，不再写 JSON）
func saveDataOntologyStore() error {
	if storeDB != nil {
		return sqlSaveAll()
	}
	// SQLite 未初始化时回退到 JSON
	return saveDataOntologyStoreJSON()
}

// saveDataOntologyStoreNoLock 保存持久化数据（不加锁版本，供已持有锁的函数调用）
// SQLite 模式下 sqlSaveAll 内部有自己的锁，所以这里直接调用
func saveDataOntologyStoreNoLock() error {
	if storeDB != nil {
		return sqlSaveAll()
	}
	return saveDataOntologyStoreJSONNoLock()
}

// ====== 数据备份与恢复 API ======

// handleDataOntologyBackup 导出备份（ZIP 格式，包含所有持久化数据）
// SQLite 模式：直接导出 data-store.db 文件 + 文件目录
func handleDataOntologyBackup(w http.ResponseWriter, r *http.Request) {
	username, authOK := getDataOntologyUserFromRequest(r)
	if !authOK {
		apiUnauthorized(w, "未授权")
		return
	}

	if r.Method != http.MethodGet {
		apiMethodNotAllowed(w, "只支持GET请求")
		return
	}

	// 仅管理员可备份
	if username != "admin" {
		apiForbidden(w, "仅管理员可执行备份")
		return
	}

	// 创建 ZIP 压缩包
	now := time.Now()
	filename := fmt.Sprintf("datatoolbox-backup-%s.zip", now.Format("20060102"))
	w.Header().Set("Content-Type", "application/zip")
	w.Header().Set("Content-Disposition", fmt.Sprintf(`attachment; filename="%s"`, filename))

	dataDir := filepath.Dir(getStoreDBPath())
	baseDir := "datatoolbox-backup"

	zipWriter := zip.NewWriter(w)
	defer zipWriter.Close()

	// 1. SQLite 模式：导出 data-store.db
	if storeDB != nil {
		dbPath := getStoreDBPath()
		if _, err := os.Stat(dbPath); err != nil {
			log.Printf("[备份] data-store.db 不存在: %v", err)
		} else {
			// 先 VACUUM INTO 临时文件确保数据完整
			tmpDB := filepath.Join(os.TempDir(), "backup-vacuum.db")
			storeDBMu.Lock()
			_, err := storeDB.Exec("VACUUM INTO '" + tmpDB + "'")
			storeDBMu.Unlock()
			if err != nil {
				log.Printf("[备份] VACUUM INTO 失败， 直接复制原文件: %v", err)
				// 失败时直接复制原文件
				tmpDB = dbPath
			}
			dbFile, err := zipWriter.Create(filepath.Join(baseDir, "data-store.db"))
			if err != nil {
				log.Printf("[备份] 创建 ZIP 条目失败: %v", err)
			} else {
				f, err := os.Open(tmpDB)
				if err == nil {
					written, _ := io.Copy(dbFile, f)
					log.Printf("[备份] data-store.db: %d bytes", written)
					f.Close()
				}
			}
			// 清理临时文件
			if tmpDB != dbPath {
				os.Remove(tmpDB)
			}
		}
	} else {
		// SQLite 未初始化，回退到 JSON 导出
		dataOntologyMu.RLock()
		governanceShareRunsMu.RLock()
		shareRunsByToken := make(map[string]map[string]*GovernanceShareRun)
		for runID, run := range governanceShareRuns {
			if _, ok := shareRunsByToken[run.ShareToken]; !ok {
				shareRunsByToken[run.ShareToken] = make(map[string]*GovernanceShareRun)
			}
			shareRunsByToken[run.ShareToken][runID] = run
		}
		governanceShareRunsMu.RUnlock()
		store := DataOntologyStore{
			Users: dataOntologyUsers, Databases: dataOntologyDatabases, Apis: dataOntologyApis,
			AIConfig: dataOntologyAIConfig, AICapabilities: dataOntologyAICapabilities,
			Tasks: governanceTasks, TaskLogs: governanceTaskLogs,
			MCPEnabled: dataOntologyMCPEnabled, MCPSafeConfig: dataOntologyMCPSafeConfig,
			LLMModels: llmModels, SmallModels: smallModels, ShareRuns: shareRunsByToken,
		}
		dataOntologyMu.RUnlock()
		jsonData, err := json.MarshalIndent(store, "", "  ")
		if err != nil {
			apiInternalError(w, "序列化备份数据失败")
			return
		}
		jsonFile, err := zipWriter.Create(filepath.Join(baseDir, "data-store.json"))
		if err != nil {
			apiInternalError(w, "创建ZIP条目失败")
			return
		}
		jsonFile.Write(jsonData)
	}

	// 2. 写入 quality-audit.db（如果存在）
	qaDBPath := getQualityAuditDBPath()
	if _, err := os.Stat(qaDBPath); err == nil {
		dbFile, err := zipWriter.Create(filepath.Join(baseDir, "quality-audit.db"))
		if err == nil {
			f, err := os.Open(qaDBPath)
			if err == nil {
				written, _ := io.Copy(dbFile, f)
				log.Printf("备份 quality-audit.db: %d bytes", written)
				f.Close()
			}
		}
	}

	// 3. 递归写入目录的辅助函数
	addDirToZip := func(dirPath, zipSubDir string) {
		if fi, err := os.Stat(dirPath); err != nil || !fi.IsDir() {
			return
		}
		filepath.Walk(dirPath, func(path string, info os.FileInfo, err error) error {
			if err != nil || info.IsDir() {
				return nil
			}
			relPath, _ := filepath.Rel(dataDir, path)
			zipPath := filepath.Join(baseDir, relPath)
			f, err := zipWriter.Create(zipPath)
			if err != nil {
				return nil
			}
			src, err := os.Open(path)
			if err != nil {
				return nil
			}
			defer src.Close()
			written, _ := io.Copy(f, src)
			log.Printf("备份 %s: %d bytes", relPath, written)
			return nil
		})
	}

	// 写入 share-outputs/ 目录（如果存在）
	addDirToZip(filepath.Join(dataDir, "share-outputs"), "share-outputs")

	// 写入 share-uploads/ 目录（如果存在）
	addDirToZip(filepath.Join(dataDir, "share-uploads"), "share-uploads")

	// 写入 example_files/ 目录（如果存在）
	addDirToZip(filepath.Join(dataDir, "example_files"), "example_files")

	log.Printf("备份 ZIP 已生成: %s", filename)
}

// handleDataOntologyRestore 导入恢复（支持 ZIP 和 JSON 两种格式）

func handleDataOntologyRestore(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	username, authOK := getDataOntologyUserFromRequest(r)
	if !authOK {
		apiUnauthorized(w, "未授权")
		return
	}

	if r.Method != http.MethodPost {
		apiMethodNotAllowed(w, "只支持POST请求")
		return
	}

	// 仅管理员可恢复
	if username != "admin" {
		apiForbidden(w, "仅管理员可执行恢复")
		return
	}

	// 解析请求体
	var req struct {
		Mode string `json:"mode"` // "overwrite" 或 "merge"
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		jsonError(w, "请求格式错误: "+err.Error(), ErrCodeBadRequest)
		return
	}

	if req.Mode != "overwrite" && req.Mode != "merge" {
		jsonError(w, "模式必须为 overwrite 或 merge", ErrCodeInvalidInput)
		return
	}

	jsonError(w, "新的恢复接口需要通过 multipart/form-data 上传 ZIP 文件", ErrCodeBadRequest)
}

// handleDataOntologyRestoreUpload 处理 ZIP 文件上传恢复

func handleDataOntologyRestoreUpload(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	username, authOK := getDataOntologyUserFromRequest(r)
	if !authOK {
		apiUnauthorized(w, "未授权")
		return
	}

	if r.Method != http.MethodPost {
		apiMethodNotAllowed(w, "只支持POST请求")
		return
	}

	// 仅管理员可恢复
	if username != "admin" {
		apiForbidden(w, "仅管理员可执行恢复")
		return
	}

	// 解析 multipart 表单（最大 1GB）
	maxSize := int64(1 << 30)
	if err := r.ParseMultipartForm(maxSize); err != nil {
		jsonError(w, "解析表单失败: "+err.Error(), ErrCodeBadRequest)
		return
	}

	mode := r.FormValue("mode")
	if mode == "" {
		mode = "merge" // 默认使用合并模式
	}
	if mode != "overwrite" && mode != "merge" {
		jsonError(w, "模式必须为 overwrite 或 merge", ErrCodeInvalidInput)
		return
	}

	// 获取上传的文件
	file, header, err := r.FormFile("backup")
	if err != nil {
		jsonError(w, "获取上传文件失败: "+err.Error(), ErrCodeBadRequest)
		return
	}
	defer file.Close()

	// 创建临时目录
	tmpDir, err := ioutil.TempDir("", "datatoolbox-restore-")
	if err != nil {
		jsonError(w, "创建临时目录失败: "+err.Error(), ErrCodeInternalError)
		return
	}
	defer os.RemoveAll(tmpDir)

	// 保存上传的文件到临时目录
	tmpFile := filepath.Join(tmpDir, header.Filename)
	dst, err := os.Create(tmpFile)
	if err != nil {
		jsonError(w, "创建临时文件失败: "+err.Error(), ErrCodeInternalError)
		return
	}
	if _, err := io.Copy(dst, file); err != nil {
		dst.Close()
		jsonError(w, "保存上传文件失败: "+err.Error(), ErrCodeInternalError)
		return
	}
	dst.Close()

	// 判断文件类型（ZIP 或 JSON）
	var stats map[string]interface{}
	if strings.HasSuffix(strings.ToLower(header.Filename), ".zip") {
		// ZIP 格式
		stats, err = restoreFromZIP(tmpFile, mode)
	} else if strings.HasSuffix(strings.ToLower(header.Filename), ".json") {
		// JSON 格式（向后兼容）
		stats, err = restoreFromJSON(tmpFile, mode)
	} else {
		jsonError(w, "不支持的文件格式，仅支持 .zip 或 .json", ErrCodeInvalidInput)
		return
	}

	if err != nil {
		jsonError(w, err.Error(), ErrCodeInternalError)
		return
	}

	stats["mode"] = mode
	jsonSuccess(w, stats)
}

// restoreFromZIP 从 ZIP 文件恢复
func restoreFromZIP(zipPath, mode string) (map[string]interface{}, error) {
	dataDir := filepath.Dir(getStoreDBPath())

	// 打开 ZIP 文件
	r, err := zip.OpenReader(zipPath)
	if err != nil {
		return nil, fmt.Errorf("打开 ZIP 文件失败: %v", err)
	}
	defer r.Close()

	// SQLite 模式：优先查找 data-store.db
	if storeDB != nil {
		var dbFile *zip.File
		for _, f := range r.File {
			if strings.HasSuffix(f.Name, "data-store.db") {
				dbFile = f
				break
			}
		}

		if dbFile != nil {
			if mode == "overwrite" {
				// SQLite 覆盖模式：直接替换 data-store.db 文件
				dbPath := getStoreDBPath()

				// 先关闭当前数据库连接
				storeDB.Close()
				storeDB = nil

				// 备份当前 db 文件
				backupPath := dbPath + ".restore-backup"
				os.Rename(dbPath, backupPath)

				// 解压新的 db 文件
				rc, err := dbFile.Open()
				if err != nil {
					// 恢复备份
					os.Rename(backupPath, dbPath)
					return nil, fmt.Errorf("打开 data-store.db 失败: %v", err)
				}
				dst, err := os.Create(dbPath)
				if err != nil {
					rc.Close()
					os.Rename(backupPath, dbPath)
					return nil, fmt.Errorf("创建 data-store.db 失败: %v", err)
				}
				written, err := io.Copy(dst, rc)
				dst.Close()
				rc.Close()
				if err != nil {
					os.Rename(backupPath, dbPath)
					return nil, fmt.Errorf("写入 data-store.db 失败: %v", err)
				}

				// 删除备份
				os.Remove(backupPath)

				// 直接打开恢复的数据库（不建表，文件已有完整 schema）
				storeDBMu.Lock()
				newDB, err := sql.Open("sqlite", dbPath+"?_journal_mode=WAL")
				storeDBMu.Unlock()
				if err != nil {
					return nil, fmt.Errorf("打开恢复的数据库失败: %v", err)
				}
				storeDB = newDB
				if err := sqlLoadAll(); err != nil {
					return nil, fmt.Errorf("从恢复的数据库加载数据失败: %v", err)
				}

				// 恢复文件目录
				fileCount := restoreFilesFromZip(r, dataDir, mode)

				stats := map[string]interface{}{
					"mode":           mode,
					"db_bytes":       written,
					"files_restored": fileCount,
				}
				return stats, nil
			}

			// merge 模式 + SQLite：从备份 db 读取数据合并到当前内存
			// 将备份 db 解压到临时文件，打开读取，合并到内存
			tmpDB := filepath.Join(os.TempDir(), "restore-merge.db")
			rc, err := dbFile.Open()
			if err != nil {
				return nil, fmt.Errorf("打开备份 data-store.db 失败: %v", err)
			}
			dst, err := os.Create(tmpDB)
			if err != nil {
				rc.Close()
				return nil, fmt.Errorf("创建临时 db 文件失败: %v", err)
			}
			written, err := io.Copy(dst, rc)
			dst.Close()
			rc.Close()
			if err != nil {
				os.Remove(tmpDB)
				return nil, fmt.Errorf("写入临时 db 文件失败: %v", err)
			}

			// 从临时 db 加载数据到新的内存变量
			mergeDB, err := sql.Open("sqlite", tmpDB+"?mode=ro")
			if err != nil {
				os.Remove(tmpDB)
				return nil, fmt.Errorf("打开临时数据库失败: %v", err)
			}
			mergeStats, err := mergeFromDB(mergeDB)
			mergeDB.Close()
			os.Remove(tmpDB)
			if err != nil {
				return nil, fmt.Errorf("合并数据失败: %v", err)
			}

			// 保存合并后的数据
			if err := saveDataOntologyStore(); err != nil {
				return nil, fmt.Errorf("保存合并数据失败: %v", err)
			}

			// 恢复文件目录
			fileCount := restoreFilesFromZip(r, dataDir, mode)

			mergeStats["mode"] = mode
			mergeStats["db_bytes"] = written
			mergeStats["files_restored"] = fileCount
			return mergeStats, nil
		}
	}

	// 回退到 JSON 恢复（兼容旧备份）
	var dataStoreFile *zip.File
	for _, f := range r.File {
		if strings.HasSuffix(f.Name, "data-store.json") {
			dataStoreFile = f
			break
		}
	}

	if dataStoreFile == nil {
		return nil, fmt.Errorf("ZIP 文件中未找到 data-store.db 或 data-store.json")
	}

	// 读取 data-store.json
	rc, err := dataStoreFile.Open()
	if err != nil {
		return nil, fmt.Errorf("打开 data-store.json 失败: %v", err)
	}
	jsonData, err := ioutil.ReadAll(rc)
	rc.Close()
	if err != nil {
		return nil, fmt.Errorf("读取 data-store.json 失败: %v", err)
	}

	// 解析 JSON
	var rawBackup map[string]json.RawMessage
	if err := json.Unmarshal(jsonData, &rawBackup); err != nil {
		return nil, fmt.Errorf("解析备份数据失败: %v", err)
	}

	var storeData json.RawMessage
	if md, ok := rawBackup["metadata"]; ok && md != nil {
		if data, ok2 := rawBackup["data"]; ok2 {
			storeData = data
		} else {
			return nil, fmt.Errorf("备份数据缺少 data 字段")
		}
	} else {
		storeData = jsonData
	}

	var newStore DataOntologyStore
	if err := json.Unmarshal(storeData, &newStore); err != nil {
		return nil, fmt.Errorf("解析备份数据失败: %v", err)
	}

	// 应用数据恢复
	dataOntologyMu.Lock()
	defer dataOntologyMu.Unlock()

	var stats map[string]interface{}

	if mode == "overwrite" {
		// 覆盖模式：完全替换
		// 安全处理：确保密码是 bcrypt hash 格式
		if newStore.Users != nil {
			for _, v := range newStore.Users {
				if v != nil && v.Password != "" && !isBcryptHash(v.Password) {
					v.Password = hashPassword(v.Password)
				}
			}
		}
		dataOntologyUsers = newStore.Users
		dataOntologyDatabases = newStore.Databases
		dataOntologyApis = newStore.Apis
		dataOntologyAIConfig = newStore.AIConfig
		dataOntologyAICapabilities = newStore.AICapabilities
		governanceTasks = newStore.Tasks
		governanceTaskLogs = newStore.TaskLogs
		dataOntologyMCPEnabled = newStore.MCPEnabled
		dataOntologyMCPSafeConfig = newStore.MCPSafeConfig
		llmModels = newStore.LLMModels
		smallModels = newStore.SmallModels

		governanceShareRunsMu.Lock()
		governanceShareRuns = make(map[string]*GovernanceShareRun)
		if newStore.ShareRuns != nil {
			for _, runs := range newStore.ShareRuns {
				for runID, run := range runs {
					governanceShareRuns[runID] = run
				}
			}
		}
		governanceShareRunsMu.Unlock()

		stats = map[string]interface{}{
			"users_count":        len(dataOntologyUsers),
			"databases_count":    len(dataOntologyDatabases),
			"apis_count":         len(dataOntologyApis),
			"tasks_count":        len(governanceTasks),
			"llm_models_count":   len(llmModels),
			"small_models_count": len(smallModels),
		}
	} else {
		// 合并模式
		mergedStats := map[string]int{"users_added": 0, "databases_added": 0, "apis_added": 0, "tasks_added": 0}

		if newStore.Users != nil {
			for k, v := range newStore.Users {
				if _, exists := dataOntologyUsers[k]; !exists {
					// 安全处理：确保密码是 bcrypt hash 格式
					if v != nil && v.Password != "" && !isBcryptHash(v.Password) {
						v.Password = hashPassword(v.Password)
					}
					dataOntologyUsers[k] = v
					mergedStats["users_added"]++
				}
			}
		}
		if newStore.Databases != nil {
			for k, v := range newStore.Databases {
				if _, exists := dataOntologyDatabases[k]; !exists {
					dataOntologyDatabases[k] = v
					mergedStats["databases_added"]++
				}
			}
		}
		if newStore.Apis != nil {
			for k, v := range newStore.Apis {
				if _, exists := dataOntologyApis[k]; !exists {
					dataOntologyApis[k] = v
					mergedStats["apis_added"]++
				}
			}
		}
		if newStore.Tasks != nil {
			for k, v := range newStore.Tasks {
				if _, exists := governanceTasks[k]; !exists {
					governanceTasks[k] = v
					mergedStats["tasks_added"]++
				}
			}
		}
		if newStore.AIConfig != nil && dataOntologyAIConfig == nil {
			dataOntologyAIConfig = newStore.AIConfig
		}
		if newStore.AICapabilities != nil && dataOntologyAICapabilities == nil {
			dataOntologyAICapabilities = newStore.AICapabilities
		}
		if newStore.TaskLogs != nil {
			if governanceTaskLogs == nil {
				governanceTaskLogs = newStore.TaskLogs
			} else {
				for k, v := range newStore.TaskLogs {
					if _, exists := governanceTaskLogs[k]; !exists {
						governanceTaskLogs[k] = v
					}
				}
			}
		}
		if newStore.MCPEnabled != nil && dataOntologyMCPEnabled == nil {
			dataOntologyMCPEnabled = newStore.MCPEnabled
		}
		if newStore.MCPSafeConfig != nil && dataOntologyMCPSafeConfig == nil {
			dataOntologyMCPSafeConfig = newStore.MCPSafeConfig
			dataOntologyMCPPort = newStore.MCPSafeConfig.Port
		}
		if newStore.LLMModels != nil {
			for k, v := range newStore.LLMModels {
				if _, exists := llmModels[k]; !exists {
					llmModels[k] = v
				}
			}
		}
		if newStore.SmallModels != nil {
			for k, v := range newStore.SmallModels {
				if _, exists := smallModels[k]; !exists {
					smallModels[k] = v
				}
			}
		}
		if newStore.ShareRuns != nil {
			governanceShareRunsMu.Lock()
			for _, runs := range newStore.ShareRuns {
				for runID, run := range runs {
					if _, exists := governanceShareRuns[runID]; !exists {
						governanceShareRuns[runID] = run
					}
				}
			}
			governanceShareRunsMu.Unlock()
		}

		stats = map[string]interface{}{
			"users_added":        mergedStats["users_added"],
			"databases_added":    mergedStats["databases_added"],
			"apis_added":         mergedStats["apis_added"],
			"tasks_added":        mergedStats["tasks_added"],
			"total_users":        len(dataOntologyUsers),
			"total_databases":    len(dataOntologyDatabases),
			"total_apis":         len(dataOntologyApis),
			"total_tasks":        len(governanceTasks),
			"total_llm_models":   len(llmModels),
			"total_small_models": len(smallModels),
		}
	}

	// 保存数据（已持有 dataOntologyMu.Lock，使用无锁版本避免死锁）
	if err := saveDataOntologyStoreNoLock(); err != nil {
		log.Printf("恢复数据保存失败: %v", err)
		return nil, fmt.Errorf("保存恢复数据失败: %v", err)
	}

	// 恢复文件（ZIP 中的其他文件）
	fileCount := 0
	for _, f := range r.File {
		// 跳过 data-store.json
		if strings.HasSuffix(f.Name, "data-store.json") {
			continue
		}

		// 提取相对路径（去掉 datatoolbox-backup/ 前缀）
		relPath := f.Name
		if idx := strings.Index(relPath, "/"); idx >= 0 {
			relPath = relPath[idx+1:]
		}
		if relPath == "" {
			continue
		}

		// 安全检查：防止路径遍历攻击
		targetPath := filepath.Join(dataDir, relPath)
		absTarget, err := filepath.Abs(targetPath)
		if err != nil {
			log.Printf("获取绝对路径失败 %s: %v", targetPath, err)
			continue
		}
		absDataDir, _ := filepath.Abs(dataDir)
		if !strings.HasPrefix(absTarget, absDataDir+string(filepath.Separator)) && absTarget != absDataDir {
			log.Printf("安全警告：跳过路径遍历文件 %s (目标: %s)", f.Name, absTarget)
			continue
		}

		if f.FileInfo().IsDir() {
			os.MkdirAll(targetPath, 0755)
			continue
		}

		// 创建目录
		if err := os.MkdirAll(filepath.Dir(targetPath), 0755); err != nil {
			log.Printf("创建目录失败 %s: %v", filepath.Dir(targetPath), err)
			continue
		}

		// 覆盖模式下直接覆盖，合并模式下跳过已存在的文件
		if mode == "merge" {
			if _, err := os.Stat(targetPath); err == nil {
				continue // 文件已存在，跳过
			}
		}

		// 解压文件
		rc, err := f.Open()
		if err != nil {
			log.Printf("打开 ZIP 条目失败 %s: %v", f.Name, err)
			continue
		}

		dst, err := os.Create(targetPath)
		if err != nil {
			rc.Close()
			log.Printf("创建文件失败 %s: %v", targetPath, err)
			continue
		}

		_, err = io.Copy(dst, rc)
		dst.Close()
		rc.Close()

		if err != nil {
			log.Printf("解压文件失败 %s: %v", targetPath, err)
			continue
		}

		fileCount++
	}

	stats["files_restored"] = fileCount
	log.Printf("恢复完成，共恢复 %d 个文件", fileCount)

	return stats, nil
}

// restoreFromJSON 从 JSON 文件恢复（向后兼容）

func restoreFromJSON(jsonPath, mode string) (map[string]interface{}, error) {
	jsonData, err := ioutil.ReadFile(jsonPath)
	if err != nil {
		return nil, fmt.Errorf("读取 JSON 文件失败: %v", err)
	}

	var rawBackup map[string]json.RawMessage
	if err := json.Unmarshal(jsonData, &rawBackup); err != nil {
		return nil, fmt.Errorf("解析备份数据失败: %v", err)
	}

	var storeData json.RawMessage
	if md, ok := rawBackup["metadata"]; ok && md != nil {
		if data, ok2 := rawBackup["data"]; ok2 {
			storeData = data
		} else {
			return nil, fmt.Errorf("备份数据缺少 data 字段")
		}
	} else {
		storeData = jsonData
	}

	var newStore DataOntologyStore
	if err := json.Unmarshal(storeData, &newStore); err != nil {
		return nil, fmt.Errorf("解析备份数据失败: %v", err)
	}

	dataOntologyMu.Lock()
	defer dataOntologyMu.Unlock()

	var stats map[string]interface{}

	if mode == "overwrite" {
		// 安全处理：确保密码是 bcrypt hash 格式
		if newStore.Users != nil {
			for _, v := range newStore.Users {
				if v != nil && v.Password != "" && !isBcryptHash(v.Password) {
					v.Password = hashPassword(v.Password)
				}
			}
		}
		dataOntologyUsers = newStore.Users
		dataOntologyDatabases = newStore.Databases
		dataOntologyApis = newStore.Apis
		dataOntologyAIConfig = newStore.AIConfig
		dataOntologyAICapabilities = newStore.AICapabilities
		governanceTasks = newStore.Tasks
		governanceTaskLogs = newStore.TaskLogs
		dataOntologyMCPEnabled = newStore.MCPEnabled
		dataOntologyMCPSafeConfig = newStore.MCPSafeConfig
		llmModels = newStore.LLMModels
		smallModels = newStore.SmallModels

		governanceShareRunsMu.Lock()
		governanceShareRuns = make(map[string]*GovernanceShareRun)
		if newStore.ShareRuns != nil {
			for _, runs := range newStore.ShareRuns {
				for runID, run := range runs {
					governanceShareRuns[runID] = run
				}
			}
		}
		governanceShareRunsMu.Unlock()

		stats = map[string]interface{}{
			"users_count":        len(dataOntologyUsers),
			"databases_count":    len(dataOntologyDatabases),
			"apis_count":         len(dataOntologyApis),
			"tasks_count":        len(governanceTasks),
			"llm_models_count":   len(llmModels),
			"small_models_count": len(smallModels),
		}
	} else {
		mergedStats := map[string]int{"users_added": 0, "databases_added": 0, "apis_added": 0, "tasks_added": 0}

		if newStore.Users != nil {
			for k, v := range newStore.Users {
				if _, exists := dataOntologyUsers[k]; !exists {
					// 安全处理：确保密码是 bcrypt hash 格式
					if v != nil && v.Password != "" && !isBcryptHash(v.Password) {
						v.Password = hashPassword(v.Password)
					}
					dataOntologyUsers[k] = v
					mergedStats["users_added"]++
				}
			}
		}
		if newStore.Databases != nil {
			for k, v := range newStore.Databases {
				if _, exists := dataOntologyDatabases[k]; !exists {
					dataOntologyDatabases[k] = v
					mergedStats["databases_added"]++
				}
			}
		}
		if newStore.Apis != nil {
			for k, v := range newStore.Apis {
				if _, exists := dataOntologyApis[k]; !exists {
					dataOntologyApis[k] = v
					mergedStats["apis_added"]++
				}
			}
		}
		if newStore.Tasks != nil {
			for k, v := range newStore.Tasks {
				if _, exists := governanceTasks[k]; !exists {
					governanceTasks[k] = v
					mergedStats["tasks_added"]++
				}
			}
		}
		if newStore.AIConfig != nil && dataOntologyAIConfig == nil {
			dataOntologyAIConfig = newStore.AIConfig
		}
		if newStore.AICapabilities != nil && dataOntologyAICapabilities == nil {
			dataOntologyAICapabilities = newStore.AICapabilities
		}
		if newStore.TaskLogs != nil {
			if governanceTaskLogs == nil {
				governanceTaskLogs = newStore.TaskLogs
			} else {
				for k, v := range newStore.TaskLogs {
					if _, exists := governanceTaskLogs[k]; !exists {
						governanceTaskLogs[k] = v
					}
				}
			}
		}
		if newStore.MCPEnabled != nil && dataOntologyMCPEnabled == nil {
			dataOntologyMCPEnabled = newStore.MCPEnabled
		}
		if newStore.MCPSafeConfig != nil && dataOntologyMCPSafeConfig == nil {
			dataOntologyMCPSafeConfig = newStore.MCPSafeConfig
			dataOntologyMCPPort = newStore.MCPSafeConfig.Port
		}
		if newStore.LLMModels != nil {
			for k, v := range newStore.LLMModels {
				if _, exists := llmModels[k]; !exists {
					llmModels[k] = v
				}
			}
		}
		if newStore.SmallModels != nil {
			for k, v := range newStore.SmallModels {
				if _, exists := smallModels[k]; !exists {
					smallModels[k] = v
				}
			}
		}
		if newStore.ShareRuns != nil {
			governanceShareRunsMu.Lock()
			for _, runs := range newStore.ShareRuns {
				for runID, run := range runs {
					if _, exists := governanceShareRuns[runID]; !exists {
						governanceShareRuns[runID] = run
					}
				}
			}
			governanceShareRunsMu.Unlock()
		}

		stats = map[string]interface{}{
			"users_added":        mergedStats["users_added"],
			"databases_added":    mergedStats["databases_added"],
			"apis_added":         mergedStats["apis_added"],
			"tasks_added":        mergedStats["tasks_added"],
			"total_users":        len(dataOntologyUsers),
			"total_databases":    len(dataOntologyDatabases),
			"total_apis":         len(dataOntologyApis),
			"total_tasks":        len(governanceTasks),
			"total_llm_models":   len(llmModels),
			"total_small_models": len(smallModels),
		}
	}

	// 保存数据（已持有 dataOntologyMu.Lock，使用无锁版本避免死锁）
	if err := saveDataOntologyStoreNoLock(); err != nil {
		log.Printf("恢复数据保存失败: %v", err)
		return nil, fmt.Errorf("保存恢复数据失败: %v", err)
	}

	return stats, nil
}

// 获取网页导航持久化文件路径（存于 app 目录下）

func getWebNavStorePath() string {
	exePath, err := os.Executable()
	if err != nil {
		log.Printf("获取可执行文件路径失败: %v", err)
		return "apps/web-nav/links-store.json"
	}
	rootDir := filepath.Dir(exePath)
	return filepath.Join(rootDir, "apps", "web-nav", "links-store.json")
}

func loadWebNavStore() error {
	storePath := getWebNavStorePath()
	if _, err := os.Stat(storePath); os.IsNotExist(err) {
		return nil
	}
	data, err := os.ReadFile(storePath)
	if err != nil {
		return fmt.Errorf("读取网页导航数据失败: %v", err)
	}
	var store WebNavStore
	if err := json.Unmarshal(data, &store); err != nil {
		return fmt.Errorf("解析网页导航数据失败: %v", err)
	}
	webNavMu.Lock()
	if store.Links != nil {
		webNavLinks = store.Links
	}
	webNavMu.Unlock()
	return nil
}

func saveWebNavStore() error {
	storePath := getWebNavStorePath()
	storeDir := filepath.Dir(storePath)
	if err := os.MkdirAll(storeDir, 0755); err != nil {
		return fmt.Errorf("创建目录失败: %v", err)
	}
	webNavMu.RLock()
	store := WebNavStore{Links: append([]WebNavLink(nil), webNavLinks...)}
	webNavMu.RUnlock()
	data, err := json.MarshalIndent(store, "", "  ")
	if err != nil {
		return fmt.Errorf("序列化网页导航数据失败: %v", err)
	}
	if err := os.WriteFile(storePath, data, 0644); err != nil {
		return fmt.Errorf("写入网页导航数据失败: %v", err)
	}
	return nil
}

func initWebNav() {
	if err := loadWebNavStore(); err != nil {
		log.Printf("加载网页导航数据失败: %v", err)
	}
}

// 网页导航默认管理员 admin / admin1234
// 预生成的 bcrypt 哈希（admin1234）

const webNavAdminPasswordHash = "$2a$10$Hxx7DcpNAlReSHjolH9otuCsoIHrMZxY8gCZ4R3OFk0oKqP5C6IT2"

func checkWebNavAdmin(username, password string) bool {
	if username != "admin" {
		return false
	}
	return verifyPassword(password, webNavAdminPasswordHash)
}

func handleWebNavLogin(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	if r.Method != http.MethodPost {
		apiMethodNotAllowed(w, "只支持POST")
		return
	}
	var req struct {
		Username string `json:"username"`
		Password string `json:"password"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		apiBadRequest(w, "请求格式错误")
		return
	}
	if !checkWebNavAdmin(req.Username, req.Password) {
		apiUnauthorized(w, "用户名或密码错误")
		return
	}
	token := generateToken()
	webNavMu.Lock()
	webNavAdminToken = token
	webNavMu.Unlock()
	jsonSuccess(w, map[string]interface{}{"token": token})
}

func checkWebNavAuth(r *http.Request) bool {
	auth := r.Header.Get("Authorization")
	if auth == "" {
		return false
	}
	const prefix = "Bearer "
	if !strings.HasPrefix(auth, prefix) {
		return false
	}
	token := strings.TrimSpace(auth[len(prefix):])
	webNavMu.RLock()
	ok := token != "" && token == webNavAdminToken
	webNavMu.RUnlock()
	return ok
}

func handleWebNavLinks(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	switch r.Method {
	case http.MethodGet:
		webNavMu.RLock()
		links := append([]WebNavLink(nil), webNavLinks...)
		webNavMu.RUnlock()
		jsonSuccess(w, map[string]interface{}{"links": links})
		return
	case http.MethodPost:
		if !checkWebNavAuth(r) {
			apiUnauthorized(w, "需要管理员权限")
			return
		}
		var link WebNavLink
		if err := json.NewDecoder(r.Body).Decode(&link); err != nil {
			apiBadRequest(w, "请求格式错误")
			return
		}
		if link.Title == "" || link.URL == "" {
			apiBadRequest(w, "标题和链接不能为空")
			return
		}
		link.ID = uuid.New().String()
		webNavMu.Lock()
		webNavLinks = append(webNavLinks, link)
		webNavMu.Unlock()
		if err := saveWebNavStore(); err != nil {
			log.Printf("保存网页导航失败: %v", err)
		}
		jsonSuccess(w, map[string]interface{}{"link": link})
		return
	default:
		apiMethodNotAllowed(w, "方法不允许")
		return
	}
}

func handleWebNavLinkByID(w http.ResponseWriter, r *http.Request, id string) {
	w.Header().Set("Content-Type", "application/json")
	if !checkWebNavAuth(r) {
		apiUnauthorized(w, "需要管理员权限")
		return
	}
	webNavMu.Lock()
	idx := -1
	for i := range webNavLinks {
		if webNavLinks[i].ID == id {
			idx = i
			break
		}
	}
	if idx < 0 {
		webNavMu.Unlock()
		apiBadRequest(w, "链接不存在")
		return
	}
	switch r.Method {
	case http.MethodPut:
		var link WebNavLink
		webNavMu.Unlock()
		if err := json.NewDecoder(r.Body).Decode(&link); err != nil {
			apiBadRequest(w, "请求格式错误")
			return
		}
		if link.Title == "" || link.URL == "" {
			apiBadRequest(w, "标题和链接不能为空")
			return
		}
		link.ID = id
		webNavMu.Lock()
		webNavLinks[idx] = link
		webNavMu.Unlock()
		if err := saveWebNavStore(); err != nil {
			log.Printf("保存网页导航失败: %v", err)
		}
		jsonSuccess(w, map[string]interface{}{"link": link})
	case http.MethodDelete:
		webNavLinks = append(webNavLinks[:idx], webNavLinks[idx+1:]...)
		webNavMu.Unlock()
		if err := saveWebNavStore(); err != nil {
			log.Printf("保存网页导航失败: %v", err)
		}
		jsonSuccess(w, nil)
	default:
		webNavMu.Unlock()
		apiMethodNotAllowed(w, "方法不允许")
	}
}

func loadGovernanceAggregateDailyReportJS() string {
	b, err := governanceExamplesFS.ReadFile("scripts/aggregate-daily-report.js")
	if err != nil {
		log.Printf("读取 aggregate-daily-report.js 失败: %v", err)
		return ""
	}
	return string(b)
}

func loadGovernancePresetJS(name string) string {
	b, err := governanceExamplesFS.ReadFile("scripts/" + name)
	if err != nil {
		log.Printf("读取治理预置脚本 %s 失败: %v", name, err)
		return ""
	}
	return string(b)
}

// governancePresetDefinitions returns the canonical embedded preset definitions used to refresh persisted preset metadata.

func governancePresetDefinitions() map[string]GovernanceTask {
	now := time.Now().Format(time.RFC3339)
	return map[string]GovernanceTask{
		"数据库表行数统计": {
			Owner:       "admin",
			Name:        "数据库表行数统计",
			Type:        "scheduled",
			Description: "查询所有表的行数，输出统计报告（需关联数据库）",
			JsCode:      loadGovernancePresetJS("database-table-row-count.js"),
			CronExpr:    "0 2 * * *",
			Enabled:     false,
			CreatedAt:   now,
			Status:      "idle",
		},
		"Excel数据解析入库": {
			Owner:       "admin",
			Name:        "Excel数据解析入库",
			Type:        "interactive",
			Description: "上传Excel文件，解析内容预览，可选入库",
			JsCode:      loadGovernancePresetJS("excel-data-import.js"),
			InputType:   "file",
			AcceptExts:  []string{".xlsx", ".xls"},
			CreatedAt:   now,
			Status:      "idle",
		},
		"CSV文本解析": {
			Owner:       "admin",
			Name:        "CSV文本解析",
			Type:        "interactive",
			Description: "输入CSV格式文本，解析并展示结构化结果",
			JsCode:      loadGovernancePresetJS("csv-text-parser.js"),
			InputType:   "text",
			CreatedAt:   now,
			Status:      "idle",
		},
		"数据完整性检查": {
			Owner:       "admin",
			Name:        "数据完整性检查",
			Type:        "scheduled",
			Description: "检查数据库表的空值情况（需关联数据库）",
			JsCode:      loadGovernancePresetJS("data-integrity-check.js"),
			CronExpr:    "30 1 * * *",
			Enabled:     false,
			CreatedAt:   now,
			Status:      "idle",
		},
		"Word文档内容提取": {
			Owner:        "admin",
			Name:         "Word文档内容提取",
			Type:         "interactive",
			Description:  "上传Word，提取文本后经AI结构化并入库（AI使用「AI助手」的URL/API Key/模型）",
			JsCode:       loadGovernancePresetJS("word-content-extract.js"),
			InputType:    "file",
			ExampleFiles: []GovernanceExampleFile{{Name: "国际新闻与运输情况通报_模拟数据.docx", Path: "国际新闻与运输情况通报_模拟数据.docx"}},
			Status:       "idle",
		},
		"综合日报生成器": {
			Owner:         "admin",
			Name:          "综合日报生成器",
			Type:          "interactive",
			Description:   "上传综合日报 Word 模板 + 多份单位日报（.docx），按文件名解析日期与单位，JSON 结构化提取后生成综合日报",
			JsCode:        loadGovernanceAggregateDailyReportJS(),
			InputType:     "file",
			AcceptExts:    []string{".docx", ".doc", ".wps"},
			FileBatchMode: "multi",
			ExampleFiles: []GovernanceExampleFile{
				{Name: "综合日报模板_多层级.docx", Path: "综合日报模板_多层级.docx"},
				{Name: "2024年4月12日单位A日报_多层级.docx", Path: "2024年4月12日单位A日报_多层级.docx"},
				{Name: "2024年4月12日单位B日报_多层级.docx", Path: "2024年4月12日单位B日报_多层级.docx"},
				{Name: "2024年4月12日单位C日报_多层级.docx", Path: "2024年4月12日单位C日报_多层级.docx"},
				{Name: "2024年4月12日单位D日报_多层级.docx", Path: "2024年4月12日单位D日报_多层级.docx"},
				{Name: "2024年4月12日单位E日报_多层级.docx", Path: "2024年4月12日单位E日报_多层级.docx"},
			},
			CreatedAt: now,
			Status:    "idle",
		},
		"国际新闻入库": {
			Owner:         "admin",
			Name:          "国际新闻入库",
			Type:          "interactive",
			Description:   "上传国际新闻与运输情况通报 Word 文档，提取结构化数据入库",
			JsCode:        loadGovernancePresetJS("international-news-import.js"),
			InputType:     "file",
			AcceptExts:    []string{".docx"},
			FileBatchMode: "single",
			ExampleFiles: []GovernanceExampleFile{
				{Name: "19990101_国际新闻与运输情况通报_模拟数据.docx", Path: "19990101_国际新闻与运输情况通报_模拟数据.docx"},
				{Name: "19990102_国际新闻与运输情况通报_模拟数据.docx", Path: "19990102_国际新闻与运输情况通报_模拟数据.docx"},
				{Name: "19990103_国际新闻与运输情况通报_模拟数据.docx", Path: "19990103_国际新闻与运输情况通报_模拟数据.docx"},
			},
			CreatedAt: now,
			Status:    "idle",
		},
	}
}

// syncGovernancePresetExamplesFromEmbed 将 embed 中的预置示例元数据同步到内存中的任务并写入 data-store。
// 仅处理名称与内置预置完全一致的任务，不会修改用户自建任务。
// includeJS 为 true 时，将「综合日报生成器」的 js_code 替换为 embed 内最新脚本（慎用：会覆盖用户对该任务的代码修改）。

func syncGovernancePresetExamplesFromEmbed(includeJS bool) int {
	now := time.Now().Format(time.RFC3339)
	updated := 0
	presetDefs := governancePresetDefinitions()
	for _, t := range governanceTasks {
		if t == nil {
			continue
		}
		def, ok := presetDefs[t.Name]
		if !ok {
			continue
		}
		changed := false
		if t.Owner != def.Owner {
			t.Owner = def.Owner
			changed = true
		}
		if t.Name != def.Name {
			t.Name = def.Name
			changed = true
		}
		if t.Type != def.Type {
			t.Type = def.Type
			changed = true
		}
		if t.Description != def.Description {
			t.Description = def.Description
			changed = true
		}
		if t.InputType != def.InputType {
			t.InputType = def.InputType
			changed = true
		}
		if !reflect.DeepEqual(t.AcceptExts, def.AcceptExts) {
			t.AcceptExts = append([]string(nil), def.AcceptExts...)
			changed = true
		}
		// API 注册字段：只在用户未设置时才用预置值填充（避免覆盖用户配置）
		if !t.RegisterAsAPI && def.RegisterAsAPI {
			t.RegisterAsAPI = def.RegisterAsAPI
			changed = true
		}
		if t.APIPath == "" && def.APIPath != "" {
			t.APIPath = def.APIPath
			changed = true
		}
		if t.APIMethod == "" && def.APIMethod != "" {
			t.APIMethod = def.APIMethod
			changed = true
		}
		if t.FileBatchMode != def.FileBatchMode {
			t.FileBatchMode = def.FileBatchMode
			changed = true
		}
		if t.Runtime != def.Runtime {
			t.Runtime = def.Runtime
			changed = true
		}
		if t.RunMode != def.RunMode {
			t.RunMode = def.RunMode
			changed = true
		}
		if t.ExecutionMode != def.ExecutionMode {
			t.ExecutionMode = def.ExecutionMode
			changed = true
		}
		if !reflect.DeepEqual(t.ExampleFiles, def.ExampleFiles) {
			t.ExampleFiles = append([]GovernanceExampleFile(nil), def.ExampleFiles...)
			changed = true
		}
		if t.CronExpr != def.CronExpr {
			t.CronExpr = def.CronExpr
			changed = true
		}
		if t.Enabled != def.Enabled {
			t.Enabled = def.Enabled
			changed = true
		}
		if includeJS && def.JsCode != "" {
			if t.JsCode != def.JsCode {
				t.JsCode = def.JsCode
				changed = true
			}
		}
		if changed {
			t.UpdatedAt = now
			updated++
		}
	}
	return updated
}

// ensureGovernanceExampleFiles 为已持久化的预置任务补全示例文件元数据（兼容旧数据，逻辑已由 syncGovernancePresetExamplesFromEmbed 覆盖）

func ensureGovernanceExampleFiles() {
	if n := syncGovernancePresetExamplesFromEmbed(true); n > 0 {
		if err := saveDataOntologyStore(); err != nil {
			log.Printf("保存示例文件元数据失败: %v", err)
		}
	}
}

// restoreFilesFromZip 从 ZIP 中恢复文件目录（share-outputs, share-uploads, example_files 等）
func restoreFilesFromZip(r *zip.ReadCloser, dataDir, mode string) int {
	fileCount := 0
	for _, f := range r.File {
		// 跳过数据文件（data-store.db, data-store.json, quality-audit.db）
		name := f.Name
		if strings.HasSuffix(name, "data-store.db") || strings.HasSuffix(name, "data-store.json") || strings.HasSuffix(name, "quality-audit.db") {
			continue
		}

		// 提取相对路径（去掉 datatoolbox-backup/ 前缀）
		relPath := name
		if idx := strings.Index(relPath, "/"); idx >= 0 {
			relPath = relPath[idx+1:]
		}
		if relPath == "" {
			continue
		}

		// 安全检查：防止路径遍历攻击
		targetPath := filepath.Join(dataDir, relPath)
		absTarget, err := filepath.Abs(targetPath)
		if err != nil {
			continue
		}
		absDataDir, _ := filepath.Abs(dataDir)
		if !strings.HasPrefix(absTarget, absDataDir+string(filepath.Separator)) && absTarget != absDataDir {
			continue
		}

		if f.FileInfo().IsDir() {
			os.MkdirAll(targetPath, 0755)
			continue
		}

		if err := os.MkdirAll(filepath.Dir(targetPath), 0755); err != nil {
			continue
		}

		// 合并模式下跳过已存在的文件
		if mode == "merge" {
			if _, err := os.Stat(targetPath); err == nil {
				continue
			}
		}

		rc, err := f.Open()
		if err != nil {
			continue
		}
		dst, err := os.Create(targetPath)
		if err != nil {
			rc.Close()
			continue
		}
		io.Copy(dst, rc)
		dst.Close()
		rc.Close()
		fileCount++
	}
	return fileCount
}

// 初始化默认管理员账号

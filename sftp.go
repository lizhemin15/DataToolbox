package main

import (
	"encoding/json"
	"fmt"
	"github.com/google/uuid"
	"github.com/gorilla/websocket"
	"github.com/pkg/sftp"
	"io"
	"log"
	"net/http"
	"strings"
	"sync"
	"time"
	gossh "golang.org/x/crypto/ssh"
)

func getSFTPSession(id string) *SFTPSession {
	sftpSessionsMu.Lock()
	defer sftpSessionsMu.Unlock()
	s := sftpSessionsMap[id]
	if s != nil {
		s.LastUsed = time.Now()
	}
	return s
}

// startSFTPSessionCleaner 定期清理未使用的 SFTP 会话

func startSFTPSessionCleaner() {
	go func() {
		ticker := time.NewTicker(SFTPCleanInterval)
		defer ticker.Stop()
		for range ticker.C {
			sftpSessionsMu.Lock()
			for id, s := range sftpSessionsMap {
				if time.Since(s.LastUsed) > SFTPSessionTTL {
					s.SFTPClient.Close()
					s.SSHClient.Close()
					delete(sftpSessionsMap, id)
				}
			}
			sftpSessionsMu.Unlock()
		}
	}()
}

// startTokenCleaner 定期清理过期的登录 token

func startTokenCleaner() {
	go func() {
		ticker := time.NewTicker(TokenCleanInterval)
		defer ticker.Stop()
		for range ticker.C {
			dataOntologyMu.Lock()
			now := time.Now().Unix()
			cleaned := 0
			for _, user := range dataOntologyUsers {
				if user == nil {
					continue
				}
				// 清理过期的 TokenEntries
				validEntries := make([]TokenEntry, 0)
				for _, entry := range user.TokenEntries {
					if now-entry.CreatedAt <= int64(dataOntologyTokenTTL.Seconds()) {
						validEntries = append(validEntries, entry)
					} else {
						cleaned++
					}
				}
				user.TokenEntries = validEntries
				// 同步更新 Tokens 列表（移除过期的）
				validTokens := make([]string, 0)
				for _, entry := range validEntries {
					validTokens = append(validTokens, entry.Token)
				}
				user.Tokens = validTokens
			}
			if cleaned > 0 {
				log.Printf("[TokenCleaner] 清理了 %d 个过期 token", cleaned)
				dataOntologyMu.Unlock()
				saveDataOntologyStore()
				dataOntologyMu.Lock()
			}
			dataOntologyMu.Unlock()
		}
	}()
}

// opsSSHWriter 将 io.Write 调用转发到回调函数（用于 SSH stdout/stderr → WebSocket）

type opsSSHWriter struct {
	fn func([]byte)
}

func (w *opsSSHWriter) Write(p []byte) (n int, err error) {
	b := make([]byte, len(p))
	copy(b, p)
	w.fn(b)
	return len(p), nil
}

// handleSSHWebSocket 通过 WebSocket 代理 SSH 终端
// 连接参数：host, port, user 通过 URL Query 传入，password 通过 WebSocket 子协议传入

func handleSSHWebSocket(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	host := q.Get("host")
	portStr := q.Get("port")
	user := q.Get("user")
	// 密码不再从 URL 参数读取，改用子协议传递

	if host == "" || user == "" {
		http.Error(w, "missing host or user", http.StatusBadRequest)
		return
	}
	if portStr == "" {
		portStr = "22"
	}

	// 从 Sec-WebSocket-Protocol header 中读取密码
	// 前端需要设置: new WebSocket(url, [password])
	var password string
	if protocols := r.Header.Get("Sec-WebSocket-Protocol"); protocols != "" {
		// 协议列表格式: "password-here" 或 "protocol1, password-here"
		parts := strings.Split(protocols, ",")
		if len(parts) > 0 {
			// 取最后一个协议作为密码（去掉引号和空格）
			password = strings.TrimSpace(strings.Trim(parts[len(parts)-1], `" `))
		}
	}

	if password == "" {
		http.Error(w, "missing password in websocket protocol", http.StatusBadRequest)
		return
	}

	// 使用自定义 upgrader，响应时包含子协议
	upgrader := websocket.Upgrader{
		CheckOrigin: func(r *http.Request) bool { return true },
	}
	wsConn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		return
	}
	defer wsConn.Close()

	var wsMu sync.Mutex
	writeWS := func(data []byte) {
		wsMu.Lock()
		defer wsMu.Unlock()
		wsConn.WriteMessage(websocket.BinaryMessage, data)
	}
	writeWSText := func(text string) {
		wsMu.Lock()
		defer wsMu.Unlock()
		wsConn.WriteMessage(websocket.TextMessage, []byte(text))
	}

	sshConfig := &gossh.ClientConfig{
		User:            user,
		Auth:            []gossh.AuthMethod{gossh.Password(password)},
		HostKeyCallback: gossh.InsecureIgnoreHostKey(),
		Timeout:         SSHConnectTimeout,
	}

	sshClient, err := gossh.Dial("tcp", host+":"+portStr, sshConfig)
	if err != nil {
		writeWSText("\r\n\x1b[31m[连接失败] " + err.Error() + "\x1b[0m\r\n")
		return
	}
	defer sshClient.Close()

	session, err := sshClient.NewSession()
	if err != nil {
		writeWSText("\r\n\x1b[31m[会话创建失败] " + err.Error() + "\x1b[0m\r\n")
		return
	}
	defer session.Close()

	stdinPipe, err := session.StdinPipe()
	if err != nil {
		writeWSText("\r\n\x1b[31m[stdin 管道失败] " + err.Error() + "\x1b[0m\r\n")
		return
	}

	session.Stdout = &opsSSHWriter{fn: writeWS}
	session.Stderr = &opsSSHWriter{fn: writeWS}

	modes := gossh.TerminalModes{
		gossh.ECHO:          1,
		gossh.TTY_OP_ISPEED: 38400,
		gossh.TTY_OP_OSPEED: 38400,
	}
	if err := session.RequestPty("xterm-256color", 24, 80, modes); err != nil {
		writeWSText("\r\n\x1b[31m[PTY 请求失败] " + err.Error() + "\x1b[0m\r\n")
		return
	}
	if err := session.Shell(); err != nil {
		writeWSText("\r\n\x1b[31m[Shell 启动失败] " + err.Error() + "\x1b[0m\r\n")
		return
	}

	// 读取浏览器键盘输入，转发到 SSH stdin
	go func() {
		for {
			_, msg, err := wsConn.ReadMessage()
			if err != nil {
				session.Close()
				return
			}
			// 处理终端尺寸调整消息 {"type":"resize","cols":80,"rows":24}
			if len(msg) > 1 && msg[0] == '{' {
				var rm struct {
					Type string `json:"type"`
					Cols int    `json:"cols"`
					Rows int    `json:"rows"`
				}
				if json.Unmarshal(msg, &rm) == nil && rm.Type == "resize" {
					session.WindowChange(rm.Rows, rm.Cols)
					continue
				}
			}
			stdinPipe.Write(msg)
		}
	}()

	session.Wait()
	writeWSText("\r\n\x1b[33m[会话已结束]\x1b[0m\r\n")
}

// handleSFTPConnect POST /api/ops/sftp/connect

func handleSFTPConnect(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	if !verifyToken(r) {
		apiUnauthorized(w, "未授权")
		return
	}
	if r.Method != http.MethodPost {
		apiMethodNotAllowed(w, "仅支持 POST")
		return
	}
	var req struct {
		Host     string `json:"host"`
		Port     string `json:"port"`
		User     string `json:"user"`
		Password string `json:"password"`
	}
	json.NewDecoder(r.Body).Decode(&req)
	if req.Host == "" || req.User == "" {
		apiBadRequest(w, "host 和 user 不能为空")
		return
	}
	if req.Port == "" {
		req.Port = "22"
	}

	sshConfig := &gossh.ClientConfig{
		User:            req.User,
		Auth:            []gossh.AuthMethod{gossh.Password(req.Password)},
		HostKeyCallback: gossh.InsecureIgnoreHostKey(),
		Timeout:         SSHConnectTimeout,
	}
	sshClient, err := gossh.Dial("tcp", req.Host+":"+req.Port, sshConfig)
	if err != nil {
		log.Printf("[SFTP] SSH连接失败: host=%s, err=%v", req.Host, err)
		apiBadRequest(w, "SSH 连接失败")
		return
	}
	sftpClient, err := sftp.NewClient(sshClient)
	if err != nil {
		sshClient.Close()
		log.Printf("[SFTP] SFTP初始化失败: host=%s, err=%v", req.Host, err)
		apiBadRequest(w, "SFTP 初始化失败")
		return
	}

	sessionID := uuid.New().String()
	sftpSessionsMu.Lock()
	sftpSessionsMap[sessionID] = &SFTPSession{
		ID:         sessionID,
		SSHClient:  sshClient,
		SFTPClient: sftpClient,
		LastUsed:   time.Now(),
	}
	sftpSessionsMu.Unlock()

	homePath := "/"
	if wd, err := sftpClient.Getwd(); err == nil {
		homePath = wd
	}

	log.Printf("[SFTP] 连接成功: host=%s, user=%s, session=%s", req.Host, req.User, sessionID)
	jsonSuccess(w, map[string]interface{}{
		"success":      true,
		"session_id":   sessionID,
		"current_path": homePath,
	})
}

// handleSFTPList GET /api/ops/sftp/list?session=xxx&path=/

func handleSFTPList(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	if !verifyToken(r) {
		apiUnauthorized(w, "未授权")
		return
	}
	sessionID := r.URL.Query().Get("session")
	remotePath := r.URL.Query().Get("path")
	if remotePath == "" {
		remotePath = "/"
	}
	s := getSFTPSession(sessionID)
	if s == nil {
		apiBadRequest(w, "会话不存在或已过期，请重新连接")
		return
	}
	entries, err := s.SFTPClient.ReadDir(remotePath)
	if err != nil {
		log.Printf("[SFTP] 读取目录失败: session=%s, path=%s, err=%v", sessionID, remotePath, err)
		apiBadRequest(w, "读取目录失败")
		return
	}
	files := make([]map[string]interface{}, 0, len(entries)+1)
	if remotePath != "/" {
		files = append(files, map[string]interface{}{
			"name": "..", "size": int64(0), "is_dir": true, "mod_time": "", "permissions": "drwxr-xr-x",
		})
	}
	for _, e := range entries {
		files = append(files, map[string]interface{}{
			"name":        e.Name(),
			"size":        e.Size(),
			"is_dir":      e.IsDir(),
			"mod_time":    e.ModTime().Format("2006-01-02 15:04"),
			"permissions": e.Mode().String(),
		})
	}
	jsonSuccess(w, map[string]interface{}{"success": true, "path": remotePath, "files": files})
}

// handleSFTPUpload POST /api/ops/sftp/upload?session=xxx&path=/remote/dir

func handleSFTPUpload(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	if !verifyToken(r) {
		apiUnauthorized(w, "未授权")
		return
	}
	if r.Method != http.MethodPost {
		apiMethodNotAllowed(w, "仅支持 POST")
		return
	}
	sessionID := r.URL.Query().Get("session")
	remotePath := r.URL.Query().Get("path")
	s := getSFTPSession(sessionID)
	if s == nil {
		apiBadRequest(w, "会话不存在或已过期")
		return
	}
	r.ParseMultipartForm(200 << 20) // 200MB
	file, header, err := r.FormFile("file")
	if err != nil {
		apiBadRequest(w, "读取上传文件失败")
		return
	}
	defer file.Close()

	// 安全验证：清理文件名，防止路径遍历攻击
	safeFilename, err := sanitizeFilename(header.Filename)
	if err != nil {
		apiBadRequest(w, "文件名无效: "+err.Error())
		return
	}

	// 使用正斜杠拼接远程路径
	remoteFilePath := strings.TrimRight(remotePath, "/") + "/" + safeFilename
	dst, err := s.SFTPClient.Create(remoteFilePath)
	if err != nil {
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "message": "创建远程文件失败: " + err.Error()})
		return
	}
	defer dst.Close()
	if _, err := io.Copy(dst, file); err != nil {
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "message": "写入文件失败: " + err.Error()})
		return
	}
	json.NewEncoder(w).Encode(map[string]interface{}{"success": true, "path": remoteFilePath})
}

// handleSFTPDownload GET /api/ops/sftp/download?session=xxx&path=/file

func handleSFTPDownload(w http.ResponseWriter, r *http.Request) {
	if !verifyToken(r) {
		http.Error(w, "未授权", http.StatusUnauthorized)
		return
	}
	sessionID := r.URL.Query().Get("session")
	remotePath := r.URL.Query().Get("path")
	s := getSFTPSession(sessionID)
	if s == nil {
		http.Error(w, "会话不存在或已过期", http.StatusBadRequest)
		return
	}
	src, err := s.SFTPClient.Open(remotePath)
	if err != nil {
		http.Error(w, "打开远程文件失败: "+err.Error(), http.StatusBadRequest)
		return
	}
	defer src.Close()
	if stat, err := src.Stat(); err == nil {
		w.Header().Set("Content-Length", fmt.Sprintf("%d", stat.Size()))
	}
	// 提取文件名（远程路径使用正斜杠）
	parts := strings.Split(strings.TrimRight(remotePath, "/"), "/")
	filename := parts[len(parts)-1]
	w.Header().Set("Content-Disposition", `attachment; filename="`+filename+`"`)
	w.Header().Set("Content-Type", "application/octet-stream")
	io.Copy(w, src)
}

// handleSFTPDisconnect POST /api/ops/sftp/disconnect

func handleSFTPDisconnect(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	if !verifyToken(r) {
		json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "message": "未授权"})
		return
	}
	var sessionID string
	sessionID = r.URL.Query().Get("session")
	if sessionID == "" {
		var req struct {
			Session string `json:"session"`
		}
		json.NewDecoder(r.Body).Decode(&req)
		sessionID = req.Session
	}
	sftpSessionsMu.Lock()
	if s, ok := sftpSessionsMap[sessionID]; ok {
		s.SFTPClient.Close()
		s.SSHClient.Close()
		delete(sftpSessionsMap, sessionID)
	}
	sftpSessionsMu.Unlock()
	json.NewEncoder(w).Encode(map[string]interface{}{"success": true})
}

// handleSFTPMkdir POST /api/ops/sftp/mkdir  body: {session, path}

func handleSFTPMkdir(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	var req struct {
		Session string `json:"session"`
		Path    string `json:"path"`
	}
	json.NewDecoder(r.Body).Decode(&req)
	s := getSFTPSession(req.Session)
	if s == nil {
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "message": "会话不存在或已过期"})
		return
	}
	if err := sftpMkdirAll(s.SFTPClient, req.Path); err != nil {
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "message": "创建目录失败: " + err.Error()})
		return
	}
	json.NewEncoder(w).Encode(map[string]interface{}{"success": true})
}

// handleSFTPDelete POST /api/ops/sftp/delete  body: {session, path}

func handleSFTPDelete(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	var req struct {
		Session string `json:"session"`
		Path    string `json:"path"`
	}
	json.NewDecoder(r.Body).Decode(&req)
	s := getSFTPSession(req.Session)
	if s == nil {
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "message": "会话不存在或已过期"})
		return
	}
	if err := sftpRemoveAll(s.SFTPClient, req.Path); err != nil {
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "message": "删除失败: " + err.Error()})
		return
	}
	json.NewEncoder(w).Encode(map[string]interface{}{"success": true})
}

// handleSFTPRename POST /api/ops/sftp/rename  body: {session, oldPath, newPath}

func handleSFTPRename(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	var req struct {
		Session string `json:"session"`
		OldPath string `json:"oldPath"`
		NewPath string `json:"newPath"`
	}
	json.NewDecoder(r.Body).Decode(&req)
	s := getSFTPSession(req.Session)
	if s == nil {
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "message": "会话不存在或已过期"})
		return
	}
	if err := s.SFTPClient.Rename(req.OldPath, req.NewPath); err != nil {
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "message": "重命名失败: " + err.Error()})
		return
	}
	json.NewEncoder(w).Encode(map[string]interface{}{"success": true})
}

// sftpMkdirAll 递归创建远程目录（POSIX 路径）

func sftpMkdirAll(client *sftp.Client, remotePath string) error {
	if _, err := client.Stat(remotePath); err == nil {
		return nil
	}
	// 计算父目录（手动处理正斜杠）
	clean := strings.TrimRight(remotePath, "/")
	lastSlash := strings.LastIndex(clean, "/")
	if lastSlash > 0 {
		parent := clean[:lastSlash]
		if err := sftpMkdirAll(client, parent); err != nil {
			return err
		}
	}
	return client.Mkdir(remotePath)
}

// sftpRemoveAll 递归删除远程文件或目录

func sftpRemoveAll(client *sftp.Client, remotePath string) error {
	stat, err := client.Stat(remotePath)
	if err != nil {
		return err
	}
	if !stat.IsDir() {
		return client.Remove(remotePath)
	}
	entries, err := client.ReadDir(remotePath)
	if err != nil {
		return err
	}
	for _, e := range entries {
		child := strings.TrimRight(remotePath, "/") + "/" + e.Name()
		if err := sftpRemoveAll(client, child); err != nil {
			return err
		}
	}
	return client.RemoveDirectory(remotePath)
}

// handleDatabaseTablesList 获取数据库表列表

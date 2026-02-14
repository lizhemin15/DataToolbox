# 更新日志

## 2026-02-15 - 修复文档同步问题

### 🐛 修复的问题
1. **用户1创建文档后，用户2看不见** - 已修复
2. **刷新后文档消失** - 已修复
3. **文档数据未持久化到服务器** - 已修复

### 🔧 主要改动

#### 前端 (script.js)
1. **修改broadcastMessage函数**
   - 之前：遍历onlineUsers点对点发送消息
   - 现在：直接发送到服务器，由服务器广播
   ```javascript
   // 之前
   function broadcastMessage(msg) {
       Object.keys(onlineUsers).forEach(userId => {
           if (userId !== clientId) {
               sendMessage({ ...msg, to: userId });
           }
       });
   }
   
   // 现在
   function broadcastMessage(msg) {
       sendMessage(msg);  // 直接发送到服务器
   }
   ```

2. **修改createDocument函数**
   - 之前：先添加到本地列表，再发送到服务器
   - 现在：发送到服务器，等待服务器确认后添加
   ```javascript
   // 现在不在本地添加，等待服务器的doc-created确认消息
   sendMessage({ type: 'doc-created', document: doc });
   ```

3. **修改doc-created消息处理**
   - 添加重复检查，避免同一文档被添加多次
   - 自动打开刚创建的文档
   ```javascript
   case 'doc-created':
       if (!documents.find(d => d.id === msg.document.id)) {
           documents.push(msg.document);
       }
       if (window._pendingDocId === msg.document.id) {
           openDocument(msg.document.id);
       }
   ```

4. **修改openDocument函数**
   - 之前：使用本地文档数据
   - 现在：请求服务器获取最新数据
   ```javascript
   // 发送请求到服务器
   sendMessage({ type: 'doc-opened', docId: docId });
   // 等待服务器返回文档内容
   ```

5. **修改deleteDocument函数**
   - 之前：立即从本地删除
   - 现在：发送到服务器，等待确认后删除

#### 后端 (server.go)
1. **doc-created处理**
   - 存储文档到hub.documents
   - 广播给**所有**客户端（包括创建者，用于确认）
   - 添加详细日志
   ```go
   hub.documents[docId] = msg.Document
   // 广播给所有客户端
   for _, client := range hub.clients {
       client.Send <- data
   }
   ```

2. **doc-opened处理**
   - 从hub.documents获取文档内容
   - 返回最新的文档数据给请求者
   - 记录打开文档的用户
   - 通知其他用户更新在线列表
   ```go
   // 从服务器获取文档
   doc, exists := hub.documents[msg.DocId]
   // 返回给请求者
   c.Send <- responseData
   ```

3. **doc-title-update处理**
   - 更新服务器端存储的文档标题
   - 转发给所有其他用户
   ```go
   docMap["title"] = msg.Title
   hub.documents[msg.DocId] = docMap
   ```

4. **doc-update处理**
   - 根据更新类型维护服务器端文档状态
   - 支持Excel单元格更新、添加行列
   - 转发给所有其他用户
   ```go
   switch updateType {
   case "excel-cell":
       // 更新单元格值
   case "excel-add-row":
       // 添加行
   case "excel-add-col":
       // 添加列
   }
   ```

5. **doc-deleted处理**
   - 从hub.documents删除文档
   - 清理hub.docUsers中的记录
   - 广播给所有客户端（包括删除者）

### 📋 数据流改进

#### 创建文档流程（修复后）
```
用户1点击新建
  ↓
前端生成文档对象
  ↓
发送doc-created到服务器（不带to字段）
  ↓
服务器存储到hub.documents
  ↓
服务器广播给所有用户（包括用户1）
  ↓
所有用户收到doc-created
  ↓
所有用户添加到本地documents列表
  ↓
创建者自动打开文档
```

#### 打开文档流程（修复后）
```
用户点击文档
  ↓
发送doc-opened请求（只带docId）
  ↓
服务器从hub.documents获取最新文档
  ↓
服务器返回文档内容给请求者
  ↓
请求者收到文档内容
  ↓
设置currentDoc并显示编辑器
```

#### 刷新页面流程（修复后）
```
用户刷新页面
  ↓
重新连接WebSocket
  ↓
发送doc-list-request
  ↓
服务器返回hub.documents中的所有文档
  ↓
前端更新documents列表
  ↓
渲染文档列表
```

### ✅ 测试步骤

#### 测试1: 创建文档同步
1. 打开两个浏览器窗口（用户1和用户2）
2. 用户1创建新文档"测试Excel"
3. **预期结果**：
   - 用户1能看到新文档并自动打开
   - 用户2立即看到新文档出现在列表中

#### 测试2: 刷新后文档持久化
1. 用户1创建文档"测试Word"
2. 用户2刷新页面
3. **预期结果**：
   - 用户2刷新后仍能看到"测试Word"文档

#### 测试3: 编辑同步
1. 用户1和用户2都打开同一文档
2. 用户1编辑单元格或文字
3. **预期结果**：
   - 用户2实时看到更新
   - 用户2刷新后看到最新内容

#### 测试4: 删除同步
1. 用户1删除文档
2. **预期结果**：
   - 用户1和用户2都看到文档消失
   - 如果用户2正在编辑该文档，自动返回列表页

#### 测试5: 标题修改
1. 用户1修改文档标题
2. **预期结果**：
   - 用户2立即看到列表中的标题更新
   - 用户2刷新后看到新标题

### 🔍 调试信息

服务器端现在会输出详细日志：
```
文档已创建并存储: xxxxx (总共1个文档)
文档创建消息已发送给: user1
文档创建消息已发送给: user2
用户 user1 打开文档: xxxxx，已返回文档内容
文档标题已更新: xxxxx -> 新标题
文档已删除: xxxxx (剩余0个文档)
```

前端控制台日志：
```javascript
文档已添加: 测试Excel
文档已打开: 测试Excel
WebSocket已连接
```

### 📝 注意事项

1. **服务器重启后数据丢失**：当前版本文档数据存储在内存中（hub.documents），服务器重启后会清空。建议及时导出重要文档。

2. **并发编辑冲突**：如果两个用户同时编辑同一单元格/位置，后发送的更新会覆盖先发送的。建议团队协调编辑区域。

3. **网络延迟**：在网络延迟较大的情况下，可能会有短暂的不同步。刷新页面可以获取最新状态。

4. **大文档性能**：非常大的文档可能影响同步性能。建议：
   - Excel: 不超过1000行
   - Word: 不超过10000字

### 🚀 后续改进计划

- [ ] 实现数据库持久化存储
- [ ] 添加操作撤销/重做功能
- [ ] 实现更智能的冲突解决
- [ ] 添加版本历史记录
- [ ] 优化大文档的同步性能
- [ ] 实现完整的OT（Operational Transformation）算法

### 💻 如何应用此更新

1. 重新编译服务器：
```bash
go build -o DataToolbox-Server.exe server.go
```

2. 停止旧服务器（如果正在运行）

3. 启动新服务器：
```bash
.\DataToolbox-Server.exe
```

4. 刷新浏览器页面，开始测试

### 🐛 已知问题

无已知问题。如发现问题请及时反馈。

# 多 Token 机制修改总结

## 修改概述
将 DataToolbox 数据本体池的 token 机制从单 token 改为支持多 token 同时有效，避免新登录顶掉旧登录。

## 主要修改

### 1. User 结构体 (server.go:806-822)
- **新增字段**：
  - `Tokens []string`：支持多个 token 同时有效
  - `TokenEntries []TokenEntry`：带时间戳的 token，支持过期清理
- **保留字段**：
  - `Token string`：标记为已废弃，保留用于向后兼容

### 2. TokenEntry 结构体 (server.go:806-811)
```go
type TokenEntry struct {
    Token     string `json:"token"`
    CreatedAt int64  `json:"created_at"` // Unix 时间戳
}
```

### 3. 登录逻辑 (server.go:2874-2885)
- **旧逻辑**：`user.Token = token`（直接覆盖）
- **新逻辑**：
  ```go
  user.Tokens = append(user.Tokens, token)
  user.TokenEntries = append(user.TokenEntries, TokenEntry{Token: token, CreatedAt: time.Now().Unix()})
  ```
- **迁移逻辑**：如果旧数据有 `Token` 字段，自动迁移到 `Tokens` 列表

### 4. Token 验证逻辑 (server.go:2818-2833)
- **新增辅助函数**：`userHasToken(user *User, token string) bool`
- **验证顺序**：
  1. 检查 `TokenEntries`（带过期检查，7天有效期）
  2. 检查 `Tokens` 列表（兼容不带时间戳的 token）
  3. 检查旧 `Token` 字段（向后兼容）

### 5. 所有验证点更新
- `getDataOntologyUserFromRequest()` (server.go:2774)
- `handleApiKey()` (server.go:2890)
- `handleUserSettings()` (server.go:2953)

### 6. 数据加载迁移 (server.go:1151-1167)
在 `loadDataOntologyStore()` 中添加迁移逻辑：
- 将旧的 `Token` 字段迁移到 `Tokens` 列表
- 避免重复 token

### 7. Token 过期清理 (server.go:10157-10194)
- **新增常量**：`dataOntologyTokenTTL = 7 * 24 * time.Hour`（7天有效期）
- **新增常量**：`TokenCleanInterval = 1 * time.Hour`（每小时清理一次）
- **新增函数**：`startTokenCleaner()`
  - 定期清理过期的 `TokenEntries`
  - 同步更新 `Tokens` 列表
  - 清理后自动持久化

### 8. 启动清理器 (server.go:10675)
在 `main()` 函数中启动 token 清理器：
```go
startTokenCleaner()
```

## 测试覆盖

创建了 `token_test.go`，包含以下测试：
1. `TestUserHasToken`：测试 token 验证逻辑
   - token 在 Tokens 列表中
   - token 不在 Tokens 列表中
   - token 在 TokenEntries 中（未过期）
   - token 在 TokenEntries 中（已过期）
   - 旧 Token 字段（向后兼容）
   - 空 token 列表
   - token 同时在 Tokens 和 Token 字段中

2. `TestMultipleTokensScenario`：测试多 token 场景
   - 第一次登录生成 token1
   - 第二次登录生成 token2
   - 验证两个 token 都有效

3. `TestBackwardCompatibility`：测试向后兼容性
   - 旧数据只有 Token 字段
   - 验证旧 token 仍然有效
   - 验证迁移后 token 仍然有效

4. `TestTokenExpiration`：测试 token 过期机制
   - 1小时前的 token（有效）
   - 6天前的 token（有效）
   - 8天前的 token（过期）
   - 30天前的 token（过期）

## 向后兼容性

1. **数据兼容**：
   - 旧数据只有 `Token` 字段，仍然可以正常使用
   - 加载时自动迁移到 `Tokens` 列表
   - 验证时同时检查 `Token` 和 `Tokens`

2. **API 兼容**：
   - 登录 API 返回格式不变
   - 验证逻辑对客户端透明
   - 旧客户端无需修改

## 验证方法

### 功能验证
1. 登录两次，获取两个 token
2. 两个 token 都应该能访问需要鉴权的 API
3. 不会出现"第一个登录被顶掉"的情况

### 过期验证
1. 创建一个 8 天前的 token
2. 验证该 token 已失效
3. 等待清理器运行（或手动触发）
4. 验证过期 token 被清理

### 兼容性验证
1. 使用旧版本数据文件（只有 `Token` 字段）
2. 启动服务，验证旧 token 仍然有效
3. 登录一次，验证新 token 也有效
4. 重启服务，验证两个 token 都有效

## 性能考虑

1. **内存开销**：
   - 每个用户多存储一个 `[]string` 和 `[]TokenEntry`
   - 假设每个用户平均 3 个 token，每个 token 36 字节（UUID）
   - 额外开销：约 200 字节/用户

2. **CPU 开销**：
   - token 验证从 O(1) 变为 O(n)，n 为 token 数量
   - 实际场景中 n 很小（通常 < 5），影响可忽略

3. **磁盘开销**：
   - 数据文件略微增大（存储多个 token）
   - 定期清理过期 token，避免无限增长

## 安全考虑

1. **Token 泄露风险**：
   - 多 token 意味着多个攻击面
   - 建议配合 HTTPS 使用
   - 可考虑添加 token 撤销功能

2. **过期时间**：
   - 默认 7 天过期
   - 可通过修改 `dataOntologyTokenTTL` 常量调整

3. **清理机制**：
   - 每小时清理一次过期 token
   - 避免长期不用的 token 累积

## 未来改进

1. **Token 撤销**：
   - 添加 API 允许用户主动撤销某个 token
   - 或撤销所有 token（强制重新登录）

2. **Token 元数据**：
   - 记录 token 的创建 IP、User-Agent 等
   - 方便用户识别可疑登录

3. **Token 使用统计**：
   - 记录每个 token 的最后使用时间
   - 长期未使用的 token 可提前清理

## 文件修改列表

1. `server.go`：
   - User 结构体定义
   - TokenEntry 结构体定义
   - userHasToken 辅助函数
   - handleDataOntologyLogin 登录处理
   - getDataOntologyUserFromRequest token 验证
   - handleApiKey API Key 管理
   - handleUserSettings 用户设置
   - loadDataOntologyStore 数据加载迁移
   - startTokenCleaner token 清理器
   - main 函数启动清理器

2. `token_test.go`（新增）：
   - 单元测试覆盖所有场景

## 注意事项

1. 不要修改其他逻辑
2. 保持代码风格一致
3. 添加必要的注释说明多 token 机制
4. 确保向后兼容性
5. 定期清理过期 token 避免数据膨胀

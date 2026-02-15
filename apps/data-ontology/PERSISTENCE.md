# 数据本体池 - 持久化存储说明

## 概述

数据本体池的所有用户信息和数据库配置都会自动持久化到本地JSON文件中，方便数据迁移和备份。

## 持久化文件位置

```
apps/data-ontology/data-store.json
```

该文件会在服务器首次运行时自动创建。

## 数据结构

```json
{
  "users": {
    "用户名": {
      "username": "用户名",
      "password": "MD5加密后的密码",
      "token": "当前登录Token"
    }
  },
  "databases": {
    "数据库ID": {
      "id": "UUID格式的数据库ID",
      "type": "数据库类型",
      "name": "自定义连接名称",
      "host": "主机地址",
      "port": 端口号,
      "user": "数据库用户名",
      "password": "数据库密码",
      "database": "数据库名"
    }
  }
}
```

## 自动化流程

### 启动时
1. 服务器启动时自动检查 `data-store.json` 是否存在
2. 如果存在，加载所有用户和数据库配置到内存
3. 如果不存在，创建新文件并初始化默认管理员账号

### 运行时
所有数据修改操作都会自动保存到文件：
- 添加数据库配置 → 自动保存
- 更新数据库配置 → 自动保存
- 删除数据库配置 → 自动保存

## 使用场景

### 场景1：首次部署
1. 启动服务器
2. 系统自动创建 `data-store.json`
3. 使用默认账号 `admin/admin1234` 登录
4. 添加数据库配置，系统自动保存

### 场景2：服务器重启
1. 重启服务器
2. 系统自动从 `data-store.json` 加载所有配置
3. 无需重新配置，直接使用

### 场景3：数据迁移
有两种迁移方式：

#### 方式1：完整迁移（推荐）
```bash
# 复制整个应用文件夹
cp -r apps/data-ontology /path/to/new/location/apps/
```

#### 方式2：仅迁移配置
```bash
# 只复制配置文件
cp apps/data-ontology/data-store.json /path/to/new/location/apps/data-ontology/
```

### 场景4：数据备份
```bash
# 备份配置文件
cp apps/data-ontology/data-store.json backups/data-store-$(date +%Y%m%d).json

# 或使用git管理（需要移除.gitignore规则）
git add apps/data-ontology/data-store.json
git commit -m "backup: 数据本体池配置"
```

### 场景5：配置恢复
```bash
# 从备份恢复
cp backups/data-store-20260216.json apps/data-ontology/data-store.json

# 重启服务器自动加载
```

## 安全建议

### 1. 文件权限
```bash
# Linux/Mac
chmod 600 apps/data-ontology/data-store.json  # 仅所有者可读写

# 或
chmod 644 apps/data-ontology/data-store.json  # 所有者可读写，其他人只读
```

### 2. 密码安全
- 用户密码使用MD5哈希存储
- 数据库密码以明文存储（用于连接）
- **重要**：不要将 `data-store.json` 提交到公开的Git仓库
- 使用环境变量或密钥管理工具存储敏感配置

### 3. 访问控制
- 定期审查用户列表
- 定期更换管理员密码
- 使用强密码策略

## 故障排查

### 文件损坏
如果 `data-store.json` 损坏导致启动失败：

1. 重命名损坏的文件
```bash
mv apps/data-ontology/data-store.json apps/data-ontology/data-store.json.bak
```

2. 重启服务器，系统会创建新文件

3. 手动从备份或 `.bak` 文件恢复配置

### 加载失败
查看服务器日志输出：
```
加载持久化数据失败: <错误信息>
```

常见原因：
- JSON格式错误 → 使用JSON验证工具检查
- 文件权限问题 → 检查文件读写权限
- 文件路径错误 → 确认目录结构正确

### 保存失败
查看服务器日志输出：
```
保存数据库配置失败: <错误信息>
```

常见原因：
- 磁盘空间不足
- 文件被占用
- 权限不足

## 示例文件

参考 `data-store.example.json` 查看完整的数据结构示例。

## 版本兼容性

当前持久化格式版本：v1.0

未来版本如有数据格式变更，会提供自动迁移工具。

## 最佳实践

1. **定期备份**：建议每天或每周备份 `data-store.json`
2. **版本控制**：在私有仓库中使用Git管理配置文件
3. **环境隔离**：开发/测试/生产环境使用独立的配置文件
4. **监控日志**：关注服务器启动日志，确认数据正确加载
5. **密码管理**：定期更换数据库密码并更新配置

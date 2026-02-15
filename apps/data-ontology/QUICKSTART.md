# 数据本体池 - 快速开始指南

## 🚀 5分钟快速开始

### 步骤1：启动服务器

```bash
# 确保在DataToolbox根目录
./server.exe
# 或
go run server.go
```

服务器启动后会显示：
```
============================================================
DataToolbox 服务器已启动
============================================================
本地访问: http://localhost:8080
局域网访问: http://192.168.x.x:8080
============================================================
数据本体池初始化完成 - 用户数: 1, 数据库配置数: 0
```

### 步骤2：打开数据本体池

浏览器访问：
```
http://localhost:8080/apps/data-ontology/
```

### 步骤3：登录系统

使用默认管理员账号：
- 用户名：`admin`
- 密码：`admin1234`

### 步骤4：添加第一个数据库

1. 点击左侧 **"+ 添加"** 按钮
2. 选择数据库类型（如 MySQL）
3. 填写连接信息：
   - 连接名称：`测试MySQL`
   - 主机地址：`localhost`
   - 端口：`3306`
   - 用户名：`root`
   - 密码：`your-password`
   - 数据库名：`test`
4. 点击 **"测试连接"** 验证配置
5. 点击 **"保存"**

✅ 配置已自动保存到 `apps/data-ontology/data-store.json`

### 步骤5：查看数据

1. 在左侧列表点击刚添加的数据库
2. 查看数据库信息和表列表
3. 点击任意表名预览数据

## 📦 持久化验证

### 验证1：服务器重启后数据保留

```bash
# 1. 停止服务器 (Ctrl+C)
# 2. 重新启动服务器
./server.exe

# 3. 刷新浏览器页面
# 4. 确认数据库配置仍然存在
```

### 验证2：查看持久化文件

```bash
# 查看保存的配置
cat apps/data-ontology/data-store.json

# 或在Windows上
type apps\data-ontology\data-store.json
```

你会看到类似的内容：
```json
{
  "users": {
    "admin": {
      "username": "admin",
      "password": "0192023a7bbd73250516f069df18b500",
      "token": "..."
    }
  },
  "databases": {
    "uuid-here": {
      "id": "uuid-here",
      "type": "mysql",
      "name": "测试MySQL",
      ...
    }
  }
}
```

## 🔄 数据迁移测试

### 场景：迁移到新服务器

```bash
# 在原服务器上
# 1. 复制配置文件
cp apps/data-ontology/data-store.json /tmp/backup.json

# 在新服务器上
# 2. 将配置文件放到对应位置
mkdir -p apps/data-ontology
cp /tmp/backup.json apps/data-ontology/data-store.json

# 3. 启动服务器
./server.exe

# 4. 打开浏览器，所有配置自动加载完成！
```

## 🎯 常见使用场景

### 场景1：管理多个数据库

```
添加MySQL数据库 → 保存 ✓
添加PostgreSQL数据库 → 保存 ✓
添加MongoDB数据库 → 保存 ✓
```

所有配置自动保存在一个文件中。

### 场景2：团队协作

```bash
# 成员A：添加数据库配置
# 1. 添加开发环境数据库
# 2. 提交配置文件到私有Git仓库
git add apps/data-ontology/data-store.json
git commit -m "添加开发环境数据库配置"
git push

# 成员B：拉取配置
git pull
# 重启服务器，自动加载配置
```

### 场景3：多环境管理

```bash
# 开发环境
cp data-store.dev.json apps/data-ontology/data-store.json
./server.exe

# 测试环境
cp data-store.test.json apps/data-ontology/data-store.json
./server.exe

# 生产环境
cp data-store.prod.json apps/data-ontology/data-store.json
./server.exe
```

## 🛡️ 安全提示

1. **不要将配置文件提交到公开仓库**
   ```bash
   # 已自动生成 .gitignore
   cat apps/data-ontology/.gitignore
   # data-store.json
   ```

2. **定期备份配置**
   ```bash
   # 创建备份脚本
   cp apps/data-ontology/data-store.json \
      backups/data-store-$(date +%Y%m%d-%H%M%S).json
   ```

3. **修改默认密码**
   - 首次登录后建议立即修改管理员密码（功能开发中）

## 📚 下一步

- 查看 [README.md](README.md) 了解所有功能
- 查看 [PERSISTENCE.md](PERSISTENCE.md) 了解持久化详情
- 查看 [DATABASE_SUPPORT.md](DATABASE_SUPPORT.md) 了解支持的数据库

## ❓ 常见问题

### Q: 配置文件在哪里？
A: `apps/data-ontology/data-store.json`

### Q: 如何重置所有配置？
A: 删除 `data-store.json` 文件，重启服务器会自动创建新文件

### Q: 是否支持加密存储？
A: 当前版本用户密码使用MD5哈希，数据库密码明文存储（用于连接）

### Q: 服务器启动失败？
A: 检查日志输出，常见原因是JSON格式错误或文件权限问题

### Q: 如何查看服务器日志？
A: 日志直接输出到控制台，可以重定向到文件：
```bash
./server.exe > server.log 2>&1
```

## 🎉 完成！

现在你已经掌握了数据本体池的基本使用和持久化功能。开始管理你的数据库吧！

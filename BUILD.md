# DataToolbox 构建说明

## 环境要求

- Go 1.21 或更高版本

## 安装依赖

```bash
go mod download
```

## 构建服务器版本

### Windows
```bash
go build -o DataToolbox-Server.exe server.go
```

### Linux/Mac
```bash
go build -o DataToolbox-Server server.go
```

## 运行服务器

```bash
# Windows
DataToolbox-Server.exe

# Linux/Mac
./DataToolbox-Server
```

## 自定义端口

```bash
# 使用命令行参数
DataToolbox-Server.exe -port 9000

# 或修改 server.config.json
{
  "port": 8080,
  "host": "0.0.0.0"
}
```

## 功能说明

### 文件服务器
- 静态文件托管
- 支持局域网访问
- CORS跨域支持

### 局域网聊天
- WebSocket实时通讯
- 自动设备发现
- 消息、图片、文件传输
- 类微信UI设计

## 访问方式

- 本地访问: `http://localhost:8080`
- 局域网访问: `http://<局域网IP>:8080`
- 聊天应用: `http://localhost:8080/apps/lan-chat/`

## 依赖库

- `github.com/gorilla/websocket` - WebSocket支持

# DataToolbox 部署说明

## 快速开始（一行命令）

在下载并解压对应平台的 Release 包后，在安装目录执行：

```bash
chmod +x install.sh && ./install.sh
```

脚本会交互式询问安装目录（默认 root 为 `/opt/datatoolbox`，普通用户为 `~/datatoolbox`）、端口（默认 `8080`）、是否在 Linux 上配置 systemd 服务 `datatoolbox` 及是否开机自启，并完成复制文件、写入配置、端口检测与连通性验证。

## 手动部署

1. 从项目 Releases 页面下载与本机 CPU 架构匹配的压缩包并解压。
2. 将目录放到目标路径，例如 `/opt/datatoolbox`（需相应权限）。
3. 编辑 `server.config.json`（默认路径 **`/opt/datatoolbox/server.config.json`** 当安装目录为 `/opt/datatoolbox` 时）：

```json
{
  "port": 8080,
  "host": "0.0.0.0"
}
```

4. 赋予可执行权限并启动：

```bash
chmod +x datatoolbox-server
./datatoolbox-server
```

自定义端口可用 `./datatoolbox-server -port 3000`（命令行优先于配置文件）。

### 日志目录

- **root 且安装目录为 `/opt/datatoolbox`**：推荐将日志放到 **`/var/log/datatoolbox/`**（需自行创建并配置服务重定向）。
- **其他情况**：使用安装目录下的 **`logs/`**（例如 `~/datatoolbox/logs/`）。

`install.sh` 在配置 systemd 时会将标准输出/错误追加到上述日志目录中的 `server.log`。

## systemd 服务（Linux）

服务名：**`datatoolbox`**。

### 使用安装脚本（推荐）

运行 `./install.sh` 并选择创建 systemd 服务。root 写入 `/etc/systemd/system/datatoolbox.service`；非 root 使用用户单元 `~/.config/systemd/user/datatoolbox.service`（开机自启需 `loginctl enable-linger`）。

### 手动示例（root，安装目录 `/opt/datatoolbox`）

```ini
[Unit]
Description=DataToolbox Server
After=network.target

[Service]
Type=simple
WorkingDirectory=/opt/datatoolbox
ExecStart=/opt/datatoolbox/datatoolbox-server
Restart=always
RestartSec=3
StandardOutput=append:/var/log/datatoolbox/server.log
StandardError=append:/var/log/datatoolbox/server.log
SyslogIdentifier=datatoolbox

[Install]
WantedBy=multi-user.target
```

```bash
sudo mkdir -p /var/log/datatoolbox
sudo systemctl daemon-reload
sudo systemctl enable --now datatoolbox
```

查看状态与日志：

```bash
sudo systemctl status datatoolbox
journalctl -u datatoolbox -f
```

## Docker 部署

在**已包含** `datatoolbox-server` 与 `server.config.json` 的目录（通常为 Release 解压目录）中执行：

```bash
docker build -t datatoolbox:local .
docker run -d --name datatoolbox -p 8080:8080 \
  -v "$(pwd)/server.config.json:/opt/datatoolbox/server.config.json:ro" \
  datatoolbox:local
```

从源码仓库构建时，请先在仓库根目录执行 `go build -ldflags="-s -w" -o datatoolbox-server .`，再执行 `docker build`。

## 常见问题

**端口已被占用**  
安装脚本会检测端口；若仍冲突，请修改 `server.config.json` 中的 `port` 或使用 `-port`。

**非 root 无法写入 `/opt/datatoolbox`**  
使用默认用户目录安装（`~/datatoolbox`），或使用 `sudo` 创建目录并调整属主。

**systemd 用户服务无法开机自启**  
执行 `sudo loginctl enable-linger $USER`，并确认已 `systemctl --user enable datatoolbox`。

**macOS**  
无 systemd，可用 `install.sh` 完成文件与配置；需要开机自启时请使用 `launchd`（可参考将程序注册为 `LaunchAgents`）。

**Windows**  
在 Git Bash 或 WSL 中运行 `install.sh`；原生环境可手动解压后双击 `start.bat`。

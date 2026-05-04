#!/usr/bin/env bash
# DataToolbox 交互式安装脚本
# 用法：在解压后的发布包目录中执行 ./install.sh

set -euo pipefail

SERVICE_NAME="datatoolbox"
DEFAULT_PORT=8080
DEFAULT_HOST="0.0.0.0"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

info()  { echo -e "${CYAN}[信息]${NC} $*"; }
ok()    { echo -e "${GREEN}[成功]${NC} $*"; }
warn()  { echo -e "${YELLOW}[警告]${NC} $*"; }
err()   { echo -e "${RED}[错误]${NC} $*" >&2; }

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

detect_os() {
  case "$(uname -s 2>/dev/null)" in
    Linux*)   echo linux ;;
    Darwin*)  echo darwin ;;
    MINGW*|MSYS*|CYGWIN*) echo windows ;;
    *)        echo unknown ;;
  esac
}

is_root() {
  [[ "$(id -u 2>/dev/null || echo 1)" -eq 0 ]]
}

default_install_dir() {
  if is_root; then
    echo "/opt/datatoolbox"
  else
    echo "${HOME}/datatoolbox"
  fi
}

find_binary() {
  local os="$1"
  if [[ "$os" == "windows" ]]; then
    if [[ -f "$SCRIPT_DIR/datatoolbox-server.exe" ]]; then
      echo "datatoolbox-server.exe"
      return 0
    fi
  else
    if [[ -f "$SCRIPT_DIR/datatoolbox-server" ]]; then
      echo "datatoolbox-server"
      return 0
    fi
  fi
  return 1
}

prompt() {
  local def="$2"
  local input
  if [[ -n "$def" ]]; then
    read -r -p "$1 [默认: $def]: " input || true
    echo "${input:-$def}"
  else
    read -r -p "$1: " input || true
    echo "$input"
  fi
}

prompt_yn() {
  local def="${2:-n}"
  local p="$1"
  [[ "$def" == "y" ]] && p="$p [Y/n]" || p="$p [y/N]"
  local input
  read -r -p "$p: " input || true
  input="${input:-}"
  if [[ -z "$input" ]]; then
    [[ "$def" == "y" ]]
    return
  fi
  case "$(echo "$input" | tr '[:upper:]' '[:lower:]')" in
    y|yes) return 0 ;;
    *) return 1 ;;
  esac
}

write_server_config() {
  local path="$1"
  local port="$2"
  local host="$3"
  if command -v python3 >/dev/null 2>&1; then
    CONFIG_PATH="$path" PORT="$port" HOST="$host" python3 -c '
import json, os
cfg = {"port": int(os.environ["PORT"]), "host": os.environ["HOST"]}
with open(os.environ["CONFIG_PATH"], "w", encoding="utf-8") as f:
    json.dump(cfg, f, indent=2, ensure_ascii=False)
    f.write("\n")
'
  else
    printf '{\n  "port": %s,\n  "host": "%s"\n}\n' "$port" "$host" > "$path"
  fi
}

port_in_use() {
  local p="$1"
  if command -v lsof >/dev/null 2>&1; then
    lsof -iTCP:"$p" -sTCP:LISTEN >/dev/null 2>&1 && return 0
  fi
  if command -v ss >/dev/null 2>&1; then
    ss -tuln 2>/dev/null | grep -E ":${p}([^0-9]|$)" >/dev/null 2>&1 && return 0
  fi
  if command -v netstat >/dev/null 2>&1; then
    netstat -tuln 2>/dev/null | grep -E "[.:]${p}[[:space:]]" >/dev/null 2>&1 && return 0
  fi
  return 1
}

check_port_available() {
  local p="$1"
  if port_in_use "$p"; then
    err "端口 ${p} 已被占用，请更换端口或结束占用进程。"
    if command -v ss >/dev/null 2>&1; then
      ss -tulnp 2>/dev/null | grep ":${p}" || true
    fi
    return 1
  fi
  return 0
}

ensure_dir() {
  local d="$1"
  if [[ -d "$d" ]]; then
    return 0
  fi
  if mkdir -p "$d" 2>/dev/null; then
    return 0
  fi
  if is_root; then
    err "无法创建目录: $d"
    return 1
  fi
  warn "需要创建目录: $d"
  if command -v sudo >/dev/null 2>&1; then
    sudo mkdir -p "$d" && sudo chown -R "$(id -un):$(id -gn)" "$d"
    return 0
  fi
  err "无权限创建 $d，请使用 sudo 运行或更换安装目录。"
  return 1
}

copy_package_to() {
  local dest="$1"
  local bin_name="$2"
  ensure_dir "$dest" || return 1
  local items=("$bin_name" "server.config.json" "start.sh" "start.bat" "gov-runner" "gov-runner.exe")
  local f
  for f in "${items[@]}"; do
    if [[ -f "$SCRIPT_DIR/$f" ]]; then
      cp -f "$SCRIPT_DIR/$f" "$dest/"
    fi
  done
  # 复制静态文件目录（apps, css, js, lib 直接在包根目录）
  for dir in apps css js lib; do
    if [[ -d "$SCRIPT_DIR/$dir" ]]; then
      cp -r "$SCRIPT_DIR/$dir" "$dest/"
    fi
  done
  # 复制 index.html
  if [[ -f "$SCRIPT_DIR/index.html" ]]; then
    cp -f "$SCRIPT_DIR/index.html" "$dest/"
  fi
  chmod +x "$dest/$bin_name" 2>/dev/null || true
  [[ -f "$dest/start.sh" ]] && chmod +x "$dest/start.sh" 2>/dev/null || true
}

setup_logs() {
  local install_dir="$1"
  local use_var_log="$2"
  if [[ "$use_var_log" == "1" ]] && is_root; then
    local log_root="/var/log/${SERVICE_NAME}"
    mkdir -p "$log_root" 2>/dev/null || true
    chmod 755 "$log_root" 2>/dev/null || true
    echo "$log_root"
  else
    local ld="${install_dir}/logs"
    mkdir -p "$ld"
    echo "$ld"
  fi
}

write_systemd_unit() {
  local install_dir="$1"
  local log_file="$2"
  local unit_path="$3"
  local exec_bin="${install_dir}/datatoolbox-server"
  cat > "$unit_path" <<EOF
[Unit]
Description=DataToolbox Server
After=network.target

[Service]
Type=simple
WorkingDirectory=${install_dir}
ExecStart=${exec_bin}
Restart=always
RestartSec=3
StandardOutput=append:${log_file}
StandardError=append:${log_file}
SyslogIdentifier=${SERVICE_NAME}

[Install]
WantedBy=multi-user.target
EOF
}

write_systemd_user_unit() {
  local install_dir="$1"
  local log_file="$2"
  local unit_path="$3"
  local exec_bin="${install_dir}/datatoolbox-server"
  mkdir -p "$(dirname "$unit_path")"
  cat > "$unit_path" <<EOF
[Unit]
Description=DataToolbox Server (user)
After=network.target

[Service]
Type=simple
WorkingDirectory=${install_dir}
ExecStart=${exec_bin}
Restart=always
RestartSec=3
StandardOutput=append:${log_file}
StandardError=append:${log_file}

[Install]
WantedBy=default.target
EOF
}

verify_http() {
  local port="$1"
  local code
  if command -v curl >/dev/null 2>&1; then
    code="$(curl -s -o /dev/null -w "%{http_code}" --connect-timeout 3 "http://127.0.0.1:${port}/" || echo "000")"
    if [[ "$code" =~ ^[23] ]]; then
      ok "HTTP 检测成功 (状态码 ${code})"
      return 0
    fi
    warn "HTTP 检测未得到 2xx/3xx (状态码 ${code})，请手动访问确认。"
    return 0
  fi
  warn "未找到 curl，跳过 HTTP 验证。请浏览器访问 http://127.0.0.1:${port}/"
}

main() {
  echo ""
  echo "=========================================="
  echo "  DataToolbox 安装向导"
  echo "=========================================="
  echo ""

  local os
  os="$(detect_os)"
  info "检测到系统类型: ${os}"

  if ! bin_name="$(find_binary "$os")"; then
    err "当前目录未找到 datatoolbox-server（或 Windows 下的 .exe）。"
    err "请在官方发布包解压目录中运行本脚本。"
    exit 1
  fi
  ok "找到二进制: ${bin_name}"

  local def_dir
  def_dir="$(default_install_dir)"

  if [[ "$os" == "windows" ]]; then
    warn "当前为 Windows（Git Bash/WSL）。将复制文件并写入配置；systemd 不适用。"
    local win_dir
    win_dir="$(prompt "安装目录" "${def_dir}")"
    win_dir="${win_dir//\\//}"
    [[ -z "$win_dir" ]] && { err "安装目录不能为空"; exit 1; }
    ensure_dir "$win_dir" || exit 1
    copy_package_to "$win_dir" "$bin_name" || exit 1
    local win_port
    win_port="$(prompt "监听端口" "$DEFAULT_PORT")"
    [[ "$win_port" =~ ^[0-9]+$ ]] || { err "端口必须为数字"; exit 1; }
    if command -v netstat.exe >/dev/null 2>&1; then
      if netstat.exe -ano | grep -q ":${win_port}.*LISTENING"; then
        err "端口 ${win_port} 可能已被占用。"
        exit 1
      fi
    fi
    write_server_config "${win_dir}/server.config.json" "$win_port" "$DEFAULT_HOST"
    ok "配置已写入: ${win_dir}/server.config.json"
    echo ""
    ok "安装完成。请在资源管理器中进入目录，双击 start.bat 或在命令行运行:"
    echo "    cd \"${win_dir}\" && ./${bin_name}"
    exit 0
  fi

  if [[ "$os" == "unknown" ]]; then
    warn "无法识别操作系统，将按类 Unix 方式处理。"
  fi

  local install_dir
  install_dir="$(prompt "安装目录" "$def_dir")"
  install_dir="${install_dir/#\~/${HOME}}"
  [[ -z "$install_dir" ]] && { err "安装目录不能为空"; exit 1; }

  local port
  port="$(prompt "监听端口" "$DEFAULT_PORT")"
  [[ "$port" =~ ^[0-9]+$ ]] || { err "端口必须为数字"; exit 1; }

  if ! check_port_available "$port"; then
    if ! prompt_yn "仍要继续安装吗？" "n"; then
      exit 1
    fi
  fi

  ensure_dir "$install_dir" || exit 1
  copy_package_to "$install_dir" "$bin_name" || exit 1

  local use_var_log=0
  if is_root && [[ "$install_dir" == "/opt/datatoolbox" ]]; then
    use_var_log=1
  fi
  local log_dir
  log_dir="$(setup_logs "$install_dir" "$use_var_log")"
  local log_file="${log_dir}/server.log"
  touch "$log_file" 2>/dev/null || true

  write_server_config "${install_dir}/server.config.json" "$port" "$DEFAULT_HOST"
  ok "配置已写入: ${install_dir}/server.config.json"
  info "日志目录: ${log_dir}"

  local do_systemd=false
  local enable_boot=false

  if [[ "$os" == "linux" ]] && command -v systemctl >/dev/null 2>&1 && [[ -d /run/systemd/system || -d /lib/systemd/system ]]; then
    if prompt_yn "是否创建 systemd 服务 (${SERVICE_NAME})？" "n"; then
      do_systemd=true
      if prompt_yn "是否设置开机自启？" "n"; then
        enable_boot=true
      fi
    fi
  elif [[ "$os" == "linux" ]]; then
    info "未检测到 systemd，跳过服务安装。可使用 nohup 或 supervisor 手动托管。"
  fi

  if [[ "$do_systemd" == "true" ]]; then
    local system_unit="/etc/systemd/system/${SERVICE_NAME}.service"
    local user_unit="${HOME}/.config/systemd/user/${SERVICE_NAME}.service"

    if is_root; then
      write_systemd_unit "$install_dir" "$log_file" "$system_unit"
      ok "已写入 ${system_unit}"
      systemctl daemon-reload
      if [[ "$enable_boot" == "true" ]]; then
        systemctl enable "${SERVICE_NAME}.service"
      fi
      systemctl restart "${SERVICE_NAME}.service" 2>/dev/null || systemctl start "${SERVICE_NAME}.service"
      sleep 2
      if systemctl is-active --quiet "${SERVICE_NAME}.service"; then
        ok "systemd 服务已启动: ${SERVICE_NAME}"
      else
        err "服务启动失败，请执行: journalctl -u ${SERVICE_NAME} -e"
        exit 1
      fi
    else
      write_systemd_user_unit "$install_dir" "$log_file" "$user_unit"
      ok "已写入用户单元: ${user_unit}"
      if [[ -z "${XDG_RUNTIME_DIR:-}" && -d "/run/user/$(id -u)" ]]; then
        export XDG_RUNTIME_DIR="/run/user/$(id -u)"
      fi
      systemctl --user daemon-reload
      if [[ "$enable_boot" == "true" ]]; then
        systemctl --user enable "${SERVICE_NAME}.service"
        warn "用户服务开机自启需启用 linger: sudo loginctl enable-linger $(id -un)"
      fi
      systemctl --user restart "${SERVICE_NAME}.service" || systemctl --user start "${SERVICE_NAME}.service"
      sleep 2
      if systemctl --user is-active --quiet "${SERVICE_NAME}.service"; then
        ok "用户 systemd 服务已启动。"
      else
        err "用户服务启动失败，请执行: journalctl --user -u ${SERVICE_NAME} -e"
        exit 1
      fi
    fi
    verify_http "$port"
    echo ""
    ok "安装完成。管理命令: systemctl status ${SERVICE_NAME}"
    exit 0
  fi

  # 无 systemd：短暂启动进程并做 HTTP 检测
  info "正在启动进程做连通性检测…"
  cd "$install_dir" || exit 1
  "./${bin_name}" >>"${log_file}" 2>&1 &
  local test_pid=$!
  sleep 2
  verify_http "$port"
  kill "$test_pid" 2>/dev/null || true
  wait "$test_pid" 2>/dev/null || true

  if [[ "$os" == "darwin" ]]; then
    echo ""
    ok "安装完成。手动启动: cd \"${install_dir}\" && ./${bin_name}"
    echo "可将 plist 写入 ~/Library/LaunchAgents/ 实现开机启动（见 README_DEPLOY.md）。"
  else
    echo ""
    ok "安装完成。启动: cd \"${install_dir}\" && ./start.sh 或 ./${bin_name}"
  fi
}

main "$@"

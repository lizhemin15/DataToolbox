#!/usr/bin/env bash
#
# DataToolbox 卸载脚本
#
# 用法：./uninstall.sh [选项]
#
#   -y, --yes          跳过所有确认提示（无人值守）
#   -d, --dir PATH     指定安装目录（默认自动探测）
#   --purge            连数据一起删除（不备份！危险）
#   --keep-files       只移除服务，保留安装目录内所有文件
#   -h, --help         显示帮助
#
# 默认行为（最安全）：
#   1) 停止并移除 systemd 服务（系统级 + 用户级都处理）
#   2) 把数据【备份】到安装目录之外（data/、data-store.json/db、agent-config/、logs/）
#   3) 删除安装目录
#   4) 打印备份位置与回滚提示
#
# 数据默认只备份、不删除；要彻底清干净请显式加 --purge。
#
set -uo pipefail

SERVICE_NAME="${SERVICE_NAME:-datatoolbox}"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

info()  { echo -e "${CYAN}[信息]${NC} $*"; }
ok()    { echo -e "${GREEN}[成功]${NC} $*"; }
warn()  { echo -e "${YELLOW}[警告]${NC} $*"; }
err()   { echo -e "${RED}[错误]${NC} $*" >&2; }

ASSUME_YES=0
PURGE=0
KEEP_FILES=0
INSTALL_DIR_OPT=""

usage() {
  sed -n '3,25p' "$0" | sed 's/^# \{0,1\}//'
  exit 0
}

# ---------------------------------------------------------------- 参数解析
while [[ $# -gt 0 ]]; do
  case "$1" in
    -y|--yes)      ASSUME_YES=1; shift ;;
    -d|--dir)      INSTALL_DIR_OPT="${2:-}"; shift 2 ;;
    --purge)       PURGE=1; shift ;;
    --keep-files)  KEEP_FILES=1; shift ;;
    -h|--help)     usage ;;
    *) err "未知参数: $1"; echo "用 --help 查看用法"; exit 1 ;;
  esac
done

is_root() { [[ "$(id -u)" == "0" ]]; }

# ------------------------------------------------------------ 安装目录探测
# 优先级：--dir 参数 > systemd unit 的 WorkingDirectory > 默认路径
detect_install_dir() {
  if [[ -n "$INSTALL_DIR_OPT" ]]; then
    echo "$INSTALL_DIR_OPT"
    return 0
  fi
  # 从 systemd unit 里读真实工作目录（最准确，不会猜错）
  if command -v systemctl >/dev/null 2>&1; then
    local wd
    # 注意 pipefail：systemctl cat 在 unit 不存在时返回非零，整个管道也会非零，
    # 这里只取输出、不依赖退出码，故显式 || true 防止后续判断被带偏。
    wd="$(systemctl cat "${SERVICE_NAME}" 2>/dev/null | sed -n 's/^WorkingDirectory=//p' | head -n1 || true)"
    if [[ -n "$wd" && -d "$wd" ]]; then
      echo "$wd"
      return 0
    fi
  fi
  local uu="${HOME}/.config/systemd/user/${SERVICE_NAME}.service"
  if [[ -f "$uu" ]]; then
    local wd
    wd="$(sed -n 's/^WorkingDirectory=//p' "$uu" | head -n1)"
    if [[ -n "$wd" && -d "$wd" ]]; then
      echo "$wd"
      return 0
    fi
  fi
  if is_root; then
    echo "/opt/datatoolbox"
  else
    echo "${HOME}/datatoolbox"
  fi
}

# ------------------------------------------------------------------ 安全删除
# 卸载脚本里最危险的一行就是 rm -rf，这里加硬闸门：空路径/根路径/太短的路径一律拒绝。
safe_rm_rf() {
  local target="$1"
  if [[ -z "$target" ]]; then
    err "拒绝删除空路径"
    return 1
  fi
  case "$target" in
    "/"|"/opt"|"/usr"|"/etc"|"/var"|"/root"|"/home"|"$HOME"|"."|"..")
      err "拒绝删除危险路径: $target"
      return 1
      ;;
  esac
  if [[ ${#target} -lt 5 ]]; then
    err "路径过短，拒绝删除: $target"
    return 1
  fi
  rm -rf -- "$target"
}

# ------------------------------------------------------------------ 移除服务
remove_service() {
  local removed=0

  # 系统级 unit
  local sys_unit="/etc/systemd/system/${SERVICE_NAME}.service"
  if [[ -f "$sys_unit" ]]; then
    if is_root; then
      systemctl stop "${SERVICE_NAME}" 2>/dev/null || true
      systemctl disable "${SERVICE_NAME}" 2>/dev/null || true
      rm -f "$sys_unit"
      systemctl daemon-reload 2>/dev/null || true
      systemctl reset-failed "${SERVICE_NAME}" 2>/dev/null || true
      ok "已移除系统服务: ${SERVICE_NAME}"
      removed=1
    else
      warn "发现系统服务 ${sys_unit}，但当前非 root，跳过（请用 sudo 重新执行）"
    fi
  elif command -v systemctl >/dev/null 2>&1 && systemctl cat "${SERVICE_NAME}" >/dev/null 2>&1; then
    # unit 存在但不在标准路径（可能是运行时加载的）
    if is_root; then
      systemctl stop "${SERVICE_NAME}" 2>/dev/null || true
      systemctl disable "${SERVICE_NAME}" 2>/dev/null || true
      ok "已停止并禁用服务: ${SERVICE_NAME}"
      removed=1
    fi
  fi

  # 用户级 unit
  local user_unit="${HOME}/.config/systemd/user/${SERVICE_NAME}.service"
  if [[ -f "$user_unit" ]]; then
    systemctl --user stop "${SERVICE_NAME}" 2>/dev/null || true
    systemctl --user disable "${SERVICE_NAME}" 2>/dev/null || true
    rm -f "$user_unit"
    systemctl --user daemon-reload 2>/dev/null || true
    ok "已移除用户服务: ${SERVICE_NAME}"
    removed=1
  fi

  if [[ "$removed" == "0" ]]; then
    warn "未找到 ${SERVICE_NAME} 的 systemd 服务（可能未用 systemd 托管，或已卸载）"
  fi
}

# 兜底：服务没被 systemd 管、但进程还在跑 —— 只报告，不擅自 kill
report_leftover_process() {
  local pids
  pids="$(pgrep -f "${INSTALL_DIR}/datatoolbox-server" 2>/dev/null || true)"
  if [[ -n "$pids" ]]; then
    warn "检测到仍在运行的进程（未自动终止，请确认后手动处理）："
    # shellcheck disable=SC2086
    ps -o pid,etime,cmd -p $pids 2>/dev/null || true
  fi
}

# ------------------------------------------------------------------ 备份数据
# 返回 0 = 备份到了东西；1 = 没有数据可备份
backup_data() {
  local src="$1" dest="$2"
  mkdir -p "$dest"
  local found=0
  local items=(
    "data"
    "apps/data-ontology/data-store.json"
    "apps/data-ontology/data-store.db"
    "agent-config"
    "components"
    "templates"
    "server.config.json"
  )
  local p target
  for p in "${items[@]}"; do
    if [[ -e "$src/$p" ]]; then
      target="$dest/$(dirname "$p")"
      mkdir -p "$target"
      if cp -a "$src/$p" "$target/" 2>/dev/null; then
        ok "已备份: $p"
        found=1
      else
        warn "备份失败（已跳过）: $p"
      fi
    fi
  done
  [[ "$found" == "1" ]]
}

# ------------------------------------------------------------------ 主流程
echo ""
echo "=============================================="
echo "  DataToolbox 卸载"
echo "=============================================="
echo ""

INSTALL_DIR="$(detect_install_dir)"

if [[ ! -d "$INSTALL_DIR" ]]; then
  err "安装目录不存在: ${INSTALL_DIR}"
  echo "如果安装在其他位置，请用 --dir 指定，例如："
  echo "  ./uninstall.sh --dir /your/path"
  exit 1
fi

info "安装目录: ${INSTALL_DIR}"
if [[ "$KEEP_FILES" == "1" ]]; then
  info "模式: 仅移除服务（保留文件）"
elif [[ "$PURGE" == "1" ]]; then
  warn "模式: 移除服务 + 删除所有文件与数据（--purge，数据不留备份）"
else
  info "模式: 移除服务 + 备份数据 + 删除安装目录"
fi
echo ""

if [[ "$ASSUME_YES" != "1" ]]; then
  if [[ "$PURGE" == "1" ]]; then
    warn "这会永久删除 ${INSTALL_DIR} 下的全部文件（含数据库），无法恢复！"
  fi
  read -r -p "确认继续？[y/N]: " ans || true
  case "${ans:-}" in
    y|Y|yes|YES) ;;
    *) info "已取消"; exit 0 ;;
  esac
  echo ""
fi

# 1) 移除服务
info "停止并移除服务..."
remove_service
echo ""

BACKUP_DIR=""

# 2) 备份数据（除非 --purge 或 --keep-files）
if [[ "$PURGE" != "1" && "$KEEP_FILES" != "1" ]]; then
  BACKUP_DIR="${INSTALL_DIR}.data-backup.$(date +%Y%m%d_%H%M%S)"
  info "备份数据到: ${BACKUP_DIR}"
  if backup_data "$INSTALL_DIR" "$BACKUP_DIR"; then
    ok "数据备份完成"
  else
    warn "没有找到可备份的数据文件"
    rm -rf -- "$BACKUP_DIR" 2>/dev/null || true
    BACKUP_DIR=""
  fi
  echo ""
fi

# 3) 删除安装目录
if [[ "$KEEP_FILES" == "1" ]]; then
  info "--keep-files：保留安装目录，仅服务已移除"
else
  info "删除安装目录..."
  if safe_rm_rf "$INSTALL_DIR"; then
    ok "已删除: ${INSTALL_DIR}"
    report_leftover_process
  else
    err "删除失败，请手动处理: ${INSTALL_DIR}"
    exit 1
  fi
fi

# 4) 清理日志目录（仅 root 且日志在 /var/log 时）
LOG_DIR="/var/log/${SERVICE_NAME}"
if [[ -d "$LOG_DIR" ]]; then
  if [[ "$PURGE" == "1" ]]; then
    if safe_rm_rf "$LOG_DIR"; then
      ok "已删除日志目录: ${LOG_DIR}"
    fi
  else
    info "日志目录保留: ${LOG_DIR}（如需删除：rm -rf ${LOG_DIR}）"
  fi
fi

# 5) 结果汇总
echo ""
echo "=============================================="
echo "  DataToolbox 已卸载"
echo "=============================================="
echo ""
if [[ -n "$BACKUP_DIR" ]]; then
  echo "数据备份位置: ${BACKUP_DIR}"
  echo "恢复方式：把备份内容拷回原安装目录后重新执行 install.sh"
  echo ""
fi
echo "如需重装：解压发布包后执行 ./install.sh"
echo ""

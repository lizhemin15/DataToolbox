#!/usr/bin/env bash
# DataToolbox 更新脚本
# 用法：./update.sh <release-tarball.tar.gz>
# 示例：./update.sh datatoolbox-linux-amd64.tar.gz

set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

info()  { echo -e "${CYAN}[信息]${NC} $*"; }
ok()    { echo -e "${GREEN}[成功]${NC} $*"; }
warn()  { echo -e "${YELLOW}[警告]${NC} $*"; }
err()   { echo -e "${RED}[错误]${NC} $*" >&2; }

SERVICE_NAME="datatoolbox"
INSTALL_DIR="/opt/datatoolbox"

# 检查参数
if [[ $# -lt 1 ]]; then
    err "用法: $0 <release-tarball.tar.gz>"
    err "示例: $0 datatoolbox-linux-amd64.tar.gz"
    exit 1
fi

TARBALL="$1"
if [[ ! -f "$TARBALL" ]]; then
    err "文件不存在: $TARBALL"
    exit 1
fi

# 检查是否为 root
if [[ "$(id -u)" -ne 0 ]]; then
    err "请使用 root 权限运行此脚本"
    exit 1
fi

# 检查服务是否存在
if ! systemctl list-unit-files | grep -q "^${SERVICE_NAME}.service"; then
    err "服务 ${SERVICE_NAME} 未安装，请使用 install.sh 进行全新安装"
    exit 1
fi

info "开始更新 DataToolbox..."
info "安装目录: ${INSTALL_DIR}"

# 停止服务
info "停止服务..."
systemctl stop "$SERVICE_NAME" || true

# 备份当前版本
BACKUP_DIR="${INSTALL_DIR}.backup.$(date +%Y%m%d_%H%M%S)"
info "备份当前版本到: ${BACKUP_DIR}"
cp -a "$INSTALL_DIR" "$BACKUP_DIR"

# 解压新版本到临时目录
TMP_DIR=$(mktemp -d)
info "解压新版本..."
tar -xzf "$TARBALL" -C "$TMP_DIR"

# 更新文件
info "更新文件..."

# 1. 更新二进制文件
if [[ -f "$TMP_DIR/datatoolbox-server" ]]; then
    cp "$TMP_DIR/datatoolbox-server" "$INSTALL_DIR/"
    chmod +x "$INSTALL_DIR/datatoolbox-server"
    ok "已更新: datatoolbox-server"
fi

# 2. 更新 gov-runner
if [[ -f "$TMP_DIR/gov-runner" ]]; then
    cp "$TMP_DIR/gov-runner" "$INSTALL_DIR/"
    chmod +x "$INSTALL_DIR/gov-runner"
    ok "已更新: gov-runner"
fi

# 3. 更新前端文件（关键！）
# 注意：apps/data-ontology/data-store.json 是运行时配置，必须保留！
for item in index.html css js lib; do
    if [[ -e "$TMP_DIR/$item" ]]; then
        rm -rf "$INSTALL_DIR/$item"
        cp -r "$TMP_DIR/$item" "$INSTALL_DIR/"
        ok "已更新: $item/"
    fi
done

# apps 目录特殊处理：保留运行时配置文件和数据库
if [[ -e "$TMP_DIR/apps" ]]; then
    # 备份运行时配置
    DATA_STORE_BACKUP=""
    if [[ -f "$INSTALL_DIR/apps/data-ontology/data-store.json" ]]; then
        DATA_STORE_BACKUP=$(mktemp)
        cp "$INSTALL_DIR/apps/data-ontology/data-store.json" "$DATA_STORE_BACKUP"
        log "已备份运行时配置: data-store.json"
    fi
    
    # 备份运行时数据库（关系索引、向量索引等）
    DATA_DB_BACKUP=""
    if [[ -f "$INSTALL_DIR/apps/data-ontology/data-store.db" ]]; then
        DATA_DB_BACKUP=$(mktemp)
        cp "$INSTALL_DIR/apps/data-ontology/data-store.db" "$DATA_DB_BACKUP"
        log "已备份运行时数据库: data-store.db"
    fi
    
    # 更新 apps 目录（删除旧的，复制新的）
    rm -rf "$INSTALL_DIR/apps"
    cp -r "$TMP_DIR/apps" "$INSTALL_DIR/"
    
    # 恢复运行时配置（如果备份存在）
    if [[ -n "$DATA_STORE_BACKUP" && -f "$DATA_STORE_BACKUP" ]]; then
        cp "$DATA_STORE_BACKUP" "$INSTALL_DIR/apps/data-ontology/data-store.json"
        rm -f "$DATA_STORE_BACKUP"
        ok "已恢复运行时配置: data-store.json"
    fi
    
    # 恢复运行时数据库（如果备份存在）
    if [[ -n "$DATA_DB_BACKUP" && -f "$DATA_DB_BACKUP" ]]; then
        cp "$DATA_DB_BACKUP" "$INSTALL_DIR/apps/data-ontology/data-store.db"
        rm -f "$DATA_DB_BACKUP"
        ok "已恢复运行时数据库: data-store.db"
    fi
    
    ok "已更新: apps/"
fi

# 4. 更新启动脚本（可选）
if [[ -f "$TMP_DIR/start.sh" ]]; then
    cp "$TMP_DIR/start.sh" "$INSTALL_DIR/"
    chmod +x "$INSTALL_DIR/start.sh"
    ok "已更新: start.sh"
fi

# 清理临时目录
rm -rf "$TMP_DIR"

# 启动服务
info "启动服务..."
systemctl start "$SERVICE_NAME"

# 检查服务状态
sleep 2
if systemctl is-active --quiet "$SERVICE_NAME"; then
    ok "服务启动成功"
else
    err "服务启动失败，请检查日志: journalctl -u $SERVICE_NAME -n 50"
    exit 1
fi

# 显示版本信息
info "更新完成！"
echo ""
echo "===================================="
echo "  DataToolbox 已更新"
echo "===================================="
echo ""
echo "备份位置: ${BACKUP_DIR}"
echo "如需回滚: systemctl stop $SERVICE_NAME && rm -rf $INSTALL_DIR && mv $BACKUP_DIR $INSTALL_DIR && systemctl start $SERVICE_NAME"
echo ""

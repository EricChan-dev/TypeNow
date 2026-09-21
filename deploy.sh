#!/bin/bash
set -eo pipefail

# ─────────────────────────────────────────────────────────────
# 必须在 root 之外的正确用户下运行。
# 线上应用运行在 admin 用户的 pm2 空间（/home/admin/.pm2）中。
# 如果以 root 执行，pm2 会使用 root 自己的空空间（/root/.pm2），
# `pm2 restart typenow` 会看似成功，但完全没有碰到真实进程。
# 正确用法：su - admin -c '/home/admin/TypeNow/deploy.sh'
# ─────────────────────────────────────────────────────────────
EXPECTED_USER="admin"
if [ "$(whoami)" != "$EXPECTED_USER" ]; then
  echo "错误：必须以 $EXPECTED_USER 身份运行（当前为 $(whoami)）。" >&2
  echo "正确用法：su - $EXPECTED_USER -c '$0'" >&2
  exit 1
fi

PROJECT_DIR="/home/admin/TypeNow"
LOG_FILE="$PROJECT_DIR/deploy.log"

log() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" | tee -a "$LOG_FILE"
}

cd "$PROJECT_DIR"

log "=== 开始部署 ==="

log "拉取最新代码..."
git pull origin main 2>&1 | tee -a "$LOG_FILE"

log "安装依赖..."
pnpm install 2>&1 | tee -a "$LOG_FILE"

log "构建项目..."
pnpm run build 2>&1 | tee -a "$LOG_FILE"

# 确认 pm2 确实认识这个进程，避免「重启了一个不存在的目标」却报告成功
if ! pm2 describe typenow > /dev/null 2>&1; then
  log "错误：当前用户（$(whoami)）的 pm2 中不存在 typenow 进程，已中止部署"
  exit 1
fi

log "重启 PM2..."
pm2 restart typenow 2>&1 | tee -a "$LOG_FILE"

log "=== 部署完成 ==="

#!/bin/bash
set -e

PROJECT_DIR="/path/to/TypeNow"  # ← 改成你的实际路径
LOG_FILE="$PROJECT_DIR/deploy.log"

log() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" | tee -a "$LOG_FILE"
}

cd "$PROJECT_DIR"

log "=== 开始部署 ==="

log "拉取最新代码..."
git pull origin main 2>&1 | tee -a "$LOG_FILE"

log "安装依赖..."
npm install 2>&1 | tee -a "$LOG_FILE"

log "构建项目..."
npm run build 2>&1 | tee -a "$LOG_FILE"

log "重启 PM2..."
pm2 restart typenow 2>&1 | tee -a "$LOG_FILE"

log "=== 部署完成 ==="

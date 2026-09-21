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

# ─────────────────────────────────────────────────────────────
# 串行化：GitHub webhook 会自动触发本脚本，人工部署也可能同时进行。
# 两个构建并发会互相踩踏 node_modules / .next（2026-09-21 实际发生过：
# 依赖目录被删掉一半，靠内存中的进程苟活）。flock 保证同一时刻只有一个
# 部署在运行；后到的等待而非直接失败，避免漏掉真实推送。
# ─────────────────────────────────────────────────────────────
LOCK_FILE="/tmp/typenow-deploy.lock"
exec 200>"$LOCK_FILE"
if ! flock -w 900 200; then
  echo "错误：等待其他部署超时（超过 15 分钟），本次取消。" >&2
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
# --ff-only：服务器出现本地提交/分叉时必须显式失败，而不是静默生成合并提交
git pull --ff-only origin main 2>&1 | tee -a "$LOG_FILE"

log "安装依赖..."
# CI=true：非交互环境下 pnpm 会因缺少 TTY 中止清空 node_modules
#   （ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY），导致部署静默中断。
# --frozen-lockfile：package.json 与锁文件不一致时立即失败，避免装上未锁定的依赖。
CI=true pnpm install --frozen-lockfile 2>&1 | tee -a "$LOG_FILE"

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

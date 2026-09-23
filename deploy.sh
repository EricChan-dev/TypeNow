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
#
# 重试：本机到 github.com 的链路不稳定。2026-09-23 统计 deploy.log 的 101 次部署，
# 35 次未完成，其中 12 次是拉取阶段的网络故障（Empty reply from server /
# Failed to connect to github.com / Connection timed out / remote end hung up），
# 且全部集中在近期（2026-06 起）。这类故障是瞬时的，隔一分钟重试即可成功；
# 但 webhook 只在收到 push 时触发一次、没有补偿机制，所以不重试等于一次网络抖动
# 就静默漏掉一次发布（2026-09-23 14:45 的 f105dde 就是这样漏掉的，靠人工补跑）。
# 其余历史失败为 .git/objects 权限（7 次，已随属主修复解决）与 pnpm 无 TTY（2 次，已加 CI=true）。
PULL_DONE=0
for attempt in 1 2 3 4 5; do
  # 放进 if 条件里，set -e / pipefail 不会因为本次失败直接终止脚本
  if git pull --ff-only origin main 2>&1 | tee -a "$LOG_FILE"; then
    PULL_DONE=1
    break
  fi
  log "第 ${attempt} 次拉取失败，$((attempt * 15)) 秒后重试..."
  sleep $((attempt * 15))
done
if [ "$PULL_DONE" != "1" ]; then
  log "错误：连续 5 次拉取均失败，本次部署取消（未构建、未重启，线上维持原版本）"
  exit 1
fi
# 记录本次实际部署的提交，便于事后核对线上构建对应哪个版本
log "已同步到：$(git log -1 --format='%h %ci %s')"

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

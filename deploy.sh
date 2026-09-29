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
# ─────────────────────────────────────────────────────────────
# 构建到暂存目录，成功后再替换 .next。
#
# 直接 `next build` 是就地覆写 .next 的：一旦构建中途失败（编译报错、OOM、
# 或与另一个构建并发），.next 会残留一个写坏一半的产物。此时脚本虽然退出、
# 没有重启，但旧进程仍在跑，用户首次请求某个尚未加载的 chunk 就会 404
# ——失败从「发布没生效」升级成「线上报错」。
#
# 改为：构建到 .next-staging（由 TYPENOW_DIST_DIR 传给 next.config.ts），
# 校验产物完整后才用两次 rename 换掉 .next。校验不通过就直接退出，
# 线上 .next 一个字节都没动。
#
# 暂存目录用固定名而不是带 PID 的名字：next build 会往 tsconfig.json 的
# include 里塞该目录的 types 路径（并顺手重排格式），带 PID 的名字会让
# tsconfig.json 每次部署都变化，工作区变脏后 server 远端的
# receive.denyCurrentBranch=updateInstead 会拒绝推送、git pull 也可能失败。
# 固定名 + 已提交对应的 include 条目，next build 就不会再改写 tsconfig.json。
# 同一时刻只可能有一个部署（上面有 flock），固定名不会冲突。
#
# 回滚：上一版会保留为 .next-prev，如需回退
#   mv .next .next-broken && mv .next-prev .next && pm2 restart typenow
# ─────────────────────────────────────────────────────────────
rm -rf .next-staging
STAGING_DIR=".next-staging"
export TYPENOW_DIST_DIR="$STAGING_DIR"

# ─────────────────────────────────────────────────────────────
# 构建前清掉上一次部署遗留的生成类型目录。
#
# 根因：tsconfig 同时 include 了 .next/types 与 .next-staging/types
# （后者由 next build 自动追加）。而 .next/types 是**上一次成功部署**留下的产物，
# 里面的 validator.ts 会 import 当时存在的每一个路由。只要本次改动删除或重命名了
# 任何一个路由，旧 validator 就会引用一个已不存在的模块，构建的
# `Running TypeScript ...` 阶段直接失败（2026-09-26 删除
# /api/admin/analytics 时就撞上了）。
#
# 更麻烦的是它自锁：部署失败 → .next 不被替换 → 旧 .next/types 永远在 →
# 之后每一次部署都会以完全相同的原因失败，必须人工登服务器处理。
#
# 这些生成类型只服务于构建期类型检查，运行时（next start）不读它们，
# 所以构建前清掉即可；新的一份会由本次构建在 .next-staging/types 里重新生成。
# ─────────────────────────────────────────────────────────────
rm -rf .next/types .next/dev/types

if ! pnpm run build 2>&1 | tee -a "$LOG_FILE"; then
  log "错误：构建失败，本次部署取消。线上 .next 未被触碰，仍在运行原版本。"
  rm -rf "$STAGING_DIR"
  exit 1
fi
unset TYPENOW_DIST_DIR

# BUILD_ID 与 server/ 是 next start 的必需产物，缺任意一个都说明构建没走完
if [ ! -f "$STAGING_DIR/BUILD_ID" ] || [ ! -d "$STAGING_DIR/server" ]; then
  log "错误：构建产物不完整（缺少 $STAGING_DIR/BUILD_ID 或 $STAGING_DIR/server），本次部署取消。线上 .next 未被触碰。"
  rm -rf "$STAGING_DIR"
  exit 1
fi
# 确认 pm2 确实认识这个进程，避免「重启了一个不存在的目标」却报告成功
if ! pm2 describe typenow > /dev/null 2>&1; then
  log "错误：当前用户（$(whoami)）的 pm2 中不存在 typenow 进程，已中止部署"
  rm -rf "$STAGING_DIR"
  exit 1
fi

log "替换构建产物：$STAGING_DIR → .next（上一版保留为 .next-prev）"
# 两次 rename 之间 .next 有亚毫秒级的不存在窗口；相比原先长达数分钟的
# 「就地覆写期间产物是坏的」，这只是理论窗口。
rm -rf .next-prev
# 写成 if 而不是 `[ -e .next ] && mv ...`：后者在 .next 不存在时返回 1，
# 在 set -e 下会直接终止脚本
if [ -e .next ]; then
  mv .next .next-prev
fi
mv "$STAGING_DIR" .next

log "重启 PM2..."
pm2 restart typenow 2>&1 | tee -a "$LOG_FILE"

# ─────────────────────────────────────────────────────────────
# 安装主动触达的 crontab（生命周期消息扫描）
#
# 为什么放在部署脚本里，而不是"在服务器上手工配一次"：
#   本仓库此前没有任何定时任务，这是第一处。手工配置的问题是**它不会跟着
#   代码走** —— 换机器、重装、或新建环境时会静默失效，而且失效没有任何提示
#   （cron 不跑 = 不报错），只有对比「应触达 vs 实际发出」时才会发现。
#   写在这里，任何一次部署都会把它带上去。
#
# 幂等：先按标记行删除旧的，再追加。重复部署不会堆积多条。
# 失败不中止部署：定时任务装不上不该让整个发布失败（应用本身是好的）。
# ─────────────────────────────────────────────────────────────
CRON_MARK="# typenow-lifecycle-scan"

# 密钥在**部署时**从 .env.local 读出来写进 crontab，而不是让 cron 每次运行时
# 去 grep 一遍文件 —— 后者一旦格式变动（多空格、加引号）就会静默失效，
# 而"定时任务不跑"是没有任何报错的失败模式。
# 写进 crontab 与放在 .env.local 是同一信任级别（都属于 admin）。
CRON_SECRET_VALUE="$(grep -E '^CRON_SECRET=' /home/admin/TypeNow/.env.local 2>/dev/null | head -1 | cut -d= -f2- | tr -d '"'"'"' ')"
if [ -z "$CRON_SECRET_VALUE" ]; then
  log "警告：.env.local 里没有 CRON_SECRET，crontab 仍会安装但请求会被拒绝（接口 fail-closed）。"
  log "      主动触达要真正生效，需要：① 配置 CRON_SECRET ② 配置 LIFECYCLE_ENABLED=true ③ 部署"
fi

# 响应写进日志：§11.8 的「到期前触达率」要靠它对比"应触达 vs 实际发出"。
# 每条响应只有几百字节（计数汇总），一年约几百 KB。
CRON_URL="https://typenow.cn/api/internal/lifecycle-scan"
CRON_LOG="/home/admin/TypeNow/lifecycle-scan.log"

log "安装主动触达 crontab..."
{
  # 保留与本次无关的其他 crontab 条目，只替换带标记的那条（幂等，不会堆积）
  crontab -l 2>/dev/null | grep -v "api/internal/lifecycle-scan"
  # marker 必须作为**行尾注释**出现在 crontab 文本里：
  #   · 对 cron 来说是 shell 注释，运行时被忽略，不会污染日志
  #   · 对我们的 grep 来说是幂等标记
  # 放在 `>> $CRON_LOG` 之后会被 shell 当成 echo 的参数（写进日志），那是个坑。
  # 另外 crontab 里 `%` 有特殊含义，date 的格式串必须写成 \%F \%T。
  echo "0 10,19 * * * date '+\%F \%T' >> $CRON_LOG; curl -fsS -X POST -H 'x-cron-secret: $CRON_SECRET_VALUE' $CRON_URL >> $CRON_LOG 2>&1 $CRON_MARK"
} | crontab - 2>&1 | tee -a "$LOG_FILE" \
  && log "crontab 已更新（每天 10:00 与 19:00 各扫描一次，日志 $CRON_LOG）" \
  || log "警告：crontab 安装失败（不影响应用本身，但主动触达不会自动运行）"

log "=== 部署完成 ==="

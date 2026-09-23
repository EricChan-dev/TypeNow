#!/bin/bash
# 启动 e2e 专用的一次性 MySQL 8.0 容器，并把 src/lib/db/schema.ts 同步成表结构。
#
# 为什么用容器而不是本机 brew 的 MySQL，也不是生产库：
#   - 版本与生产一致（8.0.x），避免"测试通过但生产语法/排序规则不同"
#   - 与生产完全隔离：e2e 会 TRUNCATE 全部业务表
#   - 本机 brew 的 mysqld 已有自己的 root 口令与数据，不该被测试污染
set -euo pipefail

CONTAINER=typenow-test-mysql
PORT=3399
PASSWORD=typenow_test_pw
DB=typenow_test
IMAGE=mysql:8.0

if ! docker image inspect "$IMAGE" >/dev/null 2>&1; then
  echo "拉取镜像 $IMAGE ..."
  docker pull "$IMAGE"
fi

if docker ps --filter "name=^${CONTAINER}$" --format '{{.Names}}' | grep -q .; then
  echo "容器 $CONTAINER 已在运行"
else
  # 停掉可能存在的同端口残留容器（退出态）
  docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
  echo "启动容器 $CONTAINER（端口 $PORT）..."
  docker run -d --name "$CONTAINER" \
    -e MYSQL_ROOT_PASSWORD="$PASSWORD" \
    -e MYSQL_DATABASE="$DB" \
    -p "${PORT}:3306" \
    "$IMAGE" \
    --character-set-server=utf8mb4 \
    --collation-server=utf8mb4_0900_ai_ci \
    --default-time-zone=+08:00 \
    --max-connections=200 >/dev/null
fi

echo -n "等待 MySQL 就绪"
for _ in $(seq 1 90); do
  if docker exec "$CONTAINER" mysqladmin ping -uroot -p"$PASSWORD" --silent >/dev/null 2>&1; then
    echo " ok"
    break
  fi
  echo -n "."
  sleep 1
done

docker exec "$CONTAINER" mysqladmin ping -uroot -p"$PASSWORD" --silent >/dev/null 2>&1 || {
  echo "错误：MySQL 未能启动" >&2
  exit 1
}

echo "同步表结构（drizzle-kit push）..."
DATABASE_URL="mysql://root:${PASSWORD}@127.0.0.1:${PORT}/${DB}" npx drizzle-kit push --force >/dev/null

TABLES=$(docker exec "$CONTAINER" mysql -uroot -p"$PASSWORD" -N -e \
  "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='${DB}'" 2>/dev/null)
echo "就绪：mysql://root:***@127.0.0.1:${PORT}/${DB}（${TABLES} 张表）"
echo "运行 e2e：pnpm test:e2e"

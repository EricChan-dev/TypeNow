import { assertTestDatabase, TEST_DB_URL, E2E_BASE_URL } from "./helpers/env"
import { getPool, closePool, seedFixtures } from "./helpers/db"
import { startServer, stopServer } from "./helpers/server"

/**
 * 整套 e2e 共用一个 dev 服务端与一个测试库：串行执行（见 vitest.e2e.config.ts
 * 的 fileParallelism: false）。启动前先验库、验连通性，失败信息必须能直接指出
 * 该怎么修，而不是抛一个 ECONNREFUSED 让人猜。
 */
export async function setup(): Promise<() => Promise<void>> {
  assertTestDatabase(TEST_DB_URL)

  try {
    await getPool().query("SELECT 1")
  } catch (e) {
    throw new Error(
      `[e2e] 连不上测试库 ${TEST_DB_URL}\n` +
        `请先启动测试数据库容器：  pnpm e2e:db:up\n` +
        `原始错误：${(e as Error).message}`
    )
  }

  await seedFixtures()
  await startServer()

  console.log(`[e2e] 服务端就绪：${E2E_BASE_URL}（测试库 ${TEST_DB_URL}）`)

  return async () => {
    await stopServer()
    await closePool()
  }
}

export async function teardown(): Promise<void> {
  await stopServer()
  await closePool()
}

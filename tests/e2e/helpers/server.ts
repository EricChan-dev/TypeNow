/**
 * 被测服务端的生命周期。
 *
 * 用 `next dev` 而不是 `next build && next start`，原因见 helpers/env.ts：
 * 支付模拟与 dev 会话旁路都以 NODE_ENV=development 为条件。代价是首次访问
 * 某个路由要现场编译，因此 globalSetup 会先把下面这些路由预热一遍。
 */
import { spawn, type ChildProcess } from "child_process"
import { E2E_BASE_URL, E2E_PORT, buildE2eEnv } from "./env"

let child: ChildProcess | null = null
let logBuffer = ""

function appendLog(chunk: Buffer) {
  logBuffer += chunk.toString()
  if (logBuffer.length > 200_000) logBuffer = logBuffer.slice(-100_000)
}

export function serverLog(): string {
  return logBuffer
}

async function waitForReady(timeoutMs = 120_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (child?.exitCode != null) {
      throw new Error(
        `[e2e] 服务端提前退出（code=${child.exitCode}）。日志尾部：\n${logBuffer.slice(-3000)}`
      )
    }
    try {
      const res = await fetch(`${E2E_BASE_URL}/api/courses/list?pageSize=1`, {
        signal: AbortSignal.timeout(5000),
      })
      if (res.status < 500) return
    } catch {
      // 还没起来
    }
    await new Promise((r) => setTimeout(r, 500))
  }
  throw new Error(`[e2e] 等待服务端就绪超时。日志尾部：\n${logBuffer.slice(-3000)}`)
}

export async function startServer(): Promise<void> {
  if (child) return
  const proc = spawn("npx", ["next", "dev", "-p", String(E2E_PORT)], {
    cwd: process.cwd(),
    env: buildE2eEnv(),
    stdio: ["ignore", "pipe", "pipe"],
    detached: false,
  })
  child = proc
  proc.stdout?.on("data", appendLog)
  proc.stderr?.on("data", appendLog)
  await waitForReady()
}

export async function stopServer(): Promise<void> {
  if (!child) return
  const proc = child
  child = null
  proc.kill("SIGTERM")
  await new Promise<void>((resolve) => {
    const t = setTimeout(() => {
      try {
        proc.kill("SIGKILL")
      } catch {
        /* already gone */
      }
      resolve()
    }, 8000)
    proc.once("exit", () => {
      clearTimeout(t)
      resolve()
    })
  })
}

/**
 * 预热：dev 模式首次请求某路由要编译，若混在断言里会让超时判定变得不可信。
 * 返回每个路由是否成功响应（不校验状态码，只看服务端是否活着）。
 */
export async function warmup(paths: string[]): Promise<void> {
  await Promise.all(
    paths.map((p) =>
      fetch(`${E2E_BASE_URL}${p}`, { signal: AbortSignal.timeout(120_000) }).catch(() => null)
    )
  )
}

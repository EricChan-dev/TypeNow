import { defineConfig } from "vitest/config"
import path from "path"

/**
 * e2e 配置：跑真实的 Next dev 服务端 + 本机测试库。
 *
 * fileParallelism: false —— 所有套件共享同一个服务端进程与同一个数据库，
 * 并行会让「重置夹具」互相踩踏，失败原因也会变得不可归因。
 */
export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    include: ["tests/e2e/**/*.test.ts"],
    globalSetup: ["tests/e2e/global-setup.ts"],
    testTimeout: 60_000,
    hookTimeout: 240_000,
    fileParallelism: false,
    sequence: { concurrent: false },
    reporters: ["verbose"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
})

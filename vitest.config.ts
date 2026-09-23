import { defineConfig } from "vitest/config"
import path from "path"

export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    css: false,
    // 单元测试只跑 src/ 下的用例；tests/e2e 需要真实 dev 服务端与专用配置
    // （vitest.e2e.config.ts），若被默认 include 扫进来会与单元测试并行抢占
    // 同一个测试库，产生不可归因的 ER_DUP_ENTRY 失败。
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
    exclude: ["node_modules/**", "tests/e2e/**", ".next/**", "dist/**"],
  },
  css: {
    postcss: { plugins: [] },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
})

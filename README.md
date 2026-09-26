# TypeNow · 码上英语

> 看中文，打出英文。AI 驱动的中译英打字练习平台。
>
> 线上地址：<https://typenow.cn>

每个句子拆成一小段一小段的练习单元：屏幕上给中文和逐词提示，你把它**敲成英文**，
系统按字符级差异判分，把出错的句子送进间隔重复队列。练完的句子可以展开语法树、
AI 讲解、逐词释义，把「手熟」和「真懂」连起来。

---

## 技术栈

Next.js 16（App Router）· React 19 · TypeScript · Tailwind CSS v4 ·
**MySQL 8 + Drizzle ORM** · DeepSeek API · 有道 TTS · 微信支付 ·
自建服务器部署（pm2 + nginx）

完整设计见 [docs/architecture.md](docs/architecture.md)。

---

## 快速开始

```bash
pnpm install
```

准备 `.env.local`，至少要有一个 `DATABASE_URL`：

```bash
DATABASE_URL=mysql://user:pass@127.0.0.1:3306/typenow
DEEPSEEK_API_KEY=            # 不填则 AI 解析接口返回 503（不会伪造内容）
```

```bash
pnpm dev      # http://localhost:3000
```

> ⚠️ **必须用 `http://localhost:3000`，不要用 `http://127.0.0.1:3000`。**
> Next 16 dev 会拦截 127.0.0.1 源的 `/_next/webpack-hmr`，hydration 永不完成——
> 页面永远停在加载画面，而接口其实全部 200。这个现象极易误判为后端故障。

数据库需要先手工执行 `db/migrations/*.sql`（**迁移不会自动执行**）。
结构来源、权威顺序与同步约束见 [db/README.md](db/README.md)。
完整命令与踩坑清单见 [CLAUDE.md](CLAUDE.md)。

---

## 常用命令

| 命令 | 作用 |
|------|------|
| `pnpm dev` / `pnpm build` / `pnpm start` | 开发 / 构建 / 生产启动 |
| `pnpm lint` | ESLint（HEAD 上本就有大量既有报错，见「注意」） |
| `pnpm test` | 单元测试（Vitest，node 环境） |
| `pnpm test:e2e` | 端到端测试（先 `pnpm e2e:db:up` 起 docker MySQL） |
| `pnpm test:all` | 单测 + e2e |
| `pnpm audit:content` | 课程内容只读体检（含字段覆盖率），`--json` 输出 `content-audit.json` |
| `pnpm import-julebu` | 导入句乐部课程数据 |
| `pnpm repair:content` | 修复课程内容缺失字段 |
| `pnpm seed` | 灌入示例课程 |
| `pnpm switch-role` | 切换账号角色（本地调试后台用） |
| `pnpm selfcheck:new-user` | 新用户全链路自检 |

**注意**：单测跑在 `environment: "node"` 且**未启用 jsdom**，所以只有 node 纯逻辑可测；
React 组件与 hooks 需要浏览器验证（用 puppeteer 脚本）。
`pnpm lint` 的全局报错数不代表你的改动——按文件前后对比，写法见 `CLAUDE.md`。

---

## 项目结构

```
src/
├── app/(public)/  落地页 · 定价 · 条款 · 隐私
├── app/login/     手机验证码 + 微信 OAuth
├── app/home/      主应用（课程 / 打字练习 / 复习 / 档案）
├── app/admin/     refine.dev + Ant Design 后台
├── app/api/       REST 端点
├── components/    按业务域分目录
├── lib/           纯逻辑与集成层
└── __tests__/     单元测试
docs/              当前有效的文档（历史文档在 docs/archive/）
specs/             练习页交付规格与设计稿
scripts/           内容审计 / 导入 / 运维脚本
```

---

## 开发约定（摘要）

- 注释用**中文**，重点写**为什么**（约束、踩过的坑），不复述代码
- 具名导出；`cn()` 合并 class，不用字符串拼接
- 全局状态**不用 React Context**：跨组件偏好走 `useSyncExternalStore` + 订阅模块
  （参考 `src/lib/sfx.ts`、`src/lib/desktop-only.ts`）
- **AI 能力必须设计降级**：上游不可用时返回 503 + `code: "unconfigured"`，
  **绝不用占位文案冒充真实结果**
- 提交信息用约定式前缀 + 中文描述，如 `fix(ux):`、`feat(data):`、`test(engagement):`

完整约定见 [CLAUDE.md](CLAUDE.md)。

---

## 文档

| 文档 | 内容 |
|------|------|
| [PRD_V3.md](PRD_V3.md) | 产品全貌、功能规划、路线图 |
| [docs/architecture.md](docs/architecture.md) | 技术架构、数据模型、AI 与部署 |
| [docs/practice-page-alignment-matrix.md](docs/practice-page-alignment-matrix.md) | 练习页对标句乐部：差距、阶段规划、已拍板决策 |
| [docs/strategy.md](docs/strategy.md) | 市场、用户、定价、获客 |
| [docs/pages/](docs/pages/) | 15 篇页面级需求文档 |
| [specs/practice-page.md](specs/practice-page.md) | 练习页交付规格（含交互时序） |
| [docs/README.md](docs/README.md) | 文档索引 |
| [docs/archive/](docs/archive/README.md) | 已归档的历史文档 |

---

## 部署

生产运行在自建服务器 `typenow.cn`：nginx → pm2 (`typenow`) → MySQL。
推送到 `main` 后由 GitHub webhook 触发 [`deploy.sh`](deploy.sh) 自动部署。

```bash
# 手工部署（必须以 admin 用户执行，详见脚本头部注释）
su - admin -c '/home/admin/TypeNow/deploy.sh'
```

> 迁移 SQL **不在**部署脚本里，需要手工在生产库执行。生产库就是唯一的库，没有 staging。

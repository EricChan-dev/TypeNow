@AGENTS.md

# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

# TypeNow · 码上英语

AI 驱动的中译英打字练习平台。Next.js 16 + React 19 + Tailwind CSS v4 + **MySQL (Drizzle ORM)**。

## Commands

```bash
pnpm dev          # Start dev server（须用 http://localhost:3000，见下方「本地开发要点」）
pnpm build        # Production build
pnpm start        # Start production server
pnpm lint         # Run ESLint
pnpm test         # 单元测试（vitest，node 环境）
pnpm test:e2e     # 端到端测试（需 docker 起 MySQL：pnpm e2e:db:up）
pnpm test:all     # 单元 + e2e
pnpm audit:content
                  # 课程内容只读体检（含各字段覆盖率），加 --json 写出 content-audit.json
```

单元测试位于 `src/__tests__/*.test.ts`。**vitest 配置为 `environment: "node"` 且未启用 jsdom**，
因此只有 node 纯逻辑可被单测；React 组件与 hooks 无法单测，需要浏览器验证时用 `/tmp` 下的
puppeteer 脚本（见「本地开发要点」）。

## Architecture

### App Segments

| Route | Purpose | Auth |
|-------|---------|------|
| `(public)/` | Landing, pricing, terms, privacy | Public |
| `login/` | Phone SMS + WeChat OAuth login | Unauthenticated only |
| `home/` | Main app (dashboard, courses, learn) | Required |
| `admin/` | refine.dev + Ant Design back-office | Separate admin auth |

`home/layout.tsx` is the auth gate: it calls `getUser()` server-side and redirects unauthenticated visitors to `/login`. The profile row is fetched here and passed as props to avoid duplicate DB reads in children.

### Auth Pattern

**本项目已完全从 Supabase 迁移到 MySQL，`src/lib/supabase/` 已不存在。** 认证方式：

- **Server components / layouts / Server Actions**: `getUser()` / `isDbConfigured()` from `@/app/actions/auth`
- **API routes**: `getSession()` from `@/lib/auth/session` → `SessionInfo | null`，含 `{ sessionId, userId, expiresAt }`
- **统一守卫**：`if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })`
- **数据库未配置**：`if (!db) return NextResponse.json({ error: "DB not configured" }, { status: 500 })`

会话表为 `sessions`，验证码为 `verification_codes`。`LoginForm.tsx` 里仍有 `isSupabaseConfigured`
这个**局部变量名**，是迁移遗留的命名，不代表还存在 Supabase。

### Data Model

Drizzle schema 在 `src/lib/db/schema.ts`；DDL 在 `supabase/migrations/*.sql`
（**目录名是历史遗留**，里面是 MySQL DDL，与 Supabase 无关）。

核心表：

- `users` — 账号主表（**不叫 `profiles`**）：`phone`、`name`、`level`、`totalScore`、`isPro`、`proExpires`、`diamonds`、`role`、`inviteCode`、`wechatOpenid` 等
- `sentences` — 内容单元：`chinese`、`english`、`words`（JSON 逐词 phonetic/pos/definition）、`chunks`、`dependency_analysis`、`sentence_structure`、`lesson_id`
- `courses` / `lessons` — Course → Lesson → Sentence 三级
- `practice_records` — 每句作答记录；`practice_sessions` — 「上次练到哪」的 lesson 级恢复槽位（`UNIQUE (user_id, lesson_id)`）
- `review_queue` — 间隔重复队列（SM-2 类）
- `user_course_progress` — course 级累计进度（`sentenceCount` 是单调累计值，**不能**当恢复下标用）
- `subscriptions` + `payment_orders` + `partner_commissions` — 微信支付与分销
- `sentence_knowledge` — AI 句子解析缓存（**不叫 `sentence_knowledge_cache`**），按 `sentenceHash` 唯一；路由内缓存查询**先于** AI key 检查，所以未配 key 时缓存命中的句子仍能返回真实内容
- `tts_cache` — 有道 TTS 音频（按 text+voice+speed+volume 的 SHA-256 缓存）
- `wordbook_items` / `word_dictionary_cache` / `user_notes`、`check_ins` / `diamond_logs` / `task_logs`、`posts` / `post_likes`、`analytics_events`

**迁移是手工执行的**：仓库没有迁移执行器（`drizzle.config.ts` 的 `out` 指向不存在的目录，
无 CI，部署脚本不含 SQL 步骤）。新增迁移后需在生产库手动执行 SQL 文件。

### External Integrations

| Service | Used For | Config Env Vars |
|---------|---------|-----------------|
| DeepSeek API | 句子解析、AI 对话/出题 | `DEEPSEEK_API_KEY`（**服务端**，非 `NEXT_PUBLIC_`） |
| Youdao TTS | 句子朗读 | `YOUDAO_APP_KEY`, `YOUDAO_APP_SECRET` |
| Aliyun SMS | 手机验证码 | Aliyun credentials |
| WeChat Open Platform | OAuth 登录 | WeChat app credentials |
| WeChat Pay | 订阅支付 | WeChat Pay credentials |
| Sentry | 错误监控 | `SENTRY_DSN`（`sentry.{client,server,edge}.config.ts` 已接入） |

LLM 调用统一走 `src/lib/llm.ts`（`llmCall()` + `analyzeSentence()`）。TTS 走 `/api/youdao/tts`，
先查 `tts_cache` 再请求有道，然后 upsert。**AI 能力必须设计降级**：未配 key 时应回 503 +
`code: "unconfigured"`（见 `src/lib/knowledge-failure.ts`），不要用占位文案冒充真实结果。

### Admin Panel

`src/app/admin/` is a self-contained refine.dev + Ant Design app. It has its own auth flow (`/admin/login`) independent of the main session. In dev mode (`isDevMode()`), auth is skipped entirely. The layout wraps everything in `<Refine>` + `<ConfigProvider>` for Ant Design theming.

## Code Conventions

### Components

- `"use client"` must be the literal first line of client components
- Named exports only; one component per domain folder (`src/components/<domain>/`)
- Props typed with `interface` defined inline in the same file
- 全局状态**不用 React Context**：跨组件共享的偏好用 `useSyncExternalStore` + 订阅式模块（参考
  `src/lib/sfx.ts`、`src/lib/desktop-only.ts`），数据取用直接 `fetch` 内部 API
- Class merging: always use `cn()` from `@/lib/utils`, never string interpolation
- 注释用中文，重点写**为什么**这样做（约束、踩过的坑），而不是复述代码在做什么

### Theming (Tailwind v4)

Tailwind v4 uses `@theme inline` in `globals.css` to map CSS variables to utility classes. `:root` is dark, `.light` is light. The actual dark-mode background is `#000000` (pure black), not `#0f172a` as older docs state.

Semantic color classes to use: `text-foreground`, `text-muted-foreground`, `bg-card`, `bg-muted`, `border-border`, `text-primary`, `bg-accent`.

### Routing & Navigation

- In-page scrolling: `scrollIntoView({ behavior: "smooth" })` or `window.scrollTo({ top: 0 })`
- Clicking "Home" in nav: `window.scrollTo({ top: 0 })` — not `#hero` anchor
- Cross-page: Next.js `<Link>` or `router.push()`
- Auth-conditional CTAs: `<AuthLink>` component (redirects to `/login` if logged out, `/home` if logged in)
- Toast notifications: `sonner`
- Mobile breakpoint: `lg:` for primary, `sm:` for secondary

### Types

Two type files:
- `src/types/index.ts` — runtime types: `User`, `Sentence`, `Word`, `PracticeRecord`, `ReviewItem`, `PaymentOrder`, `Subscription`, `SCENES`
- `src/types/course.ts` — course system types: `Course`, `Lesson`, `CourseCategory`, `SentenceKnowledge`, `COURSE_CATEGORIES`

## 本地开发要点（踩过的坑）

1. **必须用 `http://localhost:3000`，不要用 `http://127.0.0.1:3000`。** Next 16 dev 会对
   127.0.0.1 源拦截 `/_next/webpack-hmr`，导致 hydration 永不完成——页面会永远停在加载画面，
   而接口其实全部返回 200。这个现象极易误判为后端故障。
2. **开发态登录旁路**：cookie `typenow_session=dev:<userId>` 在 `NODE_ENV === "development"`
   下直接生效，不需要真实登录。这让浏览器 e2e 能对着真实数据跑。
3. **生产库就是唯一的库**（`typenow.cn/typenow`）。没有 staging。任何写操作都要先想清楚。
4. **不要用 `next dev` 起第二个实例**：同一目录下 Next 16 会拒绝启动（检测到已有实例）。
   要换环境变量验证时，得先停掉当前实例。
5. 写 `/tmp` 下的临时脚本请用 shell heredoc；且从 `/tmp` 运行 node 脚本时，
   `node_modules` 解析会失败，需要 `node --input-type=module -e "$(cat /tmp/x.mjs)"` 或把脚本放进仓库目录。
6. `pnpm lint` 在 HEAD 上本就有大量既有报错。评估自己引入的增量时，用
   `git show HEAD:<file> | npx eslint --stdin --stdin-filename <file>` 对比同文件前后数量，
   不要看全局总数。

## 文档索引

| 想了解 | 看这里 |
|--------|--------|
| 产品全貌与规划 | [PRD_V3.md](PRD_V3.md) |
| 练习页与句乐部的差距、阶段规划、已拍板决策 | [docs/practice-page-alignment-matrix.md](docs/practice-page-alignment-matrix.md) |
| 页面级设计稿 | [docs/pages/](docs/pages/)、[specs/](specs/) |
| 技术架构 | [docs/architecture.md](docs/architecture.md) |
| 市场与定价策略 | [docs/strategy.md](docs/strategy.md) |
| 已执行完毕的历史方案 | [docs/archive/](docs/archive/) |

## Available Skills

### gstack（工程团队角色）
- `/review` — 代码审查与 bug 查找
- `/qa` — 系统化 QA 测试
- `/ship` — 发布自动化与 PR 创建
- `/cso` — 安全审计（OWASP + STRIDE）
- `/investigate` — 问题排查与根因分析
- `/browse` — 浏览器 UI 交互测试

### superpowers（开发工作流）
- `superpowers:brainstorming` — 需求头脑风暴
- `superpowers:writing-plans` — 编写开发计划
- `superpowers:executing-plans` — 执行开发计划
- `superpowers:systematic-debugging` — 系统化调试
- `superpowers:verification-before-completion` — 完成前验证

# 技术架构

> 最后更新：2026-09-24
>
> 本文档描述**当前真实运行的系统**。历史上的 Supabase / PostgreSQL / Vercel / OpenAI
> 选型已全部废弃，相关内容见 [archive/](archive/README.md)。

---

## 一、技术选型

| 层 | 技术 | 说明 |
|---|------|------|
| 框架 | **Next.js 16**（App Router + Turbopack）+ React 19 | 全栈一体，API Routes 兼做后端 |
| 语言 | TypeScript | |
| 样式 | **Tailwind CSS v4** | `@theme inline` + CSS 变量；**没有** shadcn/ui |
| 数据库 | **MySQL 8** + **Drizzle ORM** (`mysql2/promise`) | 自建实例，非托管 BaaS |
| 认证 | 手机短信验证码（阿里云） + 微信公众号/开放平台 OAuth | 自建 `sessions` 表 |
| AI | **DeepSeek API**（`deepseek-chat`） | 统一入口 `src/lib/llm.ts` |
| TTS | 有道智云朗读 | `tts_cache` 按内容寻址缓存 |
| 支付 | 微信支付 V3 | 订阅 + 分销（`payment_orders` / `partner_commissions`） |
| 后台 | refine.dev + Ant Design | `/admin` 独立鉴权 |
| 监控 | **Sentry** + `@vercel/speed-insights` | `sentry.{client,server,edge}.config.ts` |
| 部署 | 自建服务器 `typenow.cn`：pm2 + nginx | `deploy.sh`，GitHub webhook 触发 |
| 测试 | Vitest（单测 + e2e） | 见「七、质量保障」 |

> **注意**：项目里仍存在 `supabase/` 目录，但**只用来放 SQL 迁移文件，与 Supabase 无关**；
> `src/lib/supabase/` 已不存在。`next.config.ts` 的 `images.remotePatterns` 里还留着一条
> `*.supabase.co`，是早期头像地址的兼容白名单。

---

## 二、运行时与部署

没有 Vercel，没有 Serverless。生产是**一台自建服务器**，nginx 反代到 pm2 常驻的
`next start` 进程：

```
浏览器 ──HTTPS──▶ nginx ──▶ Next.js (pm2: typenow, :3000) ──▶ MySQL 8
                              │
                              ├─▶ DeepSeek API
                              ├─▶ 有道 TTS
                              └─▶ 微信支付 / 阿里云短信
GitHub push ──webhook──▶ webhook-server.js ──▶ deploy.sh
```

### 部署脚本 `deploy.sh` 的关键设计

这个脚本里几处约束都是踩坑换来的，改动前务必理解：

- **必须以 `admin` 用户运行**（`su - admin -c '/home/admin/TypeNow/deploy.sh'`）。
  线上进程在 `/home/admin/.pm2`。以 root 跑会让 pm2 用自己的空空间，
  `pm2 restart typenow` 看似成功但**完全没碰到真实进程**。
- **`flock` 串行化**。webhook 自动部署与人工部署可能并发，两个构建会互相踩踏
  `node_modules` / `.next`（2026-09-21 实际发生过）。
- **构建到暂存目录再原子替换**。`next.config.ts` 的 `distDir` 读取
  `TYPENOW_DIST_DIR`，构建成功后整体替换 `.next`。就地构建一旦中途失败，
  线上 `.next` 会留下残缺产物，而旧进程仍在服务，用户请求未加载的 chunk 直接 404。
- **`git pull` 带 5 次重试**。到 github.com 的链路不稳定，而 webhook 只在 push 时
  触发一次、没有补偿机制，不重试等于一次网络抖动就静默漏掉一次发布。
- **`CI=true pnpm install --frozen-lockfile`**。非交互环境下 pnpm 会因缺 TTY 中止，
  可能清空 `node_modules`。

---

## 三、代码地图

```
src/
├── app/
│   ├── (public)/      # 落地页 / 定价 / 条款 / 隐私（未登录可见）
│   ├── login/         # 手机验证码 + 微信 OAuth
│   ├── home/          # 主应用（course / learn / review / profile …）
│   ├── admin/         # refine.dev + antd 后台，独立鉴权
│   ├── api/           # 全部 REST 端点（72 个 route.ts）
│   └── actions/       # Server Actions（auth 等）
├── components/<domain>/   # 按业务域分目录，一组件一文件
├── lib/               # 纯逻辑与集成层（见下）
├── types/             # index.ts（运行时类型）+ course.ts（课程域类型）
└── __tests__/         # vitest 单测（node 环境）
supabase/migrations/   # MySQL DDL（目录名为历史遗留）
scripts/               # 内容审计/导入/修复等一次性与运维脚本
```

### `src/lib/` 关键模块

| 模块 | 职责 |
|------|------|
| `db/{index,schema}.ts` | 连接、时区口径、32 张表的 Drizzle schema |
| `auth/{session,user,invite}.ts` | 会话读写、用户查询、邀请码 |
| `llm.ts` | `llmCall()` + `analyzeSentence()`，DeepSeek 统一入口 |
| `knowledge-failure.ts` | AI 解析失败的**用户可读文案** + 是否可重试 |
| `dedup.ts` | 并发请求合并（in-flight Promise 复用） |
| `rate-limit.ts` | 内存滑动窗口限流 |
| `practice-*.ts` | 判分、统计、会话恢复点 |
| `typing-*.ts` | 按键分类、字符差异（练习页输入内核） |
| `spaced-repetition.ts` / `review-rules.ts` | 复习队列调度 |
| `sfx.ts` / `desktop-only.ts` | 跨组件偏好，`useSyncExternalStore` + 订阅模块 |
| `wechat*.ts` / `wechat-pay.ts` / `aliyun-sms.ts` | 外部平台集成 |

---

## 四、数据层

### 时间口径（重要，不要绕开）

全站约定：**MySQL `DATETIME` 一律以 Asia/Shanghai 的墙上时间存储**。

`src/lib/db/index.ts` 里三处显式固定，缺一不可：

1. mysql2 的 `timezone: "+08:00"` —— JS `Date` ↔ 字符串转换不依赖进程时区
2. 连接后 `SET time_zone = '+08:00'` —— `NOW()` / `CURRENT_TIMESTAMP` 不依赖 DB 主机时区
3. `patchDatetimeMapping()` —— drizzle 自带的 `MySqlDateTime` 映射是 **UTC 墙上时间**，
   会把上面两条全部绕过去

因此 `DATE(created_at)` 恒等于「上海日历日」，读取侧**不需要也不应该**再叠加
`CONVERT_TZ(created_at, '+00:00', '+08:00')`。

### 迁移

DDL 放在 `supabase/migrations/*.sql`，按序号递增（当前到 `00011_practice_sessions.sql`）。

**迁移是手工执行的**：仓库没有迁移执行器（`drizzle.config.ts` 的 `out` 指向不存在的
目录），没有 CI 步骤，`deploy.sh` 也不含 SQL 环节。新增迁移后需在生产库手动执行 SQL 文件，
并同步更新 `src/lib/db/schema.ts`。

> **生产库就是唯一的库**（`typenow.cn/typenow`）。没有 staging 环境，任何写操作先想清楚。

### 核心表

**账号与鉴权**

- `users` — 账号主表（**不叫 `profiles`**）。`phone` / `email` / `name` / `level` /
  `totalScore` / `isPro` / `proExpires` / `diamonds` / `role` / `inviteCode` / 微信
  `wechatOpenid` 等
- `sessions` — 登录态；`verification_codes` — 短信验证码

**内容（Course → Lesson → Sentence 三级）**

- `courses` / `lessons` / `sentences`
- `sentences` 的富字段：`words`（JSON，逐词 phonetic/pos/definition）、`chunks`、
  `dependency_analysis`、`sentence_structure`
- `sentence_knowledge` — AI 句子解析缓存（**不叫 `sentence_knowledge_cache`**），按
  `sentenceHash` 唯一
- `tts_cache` — 有道 TTS 音频，按 text+voice+speed+volume 的 SHA-256 缓存
- `material_imports` — 后台素材导入记录

**学习行为**

- `practice_records` — 每句作答记录（`userInput` / `score` / `mistakes`）
- `practice_sessions` — 「上次练到哪」的 **lesson 级恢复槽位**，
  `UNIQUE (user_id, lesson_id)`
- `review_queue` — 间隔重复队列
- `user_course_progress` — course 级累计进度。⚠️ `sentenceCount` 是**单调累计值**，
  不能当恢复下标用（恢复点请读 `practice_sessions`）
- `strengthen_sessions` / `writing_entries` — 表已建，**前端尚未接入**
- `check_ins` / `diamond_logs` / `task_logs` — 签到、钻石流水、任务

**社区与变现**

- `posts` / `post_likes` / `user_feedback`
- `payment_orders` / `subscriptions` / `partner_commissions` / `withdrawal_requests` /
  `partner_risk_flags`
- `invite_rewards` — **遗留表**：`src/` 内已无任何读写引用，保留定义只是为了让
  `schema.ts` 与生产库一致（否则 `drizzle-kit push` 会把它当作多余表 DROP 掉）
- `wordbook_items` / `word_dictionary_cache` / `user_notes`
- `site_config` / `analytics_events`

---

## 五、认证与鉴权

| 场景 | 用法 |
|------|------|
| Server Component / Layout / Server Action | `getUser()` / `isDbConfigured()` from `@/app/actions/auth` |
| API Route | `getSession()` from `@/lib/auth/session` → `SessionInfo \| null` |

统一守卫写法：

```ts
const session = await getSession()
if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
if (!db) return NextResponse.json({ error: "DB not configured" }, { status: 500 })
```

`src/app/home/layout.tsx` 是主应用的鉴权闸门：服务端 `getUser()`，未登录
`redirect("/login")`，并把用户行作为 props 传下去，避免子组件重复读库。

`src/app/admin/` 有**独立的鉴权流**（`/admin/login`），与会话体系无关；dev 模式下
`isDevMode()` 直接跳过。

> 遗留命名：`LoginForm.tsx` 里有个局部变量叫 `isSupabaseConfigured`，是迁移残留，
> 不代表还存在 Supabase。

---

## 六、外部集成

| 服务 | 用途 | 配置 |
|------|------|------|
| DeepSeek | 句子解析、AI 对话 | `DEEPSEEK_API_KEY`（**服务端**，绝不用 `NEXT_PUBLIC_`） |
| 有道智云 | 句子朗读、口语评测 | `YOUDAO_APP_KEY` / `YOUDAO_APP_SECRET` |
| 阿里云短信 | 手机验证码 | 阿里云凭证（`src/lib/aliyun-sms.ts`） |
| 微信开放平台 / 公众号 | OAuth 登录、扫码 | `WECHAT_APP_ID`、`WECHAT_OA_*` |
| 微信支付 V3 | 订阅支付 | `WECHAT_PAY_MCH_ID` / `_SERIAL_NO` / `_PRIVATE_KEY` / `_API_V3_KEY` / `_NOTIFY_URL` |
| Sentry | 错误监控 | `SENTRY_DSN`、`SENTRY_ORG`… |

数据库连接只有 `DATABASE_URL` 一个变量。

### AI 调用路径

- `src/lib/llm.ts` — `llmCall()`（通用）+ `analyzeSentence()`；被 `/api/knowledge/analyze`
  与 admin 的 AI 端点复用
- `/api/chat` — **直接** `fetch` DeepSeek（未走 `llm.ts`）。扣 5 钻石，**任何失败都退还**，
  避免用户白扣。`role` 走白名单，只接受 `user` / `assistant`，客户端传来的 `system` 直接丢弃
- `/api/knowledge/analyze` — 顺序为：① 查 `sentence_knowledge` 缓存 ② 检查
  `DEEPSEEK_API_KEY` ③ 限流 ④ 调模型 ⑤ 写缓存

### AI 降级策略（硬性要求）

**未配 key / 上游失败时绝不允许用占位文案冒充真实结果。** 未配置返回
`503 { error: "AI 解析服务暂未配置", code: "unconfigured" }`，文案与「是否可重试」由
`src/lib/knowledge-failure.ts` 的 `describeKnowledgeFailure()` 统一决定：

判定顺序 `timedOut` → `unconfigured`（503 或 `code`）→ 401 → 400 → 429 → null（网络）
→ 默认。**「未配置」的检查放在限流之前**——这不是用户行为导致的失败，不该消耗配额
（实测 25 次请求得到 25 个 503、0 个 429）。

缓存查询**先于** key 检查，所以即使没配 key，命中缓存的句子依然能返回真实解析内容。

> ⚠️ **一致性欠账**：`/api/chat` 未配 key 时返回的是 `500 { error: "AI 服务未配置" }`，
> **没有 `code` 字段**，与 `/api/knowledge/analyze` 的 503 + `code` 口径不一致，
> 客户端无法用同一套 `describeKnowledgeFailure()` 判定「是否可重试」。
> 统一这两个端点时应顺带收敛。

---

## 七、质量保障

```bash
pnpm test        # vitest 单测（environment: node）
pnpm test:e2e    # e2e（需先 docker 起 MySQL：pnpm e2e:db:up）
pnpm test:all    # 两者都跑
pnpm audit:content   # 课程内容只读体检（含各字段覆盖率），--json 写出 content-audit.json
```

- 单测在 `src/__tests__/*.test.ts`。**vitest 是 `environment: "node"` 且未启用 jsdom**，
  因此只有 node 纯逻辑可单测；React 组件与 hooks **无法**单测，需要浏览器验证时用
  puppeteer 脚本
- e2e 配置 `vitest.e2e.config.ts`，配套 `scripts/e2e/db-up.sh` 起 docker MySQL
- 其他运维脚本：`repair:content`、`import-julebu`、`rescue:orphans`、`cleanup:residual`、
  `seed`、`switch-role`、`selfcheck:new-user`（见 `package.json`）

`pnpm lint` 在 HEAD 上本就有大量既有报错。**评估自己引入的增量时按文件对比**：

```bash
git show HEAD:<file> | npx eslint --stdin --stdin-filename <file>
```

---

## 八、安全基线

`next.config.ts` 统一下发响应头：

- `X-Content-Type-Options: nosniff`、`X-Frame-Options: DENY`
- `Referrer-Policy: strict-origin-when-cross-origin`
- `Permissions-Policy: camera=(), microphone=(), geolocation=()`
- `Strict-Transport-Security: max-age=31536000`（nginx 已把 80 端口 301 到 https。
  暂不加 `includeSubDomains` / `preload`，需确认全部子域已 HTTPS 后单独评估）

其他：密码/密钥经 `src/lib/crypto.ts`；`rate-limit.ts` 内存滑动窗口；支付回调
`/api/payment/notify` 校验签名；`webhook-server.js` 未配置 `WEBHOOK_SECRET` 时
**拒绝所有请求**（fail-closed，否则任何人都能反复触发生产构建）。

---

## 九、已知约束

1. **限流是进程内内存的**，pm2 多实例或重启后不共享，属于防抖而非硬防护
2. **没有对象存储**，分享卡片走前端 Canvas 生成
3. `strengthen_sessions` / `writing_entries` 表存在但无前端，属于未完成的功能面
4. 内容层有已知的覆盖度短板：`chunks` 仅约 5%，`dependency_analysis` 里约 43% 的句子
   画不出语法树。详见 [practice-page-alignment-matrix.md](practice-page-alignment-matrix.md)
5. `/api/chat` 未走 `llm.ts`，是重复实现；未配 key 的响应口径也与会话解析不一致
   （500 无 `code` vs 503 + `code`）。改动 AI 相关逻辑时两处都要看
6. `/api/chat` 未做限流，只有钻石扣费作为节流；被刷时按钻石成本承担
7. `sentence_knowledge` 缓存的写入不做失效管理，模型或 prompt 升级后旧条目仍会被命中

---

## 十、延伸阅读

| 主题 | 文档 |
|------|------|
| 产品全貌与规划 | [../PRD_V3.md](../PRD_V3.md) |
| 练习页与句乐部差距、阶段规划、已拍板决策 | [practice-page-alignment-matrix.md](practice-page-alignment-matrix.md) |
| 页面级设计稿 | [pages/](pages/)、[../specs/](../specs/) |
| 市场与定价 | [strategy.md](strategy.md) |
| 本地开发踩坑清单 | [../CLAUDE.md](../CLAUDE.md) |
| 已归档的历史方案 | [archive/](archive/README.md) |

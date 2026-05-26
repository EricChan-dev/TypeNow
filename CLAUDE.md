@AGENTS.md

# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

# TypeNow · 码上英语

AI 驱动的中译英打字练习平台。Next.js 16 + React 19 + Tailwind CSS v4 + Supabase。

## Commands

```bash
pnpm dev        # Start dev server
pnpm build      # Production build
pnpm start      # Start production server
pnpm lint       # Run ESLint
```

No test runner is configured.

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

- **Server components / layouts / Server Actions**: `createClient()` from `@/lib/supabase/server` → `supabase.auth.getUser()`
- **Client components**: `createClient()` from `@/lib/supabase/client` → `supabase.auth.getUser()` + `onAuthStateChange`
- **API routes**: `getSession()` from `@/app/actions/auth`
- **Service-role operations** (subscription activation, TTS cache): `createServiceClient()` from `@/lib/supabase/service`

Dev mode fallback: when `NEXT_PUBLIC_SUPABASE_URL` is absent or not an HTTP URL, all Supabase helpers return `null`. Always guard with `isSupabaseConfigured()` or null-checks — never assume Supabase is available.

### Data Model

Core tables (see `supabase/migrations/` for full schema):

- `profiles` — extends Supabase `auth.users`; holds `is_pro`, `pro_expires`, `level`, `total_score`
- `sentences` — the content unit: `chinese`, `english`, `words` (JSONB per-word phonetic/POS/translation), `lesson_id`
- `courses` / `lessons` — Course → Lesson → Sentence hierarchy
- `practice_records` — per-sentence attempt log
- `review_queue` — spaced-repetition queue (SM-2-like)
- `subscriptions` + `payment_orders` — WeChat Pay monetization
- `sentence_knowledge_cache` — AI-generated sentence explanations (keyed by sentence text)
- `tts_cache` — Youdao TTS audio (keyed by SHA-256 of text+voice+speed+volume)
- `analytics_events` — custom event log

### External Integrations

| Service | Used For | Config Env Vars |
|---------|---------|-----------------|
| DeepSeek API | Sentence analysis, AI features | `NEXT_PUBLIC_DEEPSEEK_API_KEY` |
| Youdao TTS | Text-to-speech for sentences | `YOUDAO_APP_KEY`, `YOUDAO_APP_SECRET` |
| Aliyun SMS | Phone verification codes | Aliyun credentials |
| WeChat Open Platform | OAuth login | WeChat app credentials |
| WeChat Pay | Subscription payments | WeChat Pay credentials |
| Sentry | Error monitoring | `SENTRY_DSN` |

LLM calls go through `src/lib/llm.ts` (`llmCall()` + `analyzeSentence()`). TTS calls go through `/api/youdao/tts` which checks `tts_cache` before hitting Youdao, then upserts the result.

### Admin Panel

`src/app/admin/` is a self-contained refine.dev + Ant Design app. It has its own auth flow (`/admin/login`) independent of the main Supabase session. In dev mode (`isDevMode()`), auth is skipped entirely. The layout wraps everything in `<Refine>` + `<ConfigProvider>` for Ant Design theming.

## Code Conventions

### Components

- `"use client"` must be the literal first line of client components
- Named exports only; one component per domain folder (`src/components/<domain>/`)
- Props typed with `interface` defined inline in the same file
- No React Context for global state — each component calls `createClient()` independently
- Class merging: always use `cn()` from `@/lib/utils`, never string interpolation

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

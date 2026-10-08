# 个人作品集站（dev.typenow.cn）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 用 Next.js 16 建一个求职导向的个人作品集站，跑在新仓库 `dev-typenow`、新端口 `:3001`、新子域 `dev.typenow.cn`，与现有 `typenow.cn` 完全隔离。

**Architecture:** 一个**纯内容站**：所有文案与数据集中在 `src/content/*.ts` 的**类型化常量**里，组件只负责渲染，不含业务逻辑。唯一有逻辑的地方是「点击才显示联系方式」——号码以碎片形式存放，靠 `revealContact()` 拼接，使完整号码不在源码与 HTML 中出现。测试只覆盖**真正会出错的地方**：内容完整性（漏字段、年限越界）与隐私守卫（源码里不许出现完整号码），不做组件快照测试（静态内容站里那只是把实现抄一遍）。

**Tech Stack:** Next.js 16（App Router）/ React 19 / TypeScript / Tailwind v4 / vitest 1.6（node 环境，纯函数与内容守卫）

**设计文档：** `docs/superpowers/specs/2026-10-08-personal-portfolio-site-design.md`

**参考实现：** 现有仓库 `/home/admin/TypeNow/deploy.sh`（197 行，含 flock、staging 原子切换、拉取重试的完整理由注释），新站的 deploy.sh 参照它但更简（无 crontab）。

---

## 执行前必须知道的三件事

1. **这是新仓库，不在当前工作目录里。** 计划里所有 `src/...` 路径都相对新仓库根 `~/Documents/trae_projects/dev-typenow`（本地）与 `/home/admin/dev-typenow`（服务器）。
2. **技术栈年限必须由用户逐项核准。** 本计划 Task 7 里填的是**估算值**，Task 7 有一个显式的确认步骤，未确认不得提交。写错的年限比不写更糟——面试官一句「这个你用了几年」就能验证。
3. **nginx 1.14.1，不支持 `http2 on;` 指令**（需要 1.25.1+）。必须写成 `listen 443 ssl http2;`。写错会导致 `nginx -t` 失败。

---

## 文件结构

```
dev-typenow/
├── package.json                        # 依赖与 start 脚本（绑定 127.0.0.1:3001）
├── tsconfig.json
├── next.config.ts
├── postcss.config.mjs                  # Tailwind v4 走 @tailwindcss/postcss
├── vitest.config.ts
├── .gitignore
├── deploy.sh                           # 参照 TypeNow/deploy.sh，无 crontab
└── src/
    ├── app/
    │   ├── layout.tsx                  # 字体、metadata、全局页脚
    │   ├── page.tsx                    # 一页滚动：Hero → 心路历程 → 作品 → 技术栈
    │   ├── globals.css                 # 设计令牌（米白底 / 衬线标题 / 琥珀强调）
    │   ├── sitemap.ts
    │   ├── robots.ts
    │   └── projects/
    │       └── [slug]/page.tsx         # 详情页，五段结构；slug 由 content/projects.ts 驱动
    ├── components/
    │   ├── Magazine.tsx                # 共用的排版原子：Eyebrow / SectionTitle / Rule
    │   ├── Hero.tsx
    │   ├── Timeline.tsx
    │   ├── Works.tsx
    │   ├── TechStack.tsx
    │   ├── ProjectDetail.tsx           # 详情页五段的统一渲染
    │   ├── ContactReveal.tsx           # 客户端组件：点击才拼出联系方式
    │   ├── contact-privacy.test.tsx    # 渲染产物守卫（必须 .tsx，含 JSX）
    │   └── SiteFooter.tsx
    ├── content/
    │   ├── profile.ts                  # 姓名、定位句、四个数字
    │   ├── journey.ts                  # 五级台阶
    │   ├── projects.ts                 # otest / typenow + 三个次要经历
    │   ├── stack.ts                    # 五组技术栈
    │   ├── contact.ts                  # 号码碎片（唯一存放地）
    │   ├── content.test.ts             # 内容完整性守卫（journey + profile + stack）
    │   └── projects.test.ts            # 详情页五段齐全 + 取舍必须写代价
    └── lib/
        ├── contact.ts                  # revealContact()：纯函数，唯一有逻辑的地方
        └── contact.test.ts             # 拼接纯函数的单测
```

**职责边界：** `content/` 只放数据、不含 JSX；`lib/` 只放纯函数；`components/` 只做渲染。这样内容改动不需要碰组件，组件改动不需要碰文案。

---

### Task 1: 初始化仓库与工具链

**Files:**
- Create: `dev-typenow/package.json`
- Create: `dev-typenow/tsconfig.json`
- Create: `dev-typenow/next.config.ts`
- Create: `dev-typenow/postcss.config.mjs`
- Create: `dev-typenow/vitest.config.ts`
- Create: `dev-typenow/.gitignore`
- Create: `dev-typenow/src/app/globals.css`
- Create: `dev-typenow/src/app/layout.tsx`
- Create: `dev-typenow/src/app/page.tsx`

- [ ] **Step 1: 创建 GitHub 仓库并克隆**

```bash
cd ~/Documents/trae_projects
gh repo create EricChan-dev/dev-typenow --public \
  --description "个人作品集站 — dev.typenow.cn"
git clone git@github.com:EricChan-dev/dev-typenow.git
cd dev-typenow
```

Expected: `Cloning into 'dev-typenow'...` 且 `gh` 输出仓库 URL。

若本机没有 `gh`（`command not found: gh`）：到 https://github.com/new 手工建 `dev-typenow`（Public，**不要**勾选 README/.gitignore/License），再执行 `git clone`。

- [ ] **Step 2: 写 `package.json`**

注意 `start` 脚本**直接绑定 `127.0.0.1:3001`**——不绑的话 Next 默认监听 `0.0.0.0:3000`，会与 TypeNow 撞端口，且暴露在公网绕过 nginx。

```json
{
  "name": "dev-typenow",
  "version": "1.0.0",
  "private": true,
  "scripts": {
    "dev": "next dev -p 3001",
    "build": "next build",
    "start": "next start -H 127.0.0.1 -p 3001",
    "lint": "eslint",
    "test": "vitest run"
  },
  "dependencies": {
    "next": "16.2.4",
    "react": "19.2.4",
    "react-dom": "19.2.4"
  },
  "devDependencies": {
    "@tailwindcss/postcss": "^4",
    "@types/node": "^20",
    "@types/react": "^19",
    "@types/react-dom": "^19",
    "eslint": "^9",
    "eslint-config-next": "16.2.4",
    "tailwindcss": "^4",
    "typescript": "^5",
    "vitest": "^1.6.1"
  }
}
```

版本与 TypeNow 对齐（`next 16.2.4` / `react 19.2.4` / `vitest ^1.6.1`），避免两套行为差异。

- [ ] **Step 3: 写 `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["dom", "dom.iterable", "esnext"],
    "allowJs": true,
    "skipLibCheck": true,
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "preserve",
    "incremental": true,
    "plugins": [{ "name": "next" }],
    "paths": { "@/*": ["./src/*"] }
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}
```

`"strict": true` 是刻意的：内容模块靠类型约束字段齐全。

- [ ] **Step 4: 写 `next.config.ts` / `postcss.config.mjs` / `vitest.config.ts`**

`next.config.ts`：

```ts
import type { NextConfig } from "next"

const nextConfig: NextConfig = {
  poweredByHeader: false,
}

export default nextConfig
```

> ⚠️ **不要加 `output: "export"`。** 虽然这是个几乎纯静态的站，静态导出看着更省资源，
> 但它会**让 `next start` 完全不可用**（静态导出不产出 Node 服务端），
> 而本计划的部署方式（pm2 + `next start`）依赖它。
> 若要改成静态托管，是另一套部署流程，不在本计划范围内。

`postcss.config.mjs`：

```js
export default {
  plugins: {
    "@tailwindcss/postcss": {},
  },
}
```

`vitest.config.ts`：

```ts
import { defineConfig } from "vitest/config"
import path from "path"

export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    css: false,
    // 只跑 src/ 下的用例。默认 include 会把 .next 构建产物扫进来
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
    exclude: ["node_modules/**", ".next/**"],
  },
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
})
```

- [ ] **Step 5: 写 `.gitignore`**

```
node_modules/
.next/
.next-staging/
.next-prev/
out/
*.log
.env*.local
.DS_Store
next-env.d.ts
tsconfig.tsbuildinfo
```

- [ ] **Step 6: 写 `src/app/globals.css`（设计令牌）**

Tailwind v4 用 `@theme` 声明令牌，令牌会自动变成 `bg-canvas` / `text-ink` 这类工具类。

```css
@import "tailwindcss";

@theme {
  /* 米白纸面 + 墨色正文：杂志编辑感的底色 */
  --color-canvas: #faf8f5;
  --color-surface: #ffffff;
  --color-ink: #1a1a1a;
  --color-ink-soft: #5c554d;
  --color-ink-faint: #a89f95;
  --color-rule: #e0dad2;
  --color-rule-soft: #ede8e1;
  --color-accent: #b45309;
  --color-accent-wash: #f3ede5;

  --font-serif: Georgia, "Songti SC", "Noto Serif SC", serif;
  --font-sans: ui-sans-serif, system-ui, -apple-system, "PingFang SC", sans-serif;
  --font-mono: ui-monospace, "SF Mono", Menlo, monospace;
}

html {
  scroll-behavior: smooth;
}

body {
  background-color: var(--color-canvas);
  color: var(--color-ink);
  font-family: var(--font-sans);
  -webkit-font-smoothing: antialiased;
}

/* 联系方式碎片：视觉上不可见但仍参与布局的容器 */
.contact-fragments {
  display: inline;
}
```

> 说明：`scroll-behavior: smooth` 让首页的锚点跳转（如「看详情」）平滑滚动，这是杂志版式的一部分。

- [ ] **Step 7: 写 `src/app/layout.tsx`**

```tsx
import type { Metadata } from "next"
import "./globals.css"
import { profile } from "@/content/profile"
import { SiteFooter } from "@/components/SiteFooter"

export const metadata: Metadata = {
  title: `${profile.name} · ${profile.role}`,
  description: profile.headline,
  metadataBase: new URL("https://dev.typenow.cn"),
}

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>
        {children}
        <SiteFooter />
      </body>
    </html>
  )
}
```

- [ ] **Step 8: 写最小 `src/components/SiteFooter.tsx`（让 layout 能编译）**

```tsx
import { profile } from "@/content/profile"
import { ContactReveal } from "./ContactReveal"

export function SiteFooter() {
  return (
    <footer className="border-t border-rule px-6 py-10 md:px-12">
      <div className="mx-auto flex max-w-5xl flex-col gap-3 text-sm text-ink-faint md:flex-row md:items-center md:justify-between">
        <span>
          {profile.name} · {profile.role} · {profile.years} 年
        </span>
        <ContactReveal />
      </div>
    </footer>
  )
}
```

- [ ] **Step 9: 写最小 `src/content/profile.ts`（Task 4 会补全）**

```ts
export type Profile = {
  name: string
  role: string
  years: number
  city: string
  headline: string
  headlineAccent: string
  intro: string
  metrics: readonly { value: string; unit: string; label: string }[]
}

export const profile: Profile = {
  name: "陈应帅",
  role: "全栈工程师",
  years: 11,
  city: "北京",
  headline: "从写页面，到",
  headlineAccent: "一个人交付整个平台",
  intro: "iOS 出身。",
  metrics: [],
}
```

- [ ] **Step 10: 写最小 `src/app/page.tsx` 与 `src/components/ContactReveal.tsx`（占位，后续任务补全）**

`src/components/ContactReveal.tsx`：

```tsx
export function ContactReveal() {
  return <span>查看联系方式</span>
}
```

`src/app/page.tsx`：

```tsx
export default function Home() {
  return <main className="mx-auto max-w-5xl px-6 py-24 md:px-12" />
}
```

- [ ] **Step 11: 安装依赖并验证构建**

```bash
pnpm install
pnpm test
npx tsc --noEmit
pnpm run build
```

Expected: `pnpm install` 成功；`pnpm test` 输出 `No test files found` 并以非零码退出（此时还没有测试文件，属正常）；`tsc --noEmit` **无输出**；`pnpm run build` 输出 `✓ Compiled successfully`。

- [ ] **Step 12: Commit**

```bash
git add -A
git commit -m "chore: 初始化作品集站脚手架（Next 16 + Tailwind v4 + vitest）"
```

---

### Task 2: 联系方式碎片与拼接（TDD）

这是全站唯一有真实逻辑的地方，也是唯一有安全含义的地方。**先写测试**。

**Files:**
- Create: `src/content/contact.ts`
- Create: `src/lib/contact.ts`
- Test: `src/lib/contact.test.ts`
- Test: `src/components/contact-privacy.test.tsx`（含 JSX，必须是 `.tsx`）
- Modify: `src/components/ContactReveal.tsx`

- [ ] **Step 1: 写失败测试 `src/lib/contact.test.ts`**

```ts
import { describe, expect, it } from "vitest"
import { revealContact } from "./contact"

// 期望值由碎片拼出，而不是写成字面量：这样完整号码在仓库任何角落都不存在，
// `grep -rn "<完整号码>" src/` 能保持「结果为空」这条硬性不变量。
const FULL_PHONE = ["166", "3448", "2010"].join("")

describe("revealContact", () => {
  it("把碎片按顺序拼成完整号码", () => {
    expect(revealContact(["166", "3448", "2010"])).toBe(FULL_PHONE)
  })

  it("允许片段是单字符（碎片可以切得很碎）", () => {
    expect(revealContact(["1", "6", "6"])).toBe("166")
  })

  it("空数组返回空串而不是抛错", () => {
    expect(revealContact([])).toBe("")
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm vitest run src/lib/contact.test.ts`
Expected: FAIL — `Failed to resolve import "./contact"`。

- [ ] **Step 3: 写 `src/lib/contact.ts`**

```ts
/**
 * 把打散的联系方式碎片拼回完整字符串。
 *
 * 存在意义：完整号码一旦以连续文本出现在源码或 HTML 里，爬虫扫一遍就拿到了。
 * 碎片分开存放后，源码里搜完整号码搜不到，用户点击时才在浏览器内存中拼出来。
 *
 * 注意：这里刻意不做 trim / 过滤空串 —— 碎片是手写的常量，
 * 自动清洗会掩盖「碎片写错了」这个错误，让拼接结果静默出错。
 */
export function revealContact(fragments: readonly string[]): string {
  return fragments.join("")
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm vitest run src/lib/contact.test.ts`
Expected: PASS — 3 passed。

- [ ] **Step 5: 写 `src/content/contact.ts`（碎片唯一存放地）**

碎片切分遵循一条硬规则：**任何单个片段都不得等于完整号码**。

```ts
/**
 * 号码碎片。切分规则：**任何单个片段都不得等于完整号码**。
 * 正例："166" / "3448" / "2010"（三段各自都不是完整号码）。
 * 反例：把整个号码放进一个片段——那等于明文存放，防护彻底作废。
 */
export const PHONE_FRAGMENTS: readonly string[] = ["166", "3448", "2010"]

/** 邮箱域名部分。邮箱 = 号码碎片 + 这个后缀，拼接后得到完整邮箱。 */
export const EMAIL_DOMAIN = "@163.com"
```

> ⚠️ **注意注释里也不要写出完整号码。** 哪怕是「反例示范」，
> 写出来的那一行就已经让 `grep -rn "<完整号码>" src/` 命中，
> 不变量就破了。用「完整号码」这种说法指代，不要粘贴真值。

> ⚠️ **不要把邮箱写成 `["166****2010", "@163.com"]`。** 那样第一个片段**就是完整手机号**，
> 等于在源码里明文存了一份号码，防护形同虚设——凡是扫描源码的爬虫（或任何人 grep 仓库）
> 都能直接找到。正确做法是复用 `PHONE_FRAGMENTS`，让号码以碎片形式存在：
>
> ```ts
> const phone = revealContact(PHONE_FRAGMENTS)          // "166****2010"
> const email = `${phone}${EMAIL_DOMAIN}`               // "166****2010@163.com"
> ```
>
> 拼接发生在**点击后的客户端**，所以服务端渲染的 HTML 与源码里都没有完整号码。
> 这样 `grep -rn "166****2010" src/` 的结果就是**彻底为空**，不需要为任何文件开例外。

- [ ] **Step 6: 写失败测试 `src/components/contact-privacy.test.tsx`（渲染产物守卫）**

> ⚠️ 文件名必须是 `.tsx` 而不是 `.ts`——这个测试里写了 JSX，`.ts` 文件无法编译 JSX。
> `vitest.config.ts` 的 include 已经覆盖 `.tsx`。

这个测试渲染 `ContactReveal` 组件，断言输出 HTML 里**不含完整号码**。

```tsx
import { describe, expect, it } from "vitest"
import { renderToStaticMarkup } from "react-dom/server"
import { ContactReveal } from "./ContactReveal"

// 同样由碎片拼出，避免测试文件成为全仓库唯一写死号码的地方。
// 这条很关键：本仓库是公开的，写死一次就等于把号码发布出去。
const FULL_PHONE = ["166", "3448", "2010"].join("")
const FULL_EMAIL = `${FULL_PHONE}@163.com`

describe("联系方式隐私守卫", () => {
  it("服务端渲染的 HTML 里不出现完整手机号", () => {
    const html = renderToStaticMarkup(<ContactReveal />)
    expect(html).not.toContain(FULL_PHONE)
  })

  it("服务端渲染的 HTML 里不出现完整邮箱", () => {
    const html = renderToStaticMarkup(<ContactReveal />)
    expect(html).not.toContain(FULL_EMAIL)
  })

  it("初始状态只显示按钮文案", () => {
    const html = renderToStaticMarkup(<ContactReveal />)
    expect(html).toContain("查看联系方式")
  })
})
```

`react-dom/server` 是 `react-dom` 自带的入口，无需额外依赖。

- [ ] **Step 7: 确认守卫测试真的能捕获泄漏（不可跳过）**

此刻 `ContactReveal` 只返回 `<span>查看联系方式</span>`，三条都会**通过**——但那是假绿，
因为它压根还没渲染号码。必须先证明测试能变红。

临时把 `src/components/ContactReveal.tsx` 改成硬编码完整号码：

```tsx
export function ContactReveal() {
  return <span>166****2010</span>
}
```

Run: `pnpm vitest run src/components/contact-privacy.test.tsx`
Expected: FAIL — `expected '<span>166****2010</span>' not to contain '166****2010'`。

**只有看到这条失败，才能确认守卫测试有效。** 然后继续 Step 8 写真正的实现。

- [ ] **Step 8: 写真正的 `src/components/ContactReveal.tsx`**

```tsx
"use client"

import { useState } from "react"
import { EMAIL_DOMAIN, PHONE_FRAGMENTS } from "@/content/contact"
import { revealContact } from "@/lib/contact"

/**
 * 点击才显示联系方式。
 *
 * 为什么不用「反转字符串再还原」这类小把戏：爬虫早就会跑 JS 了，
 * 混淆只挡得住最笨的爬虫。真正的防护是**服务端渲染时不含号码**——
 * 碎片只在点击后由客户端拼接，静态 HTML 里搜不到。
 * 代价是禁用 JS 的访客看不到联系方式，对方是可接受的小比例。
 */
export function ContactReveal() {
  const [shown, setShown] = useState(false)

  if (!shown) {
    return (
      <button
        type="button"
        onClick={() => setShown(true)}
        className="rounded-sm border border-rule px-4 py-2 text-sm text-ink transition-colors hover:border-accent hover:text-accent"
      >
        查看联系方式
      </button>
    )
  }

  const phone = revealContact(PHONE_FRAGMENTS)
  const email = `${phone}${EMAIL_DOMAIN}`

  return (
    <span className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm">
      <a href={`tel:${phone}`} className="text-accent hover:underline">
        {phone}
      </a>
      <a href={`mailto:${email}`} className="text-accent hover:underline">
        {email}
      </a>
    </span>
  )
}
```

> `href={tel:...}` 与 `mailto:` 里**含完整号码**，但那串只在点击后的客户端 DOM 里出现，
> 不在服务端渲染的 HTML 里。守卫测试渲染的是 `renderToStaticMarkup`（初始态），
> 因此仍然通过——这正是我们要的性质。

- [ ] **Step 9: 跑测试确认通过**

Run: `pnpm test`
Expected: PASS — `src/lib/contact.test.ts` 3 passed，`src/components/contact-privacy.test.tsx` 3 passed。

- [ ] **Step 10: 确认构建产物里没有明文号码**

```bash
pnpm run build
FULL_PHONE=$(node -e 'process.stdout.write(["166","3448","2010"].join(""))')
grep -rn "$FULL_PHONE" .next/static .next/server/app 2>/dev/null && echo "❌ 泄漏！" || echo "✅ 构建产物中无明文号码"
```

Expected: `✅ 构建产物中无明文号码`

> ⚠️ 如果这里报泄漏，检查是不是有组件把 `PHONE_FRAGMENTS` 拼好的结果写进了服务端渲染的 JSX。
> 号码只允许在 `ContactReveal` 的 `onClick` 之后出现。**这是本任务最重要的一步验证。**

- [ ] **Step 11: Commit**

```bash
git add -A
git commit -m "feat(contact): 点击才显示联系方式，号码以碎片存放"
```

---

### Task 3: 排版原子组件（Magazine.tsx）

**Files:**
- Create: `src/components/Magazine.tsx`

- [ ] **Step 1: 写 `src/components/Magazine.tsx`**

三个原子覆盖了全站重复出现的排版模式，避免每节各写一遍类名。

```tsx
import type { ReactNode } from "react"

/** 小号等宽全大写标签，杂志里对应「栏目名/眉标」。 */
export function Eyebrow({ children }: { children: ReactNode }) {
  return (
    <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-ink-faint">
      {children}
    </div>
  )
}

/** 节标题：衬线大字，可带斜体强调尾。 */
export function SectionTitle({
  children,
  accent,
}: {
  children: ReactNode
  accent?: ReactNode
}) {
  return (
    <h2 className="mt-2 font-serif text-3xl leading-tight tracking-tight text-ink md:text-4xl">
      {children}
      {accent ? (
        <>
          ，<em className="italic text-accent">{accent}</em>
        </>
      ) : null}
    </h2>
  )
}
```

> 只做两个原子。**刻意不做 `Rule` 分隔线组件**——全站的分隔线都是「某个区块的下边框」
> （`border-b border-rule`），是布局的一部分；抽成独立组件反而要把边框责任拆到两处，
> 是 YAGNI 的反例。

- [ ] **Step 2: 验证类型**

Run: `npx tsc --noEmit`
Expected: 无输出。

- [ ] **Step 3: Commit**

```bash
git add src/components/Magazine.tsx
git commit -m "feat(ui): 杂志排版原子组件"
```

---

### Task 4: 首屏 Hero + 完整 profile 内容

**Files:**
- Modify: `src/content/profile.ts`
- Create: `src/components/Hero.tsx`
- Modify: `src/app/page.tsx`

- [ ] **Step 1: 补全 `src/content/profile.ts`**

四个数字取自简历：11 年工龄、日均 1200 万 PV、累计放款超 1000 亿、11 项专利。**专利是荣誉不是业务量**，用户在 spec 评审时表示「都行」，此处保留并放在第四格——它读起来像荣誉栏而非业务栏。

```ts
export type Profile = {
  name: string
  role: string
  years: number
  city: string
  headline: string
  headlineAccent: string
  intro: string
  metrics: readonly { value: string; unit: string; label: string }[]
}

export const profile: Profile = {
  name: "陈应帅",
  role: "全栈工程师",
  years: 11,
  city: "北京",
  headline: "从写页面，到",
  headlineAccent: "一个人交付整个平台",
  intro:
    "iOS 出身，做过千亿级金融核心业务的前端与全栈，现在独立交付一套四端云真机测试平台。既能在日活千万的系统里兜住稳定性，也能从零把产品做出来。",
  metrics: [
    { value: "11", unit: "年", label: "全栈开发经验" },
    { value: "1200", unit: "万/日", label: "峰值业务 PV" },
    { value: "1000", unit: "亿+", label: "累计放款规模" },
    { value: "11", unit: "项", label: "金融技术专利（已受理）" },
  ],
}
```

- [ ] **Step 2: 写 `src/components/Hero.tsx`**

```tsx
import { profile } from "@/content/profile"
import { ContactReveal } from "./ContactReveal"
import { Eyebrow } from "./Magazine"

export function Hero() {
  return (
    <section className="px-6 pb-16 pt-16 md:px-12 md:pb-24 md:pt-24">
      <div className="mx-auto max-w-5xl">
        <Eyebrow>
          {profile.name} · {profile.role} · {profile.years} 年
        </Eyebrow>

        <h1 className="mt-4 max-w-[16em] font-serif text-4xl leading-[1.14] tracking-tight text-ink md:text-5xl">
          {profile.headline}
          <em className="italic text-accent">{profile.headlineAccent}</em>。
        </h1>

        <p className="mt-5 max-w-[32em] text-[15px] leading-relaxed text-ink-soft">
          {profile.intro}
        </p>

        {/* 数字栏：靠 1px 间隙露出底色形成表格线，是杂志数据栏的做法。
            不用 per-cell 边框：那样在 2 列 / 4 列两个断点下要分别为第 2、4 项
            去掉右边框、为最后一行去掉下边框，极易漏掉一条而出现双线。 */}
        <dl className="mt-9 grid grid-cols-2 gap-px border border-rule bg-rule md:grid-cols-4">
          {profile.metrics.map((m) => (
            <div key={m.label} className="bg-canvas px-4 py-4">
              <dt className="sr-only">{m.label}</dt>
              <dd>
                <span className="font-serif text-3xl leading-none tracking-tight text-ink">
                  {m.value}
                  <em className="ml-1 font-serif text-xs not-italic text-ink-faint">
                    <span className="italic">{m.unit}</span>
                  </em>
                </span>
                <span className="mt-2 block text-[11px] text-ink-faint">{m.label}</span>
              </dd>
            </div>
          ))}
        </dl>

        <div className="mt-8 flex flex-wrap items-center gap-4">
          <ContactReveal />
          <a
            href="/resume.pdf"
            className="rounded-sm border border-rule bg-surface px-4 py-2 text-sm text-ink transition-colors hover:border-accent hover:text-accent"
          >
            下载 PDF 简历
          </a>
        </div>
      </div>
    </section>
  )
}
```

- [ ] **Step 3: 接入 `src/app/page.tsx`**

```tsx
import { Hero } from "@/components/Hero"

export default function Home() {
  return (
    <main>
      <Hero />
    </main>
  )
}
```

- [ ] **Step 4: 本地起服务肉眼验证**

```bash
pnpm run build && pnpm start
```

在另一个终端：

```bash
curl -s http://127.0.0.1:3001/ | grep -c "一个人交付整个平台"
```

Expected: `1`

浏览器打开 http://localhost:3001 ，确认：米白底、标题是衬线大字、四个数字栏有细线分隔、手机号**未显示**（只有一个按钮）。

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(hero): 首屏定位句与四项数据栏"
```

---

### Task 5: 心路历程时间线（五级台阶）

**Files:**
- Create: `src/content/journey.ts`
- Create: `src/components/Timeline.tsx`
- Create: `src/content/content.test.ts`
- Modify: `src/app/page.tsx`

- [ ] **Step 1: 写 `src/content/journey.ts`**

2015–2018 这三年在简历上没有工作经历条目（简历写 11 年工龄，最早条目是 2018.07），面试官必问。第一级台阶主动交代。

```ts
export type JourneyNode = {
  year: string
  org: string
  title: string
  summary: string
}

export const journeyAxes = "写页面 → 建体系 → 跨端 → 架构 → 平台 + AI"

export const journey: readonly JourneyNode[] = [
  {
    year: "2015",
    org: "iOS 开发",
    title: "原生移动端起步",
    summary:
      "刚毕业做 iOS，处理多机型适配与性能问题。这段原生底子后来直接复用在 RN 容器与真机接入上。",
  },
  {
    year: "2018",
    org: "展恒基金",
    title: "从写页面到建体系",
    summary:
      "搭前端工程化与自动化部署，线上 bug 率降 40%+，方案沉淀为公司前端通用标准。",
  },
  {
    year: "2021",
    org: "阳光保险",
    title: "跨端与原生底座",
    summary:
      "自研 JSBridge + RN 容器，抹平 iOS/Android WebView 差异，跨端可维护性提升 50%。",
  },
  {
    year: "2023",
    org: "马上消费金融",
    title: "架构与稳定性",
    summary:
      "日均 1200 万 PV、累计放款超千亿，可用性 99.99%，11 项金融技术专利获受理。",
  },
  {
    year: "2026",
    org: "OPay",
    title: "平台 + AI",
    summary:
      "独立交付四端云真机测试平台，LangChain4j 接入大模型做用例生成、补全与修复，SSE 流式响应。",
  },
]
```

- [ ] **Step 2: 写失败测试 `src/content/content.test.ts`**

内容守卫——防的是「复制粘贴时漏改年份」「新增节点忘了填 summary」这类真实会发生的错误。

```ts
import { describe, expect, it } from "vitest"
import { journey, journeyAxes } from "./journey"
import { profile } from "./profile"

describe("心路历程内容", () => {
  it("恰好五个节点", () => {
    expect(journey).toHaveLength(5)
  })

  it("年份严格递增", () => {
    const years = journey.map((n) => Number(n.year))
    for (let i = 1; i < years.length; i++) {
      expect(years[i]).toBeGreaterThan(years[i - 1])
    }
  })

  it("每个节点四个字段都不为空", () => {
    for (const node of journey) {
      expect(node.year.trim(), `节点 ${node.title} 缺 year`).not.toBe("")
      expect(node.org.trim(), `节点 ${node.title} 缺 org`).not.toBe("")
      expect(node.title.trim(), `节点 ${node.year} 缺 title`).not.toBe("")
      expect(node.summary.trim(), `节点 ${node.title} 缺 summary`).not.toBe("")
    }
  })

  it("描述长度在 30–80 字之间", () => {
    for (const node of journey) {
      expect(node.summary.length, `${node.title} 描述过短`).toBeGreaterThanOrEqual(30)
      expect(node.summary.length, `${node.title} 描述过长`).toBeLessThanOrEqual(80)
    }
  })

  it("主轴是五级", () => {
    expect(journeyAxes.split("→")).toHaveLength(5)
  })

  it("首个节点是 2015，用来交代简历上的三年空档", () => {
    expect(journey[0].year).toBe("2015")
  })
})

describe("profile 内容", () => {
  it("四个数字都有单位与说明", () => {
    expect(profile.metrics).toHaveLength(4)
    for (const m of profile.metrics) {
      expect(m.value.trim()).not.toBe("")
      expect(m.unit.trim()).not.toBe("")
      expect(m.label.trim()).not.toBe("")
    }
  })

  it("工龄与简历一致", () => {
    expect(profile.years).toBe(11)
  })
})
```

- [ ] **Step 3: 跑测试**

Run: `pnpm vitest run src/content/content.test.ts`
Expected: PASS — 8 passed。

若「描述长度」失败：按提示把该节点的 summary 改到 30–80 字。这是刻意的约束——时间线上描述超过 80 字会从「时间线」退化成「散文」。

- [ ] **Step 4: 写 `src/components/Timeline.tsx`**

```tsx
import { journey, journeyAxes } from "@/content/journey"
import { profile } from "@/content/profile"
import { Eyebrow, SectionTitle } from "./Magazine"

export function Timeline() {
  const lastIndex = journey.length - 1

  return (
    <section id="journey" className="px-6 py-16 md:px-12 md:py-24">
      <div className="mx-auto max-w-5xl">
        <Eyebrow>Career Path · 2015 → 2026</Eyebrow>
        {/* 工龄取 profile.years，不按节点数推算：节点数与工龄是两回事，
            写 journey.length * 2 + 1 会在增删节点时静默算错年份 */}
        <SectionTitle accent="五级台阶">{`${profile.years} 年`}</SectionTitle>

        <div className="mt-4 border-b border-rule pb-4 font-mono text-[10px] uppercase tracking-[0.13em] text-ink-faint">
          {journeyAxes}
        </div>

        <ol className="mt-2">
          {journey.map((node, i) => {
            const isLast = i === lastIndex
            return (
              <li
                key={node.year}
                className="flex gap-4 border-b border-rule-soft py-4 last:border-b-0 md:gap-6"
              >
                <div
                  className={`w-11 shrink-0 pt-1 font-mono text-[11px] ${
                    isLast ? "font-bold text-accent" : "text-accent"
                  }`}
                >
                  {node.year}
                </div>
                <div
                  className={`flex-1 border-l-2 pl-4 ${
                    isLast ? "border-accent" : "border-rule"
                  }`}
                >
                  <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                    <h3 className="font-serif text-base font-bold tracking-tight text-ink">
                      {node.title}
                    </h3>
                    <span className="font-serif text-[11px] italic text-ink-faint">
                      {node.org}
                    </span>
                  </div>
                  <p className="mt-1 text-sm leading-relaxed text-ink-soft">
                    {node.summary}
                  </p>
                </div>
              </li>
            )
          })}
        </ol>
      </div>
    </section>
  )
}
```

> 关于「13–18 空白已补上」的提示块：spec 里列作待定项，用户答复「都行」。
> 实施时**不单独做提示块**——第一级台阶的 2015 年份与「刚毕业做 iOS」已经完成了交代，
> 再加一个解释框反而像在辩解。这是有意的简化。

- [ ] **Step 5: 接入 `src/app/page.tsx`**

```tsx
import { Hero } from "@/components/Hero"
import { Timeline } from "@/components/Timeline"

export default function Home() {
  return (
    <main>
      <Hero />
      <Timeline />
    </main>
  )
}
```

- [ ] **Step 6: 构建并肉眼验证**

```bash
pnpm run build && pnpm start
```

打开 http://localhost:3001#journey ，确认：标题是「11 年，*五级台阶*」（衬线 + 斜体琥珀色）、五个节点年份严格递增、最后一级（2026）竖线与年份高亮、每级描述不超过两行。

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(journey): 五级台阶时间线"
```

---

### Task 6: 作品区（两个大卡 + 三个次要经历）

**Files:**
- Create: `src/content/projects.ts`
- Create: `src/components/Works.tsx`
- Create: `src/content/projects.test.ts`
- Modify: `src/app/page.tsx`

- [ ] **Step 1: 写 `src/content/projects.ts`**

详情页固定五段。`decisions`（关键取舍）是全页价值最高的部分——每条都必须写清「放弃了什么」，只讲好处的不是取舍。

```ts
export type ProjectDecision = {
  title: string
  body: string
}

export type Project = {
  slug: string
  name: string
  codename: string
  tagline: string
  tags: readonly string[]
  metric: { value: string; label: string }
  detail: {
    background: string
    role: string
    architecture: string
    decisions: readonly ProjectDecision[]
    outcome: string
  }
}

export const projects: readonly Project[] = [
  {
    slug: "otest",
    name: "移动端云真机测试平台",
    codename: "otest",
    tagline:
      "让测试同学在网页上直接操作真实手机。四端架构，WebSocket 打通 Server—Agent—Device 实时链路，接大模型自动生成与修复测试用例。",
    tags: [
      "Vue 3",
      "Spring Boot",
      "Electron",
      "WebSocket",
      "LangChain4j",
      "Docker Compose",
    ],
    metric: { value: "98%+", label: "设备连接成功率" },
    detail: {
      background:
        "测试团队要覆盖几十款真机，过去靠人工借机器、手工回归，设备利用率低且结果不可追溯。目标是让测试同学在浏览器里直接操作真机并自动生成用例。",
      role: "独立负责全栈：领域建模、四端架构设计、WebSocket 实时链路、AI 能力接入与部署编排。",
      architecture: [
        "Vue 3 管理端（云端）",
        "  │ HTTP / WebSocket",
        "Spring Boot 服务端   · JWT/RBAC · Quartz · MySQL · Redis",
        "  │ WebSocket（注册鉴权 / 设备发现 / 心跳保活 / 状态同步 / 异常重连）",
        "Java 设备 Agent      · ADB · scrcpy/minicap · WDA · MJPEG / H.264",
        "  │ 本地会话",
        "真机集群              另有 Electron 桌面端用于本地调试",
      ].join("\n"),
      decisions: [
        {
          title: "用 WebSocket 长连接而不是轮询",
          body: "设备状态变化频繁，轮询在几十台设备下会把服务端打满。代价是要自己实现心跳、重连与状态补偿。",
        },
        {
          title: "画面传输分离：MJPEG 与 H.264 双路径",
          body: "低端机用 MJPEG 保证兼容，主流机用 H.264 换流畅度。代价是 Agent 侧要维护两套编码。",
        },
        {
          title: "大模型只放在「生成/修复用例」，不进执行控制",
          body: "执行链路要确定性，不能有幻觉。AI 只进确定性要求低、价值高的环节，并保留人工确认。",
        },
        {
          title: "服务端与设备 Agent 分离部署",
          body: "Agent 要贴近设备、直连 ADB，放同一进程会让扩容与故障隔离都变难。代价是多一跳网络与一套部署。",
        },
      ],
      outcome:
        "设备连接成功率 98%+；用例编写从手工逐条录入改为 AI 生成加人工确认；Docker Compose 一键起全栈，nginx 统一代理 HTTP 与 WebSocket。",
    },
  },
  {
    slug: "typenow",
    name: "TypeNow 码上英语",
    codename: "typenow.cn",
    tagline:
      "在线英语学习网站。从产品设计、数据建模到部署运维全部自己完成，含发音评分、练习计分与定时生命周期任务。",
    tags: [
      "Next.js 16",
      "React 19",
      "Tailwind v4",
      "MySQL",
      "Drizzle ORM",
      "pm2 + nginx",
    ],
    metric: { value: "一人", label: "从 0 到线上" },
    detail: {
      background:
        "想要一个能真正用起来的英语练习产品，而不是玩具项目。成功标准是自己每天愿意用它练，且能在低配服务器上稳定跑。",
      role: "独立完成全部工作：产品设计、数据建模、前后端实现、部署与运维。",
      architecture: [
        "浏览器",
        "  │ HTTP",
        "nginx（Let's Encrypt 终止 TLS，统一入口）",
        "  │ 反向代理",
        "Next.js 16 应用（pm2 常驻）",
        "  │ Drizzle ORM",
        "MySQL 8",
        "",
        "另有 webhook 服务监听 :9000，GitHub push 自动触发部署",
      ].join("\n"),
      decisions: [
        {
          title: "构建到暂存目录再原子切换，而不是就地覆写",
          body: "就地构建一旦中途失败会留下坏一半的产物，用户请求到未加载的 chunk 就 404，失败从「发布没生效」升级成「线上报错」。代价是磁盘多占一份构建产物。",
        },
        {
          title: "逐词评分用第三方返回的分词，不按自己的字段切词",
          body: "库里句子的标点是独立 token（如「Seven , eight」），自己切词会与评分服务的分词对不上。代价是逐词区只能显示对方给了分的词。",
        },
        {
          title: "部署串行化并带拉取重试",
          body: "GitHub webhook 只触发一次、没有补偿机制，一次网络抖动就静默漏掉一次发布。代价是部署会排队等待。",
        },
      ],
      outcome:
        "稳定运行在 2 核 3.5G 的服务器上；每次 push 自动部署；发音评分落库后可在历史回看时查看。",
    },
  },
]

/** 次要经历：不做详情页，列表里一行带过。 */
export type MinorExperience = {
  period: string
  name: string
  tech: string
}

export const minorExperiences: readonly MinorExperience[] = [
  { period: "2023–2026", name: "易借钱贷款超市", tech: "Vue + Node.js + Redis" },
  { period: "2021–2022", name: "阳光互联网医院", tech: "小程序 / 医生端 / 管理端" },
  { period: "2021–2022", name: "惠金所 APP", tech: "React Native + Vue 2" },
]
```

- [ ] **Step 2: 写失败测试 `src/content/projects.test.ts`**

```ts
import { describe, expect, it } from "vitest"
import { minorExperiences, projects } from "./projects"

describe("项目内容", () => {
  it("两个重点项目，slug 唯一且可用作路由", () => {
    expect(projects).toHaveLength(2)
    const slugs = projects.map((p) => p.slug)
    expect(new Set(slugs).size).toBe(slugs.length)
    for (const slug of slugs) {
      expect(slug, `slug ${slug} 只能含小写字母与连字符`).toMatch(/^[a-z][a-z0-9-]*$/)
    }
  })

  it("每个项目详情五段齐全", () => {
    for (const p of projects) {
      expect(p.detail.background.trim(), `${p.slug} 缺 background`).not.toBe("")
      expect(p.detail.role.trim(), `${p.slug} 缺 role`).not.toBe("")
      expect(p.detail.architecture.trim(), `${p.slug} 缺 architecture`).not.toBe("")
      expect(p.detail.outcome.trim(), `${p.slug} 缺 outcome`).not.toBe("")
      // 设计文档 §5.1 要求「关键取舍各四条以上」。
      // 这里断言 4 而不是 3：取舍是详情页唯一无法靠模板补齐的内容，
      // 低于 4 条会让人觉得「这项目没什么可讲的」。
      expect(p.detail.decisions.length, `${p.slug} 取舍少于 4 条`).toBeGreaterThanOrEqual(4)
    }
  })

  it("每条取舍都写了「代价」，而不只是好处", () => {
    for (const p of projects) {
      for (const d of p.detail.decisions) {
        expect(d.title.trim(), `${p.slug} 有取舍缺标题`).not.toBe("")
        expect(d.body.length, `${p.slug} 的「${d.title}」没写代价`).toBeGreaterThan(25)
        expect(
          /代价|成本|多|慢|受限/.test(d.body),
          `${p.slug} 的「${d.title}」没写明放弃了什么`,
        ).toBe(true)
      }
    }
  })

  it("每个项目都有标签与一个关键数字", () => {
    for (const p of projects) {
      expect(p.tags.length, `${p.slug} 标签太少`).toBeGreaterThanOrEqual(4)
      expect(p.metric.value.trim(), `${p.slug} 缺 metric.value`).not.toBe("")
      expect(p.metric.label.trim(), `${p.slug} 缺 metric.label`).not.toBe("")
    }
  })

  it("次要经历三条，都有周期与名称", () => {
    expect(minorExperiences).toHaveLength(3)
    for (const e of minorExperiences) {
      expect(e.period.trim()).not.toBe("")
      expect(e.name.trim()).not.toBe("")
      expect(e.tech.trim()).not.toBe("")
    }
  })
})
```

「每条取舍都必须写明代价」是这份测试里最有价值的一条——它防的是详情页退化成自我表扬。

- [ ] **Step 3: 跑测试**

Run: `pnpm vitest run src/content/projects.test.ts`
Expected: PASS — 5 passed。

若「没写明放弃了什么」失败：该条 `body` 里补上代价。关键词是 `代价|成本|多|慢|受限` 之一。

- [ ] **Step 4: 写 `src/components/Works.tsx`**

```tsx
import Link from "next/link"
import { minorExperiences, projects } from "@/content/projects"
import { Eyebrow, SectionTitle } from "./Magazine"

export function Works() {
  return (
    <section id="works" className="px-6 py-16 md:px-12 md:py-24">
      <div className="mx-auto max-w-5xl">
        <Eyebrow>Selected Works</Eyebrow>
        <SectionTitle>两个从零做起的系统</SectionTitle>

        <div className="mt-8 space-y-4">
          {projects.map((p) => (
            <article
              key={p.slug}
              className="rounded-sm border border-rule bg-surface p-5 md:p-6"
            >
              <div className="flex flex-col gap-5 md:flex-row md:items-start md:justify-between">
                <div className="flex-1">
                  <div className="flex flex-wrap items-baseline gap-x-3">
                    <h3 className="font-serif text-xl tracking-tight text-ink">
                      {p.name}
                    </h3>
                    <span className="font-mono text-[11px] italic text-ink-faint">
                      {p.codename}
                    </span>
                  </div>

                  <p className="mt-2 text-sm leading-relaxed text-ink-soft">
                    {p.tagline}
                  </p>

                  <ul className="mt-4 flex flex-wrap gap-2">
                    {p.tags.map((t) => (
                      <li
                        key={t}
                        className="rounded-full bg-accent-wash px-3 py-1 text-[11px] text-ink-soft"
                      >
                        {t}
                      </li>
                    ))}
                  </ul>
                </div>

                <div className="shrink-0 md:w-32 md:text-right">
                  <div className="text-[11px] leading-relaxed text-ink-faint">
                    {p.metric.label}
                  </div>
                  <div className="font-serif text-2xl font-bold text-ink">
                    {p.metric.value}
                  </div>
                  <Link
                    href={`/projects/${p.slug}`}
                    className="mt-3 inline-block text-xs font-medium text-accent hover:underline"
                  >
                    看详情 →
                  </Link>
                </div>
              </div>
            </article>
          ))}
        </div>

        <div className="mt-10 border-t border-rule pt-4">
          <Eyebrow>其他经历</Eyebrow>
          <dl className="mt-3 space-y-2">
            {minorExperiences.map((e) => (
              <div
                key={`${e.period}-${e.name}`}
                className="flex flex-wrap items-baseline gap-x-4 text-sm"
              >
                <dt className="w-24 shrink-0 font-mono text-[11px] text-accent">
                  {e.period}
                </dt>
                <dd className="flex-1 font-medium text-ink">{e.name}</dd>
                <dd className="text-[11px] text-ink-faint">{e.tech}</dd>
              </div>
            ))}
          </dl>
        </div>
      </div>
    </section>
  )
}
```

- [ ] **Step 5: 接入 `src/app/page.tsx`**

```tsx
import { Hero } from "@/components/Hero"
import { Timeline } from "@/components/Timeline"
import { Works } from "@/components/Works"

export default function Home() {
  return (
    <main>
      <Hero />
      <Timeline />
      <Works />
    </main>
  )
}
```

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(works): 作品区两个大卡与三条次要经历"
```

---

### Task 7: 技术栈（分组 + 使用年限）

> ⚠️ **本任务的年限数据是估算值，必须由用户逐项核准后才能提交。** 见 Step 4。

**Files:**
- Create: `src/content/stack.ts`
- Create: `src/components/TechStack.tsx`
- Modify: `src/content/content.test.ts`
- Modify: `src/app/page.tsx`

- [ ] **Step 1: 写 `src/content/stack.ts`**

年限来自简历上的项目时间段推算，`primary: true` 表示主力技术（渲染成 `⋆`）。

```ts
export type StackItem = {
  name: string
  years: number
  primary?: boolean
}

export type StackGroup = {
  key: "FRONTEND" | "BACKEND" | "DATA" | "AI" | "INFRA"
  label: string
  items: readonly StackItem[]
}

export const stack: readonly StackGroup[] = [
  {
    key: "FRONTEND",
    label: "前端",
    items: [
      { name: "Vue 3", years: 7, primary: true },
      { name: "React 19", years: 5, primary: true },
      { name: "TypeScript", years: 6, primary: true },
      { name: "React Native", years: 4 },
      { name: "Taro", years: 3 },
      { name: "Tailwind v4", years: 2 },
      { name: "Next.js 16", years: 1 },
    ],
  },
  {
    key: "BACKEND",
    label: "后端",
    items: [
      { name: "Node.js", years: 6, primary: true },
      { name: "Spring Boot", years: 3, primary: true },
      { name: "Express", years: 5 },
      { name: "MyBatis-Plus", years: 3 },
      { name: "gRPC", years: 2 },
      { name: "JWT / RBAC", years: 3 },
      { name: "Quartz", years: 2 },
    ],
  },
  {
    key: "DATA",
    label: "数据",
    items: [
      { name: "MySQL", years: 8, primary: true },
      { name: "Redis", years: 5, primary: true },
      { name: "ELK", years: 2 },
      { name: "Drizzle ORM", years: 1 },
    ],
  },
  {
    key: "AI",
    label: "AI",
    items: [
      { name: "LangChain4j", years: 1, primary: true },
      { name: "大模型工具调用", years: 1 },
      { name: "SSE 流式响应", years: 1 },
      { name: "Prompt 工程", years: 1 },
    ],
  },
  {
    key: "INFRA",
    label: "工程化",
    items: [
      { name: "WebSocket", years: 3 },
      { name: "Docker Compose", years: 3 },
      { name: "nginx", years: 5 },
      { name: "pm2", years: 3 },
      { name: "Jenkins", years: 4 },
      { name: "Sentry", years: 3 },
      { name: "Let's Encrypt", years: 2 },
    ],
  },
]
```

- [ ] **Step 2: 在 `src/content/content.test.ts` 追加技术栈守卫**

```ts
import { stack } from "./stack"

describe("技术栈内容", () => {
  it("恰好五组，key 不重复", () => {
    expect(stack).toHaveLength(5)
    const keys = stack.map((g) => g.key)
    expect(new Set(keys).size).toBe(keys.length)
  })

  it("每组至少三项", () => {
    for (const g of stack) {
      expect(g.items.length, `${g.key} 项数太少`).toBeGreaterThanOrEqual(3)
    }
  })

  it("同一项不重复出现在不同组里", () => {
    const all = stack.flatMap((g) => g.items.map((i) => i.name))
    const dupes = all.filter((n, i) => all.indexOf(n) !== i)
    expect(dupes, `重复项：${dupes.join(", ")}`).toEqual([])
  })

  it("年限在合理区间（1–15 年）", () => {
    for (const g of stack) {
      for (const i of g.items) {
        expect(i.years, `${i.name} 年限越界`).toBeGreaterThanOrEqual(1)
        expect(i.years, `${i.name} 年限越界`).toBeLessThanOrEqual(15)
      }
    }
  })

  it("每项名称与年限都不为空", () => {
    for (const g of stack) {
      for (const i of g.items) {
        expect(i.name.trim(), `${g.key} 有空名称`).not.toBe("")
        expect(Number.isInteger(i.years), `${i.name} 年限须为整数`).toBe(true)
      }
    }
  })

  it("每组都有主力技术", () => {
    for (const g of stack) {
      expect(
        g.items.some((i) => i.primary),
        `${g.key} 没有标主力技术`,
      ).toBe(true)
    }
  })
})
```

- [ ] **Step 3: 跑测试**

Run: `pnpm vitest run src/content/content.test.ts`
Expected: PASS — 14 passed。

- [ ] **Step 4: 【阻断步骤】向用户逐项确认年限**

把 `src/content/stack.ts` 里的数据整理成一张表发给用户，逐项确认。**未收到确认前不得提交本任务。**

要问的原话：

> 技术栈的年限按简历时间段推算如下，请逐项核对——写错的年限比不写更糟，面试官一句「这个你用了几年」就能验证：
>
> | 组 | 技术 | 年限 |
> |---|---|---|
> | 前端 | Vue 3 7 / React 19 5 / TypeScript 6 / React Native 4 / Taro 3 / Tailwind v4 2 / Next.js 16 1 | |
> | 后端 | Node.js 6 / Spring Boot 3 / Express 5 / MyBatis-Plus 3 / gRPC 2 / JWT·RBAC 3 / Quartz 2 | |
> | 数据 | MySQL 8 / Redis 5 / ELK 2 / Drizzle ORM 1 | |
> | AI | LangChain4j 1 / 大模型工具调用 1 / SSE 流式响应 1 / Prompt 工程 1 | |
> | 工程化 | WebSocket 3 / Docker Compose 3 / nginx 5 / pm2 3 / Jenkins 4 / Sentry 3 / Let's Encrypt 2 | |
>
> 哪几项要改？另外**有没有哪项你其实没在真实项目里用过**——那种应该直接删掉，不刷关键词。

按用户答复修改 `stack.ts`，重跑 Step 3 的测试，再继续。

- [ ] **Step 5: 写 `src/components/TechStack.tsx`**

```tsx
import { stack } from "@/content/stack"
import { Eyebrow, SectionTitle } from "./Magazine"

export function TechStack() {
  return (
    <section id="stack" className="px-6 py-16 md:px-12 md:py-24">
      <div className="mx-auto max-w-5xl">
        <Eyebrow>Technical Stack</Eyebrow>
        <SectionTitle>写过的每一样，都有项目背书</SectionTitle>

        <p className="mt-3 text-[11px] text-ink-faint">
          <span className="text-accent">⋆</span> = 主力技术 · 数字 = 实际使用年限
        </p>

        <dl className="mt-6">
          {stack.map((group, gi) => {
            const isLast = gi === stack.length - 1
            const border = isLast ? "border-y border-rule" : "border-t border-rule"
            return (
              <div
                key={group.key}
                className={`grid grid-cols-1 gap-x-6 gap-y-2 py-4 md:grid-cols-[6rem_1fr] ${border}`}
              >
                <dt className="font-mono text-[10px] font-bold uppercase tracking-[0.08em] text-accent md:pt-0.5">
                  {group.key}
                </dt>
                <dd className="flex flex-wrap gap-x-5 gap-y-2 text-sm">
                  {group.items.map((item) => (
                    <span
                      key={item.name}
                      className={
                        group.key === "AI"
                          ? "rounded-full bg-accent-wash px-2.5 py-0.5"
                          : undefined
                      }
                    >
                      <span className="font-medium text-ink">{item.name}</span>
                      <span className="ml-1.5 text-[11px] text-ink-faint">
                        {item.years}y
                        {item.primary ? <span className="ml-1 text-accent">⋆</span> : null}
                      </span>
                    </span>
                  ))}
                </dd>
              </div>
            )
          })}
        </dl>
      </div>
    </section>
  )
}
```

- [ ] **Step 6: 接入 `src/app/page.tsx`**

```tsx
import { Hero } from "@/components/Hero"
import { Timeline } from "@/components/Timeline"
import { Works } from "@/components/Works"
import { TechStack } from "@/components/TechStack"

export default function Home() {
  return (
    <main>
      <Hero />
      <Timeline />
      <Works />
      <TechStack />
    </main>
  )
}
```

- [ ] **Step 7: 构建并验证**

```bash
pnpm run build && pnpm start
```

打开 http://localhost:3001#stack ，确认：五组齐全、每组左侧是等宽大写标签、AI 组整组有浅琥珀底色、每项带 `Ny` 年限与 `⋆`。

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat(stack): 分组技术栈与使用年限"
```

---

### Task 8: 项目详情页

**Files:**
- Create: `src/app/projects/[slug]/page.tsx`
- Create: `src/components/ProjectDetail.tsx`

- [ ] **Step 1: 写 `src/components/ProjectDetail.tsx`**

五段结构统一由这个组件渲染，`[slug]` 页面只负责取数据与处理 404。

```tsx
import Link from "next/link"
import type { Project } from "@/content/projects"
import { Eyebrow } from "./Magazine"

const SECTIONS = ["背景与目标", "我的角色", "架构", "关键取舍", "结果"] as const

export function ProjectDetail({
  project,
  index,
  total,
}: {
  project: Project
  index: number
  total: number
}) {
  const d = project.detail

  return (
    <article className="px-6 py-16 md:px-12 md:py-24">
      <div className="mx-auto max-w-3xl">
        <Link
          href="/#works"
          className="font-mono text-[11px] text-ink-faint hover:text-accent"
        >
          ← 返回作品
        </Link>

        <div className="mt-5 flex flex-wrap items-baseline gap-x-4 border-b border-rule pb-3">
          <span className="font-mono text-[11px] text-accent">
            {String(index).padStart(2, "0")} / {String(total).padStart(2, "0")}
          </span>
          <h1 className="font-serif text-2xl tracking-tight text-ink">{project.name}</h1>
        </div>

        <p className="mt-5 text-sm leading-relaxed text-ink-soft">{project.tagline}</p>

        <ul className="mt-4 flex flex-wrap gap-2">
          {project.tags.map((t) => (
            <li
              key={t}
              className="rounded-full bg-accent-wash px-3 py-1 text-[11px] text-ink-soft"
            >
              {t}
            </li>
          ))}
        </ul>

        <dl className="mt-8">
          <Row label={SECTIONS[0]}>{d.background}</Row>
          <Row label={SECTIONS[1]}>{d.role}</Row>
          <Row label={SECTIONS[2]}>
            <pre className="overflow-x-auto rounded-sm border border-rule bg-surface p-4 font-mono text-[11px] leading-loose text-ink-soft">
              {d.architecture}
            </pre>
          </Row>
          <Row label={SECTIONS[3]}>
            <div className="space-y-4">
              {d.decisions.map((dec) => (
                <div key={dec.title}>
                  <h3 className="font-serif text-sm font-bold text-ink">{dec.title}</h3>
                  <p className="mt-1 text-sm leading-relaxed text-ink-soft">{dec.body}</p>
                </div>
              ))}
            </div>
          </Row>
          <Row label={SECTIONS[4]} last>
            {d.outcome}
          </Row>
        </dl>
      </div>
    </article>
  )
}

function Row({
  label,
  children,
  last,
}: {
  label: string
  children: React.ReactNode
  last?: boolean
}) {
  return (
    <div
      className={`grid grid-cols-1 gap-x-6 gap-y-2 py-5 md:grid-cols-[6rem_1fr] ${
        last ? "" : "border-b border-rule-soft"
      }`}
    >
      <dt className="font-mono text-[10px] font-bold uppercase tracking-[0.06em] text-accent md:pt-0.5">
        {label}
      </dt>
      <dd className="text-sm leading-relaxed text-ink-soft">{children}</dd>
    </div>
  )
}
```

- [ ] **Step 2: 写 `src/app/projects/[slug]/page.tsx`**

用 `dynamicParams = false` + `generateStaticParams` 让未知 slug 直接 404，而不是运行时才报错。

```tsx
import { notFound } from "next/navigation"
import { projects } from "@/content/projects"
import { ProjectDetail } from "@/components/ProjectDetail"

export const dynamicParams = false

export function generateStaticParams() {
  return projects.map((p) => ({ slug: p.slug }))
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params
  const project = projects.find((p) => p.slug === slug)
  if (!project) return {}
  return {
    title: `${project.name} · 陈应帅`,
    description: project.tagline,
  }
}

export default async function ProjectPage({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params
  const index = projects.findIndex((p) => p.slug === slug)
  if (index === -1) notFound()

  return (
    <main>
      <ProjectDetail
        project={projects[index]}
        index={index + 1}
        total={projects.length}
      />
    </main>
  )
}
```

> Next.js 16 的 `params` 是 **Promise**，必须 `await`。写成同步取值会得到 `undefined` 并在构建期报类型错误。

- [ ] **Step 3: 构建并验证两条详情页都生成**

```bash
pnpm run build
ls .next/server/app/projects/
```

Expected: 输出包含 `otest` 与 `typenow` 两个目录。

```bash
pnpm start
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:3001/projects/otest
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:3001/projects/typenow
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:3001/projects/nonexistent
```

Expected: `200`、`200`、`404`。

- [ ] **Step 4: 验证五段都渲染出来**

```bash
curl -s http://127.0.0.1:3001/projects/otest \
  | grep -oE "背景与目标|我的角色|架构|关键取舍|结果" | sort -u
```

Expected: 五行，五段齐全。

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(projects): 项目详情页五段结构"
```

---

### Task 9: SEO、站点地图与响应式收尾

**Files:**
- Create: `src/app/sitemap.ts`
- Create: `src/app/robots.ts`
- Modify: `src/app/layout.tsx`

- [ ] **Step 1: 写 `src/app/sitemap.ts`**

```ts
import type { MetadataRoute } from "next"
import { projects } from "@/content/projects"

const BASE = "https://dev.typenow.cn"

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    {
      url: BASE,
      lastModified: new Date(),
      changeFrequency: "monthly",
      priority: 1,
    },
    ...projects.map((p) => ({
      url: `${BASE}/projects/${p.slug}`,
      lastModified: new Date(),
      changeFrequency: "monthly" as const,
      priority: 0.8,
    })),
  ]
}
```

- [ ] **Step 2: 写 `src/app/robots.ts`**

```ts
import type { MetadataRoute } from "next"

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      // 简历 PDF 若放上去，不希望被搜索引擎收录（详情仍可被爬走，见设计文档 §7 未决）
      disallow: ["/resume.pdf"],
    },
    sitemap: "https://dev.typenow.cn/sitemap.xml",
  }
}
```

- [ ] **Step 3: 验证生成**

```bash
pnpm run build && pnpm start
curl -s http://127.0.0.1:3001/sitemap.xml | grep -c "<url>"
curl -s http://127.0.0.1:3001/robots.txt
```

Expected: `<url>` 出现 3 次；robots.txt 含 `Disallow: /resume.pdf` 与 `Sitemap:` 行。

- [ ] **Step 4: 响应式自查（390px）**

浏览器开发者工具切到 iPhone 14 宽度（390px），逐项确认：

- 首屏四个数字变成 2×2 而非挤成一行
- 时间线年份列不被压扁，描述正常换行
- 作品卡从左右布局变成上下堆叠
- 技术栈每组从两列变成上下排列
- 详情页的 `架构` 代码块横向可滚动，不溢出页面

发现溢出时，用 `overflow-x-auto` 包住该块，不要靠缩小字号解决。

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(seo): sitemap 与 robots，响应式收尾"
```

---

### Task 10: 部署到服务器（nginx + 证书 + pm2 + deploy.sh）

**风险最高的一步。** 现有 `typenow.cn` 必须全程不受影响。

**Files:**
- Create: `dev-typenow/deploy.sh`
- Create（服务器）: `/etc/nginx/conf.d/dev-typenow.conf`

- [ ] **Step 0: 【前置】确认 `dev.typenow.cn` 的 DNS 已解析到本机**

设计文档 §7 把「DNS 是否已配置」列为未决项。**这一步不通过，后面全部无法验证**——
证书 ACME 校验走 HTTP 回源，DNS 没解析就连不上，certbot 必然失败。

```bash
dig +short dev.typenow.cn
dig +short typenow.cn
```

Expected: 第一条输出 **`116.62.228.244`**（与第二条相同）。

- **若 `dev.typenow.cn` 无输出**：到域名控制台加一条 A 记录
  （主机记录 `dev`、记录值 `116.62.228.244`），等 TTL 生效后再继续。
- **若输出别的 IP**：说明解析到了别处，先查清再动，否则证书签发会失败。

- [ ] **Step 1: 侦察现有证书的续签方式（不要猜）**

证书续签方式决定了该怎么加 `dev.typenow.cn`。先读现有配置：

```bash
ssh root@typenow.cn 'cat /etc/letsencrypt/renewal/typenow.cn.conf'
```

Expected: 输出含 `authenticator = XXX` 与 `installer = XXX`。记下这两个值。

- `authenticator = nginx` → 用 `certbot --nginx --expand -d ...`，它会自动改 nginx 配置（**它会碰 `typenow.conf`，见下一步警告**）
- `authenticator = webroot` → 用 `certbot certonly --webroot -w <webroot> --expand -d ...`

**若 `authenticator = nginx`：** certbot 的 nginx 插件会重写它管理的 server 块。`typenow.conf` 本身有括号嵌套 bug，被自动改写可能失败或弄坏老站。这种情况下改用 `certonly --webroot`，并在 nginx 里手工维护证书路径（证书文件路径不变，只是多一个 SAN）。

- [ ] **Step 2: 【硬约束】先把现有配置备份，并确认它的 bug 不被触碰**

```bash
ssh root@typenow.cn 'cp -a /etc/nginx/conf.d/typenow.conf /root/typenow.conf.bak-$(date +%Y%m%d) && ls -la /root/typenow.conf.bak-*'
```

Expected: 列出刚创建的备份文件。

**`/etc/nginx/conf.d/typenow.conf` 已知有 bug**：`location /webhook` 嵌套在 `location /` 内部、括号层级错乱。**本次不动它。** 新站另开配置文件。

- [ ] **Step 3: 写服务器的 `/etc/nginx/conf.d/dev-typenow.conf`**

> ⚠️ nginx 版本是 **1.14.1**。**不要写 `http2 on;`**（需 1.25.1+），必须用 `listen 443 ssl http2;`。

```bash
ssh root@typenow.cn 'cat > /etc/nginx/conf.d/dev-typenow.conf' <<'NGINX'
server {
    listen 80;
    server_name dev.typenow.cn;

    # ACME 校验走本地目录，不反代到应用（certbot webroot 模式需要）
    location /.well-known/acme-challenge/ {
        root /var/www/certbot;
    }

    location / {
        return 301 https://$host$request_uri;
    }
}

server {
    listen 443 ssl http2;
    server_name dev.typenow.cn;

    ssl_certificate     /etc/letsencrypt/live/typenow.cn/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/typenow.cn/privkey.pem;
    ssl_protocols       TLSv1.2 TLSv1.3;
    ssl_ciphers         HIGH:!aNULL:!MD5;

    location / {
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
NGINX
ssh root@typenow.cn 'mkdir -p /var/www/certbot'
```

- [ ] **Step 4: 为证书追加 `dev.typenow.cn`（不改动老域名）**

```bash
ssh root@typenow.cn 'certbot certonly --webroot -w /var/www/certbot \
  --cert-name typenow.cn \
  -d typenow.cn -d www.typenow.cn -d dev.typenow.cn \
  --expand --non-interactive --agree-tos'
```

Expected: 输出 `Successfully received certificate`，并提示新证书路径。

关键：`--expand` + 同一 `--cert-name typenow.cn` 表示**在同一张证书上追加 SAN**，不是新签一张。老域名继续有效。

- [ ] **Step 5: 验证证书含三个域名，且 nginx 配置无误**

```bash
ssh root@typenow.cn 'openssl x509 -in /etc/letsencrypt/live/typenow.cn/cert.pem -noout -text | grep -A1 "Subject Alternative Name"'
ssh root@typenow.cn 'nginx -t'
```

Expected: SAN 行含 `DNS:typenow.cn, DNS:www.typenow.cn, DNS:dev.typenow.cn`；`nginx -t` 输出 `syntax is ok` 与 `test is successful`。

**若 `nginx -t` 失败**：删掉新配置再 reload，老站不受影响：

```bash
ssh root@typenow.cn 'rm /etc/nginx/conf.d/dev-typenow.conf && nginx -t'
```

- [ ] **Step 6: 让服务器能拉到新仓库，并建目录**

先确认服务器上有该仓库的部署密钥（TypeNow 能拉说明 GitHub 访问是通的）：

```bash
ssh root@typenow.cn 'sudo -u admin -H git ls-remote git@github.com:EricChan-dev/dev-typenow.git HEAD'
```

Expected: 输出一行 `<sha>\tHEAD`。

- 若报 `Permission denied (publickey)`：新仓库需要授权。用 `admin` 用户已有的 deploy key 或把仓库设为 public。
- 若仓库是 public，直接 `git clone https://github.com/EricChan-dev/dev-typenow.git` 亦可。

```bash
ssh root@typenow.cn 'su - admin -c "git clone git@github.com:EricChan-dev/dev-typenow.git /home/admin/dev-typenow"'
```

Expected: `Cloning into '/home/admin/dev-typenow'...`

- [ ] **Step 7: 写 `deploy.sh`**

直接放进新仓库根目录，提交后服务器上就有了。参照 `/home/admin/TypeNow/deploy.sh`：保留 flock 串行化、拉取重试、staging 原子切换、`CI=true`；去掉 crontab 部分（本仓库没有定时任务）。

```bash
#!/bin/bash
set -eo pipefail

# ─────────────────────────────────────────────────────────────
# 必须再以 admin 身份运行。线上应用跑在 admin 的 pm2 空间
# （/home/admin/.pm2）。以 root 跑会操作 root 自己的空空间，
# `pm2 restart dev-typenow` 看似成功却没碰到真实进程。
# 正确用法：su - admin -c '/home/admin/dev-typenow/deploy.sh'
# ─────────────────────────────────────────────────────────────
EXPECTED_USER="admin"
if [ "$(whoami)" != "$EXPECTED_USER" ]; then
  echo "错误：必须以 $EXPECTED_USER 身份运行（当前为 $(whoami)）。" >&2
  echo "正确用法：su - $EXPECTED_USER -c '$0'" >&2
  exit 1
fi

# 与 TypeNow 用不同的锁文件：两个站可以并行部署互不阻塞
LOCK_FILE="/tmp/dev-typenow-deploy.lock"
exec 200>"$LOCK_FILE"
if ! flock -w 900 200; then
  echo "错误：等待其他部署超时（超过 15 分钟），本次取消。" >&2
  exit 1
fi

PROJECT_DIR="/home/admin/dev-typenow"
LOG_FILE="$PROJECT_DIR/deploy.log"

log() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" | tee -a "$LOG_FILE"
}

cd "$PROJECT_DIR"
log "=== 开始部署 ==="

# 拉取带重试：webhook 只触发一次且无补偿，一次网络抖动就静默漏掉一次发布
PULL_DONE=0
for attempt in 1 2 3 4 5; do
  if git pull --ff-only origin main 2>&1 | tee -a "$LOG_FILE"; then
    PULL_DONE=1
    break
  fi
  log "第 ${attempt} 次拉取失败，$((attempt * 15)) 秒后重试..."
  sleep $((attempt * 15))
done
if [ "$PULL_DONE" != "1" ]; then
  log "错误：连续 5 次拉取均失败，本次部署取消（线上维持原版本）"
  exit 1
fi
log "已同步到：$(git log -1 --format='%h %ci %s')"

# CI=true：非交互环境下 pnpm 会因缺 TTY 中止清空 node_modules
log "安装依赖..."
CI=true pnpm install --frozen-lockfile 2>&1 | tee -a "$LOG_FILE"

# ─────────────────────────────────────────────────────────────
# 构建到暂存目录，成功后再原子替换 .next。
# 直接 next build 是就地覆写的：构建中途失败会留下写坏一半的产物，
# 用户请求到未加载的 chunk 就 404，失败从「发布没生效」升级成「线上报错」。
# 暂存目录用固定名：带 PID 会让 next build 往 tsconfig.json 塞不同路径，
# 工作区变脏后 git pull 可能失败。同一时刻只有一个部署（上面有 flock）。
# ─────────────────────────────────────────────────────────────
log "构建项目..."
rm -rf .next-staging
STAGING_DIR=".next-staging"

if ! pnpm run build 2>&1 | tee -a "$LOG_FILE"; then
  log "错误：构建失败，本次部署取消。线上 .next 未被触碰。"
  rm -rf "$STAGING_DIR"
  exit 1
fi

if [ ! -f "$STAGING_DIR/BUILD_ID" ] || [ ! -d "$STAGING_DIR/server" ]; then
  log "错误：构建产物不完整，本次部署取消。线上 .next 未被触碰。"
  rm -rf "$STAGING_DIR"
  exit 1
fi

if ! pm2 describe dev-typenow > /dev/null 2>&1; then
  log "错误：当前用户（$(whoami)）的 pm2 中不存在 dev-typenow 进程，已中止"
  rm -rf "$STAGING_DIR"
  exit 1
fi

log "替换构建产物：$STAGING_DIR → .next（上一版保留为 .next-prev）"
rm -rf .next-prev
# 写成 if 而不是 `[ -e .next ] && mv ...`：后者在 .next 不存在时返回 1，
# 在 set -e 下会直接终止脚本
if [ -e .next ]; then
  mv .next .next-prev
fi
mv "$STAGING_DIR" .next

log "重启 PM2..."
pm2 restart dev-typenow 2>&1 | tee -a "$LOG_FILE"

log "=== 部署完成 ==="
```

- [ ] **Step 8: 服务器上补一份 `pnpm-lock.yaml` 前置检查**

`--frozen-lockfile` 要求锁文件已提交。在本地先确认：

```bash
ls pnpm-lock.yaml && git ls-files --error-unmatch pnpm-lock.yaml
```

Expected: 两行都有输出（第二行打印 `pnpm-lock.yaml`）。若第二步报 not in index，先 `git add pnpm-lock.yaml`。

- [ ] **Step 9: 首次以 admin 启动 pm2 进程**

```bash
ssh root@typenow.cn 'su - admin -c "cd /home/admin/dev-typenow && CI=true pnpm install --frozen-lockfile && pnpm run build"'
ssh root@typenow.cn 'su - admin -c "cd /home/admin/dev-typenow && pm2 start pnpm --name dev-typenow -- start"'
ssh root@typenow.cn 'su - admin -c "pm2 save"'
```

> `package.json` 的 `start` 已经是 `next start -H 127.0.0.1 -p 3001`，
> 所以这里不传端口参数。**这是端口不撞车的关键。**

- [ ] **Step 10: 【必须实测】内存表现**

```bash
ssh root@typenow.cn 'free -m; echo "---"; su - admin -c "pm2 list"'
```

Expected: `dev-typenow` 显示 `online`；`free -m` 的 `available` 仍在 1000MB 以上，Swap 使用量相比部署前**没有显著上升**。

**已知风险**：部署前 Swap 已用 1410MB / 2047MB，内存压力已存在。若 `available` 掉到 300MB 以下或 Swap 逼近满值，立即回滚（见 Step 14），并考虑把新站改为静态托管。

- [ ] **Step 11: 部署脚本就位并首次运行**

```bash
ssh root@typenow.cn 'su - admin -c "chmod +x /home/admin/dev-typenow/deploy.sh"'
ssh root@typenow.cn 'su - admin -c "/home/admin/dev-typenow/deploy.sh"'
```

Expected: 日志依次打印 `=== 开始部署 ===`、`已同步到：...`、`=== 部署完成 ===`。

- [ ] **Step 12: 端到端验证，并确认老站没被弄坏**

```bash
curl -sI https://dev.typenow.cn | head -1
curl -sI https://typenow.cn | head -1
curl -sI https://www.typenow.cn | head -1
echo | openssl s_client -connect dev.typenow.cn:443 -servername dev.typenow.cn 2>/dev/null \
  | openssl x509 -noout -text | grep -A1 "Subject Alternative Name"
```

Expected:
- `dev.typenow.cn` → `HTTP/2 200`
- `typenow.cn` → `HTTP/2 200`（**老站必须仍然 200**）
- `www.typenow.cn` → `HTTP/2 200`
- SAN 含三个域名

再验隐私：

```bash
FULL_PHONE=$(node -e 'process.stdout.write(["166","3448","2010"].join(""))')
curl -s https://dev.typenow.cn/ | grep -c "$FULL_PHONE" || echo "✅ 公网 HTML 中无明文号码"
```

Expected: `✅ 公网 HTML 中无明文号码`

- [ ] **Step 13: 配置自动部署（可选，与老站一致的 webhook 方式）**

查看老站 webhook 如何配置，再为新仓库加一份：

```bash
ssh root@typenow.cn 'cat /home/admin/webhook* 2>/dev/null | head -40; su - admin -c "pm2 describe webhook" | grep -E "script path|exec cwd"'
```

按其模式为 `dev-typenow` 增加触发规则（GitHub 仓库 → Settings → Webhooks 指向同一地址，或用已有 webhook 的仓库列表配置）。

**若 webhook 配置复杂或不确定**，可先跳过——手工执行 Step 11 的 `deploy.sh` 同样能发布，自动部署是增量优化。

- [ ] **Step 14: 回滚预案（仅在上线异常时执行）**

```bash
ssh root@typenow.cn 'su - admin -c "pm2 delete dev-typenow"'
ssh root@typenow.cn 'rm /etc/nginx/conf.d/dev-typenow.conf && nginx -t && nginx -s reload'
```

回滚后 `dev.typenow.cn` 不再解析到任何服务，`typenow.cn` 与 `www.typenow.cn` **全程未受影响**（证书是追加 SAN，老域名继续有效）。

- [ ] **Step 15: Commit**

```bash
git add deploy.sh
git commit -m "feat(deploy): 部署脚本（flock 串行化 + staging 原子切换）"
git push origin main
```

---

### Task 11: 全量验证收尾

**Files:**
- Modify: `docs/`（若新仓库需要 README）

- [ ] **Step 1: 本地全量验证**

```bash
pnpm test
npx tsc --noEmit
pnpm run lint
pnpm run build
```

Expected: `pnpm test` 全绿（`lib/contact.test.ts` 3 + `components/contact-privacy.test.tsx` 3 + `content/content.test.ts` 14 + `content/projects.test.ts` 5 = 25 条）；`tsc --noEmit` 无输出；`lint` 无 error；`build` 成功。

- [ ] **Step 2: 逐个跑一遍设计文档 §5.1 的内容层验证**

```bash
pnpm start
```

| 检查项 | 命令 | 期望 |
|---|---|---|
| 源码无明文号码 | 从碎片拼出真值后 `grep -rn "$FULL_PHONE" src/` | **无输出**（零例外） |
| 构建产物无明文号码 | `grep -rn "$FULL_PHONE" .next/static .next/server/app` | **无输出** |
| 时间线五节点 | 打开 `/#journey` 肉眼数 | 5 个 |
| 详情页五段 | 打开 `/projects/otest` | 背景/角色/架构/取舍/结果 齐全 |
| 取舍条数 | 数 `/projects/otest` 的取舍段 | ≥ 4 条 |

- [ ] **Step 3: 写新仓库的 README**

```markdown
# dev-typenow

陈应帅的个人作品集站，部署在 https://dev.typenow.cn 。

## 本地开发

```bash
pnpm install
pnpm dev          # http://localhost:3001
```

## 测试

```bash
pnpm test         # 内容守卫 + 联系方式拼接
```

## 部署

```bash
su - admin -c '/home/admin/dev-typenow/deploy.sh'
```

必须在 **admin** 用户下运行——pm2 空间属于 admin，
以 root 执行会操作到空的 pm2 空间。

## 内容维护

所有文案在 `src/content/` 下的类型化常量里，改文案不需要碰组件：

- `profile.ts` — 姓名、定位句、首屏四个数字
- `journey.ts` — 心路历程五个节点
- `projects.ts` — 两个重点项目与三条次要经历
- `stack.ts` — 技术栈五组
- `contact.ts` — 联系方式碎片（**改这里要留意隐私守卫测试**）

修改后跑 `pnpm test`——内容守卫会拦住漏字段、年限越界、取舍没写代价这类错误。
```

- [ ] **Step 4: 提交并推送**

```bash
git add -A
git commit -m "docs: README"
git push origin main
```

- [ ] **Step 5: 上线后隔一天复查一次内存**

Swap 压力是这次部署唯一的真实风险，且它在刚启动时看不出来：

```bash
ssh root@typenow.cn 'free -m; uptime; su - admin -c "pm2 list"'
```

Expected: `dev-typenow` 仍 online，重启次数（`↺`）不增长，`available` 稳定。

---

## 实施前必须确认的三件事

1. **技术栈年限**（Task 7 Step 4，阻断步骤）——估算值必须由用户逐项核准。写错的年限比不写更糟。
2. **otest 涉密边界**——Task 6 里 otest 的架构描述包含「Java 设备 Agent」「scrcpy/minicap/WDA」等实现细节。**这些来自简历，但简历是投递材料、作品集站是公开页面**。实施前需用户确认哪些能公开；若有疑问，把架构段简化为「四端架构 + WebSocket 实时链路」，删掉具体工具名。
3. **是否放 PDF 简历**——首屏有「下载 PDF 简历」按钮，但 PDF 里含明文手机号，等于绕过「点击才显示」的隐私保护。三选一：
   - 放（`public/resume.pdf`）——方便 HR，但号码实际公开了
   - 换成脱敏版 PDF（遮掉手机号）——推荐
   - 去掉这个按钮

   **未确认前，Task 4 里的按钮先保留但 `public/resume.pdf` 不放文件**（点击 404 比泄漏好）。

---

## 回滚

- **代码级**：新仓库与老仓库完全独立，`git revert` 或直接不部署即可。
- **部署级**：`pm2 delete dev-typenow` + `rm /etc/nginx/conf.d/dev-typenow.conf` + `nginx -s reload`。
- **证书**：`--expand` 是追加 SAN，老域名不受影响。如需彻底回退，用同一 `--cert-name typenow.cn` 重新 `certonly` 只含 `typenow.cn` 与 `www.typenow.cn` 即可。
- **老站零风险**：`/etc/nginx/conf.d/typenow.conf` 全程不被修改（有备份在 `/root/typenow.conf.bak-*`）。

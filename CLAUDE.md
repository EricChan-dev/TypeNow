@AGENTS.md

# TypeNow · 码上英语

AI 驱动的中译英打字练习平台。Next.js 16 + React 19 + Tailwind CSS v4 + Supabase。

## 技术栈

| 类别 | 技术 |
|------|------|
| 框架 | Next.js 16 (App Router, 含 breaking changes) |
| UI | React 19 + Tailwind CSS v4 + `next-themes` |
| 组件库 | 前台: lucide-react + sonner；后台: Ant Design + refine.dev |
| 后端 | Supabase (Auth + DB), 阿里云短信, 微信支付 |
| 监控 | Sentry + Vercel Speed Insights + 自定义埋点 |
| 工具 | clsx + tailwind-merge → `cn()` |

## 项目结构

```
src/
├── app/
│   ├── (public)/     # 公开页 (首页/定价/条款/隐私)
│   ├── home/         # 主应用页 (需登录)
│   ├── login/        # 登录页
│   ├── admin/        # 管理后台 (refine + antd)
│   ├── api/          # API 路由 (auth/payment/subscription/analytics)
│   ├── actions/      # Server Actions (auth.ts)
│   └── layout.tsx    # 根布局 (ThemeProvider + Toaster)
├── components/
│   ├── layout/       # 布局组件 (Navbar, AuthLink, ScrollToSection)
│   ├── auth/         # 登录表单 + 微信二维码
│   ├── home/         # 首页/练习相关组件
│   ├── pricing/      # 定价卡片 + FAQ
│   └── payment/      # 支付弹窗
├── lib/
│   ├── supabase/     # client.ts / server.ts / service.ts / middleware.ts
│   ├── analytics.ts  # 埋点 (track / trackClick / trackPageView ...)
│   ├── utils.ts      # cn() 工具函数
│   └── ...
└── types/index.ts    # 全局类型定义
```

## 代码规范

### 组件编写
- 客户端组件必须 `"use client"` 声明在文件第一行
- 组件按领域放在 `src/components/<domain>/`，用 named export
- Props 类型用 `interface` 定义在组件文件内，不用单独的类型文件
- 不用 React Context 做全局状态——每个组件独立调用 `createClient()` 管理自己的 auth 状态
- 避免不必要的注释，只注释 WHY 不注释 WHAT

### 样式
- 用 Tailwind 原子类，不写自定义 CSS（全局主题变量除外）
- 类名合并用 `cn()` (来自 `@/lib/utils`)，不要手动拼接或使用字符串模板
- 语义化颜色：`text-foreground` / `text-muted-foreground` / `bg-card` / `border-border` 等
- 圆角统一用 `rounded-[10px]` / `rounded-xl` / `rounded-2xl`
- 焦点样式统一走 `globals.css` 中的 `*:focus-visible` 规则
- 不用 `fixed` 定位导航栏——导航栏在正常文档流中，页面滚动到顶部即可同时看到导航栏和内容

### 类型
- TypeScript strict 模式，不跳过类型检查
- 公共类型放在 `src/types/index.ts`
- 路径别名 `@/*` → `./src/*`

### Auth 模式
- 客户端: `createClient()` from `@/lib/supabase/client` → `supabase.auth.getUser()` + `onAuthStateChange` 订阅
- 服务端: Server Actions (`getUser()` / `getSession()`) 或 middleware
- API 路由: 各自调用 `getSession()` 验证
- 登录后默认跳转 `/home`，未登录跳转 `/login`
- 开发模式下 Supabase 未配置时客户端返回 `null`，要处理这种降级情况

### 交互约定
- 页面内导航使用 `scrollIntoView({ behavior: "smooth" })` 或 `window.scrollTo({ top: 0, behavior: "smooth" })` 滚动到顶部
- 外链/跨页导航用 Next.js `<Link>` 或 `router.push()`
- 需要鉴权的按钮用 `AuthLink` 组件（未登录→/login，已登录→/home，可配置 `hideIfLoggedIn` 隐藏）
- 移动端用 `lg:` 断点切换，`sm:` 用于次要断点
- Toast 通知用 `sonner`

## 设计规范

### 主题变量 (Tailwind v4 `@theme inline`)
CSS 变量在 `globals.css` 中定义，`:root` 为暗色模式，`.light` 为浅色模式：

| 变量 | 暗色值 | 浅色值 | 用途 |
|------|--------|--------|------|
| `--background` | `#0f172a` | `#ffffff` | 页面背景 |
| `--foreground` | `#f1f5f9` | `#0f172a` | 主文字色 |
| `--primary` | `#f59e0b` | `#f59e0b` | 主色调 (amber) |
| `--muted` | `#1e293b` | `#f8fafc` | 次级背景 |
| `--border` | `#334155` | `#e2e8f0` | 边框 |
| `--card` | `#1e293b` | `#ffffff` | 卡片背景 |
| `--accent` | `#6366f1` | `#1e40af` | 强调色 (indigo/blue) |
| `--success` | `#22c55e` | `#22c55e` | 成功色 |

### 排版
- 大标题: `text-[42px] sm:text-[56px] font-extrabold tracking-tight`
- 二级标题: `text-[36px] sm:text-[42px] font-bold`
- 三级标题: `text-[32px] font-bold`
- 正文: `text-base text-muted-foreground leading-relaxed`
- 小字: `text-[13px] text-muted-foreground`
- 按钮文字: `text-base font-semibold` 或 `text-[15px] font-bold`

### 间距
- 页面横向内边距: `px-5 xl:px-20`
- Section 纵向内边距: `py-20 xl:py-24`
- 导航栏高度: `h-[72px]`

### 导航滚动
- 首页锚点包含导航栏区域，点击"首页"应滚动到页面顶部（`window.scrollTo({ top: 0 })`），而非 `#hero` 元素
- 其他锚点（`#features`, `#pricing`, `#faq`）使用 `scrollIntoView`

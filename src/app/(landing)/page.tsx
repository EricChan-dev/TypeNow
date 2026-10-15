import { Suspense } from "react"
import Link from "next/link"
import { Puzzle, Keyboard, Mic } from "lucide-react"
import { AuthLink } from "@/components/layout/AuthLink"
import { ScrollToSection } from "@/components/layout/ScrollToSection"
import { PuzzleDemoCard } from "@/components/home/PuzzleDemoCard"
import { BRAND, brandLockupWithEn } from "@/lib/brand"
import type { Metadata } from "next"

/**
 * 落地页 —— 按用户提供的对标页还原。
 *
 * ── 还原范围 ────────────────────────────────────────────────────────────────
 *
 * 结构、区块划分、字段、间距、配色、文案全部与基准实现一致；**只换四处**：
 *
 * 1. 品牌名 基准实现 → {BRAND.nameZh}
 *   2. 页面标题    → BRAND.tabTitle（格式「品牌名 - 定位语」）
 * 3. 主口号 → BRAND.slogan（基准实现首屏 H1 那句）
 *   4. Logo        → public/brand/icon.png（AI 彩色徽标去水印版）
 *
 * 页脚里的公司信息（备案号、协议链接、版权行）也换成本站的 —— 那些属于
 * 「公司相关」，不能照抄别人的主体。
 *
 * ── 为什么这个文件在 (landing) 而不是 (public) ───────────────────────────────
 *
 * 基准实现自带一整套顶栏与页脚，与本站 (public) 布局里的 Navbar/Footer 不是同一套。
 * 路由组 (public)/layout.tsx 会给组内每个页面套上 Navbar+Footer，而还原要求
 * 首页用基准实现自己的那套，所以首页单独放到 (landing) 组，只继承根布局。
 * 其余公开页（/pricing、/privacy、/terms…）仍在 (public) 组里共用站内导航。
 *
 * ── 基准实现附件缺了什么 ──────────────────────────────────────────────────────
 *
 * 附件只保存了 .html，`_files/` 目录（logo.png、jigsaw/jianpan/yuyin.png、
 * style.css、app.js）都没有跟过来。处理方式：
 * · 三张功能卡插画 → 换成等价语义的 lucide 图标（Puzzle/Keyboard/Mic）
 * · `.word-btn` 的样式 → 直接用等价的 Tailwind 类写在组件里
 * · app.js 的拼词交互 → 在 PuzzleDemoCard 里按可见行为重写
 */

export const metadata: Metadata = {
  title: BRAND.tabTitle,
  description: `${BRAND.nameZh}将枯燥的语法拆解成有趣的拼图游戏，提供单词拼图、键盘打字、AI口语纠错三种高效学习模式。无需下载，打开浏览器即可开始学习。`,
}

/** 基准实现里反复出现的绿色对勾（`w-4 h-4` 与 `w-3.5 h-3.5` 两种尺寸） */
function Tick({ className }: { className: string }) {
  return (
    <svg className={className} fill="currentColor" viewBox="0 0 20 20">
      <path
        fillRule="evenodd"
        d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
        clipRule="evenodd"
      ></path>
    </svg>
  )
}

/**
 * 首屏 H1 的两段式拆法。
 *
 * 文案取自 `BRAND.slogan`（唯一事实源），在**全角逗号**处断成两行：
 * 前半句纯黑，后半句染蓝并加手绘下划线 —— 这是基准实现的版式。
 *
 * 此前这里**硬编码**着旧口号，导致改 `BRAND.slogan` 对首屏毫无影响，
 * 两处文案各自漂移（旧句换掉后首屏仍显示旧句）。现在统一从事实源派生，
 * 改 slogan 一处即可。若将来文案没有逗号，第二段为空，
 * 首屏退化成一行纯黑文字，不会报错。
 */
const [HERO_LINE_1, HERO_LINE_2 = ""] = BRAND.slogan.split("，")

export default function LandingPage() {
  return (
    <div className="relative min-h-screen bg-slate-50 text-slate-800 selection:bg-blue-500 selection:text-white">
 {/* 背景装饰光晕。基准实现是 `fixed … -z-10`，靠 body 背景在最低层透出来；
          这里 body 背景来自主题变量，所以改成 z-0 光晕 + z-10 内容块，
 视觉结果与基准实现一致，但不会被自家背景盖掉。 */}
      <div className="pointer-events-none fixed inset-0 z-0 overflow-hidden" aria-hidden>
        <div className="absolute -top-40 left-1/2 -translate-x-1/2 w-[800px] h-[500px] bg-gradient-to-tr from-blue-100/70 via-indigo-100/50 to-amber-100/40 blur-3xl rounded-full"></div>
        <div className="absolute top-1/2 -right-40 w-[500px] h-[500px] bg-emerald-100/40 blur-3xl rounded-full"></div>
      </div>

      <div className="relative z-10">
        {/* 顶部导航栏 */}
        <header className="sticky top-0 z-50 backdrop-blur-md bg-white/80 border-b border-slate-100 transition-all">
          <div className="max-w-6xl mx-auto px-4 sm:px-6 h-20 flex items-center justify-between">
            {/* 品牌锁定标：图标 + 中文名横排。
 基准实现的 logo.png 是把「图标 + 基准实现」烘焙进一张 338×80 位图，
                所以它一行就是完整的品牌名。我们的图标（public/brand/icon.png，
                AI 彩色徽标去水印抠图版）是单图形，单独放进去就只剩图、没有名字，
 于是这里按基准实现的比例用「图标 + 真实文字」拼出同样版式：
 · 文字墨高 ≈ 图标高的 0.6（基准实现 36px 图标对应 49/80 的文字高）
 · 图标与文字间距 ≈ 图标宽的 1/3（基准实现 78→104 共 26px）
                brand/web-logo/ 里已有烘焙好的横排锁标 PNG（build-brand-lockup.py），
                但站内保持「图标 + 真实文字」：文字是活的（跟 brand.ts 走、可选中、
                不糊），锁标图留给印刷/OG 等需要整块位图的场合。 */}
            <a href="#" className="group flex items-center gap-3">
              <span className="flex items-center gap-3 transition-transform group-hover:scale-105">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/brand/icon.png" alt="" aria-hidden className="h-14 w-auto object-contain" />
                {/* 尺寸层级（m00559 用户要求）：文字只大一号，图标要比文字再大几个号 ——
 图标 h-14(56px) vs 文字 32px（m00630：m00559 的比例保持，整体再大一号）。站酷快乐体即基准实现同款
                    （见 globals.css 的 @font-face 注释，字形 IoU 0.907）；
                    font-brand 内含 400 字重锁定（该字体只有 Regular）。 */}
                <span className="font-brand text-[32px] leading-none tracking-tight text-slate-900">
                  {BRAND.lockup}
                </span>
              </span>
            </a>

            {/* 快速导航与操作 */}
            <nav className="hidden md:flex items-center gap-8 text-sm font-medium text-slate-600">
              <a href="#features" className="hover:text-blue-600 transition-colors">
                核心玩法
              </a>
              <a href="#demo" className="hover:text-blue-600 transition-colors">
                试玩演示
              </a>
              <a href="#highlights" className="hover:text-blue-600 transition-colors">
                产品特色
              </a>
            </nav>

            {/* 右侧行动按钮 */}
            <div className="flex items-center gap-3">
              <Link
                href="/login"
                className="text-sm font-semibold text-slate-600 hover:text-blue-600 px-3.5 py-2 transition-colors"
              >
                登录
              </Link>
              <AuthLink className="inline-flex items-center justify-center text-sm font-bold text-white bg-blue-600 hover:bg-blue-700 active:scale-95 px-5 py-2.5 rounded-full shadow-md shadow-blue-500/25 transition-all">
                免费开始
                <svg className="w-4 h-4 ml-1.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M13 7l5 5m0 0l-5 5m5-5H6"></path>
                </svg>
              </AuthLink>
            </div>
          </div>
        </header>

        {/* 首屏 Hero 区域 */}
        <section className="relative pt-12 pb-20 md:pt-20 md:pb-28 overflow-hidden">
          <div className="max-w-6xl mx-auto px-4 sm:px-6">
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-12 lg:gap-8 items-center">
              {/* 左侧文案与口号 */}
              <div className="lg:col-span-7 text-center lg:text-left">
                {/* 胶囊徽章 */}
                <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-blue-50 border border-blue-200/60 text-blue-700 text-xs sm:text-sm font-semibold mb-6 shadow-sm">
                  <span className="flex h-2 w-2 rounded-full bg-blue-500 animate-pulse"></span>
                  无需下载安装 · 打开浏览器即玩
                </div>

                {/* 主口号。
 行高要分两段写：基准实现用的是 Tailwind v3 编译产物，
                    `.sm\:text-5xl{line-height:1}` / `.lg\:text-6xl{line-height:1}`
                    排在基础工具类**之后**，所以 ≥640px 时它们的 line-height:1
                    会盖掉 `leading-[1.15]`；只有 <640px 才是 1.15。
                    Tailwind v4 的排序规则相反（leading-* 在字号的后面），
                    单写 leading-[1.15] 会在所有断点都生效 → h1 高 138px 而非 120px。
                    因此这里显式补一个 `sm:leading-none`。 */}
                <h1 className="text-4xl sm:text-5xl lg:text-6xl font-black text-slate-900 tracking-tight leading-[1.15] sm:leading-none mb-6">
                  {HERO_LINE_1}，<br />
                  <span className="relative inline-block text-blue-600">
                    {HERO_LINE_2}
                    {/* 创意手绘下划线 */}
                    <svg
                      className="absolute -bottom-2.5 left-0 w-full h-3 text-amber-400 -z-10"
                      viewBox="0 0 100 12"
                      preserveAspectRatio="none"
                    >
                      <path d="M0 6 Q 50 14 100 6" stroke="currentColor" strokeWidth="9" strokeLinecap="round" fill="none" opacity="0.8"></path>
                    </svg>
                  </span>
                </h1>

                {/* 简洁副标题。
 行高同样分两段：基准实现 v3 产物里 `sm:text-xl{line-height:1.75rem}`
                    位于媒体查询中、排在 `leading-relaxed` 之后，所以 ≥640px 取 28px；
                    <640px 才是 leading-relaxed 的 29.25px（18×1.625）。
                    v4 的 leading-* 排在 text-* 之后，不补 `sm:leading-7` 会一直是 32.5px。 */}
                <p className="text-lg sm:text-xl text-slate-600 font-normal leading-relaxed sm:leading-7 max-w-xl mx-auto lg:mx-0 mb-8">
                  {BRAND.nameZh}将枯燥的语法拆解成有趣的拼图游戏。每天只需 15 分钟，通过拼词、打字、开口说，轻松建立母语般的地道表达。
                </p>

                {/* 关键行动转化组 */}
                <div className="flex flex-col sm:flex-row items-center justify-center lg:justify-start gap-4 mb-8">
                  <AuthLink className="w-full sm:w-auto inline-flex items-center justify-center gap-2.5 px-8 py-4 rounded-2xl bg-blue-600 hover:bg-blue-700 text-white font-bold text-base shadow-lg shadow-blue-500/30 hover:shadow-xl hover:-translate-y-0.5 active:translate-y-0 transition-all">
                    <span>免费开始学习</span>
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M14 5l7 7m0 0l-7 7m7-7H3"></path>
                    </svg>
                  </AuthLink>
                  <a
                    href="#features"
                    className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-6 py-4 rounded-2xl bg-white hover:bg-slate-50 text-slate-700 font-bold text-base border border-slate-200/80 shadow-sm hover:shadow transition-all"
                  >
                    <span>了解核心玩法</span>
                    <svg className="w-4 h-4 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7"></path>
                    </svg>
                  </a>
                </div>

                {/* 快速特性亮点提示 */}
                <div className="flex flex-wrap items-center justify-center lg:justify-start gap-y-2 gap-x-6 text-xs sm:text-sm text-slate-500 font-medium">
                  <span className="flex items-center gap-1.5">
                    <Tick className="w-4 h-4 text-emerald-500" />
                    基础课程永久免费
                  </span>
                  <span className="flex items-center gap-1.5">
                    <Tick className="w-4 h-4 text-emerald-500" />
                    无需配置即刻上手
                  </span>
                  <span className="flex items-center gap-1.5">
                    <Tick className="w-4 h-4 text-emerald-500" />
                    全平台设备兼容
                  </span>
                </div>
              </div>

              {/* 右侧交互卡片：小拼图微演示 (可直接试玩) */}
              <div className="lg:col-span-5" id="demo">
                <PuzzleDemoCard />
              </div>
            </div>
          </div>
        </section>

        {/* 核心功能板块 (Features) */}
        <section id="features" className="py-20 bg-white border-y border-slate-100">
          <div className="max-w-6xl mx-auto px-4 sm:px-6">
            {/* 章节标题 */}
            <div className="text-center max-w-2xl mx-auto mb-16">
              <span className="text-xs font-black uppercase tracking-widest text-blue-600 bg-blue-50 px-3 py-1 rounded-full">
                Three Learning Modes
              </span>
              <h2 className="text-3xl sm:text-4xl font-black text-slate-900 mt-4 mb-4 tracking-tight">
                三种玩法，全方位攻克句法语感
              </h2>
              <p className="text-slate-600 text-base sm:text-lg">
                告别单一枯燥的死记单词。在{BRAND.nameZh}，通过多维互动输入，让你在轻松闯关中自然形成英语语感。
              </p>
            </div>

            {/* 3 大核心玩法卡片 */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
              {/* 卡片 1: 单词拼图模式 */}
              <div className="group relative bg-slate-50 hover:bg-white rounded-3xl p-8 border border-slate-100 hover:border-blue-100 hover:shadow-xl hover:-translate-y-1 transition-all duration-300">
                <div className="w-14 h-14 rounded-2xl bg-amber-400 flex items-center justify-center mb-6 shadow-md shadow-amber-400/30 border-b-4 border-amber-500 group-hover:scale-110 transition-transform">
                  <Puzzle className="w-8 h-8 text-white" aria-hidden />
                </div>
                <div className="text-xs font-black tracking-wider text-amber-600 uppercase mb-2">
                  逻辑构建 · 像搭积木
                </div>
                <h3 className="text-xl font-bold text-slate-900 mb-3">单词拼图模式</h3>
                <p className="text-slate-600 text-sm leading-relaxed mb-6">
                  像拼积木一样学语法。通过拖拽打乱的单词卡片，直观感受句子的结构与成分逻辑，彻底告别枯燥难懂的语法规则。
                </p>
                <div className="flex flex-wrap gap-2 pt-4 border-t border-slate-200/60 text-xs font-medium text-slate-500">
                  <span className="bg-white px-2.5 py-1 rounded-lg border border-slate-200/80">直观语序</span>
                  <span className="bg-white px-2.5 py-1 rounded-lg border border-slate-200/80">积木造句</span>
                  <span className="bg-white px-2.5 py-1 rounded-lg border border-slate-200/80">趣味闯关</span>
                </div>
              </div>

              {/* 卡片 2: 键盘打字模式 */}
              <div className="group relative bg-slate-50 hover:bg-white rounded-3xl p-8 border border-slate-100 hover:border-blue-100 hover:shadow-xl hover:-translate-y-1 transition-all duration-300">
                <div className="w-14 h-14 rounded-2xl bg-blue-500 flex items-center justify-center mb-6 shadow-md shadow-blue-500/30 border-b-4 border-blue-600 group-hover:scale-110 transition-transform">
                  <Keyboard className="w-8 h-8 text-white" aria-hidden />
                </div>
                <div className="text-xs font-black tracking-wider text-blue-600 uppercase mb-2">
                  肌肉记忆 · 拼写强化
                </div>
                <h3 className="text-xl font-bold text-slate-900 mb-3">键盘打字模式</h3>
                <p className="text-slate-600 text-sm leading-relaxed mb-6">
                  不仅仅是练习拼写，更是肌肉记忆的深度建立。通过指尖敲击完整句子，确保每一个单词拼写与标点符号都准确无误。
                </p>
                <div className="flex flex-wrap gap-2 pt-4 border-t border-slate-200/60 text-xs font-medium text-slate-500">
                  <span className="bg-white px-2.5 py-1 rounded-lg border border-slate-200/80">强化拼写</span>
                  <span className="bg-white px-2.5 py-1 rounded-lg border border-slate-200/80">肌肉记忆</span>
                  <span className="bg-white px-2.5 py-1 rounded-lg border border-slate-200/80">盲打提速</span>
                </div>
              </div>

              {/* 卡片 3: AI 口语与语音 */}
              <div className="group relative bg-slate-50 hover:bg-white rounded-3xl p-8 border border-slate-100 hover:border-blue-100 hover:shadow-xl hover:-translate-y-1 transition-all duration-300">
                <div className="w-14 h-14 rounded-2xl bg-emerald-500 flex items-center justify-center mb-6 shadow-md shadow-emerald-500/30 border-b-4 border-emerald-600 group-hover:scale-110 transition-transform">
                  <Mic className="w-8 h-8 text-white" aria-hidden />
                </div>
                <div className="text-xs font-black tracking-wider text-emerald-600 uppercase mb-2">
                  自信开口 · 智能纠错
                </div>
                <h3 className="text-xl font-bold text-slate-900 mb-3">语音口语模式</h3>
                <p className="text-slate-600 text-sm leading-relaxed mb-6">
                  大胆开口脱口而出！依托先进的 AI 语音识别与语法分析技术，实时评估发音与时态准确度，让你告别“哑巴英语”。
                </p>
                <div className="flex flex-wrap gap-2 pt-4 border-t border-slate-200/60 text-xs font-medium text-slate-500">
                  <span className="bg-white px-2.5 py-1 rounded-lg border border-slate-200/80">实时评分</span>
                  <span className="bg-white px-2.5 py-1 rounded-lg border border-slate-200/80">时态纠错</span>
                  <span className="bg-white px-2.5 py-1 rounded-lg border border-slate-200/80">母语语感</span>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* 亮点特色数据栏 (Highlights) */}
        <section id="highlights" className="py-16 bg-slate-50">
          <div className="max-w-6xl mx-auto px-4 sm:px-6">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-6 text-center">
              <div className="bg-white rounded-2xl p-6 border border-slate-100 shadow-sm">
                <div className="text-3xl font-black text-amber-500 mb-1">15w+</div>
                <div className="text-sm font-bold text-slate-800">高频真实语境词条</div>
              </div>

              <div className="bg-white rounded-2xl p-6 border border-slate-100 shadow-sm">
                <div className="text-3xl font-black text-blue-600 mb-1">150+</div>
                <div className="text-sm font-bold text-slate-800">精选实用单词本</div>
              </div>

              <div className="bg-white rounded-2xl p-6 border border-slate-100 shadow-sm">
                <div className="text-3xl font-black text-emerald-500 mb-1">AI 伴学</div>
                <div className="text-sm font-bold text-slate-800">艾宾浩斯智能复习</div>
              </div>

              <div className="bg-white rounded-2xl p-6 border border-slate-100 shadow-sm">
                <div className="text-3xl font-black text-purple-600 mb-1">0 门槛</div>
                <div className="text-sm font-bold text-slate-800">免安装即刻开练</div>
              </div>
            </div>
          </div>
        </section>

        {/* 底部号召行动区域 (开阔通透极简风格) */}
        <section className="relative py-24 bg-gradient-to-b from-white via-blue-50/30 to-slate-50 overflow-hidden border-t border-slate-100">
          {/* 柔和背景微光晕 */}
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[300px] bg-gradient-to-tr from-blue-200/25 to-indigo-100/25 blur-3xl rounded-full pointer-events-none z-0"></div>

          <div className="relative z-10 max-w-3xl mx-auto px-4 sm:px-6 text-center">
            {/* Logo 徽章（public/brand/icon.png，AI 彩色徽标去水印版） */}
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-3xl bg-white shadow-xl shadow-blue-500/10 border border-slate-100 mb-6 p-3 group hover:scale-105 transition-transform">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/brand/icon.png" alt={BRAND.nameZh} className="w-full h-full object-contain" />
            </div>

            {/* 核心标题 */}
            <h2 className="text-3xl sm:text-4xl lg:text-5xl font-black text-slate-900 tracking-tight mb-4">
              准备好开始你的英语游戏了吗？
            </h2>

 {/* 舒适副标题。与首屏那段同理：基准实现 ≥640px 走 `sm:text-lg` 的
                28px 行高，v4 需要显式 `sm:leading-7` 才能压过 leading-relaxed。 */}
            <p className="text-slate-600 text-base sm:text-lg max-w-xl mx-auto mb-8 font-normal leading-relaxed sm:leading-7">
              加入我们，无需下载安装，打开网页即刻开启练习。<br className="hidden sm:inline" />每天 15 分钟，体验在游戏中轻松掌握地道英语的乐趣。
            </p>

            {/* 核心行动按钮 */}
            <div className="flex flex-col sm:flex-row items-center justify-center gap-4 mb-6">
              <AuthLink className="w-full sm:w-auto inline-flex items-center justify-center gap-2.5 px-9 py-4 rounded-2xl bg-blue-600 hover:bg-blue-700 active:scale-95 text-white font-bold text-base shadow-xl shadow-blue-500/25 hover:shadow-2xl hover:shadow-blue-500/35 hover:-translate-y-0.5 transition-all">
                <span>立即免费体验</span>
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M13 7l5 5m0 0l-5 5m5-5H6"></path>
                </svg>
              </AuthLink>
            </div>

            {/* 底部亮点标签 */}
            <div className="inline-flex flex-wrap items-center justify-center gap-2 sm:gap-3 text-slate-500 text-xs font-medium">
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-white border border-slate-200/60 shadow-sm">
                <Tick className="w-3.5 h-3.5 text-emerald-500" />
                基础课程永久免费
              </span>
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-white border border-slate-200/60 shadow-sm">
                <Tick className="w-3.5 h-3.5 text-emerald-500" />
                30秒免注册上手
              </span>
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-white border border-slate-200/60 shadow-sm">
                <Tick className="w-3.5 h-3.5 text-emerald-500" />
                多端全平台适配
              </span>
            </div>
          </div>
        </section>

        {/* 极简页脚 (Footer) */}
        <footer className="bg-slate-50 border-t border-slate-100 py-12 text-slate-500 text-sm">
          <div className="max-w-6xl mx-auto px-4 sm:px-6 flex flex-col md:flex-row items-center justify-between gap-6">
            {/* 品牌名与简述 */}
            <div className="flex flex-col sm:flex-row items-center gap-4 text-center sm:text-left">
              {/* 与顶栏同层级：图标 h-12(48px) vs 文字 26px（m00559 比例 + m00630 整体放大一号）。 */}
              <span className="flex items-center gap-2.5">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/brand/icon.png" alt="" aria-hidden className="h-12 w-auto object-contain" />
                <span className="font-brand text-[26px] leading-none tracking-tight text-slate-900">
                  {BRAND.lockup}
                </span>
              </span>
              <span className="text-xs text-slate-400 border-t sm:border-t-0 sm:border-l sm:pl-4 border-slate-200 pt-2 sm:pt-0">
                {BRAND.tagline}
              </span>
            </div>

            {/* 条款与链接 */}
            <div className="flex items-center gap-6 text-xs text-slate-500">
              <Link href="/terms" className="hover:text-blue-600 transition-colors">
                用户协议
              </Link>
              <Link href="/privacy" className="hover:text-blue-600 transition-colors">
                隐私政策
              </Link>
 {/* 基准实现第三个链接就是独立页面「儿童隐私」，现在本站也有独立页了
                  （/children-privacy）。此前没有单开页时指向 /privacy#minors，
                  那个锚点仍然保留在隐私政策第 7 节，不会因为改了这里就失效。 */}
              <Link
                href="/children-privacy"
                className="hover:text-blue-600 transition-colors"
              >
                儿童隐私
              </Link>
              <a
                href="https://beian.miit.gov.cn/"
                target="_blank"
                rel="noreferrer"
                className="hover:text-blue-600 transition-colors"
              >
                晋ICP备2026006473号
              </a>
            </div>
          </div>
          <div className="text-center text-xs text-slate-400 mt-6">
            © 2026 <span className="font-brand">{brandLockupWithEn()}</span>. 保留所有权利.
          </div>
        </footer>
      </div>

      <Suspense fallback={null}>
        <ScrollToSection />
      </Suspense>
    </div>
  )
}

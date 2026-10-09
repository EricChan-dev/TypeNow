"use client"

import { useState, useCallback, useEffect, useRef } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import Link from "next/link"
import { Check, Loader2 } from "lucide-react"
import { toast } from "sonner"
import { trackLoginSuccess } from "@/lib/analytics"
import { signOutAction } from "@/app/actions/auth"
import QRCode from "qrcode"
import { WeChatQRCode } from "@/components/auth/WeChatQRCode"
import { ContactModal } from "@/components/auth/ContactModal"
import {
  useAliyunCaptcha,
  type CaptchaVerifyResult,
} from "@/lib/hooks/useAliyunCaptcha"

type LoginTab = "wechat" | "phone"

/**
 * 绑定手机号模式（`/login?bind=1`）的文案。
 *
 * 微信登录建号时拿不到手机号，而手机号是唯一能把「微信注册的号」与「手机号注册的号」
 * 认成同一个人的凭据 —— 所以微信登录后必须补上（见 lib/phone-gate 的长说明）。
 *
 * 这里刻意**让登录页的「验证码登录」tab 直接承担绑定**，而不是再造一个只有
 * 绑定时才出现的 UI（用户 m03647 要的也是"登录校验"而不是全局弹窗）。
 * 用户在这个 tab 上本来就要输手机号 + 验证码，操作完全一样，不必再学一套只有
 * 绑定时才出现的 UI（用户 m03647 要的也是"登录校验"而不是全局弹窗）。
 *
 * 差别只有三处：请求打到 /api/auth/bind/phone（绑到当前账号，而不是登录/注册）、
 * 按钮文案、以及不再允许切回微信 tab（切过去只会重新扫码，绕不出绑定）。
 */
const BIND_COPY = {
  tabLocked: true,
  submit: "绑定并继续",
  hint: "微信登录成功。请绑定手机号，之后用微信或手机号都能进同一个账号。",
} as const

/**
 * 协议勾选框。
 *
 * 参考页这里是一个真拦截：未勾选点「立即登录」会弹出「服务协议与隐私政策」
 * 弹窗阻断登录，弹窗里点「同意并登录」才继续。
 *
 * 本次改造**按用户决定只还原样式，不拦截登录**（问询答复：`只还原样式，不拦截登录`）。
 * 所以这里没有任何 service 弹窗，勾选状态是本地纯展示、可点可切换。
 * 但告知义务不能因此丢掉 —— 原先底部那行「登录即表示同意」改放在参考页
 * 本来就有的 `span small` 槽位里（login.css 里定义了该槽位的样式）：
 * 既保留隐式同意的说明，也不额外新增一行版式。
 */
function FormControl({
  agreed,
  onToggle,
}: {
  agreed: boolean
  onToggle: () => void
}) {
  return (
    <div className={agreed ? "form-control on" : "form-control"}>
      <button
        type="button"
        role="checkbox"
        aria-checked={agreed}
        aria-label="我已阅读并同意用户协议、隐私政策和儿童隐私保护政策"
        onClick={onToggle}
      >
        <Check aria-hidden />
      </button>
      <span>
        我已阅读并同意
        <Link href="/terms">《用户协议》</Link>、
        <Link href="/privacy">《隐私政策》</Link>和
        <Link href="/children-privacy">《儿童隐私保护政策》</Link>
        <small>登录即表示同意上述条款。</small>
      </span>
    </div>
  )
}

const ERROR_MESSAGES: Record<string, string> = {
  invalid_callback: "微信回调参数错误，请重试",
  csrf_mismatch: "安全验证失败，请刷新页面重试",
  code_expired: "微信授权码已过期，请重新扫码",
  code_used: "微信授权码已被使用，请重新扫码",
  wechat_invalid_code: "微信授权码无效，请重新扫码",
  network_error: "微信服务连接失败，请稍后重试",
  server_error: "服务异常，请稍后重试",
  signin_failed: "登录失败，请重试",
}

export function LoginForm() {
  const router = useRouter()
  const searchParams = useSearchParams()

  /**
   * 默认登录方式按设备区分。
   *
   * 微信扫码登录的优势场景是**桌面**——手机一扫即完成。但在手机上，"扫码登录"
   * 反而更麻烦（保存二维码 → 打开微信 → 扫一扫 → 从相册选），短信才是顺手的路径。
   * 而我们的用户绝大多数来自微信、以手机为主，所以「一律默认扫码」会伤到主要人群。
   *
   * SSR 阶段不知道设备形态，因此初值仍是 phone（不会 hydration 报错），
   * 挂载后若判定为桌面再切到微信；用户手动点过 tab 就不再覆盖他的选择。
   */
  /**
   * 绑定手机号模式。
   *
   * 两个入口都会落到这里：
   *   · 服务端跳转 —— 微信回调发现这个账号没手机号，直接 302 到 /login?bind=1
   *     （见 api/auth/wechat/callback），此时 `bind` 在 URL 上；
   *   · 就地切换 —— 用户在**本页**扫码，oa-check 轮询回来说 needsBind，
   *     WeChatQRCode 回调 onNeedsBind 把状态置起来（不必整页跳一次 /login）。
   *
   * 用 state 而不是只读 searchParams，就是因为第二条路径 URL 上并没有 bind。
   * 初值从 URL 取，保证服务端跳转这一路首帧就已是绑定模式（不会闪一下微信 tab）。
   */
  const [bindMode, setBindMode] = useState(
    () => searchParams.get("bind") === "1",
  )

  const [activeTab, setActiveTab] = useState<LoginTab>("phone")
  const [tabPickedByUser, setTabPickedByUser] = useState(false)
  useEffect(() => {
    // 绑定模式必须停在「验证码登录」tab：这是用户唯一的出路，
    // 桌面端的「默认切微信」在这里会把刚扫完码的人推回二维码界面。
    if (bindMode) {
      setActiveTab("phone")
      return
    }
    if (tabPickedByUser) return
    // (hover: none) + (pointer: coarse) 是触屏主设备的通行判定
    const isTouchPrimary =
      typeof window !== "undefined" &&
      window.matchMedia?.("(hover: none) and (pointer: coarse)").matches
    if (!isTouchPrimary) setActiveTab("wechat")
  }, [tabPickedByUser, bindMode])

  const [phone, setPhone] = useState("")
  const [code, setCode] = useState("")
  const [cooldown, setCooldown] = useState(0)
  const [loading, setLoading] = useState(false)
  // 协议勾选框：纯展示，不参与登录校验（见 FormControl 的注释）
  const [agreed, setAgreed] = useState(false)
  // 联系我们弹窗（客服二维码）。此前那句「请联系客服」是指向 /privacy#contact 的
  // 死链 —— 隐私政策第 9 节并没有 id="contact"，点了只会停在政策页顶部。
  const [contactOpen, setContactOpen] = useState(false)
  const [devQrDataUrl, setDevQrDataUrl] = useState<string | null>(null)

  /**
   * 登录后的回跳目标。
   *
   * 只接受**站内路径**：`redirect` 来自 query string，是用户可控输入，
   * 直接 `router.push()` 会形成开放重定向（`?redirect=//evil.com` 这类
   * protocol-relative 写法最容易被忽略）。所以要求以单个 "/" 开头，
   * 且不能是 "//" 开头。proxy.ts 在把未登录用户送去 /login 时会带上这个参数。
   */
  const rawRedirect = searchParams.get("redirect")
  const redirectTo =
    rawRedirect && rawRedirect.startsWith("/") && !rawRedirect.startsWith("//")
      ? rawRedirect
      : "/home"

  /**
   * 绑定成功后要去的地址。
   *
   * 优先级：本页扫码（onNeedsBind 给的那个 /home?...，带 login_success 与新人引导）
   * > URL 上的 ?next=（服务端跳转时把原本要去的地址带了过来）> redirect > /home。
   *
   * `next` 与 `redirect` 同样来自 query string、同样必须做站内校验，理由见上面。
   */
  const [bindNext, setBindNext] = useState<string | null>(null)
  const rawNext = searchParams.get("next")
  const nextFromUrl =
    rawNext && rawNext.startsWith("/") && !rawNext.startsWith("//") ? rawNext : null
  const afterBind = bindNext ?? nextFromUrl ?? redirectTo

  const isDevEnv = process.env.NODE_ENV === "development"

  // Generate dev login QR code
  useEffect(() => {
    if (!isDevEnv) return
    const devLoginUrl = `${window.location.origin}/api/auth/dev-login`
    QRCode.toDataURL(devLoginUrl, { width: 160, margin: 1 }).then(setDevQrDataUrl)
  }, [isDevEnv])

  // Handle error query param from WeChat callback redirects
  useEffect(() => {
    const errorParam = searchParams.get("error")
    if (errorParam) {
      // Switch to WeChat tab so user sees the QR code to retry
      if (
        [
          "code_expired",
          "code_used",
          "wechat_invalid_code",
          "csrf_mismatch",
        ].includes(errorParam)
      ) {
        setTabPickedByUser(true)
        setActiveTab("wechat")
      }
      const message = ERROR_MESSAGES[errorParam] || "登录失败，请重试"
      toast.error(message)
    }
  }, [searchParams])

  /**
   * 发短信的**唯一**请求实现。`captchaVerifyParam` 由人机校验回调提供；
   * 未启用校验（或校验服务不可用而放行）时为空。
   */
  const sendSms = useCallback(
    async (captchaVerifyParam?: string) => {
      const trimmedPhone = phone.trim()
      try {
        const res = await fetch("/api/auth/send-sms", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            phone: trimmedPhone,
            // 只在真的拿到参数时才带上，避免给服务端塞一个空串 ——
            // 服务端把「空参数」判为**拒绝**（防绕过），空串会变成一次必然失败。
            ...(captchaVerifyParam?.trim()
              ? { captchaVerifyParam }
              : {}),
          }),
        })

        const data = await res.json()

        if (!res.ok) {
          return {
            ok: false as const,
            error: data.error || "发送验证码失败",
            // 服务端用它区分「人机验证没过」与「短信发送失败」：
            // 前者要让验证码控件刷新、请用户重试；后者人机已通过，不能刷新。
            captchaFailed: data.captchaFailed === true,
          }
        }
        return { ok: true as const, message: data.message || "验证码已发送" }
      } catch {
        return {
          ok: false as const,
          error: "发送验证码失败，请重试",
          captchaFailed: false,
        }
      }
    },
    [phone],
  )

  const cooldownTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const startCooldown = useCallback(() => {
    // **同步**先置 60，不等 setState 落地：否则用户能在 React 提交这次更新之前
    // 再点一下，于是并发发出第二条短信（服务端 60s 冷却会拦，但用户会看到一次
    // 莫名其妙的报错）。官方示例也是同步 setCountdown(60)。
    setCooldown(60)
    if (cooldownTimerRef.current) clearInterval(cooldownTimerRef.current)
    cooldownTimerRef.current = setInterval(() => {
      setCooldown((prev) => {
        if (prev <= 1) {
          if (cooldownTimerRef.current) clearInterval(cooldownTimerRef.current)
          cooldownTimerRef.current = null
          return 0
        }
        return prev - 1
      })
    }, 1000)
  }, [])

  // 组件卸载时别把定时器留着（切 tab / 跳走都会卸载）
  useEffect(() => {
    return () => {
      if (cooldownTimerRef.current) clearInterval(cooldownTimerRef.current)
    }
  }, [])

  /**
   * 人机校验通过后由 SDK 调用（见 useAliyunCaptcha 的说明）。
   * 必须**返回 Promise**；`captchaResult: false` 会让控件刷新验证码请用户重试。
   */
  const verifyCaptcha = useCallback(
    async (captchaVerifyParam: string): Promise<CaptchaVerifyResult> => {
      setLoading(true)
      try {
        const result = await sendSms(captchaVerifyParam)
        if (!result.ok) {
          // 错误提示在这里就地弹：onBizResultCallback 在“验证码没过”时会不会
          // 被调到，官方没有明确说明，不能把唯一的提示挂在那上面。
          toast.error(result.error)
          return { captchaResult: !result.captchaFailed, bizResult: false }
        }
        return { captchaResult: true, bizResult: true }
      } finally {
        setLoading(false)
      }
    },
    [sendSms],
  )

  const captcha = useAliyunCaptcha({
    // 手机 tab 未显示时不要初始化：面板 hidden 时量不出按钮位置，弹层会错位；
    // 而且 SDK 初始化要求按钮在 DOM 里。见 hook 里 enabled 的说明。
    enabled: activeTab === "phone",
    buttonId: "login-send-code",
    elementId: "login-captcha-element",
    verify: verifyCaptcha,
    onBizResult: (bizResult) => {
      // 只在成功时收尾；失败已在 verify 里提示过，这里再弹一次就重复了。
      // 这是官方示例的标准分工：verify 发业务请求，onBizResult 做 UI 反馈。
      if (!bizResult) return
      toast.success("验证码已发送")
      startCooldown()
    },
    onError: (message) => toast.error(message),
  })

  /**
   * 按钮点击。**验证码就绪时 SDK 已接管这个按钮的点击**（这正是传 button 参数的
   * 目的），此时必须直接返回，否则一次点击既弹验证码、又立刻发出一条没有验证
   * 参数的短信，被服务端拒成「人机验证无效」。
   *
   * 未启用校验（没配环境变量）时走原来的直连逻辑；校验脚本加载失败时给出明确
   * 提示 —— 直接发是没用的，服务端会因缺参拒绝（这是刻意的 fail-closed）。
   */
  const handleSendCode = useCallback(() => {
    if (captcha.status === "ready") return

    if (captcha.status === "failed") {
      toast.error("人机验证加载失败，请刷新页面后重试")
      return
    }

    const trimmedPhone = phone.trim()
    if (!trimmedPhone) {
      toast.error("请输入手机号")
      return
    }
    if (!/^1[3-9]\d{9}$/.test(trimmedPhone)) {
      toast.error("请输入有效的手机号")
      return
    }

    void (async () => {
      setLoading(true)
      try {
        const result = await sendSms()
        if (!result.ok) {
          toast.error(result.error)
          return
        }
        toast.success(result.message)
        startCooldown()
      } finally {
        setLoading(false)
      }
    })()
  }, [captcha.status, phone, sendSms, startCooldown])

  const handleLogin = useCallback(async () => {
    const trimmedPhone = phone.trim()
    const trimmedCode = code.trim()

    if (!trimmedPhone || !trimmedCode) {
      toast.error("请输入手机号和验证码")
      return
    }

    setLoading(true)
    try {
      // 绑定模式打 /api/auth/bind/phone：它把手机号绑到**当前已登录的微信账号**上，
      // 并处理"这个手机号已经有账号"的撞号（把微信身份转过去、切换会话）。
      // 普通登录打 /api/auth/verify-code：按手机号找号或注册新号。
      // 两者校验与限流口径一致，但语义完全不同 —— 打错了要么凭空多一个账号，
      // 要么把用户登进另一个号。
      const endpoint = bindMode ? "/api/auth/bind/phone" : "/api/auth/verify-code"
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: trimmedPhone, code: trimmedCode }),
      })

      const data = await res.json()

      if (!res.ok) {
        toast.error(data.error || (bindMode ? "绑定失败" : "验证码错误"))
        return
      }

      if (bindMode) {
        // switched=true：手机号原本就有账号，已把微信身份转过去并换了会话 ——
        // 用户接下来用的是那个"带历史记录"的账号，而不是刚才的空壳账号
        toast.success(
          data.switched ? "已登录你的手机号账号，并把微信绑定到它上面" : "手机号绑定成功",
        )
      } else {
        trackLoginSuccess("phone")
        toast.success("登录成功")
      }
      router.push(afterBind)
      router.refresh()
    } catch {
      toast.error(bindMode ? "绑定失败，请重试" : "登录失败，请重试")
    } finally {
      setLoading(false)
    }
  }, [phone, code, router, afterBind, bindMode])

  const pickTab = (tab: LoginTab) => {
    setTabPickedByUser(true)
    setActiveTab(tab)
  }

  return (
    <>
      {/* ── Tab Bar ──
          标签文案与顺序照搬参考页（验证码登录 / 微信登录）。
          注意：参考页的「验证码登录」就是我们的 phone tab，默认选中项由上面的
          设备判定逻辑决定，与参考页（恒为验证码）不同 —— 那是业务逻辑，保留我们的。 */}
      <div className="logintab" role="tablist" aria-label="登录方式">
        <button
          type="button"
          role="tab"
          id="login-tab-phone"
          aria-controls="login-panel-phone"
          className={activeTab === "phone" ? "on" : undefined}
          aria-selected={activeTab === "phone"}
          onClick={() => pickTab("phone")}
        >
          验证码登录
        </button>
        <button
          type="button"
          role="tab"
          id="login-tab-wechat"
          aria-controls="login-panel-wechat"
          className={activeTab === "wechat" ? "on" : undefined}
          aria-selected={activeTab === "wechat"}
          // 绑定模式下禁止切回微信 tab：切过去只会看到二维码，再扫一次也还是
          // 这个没手机号的账号，绕不出绑定。用 disabled 而不是隐藏，版式与
          // 参考页保持一致。样式在 login.css 的 [disabled] 规则里。
          disabled={bindMode}
          title={bindMode ? "请先绑定手机号" : undefined}
          onClick={() => pickTab("wechat")}
        >
          微信登录
        </button>
      </div>

      {/* 绑定模式的说明。放在 tab 下方、表单上方 —— 用户是被服务端跳过来的
          （或刚扫完码就地切过来），不解释一句会不知道自己为什么在填手机号。 */}
      {bindMode && (
        <>
          <p className="support-tip" style={{ marginBottom: 8 }}>
            {BIND_COPY.hint}
          </p>
          {/* 逃生口。
              绑定的前提是当前有微信会话（用户是"已登录"状态），而微信 tab
              又被锁住 —— 万一扫错了微信号，不给出口就会卡死在这里。
              登出后回落地页，用户可以用正确的微信号重新登录。 */}
          <p className="support-tip" style={{ marginBottom: 16 }}>
            <button
              type="button"
              onClick={async () => {
                try {
                  await signOutAction()
                } catch {
                  /* 失败也照样回首页 */
                }
                window.location.href = "/"
              }}
            >
              不是我的微信号？退出登录
            </button>
          </p>
        </>
      )}

      <div className="loginContent">
        {/* ── Phone (验证码登录) ── */}
        <div
          role="tabpanel"
          id="login-panel-phone"
          aria-labelledby="login-tab-phone"
          hidden={activeTab !== "phone"}
          className={activeTab === "phone" ? "content on" : "content"}
        >
          {/* ── 与参考页的高度差已随验证码接入消失 ─────────────────────────────
              参考页 .form 里有 5 个产生盒子的子元素：
                P(74) · support-tip(18，带 -4/-8 外边距→净 6) · P(74) ·
                div#captcha-element(0 高，但 display:block，照样吃一个 18px 的 flex gap) ·
                button.login(48)
              → 74+6+74+0+48 + 4×18(gap) = 274，实测正是 274。

              接入阿里云验证码之前，我们没有那个占位 div，只有 4 个子元素 → 256，
              比参考页矮 18px（当时是有意为之：不为对齐一个并不使用的控件补假空 div）。
              现在这个 div 是**真的**验证码挂载点，高度自然与参考页一致。

              它**无条件渲染**（不随校验是否启用增减）：既是 SDK 的挂载点，
              也避免脚本就绪前后多出一段布局跳动。未启用校验时它只是个 0 高度的
              空节点，不影响任何交互。
              ────────────────────────────────────────────────────────────── */}
          <div className="form">
            <p>
              <label>
                手机号码
                <small className="phone-auto-register-tip">
                  {bindMode
                    ? "用于把微信账号与手机号绑定"
                    : "未注册的手机号登录将自动注册"}
                </small>
              </label>
              <span>+86</span>
              <input
                type="tel"
                value={phone}
                onChange={(e) =>
                  setPhone(e.target.value.replace(/\D/g, "").slice(0, 11))
                }
                placeholder="请输入手机号"
                maxLength={11}
                /* +86 前缀span绝对定位在左侧，输入内容必须让位，否则会盖住 */
                style={{ paddingLeft: 75 }}
              />
            </p>

            <div className="support-tip">
              如果登录遇到问题
              {/* 用 button 而不是 Link：这里不再跳转到政策页锚点，而是就地打开
                  客服二维码弹窗（原 /privacy#contact 是死锚点，见组件顶部注释）。 */}
              <button type="button" onClick={() => setContactOpen(true)}>
                请联系客服
              </button>
            </div>

            <p>
              <label>验证码</label>
              <input
                type="text"
                value={code}
                onChange={(e) =>
                  setCode(e.target.value.replace(/\D/g, "").slice(0, 6))
                }
                placeholder="请输入验证码"
                maxLength={6}
              />
              <button
                id="login-send-code"
                type="button"
                onClick={handleSendCode}
                disabled={
                  cooldown > 0 ||
                  loading ||
                  captcha.status === "loading" ||
                  captcha.status === "failed"
                }
              >
                {cooldown > 0
                  ? `${cooldown}s`
                  : captcha.status === "loading"
                    ? "加载中…"
                    : "获取验证码"}
              </button>
            </p>

            {/* 人机校验挂载点（阿里云验证码 2.0）。
                popup 模式下它只是个 0 高度占位节点，验证浮层由 SDK 插到 body 上。
                位置与参考页一致：放在「验证码」行之后、「立即登录」之前 ——
                参考页那个 div#captcha-element 同样占一个 flex gap，见上方注释。 */}
            <div id="login-captcha-element" />

            <button
              type="button"
              className="login"
              onClick={handleLogin}
              disabled={loading}
            >
              {loading && (
                <Loader2
                  aria-hidden
                  className="mr-2 inline-block h-4 w-4 animate-spin align-[-2px]"
                />
              )}
              {bindMode ? BIND_COPY.submit : "立即登录"}
            </button>
          </div>

          {/* 参考页里 .form-control 是 .content 的直接子元素、.form 的兄弟
              （已用 HTML 解析器核验祖先链，不是靠看缩进）。 */}
          <FormControl agreed={agreed} onToggle={() => setAgreed((v) => !v)} />
        </div>

        {/* ── WeChat (微信登录) ── */}
        <div
          role="tabpanel"
          id="login-panel-wechat"
          aria-labelledby="login-tab-wechat"
          hidden={activeTab !== "wechat"}
          className={activeTab === "wechat" ? "content code on" : "content code"}
        >
          <WeChatQRCode
            active={activeTab === "wechat"}
            onNeedsBind={(next) => {
              // 扫码成功但账号没绑手机号：就地切到验证码 tab 完成绑定，
              // 不跳 /home —— 那边会把我们弹回 /login?bind=1，白绕一圈。
              setBindNext(next)
              setBindMode(true)
              setTabPickedByUser(true)
              setActiveTab("phone")
              toast.success("微信登录成功，请绑定手机号")
            }}
          />
          <FormControl agreed={agreed} onToggle={() => setAgreed((v) => !v)} />
        </div>
      </div>

      <ContactModal open={contactOpen} onClose={() => setContactOpen(false)} />

      {/* ── Dev Mode QR Login ── */}
      {isDevEnv && (
        <div className="support-tip" style={{ marginTop: 24, textAlign: "center" }}>
          开发模式扫码登录&nbsp;
          {devQrDataUrl ? (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img
              src={devQrDataUrl}
              alt="开发模式登录二维码"
              style={{ width: 96, height: 96, margin: "8px auto", display: "block" }}
            />
          ) : null}
          <a href="/api/auth/dev-login">桌面端一键登录 →</a>
        </div>
      )}
    </>
  )
}

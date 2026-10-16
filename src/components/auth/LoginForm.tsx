"use client"

import { useState, useCallback, useEffect } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import Link from "next/link"
import { Check, Loader2 } from "lucide-react"
import { toast } from "sonner"
import { trackLoginSuccess } from "@/lib/analytics"
import { signOutAction } from "@/app/actions/auth"
import QRCode from "qrcode"
import { WeChatQRCode } from "@/components/auth/WeChatQRCode"
import { ContactModal } from "@/components/auth/ContactModal"
import SmsSlider from "@/components/auth/SmsSlider"

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
 * 这里不做真拦截：未勾选点「立即登录」不会弹「服务协议与隐私政策」
 * 弹窗阻断登录，也无需「同意并登录」确认步。
 *
 * 本次改造**按用户决定只还原样式，不拦截登录**（问询答复：`只还原样式，不拦截登录`）。
 * 所以这里没有任何 service 弹窗，勾选状态是本地纯展示、可点可切换。
 * 但告知义务不能因此丢掉 —— 原先底部那行「登录即表示同意」改放在
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
   * 发短信改由 SmsSlider 触发：拖动滑块对齐拼图 → 服务端判分（答案只存库）
   * → 通过才发短信。原「点击按钮 → 阿里云弹层 → captchaVerifyCallback 发送」
   * 的整条链路（sendSms / verifyCaptcha / useAliyunCaptcha / 冷却定时器）都
   * 收进 SmsSlider 组件里了，本组件只保留手机号/验证码输入与提交。
   */

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
 标签文案与顺序：验证码登录 / 微信登录。
 注意：「验证码登录」就是我们的 phone tab，默认选中项由上面的
 设备判定逻辑决定（不是恒为验证码）—— 那是业务逻辑，保留我们的。 */}
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
          // 这个没手机号的账号，绕不出绑定。用 disabled 而不是隐藏，
          // 版式一致。样式在 login.css 的 [disabled] 规则里。
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
 {/* ── .form 的高度账（已随验证码接入对齐）─────────────────────────────
 .form 里有 5 个产生盒子的子元素：
                P(74) · support-tip(18，带 -4/-8 外边距→净 6) · P(74) ·
                div#captcha-element(0 高，但 display:block，照样吃一个 18px 的 flex gap) ·
                button.login(48)
              → 74+6+74+0+48 + 4×18(gap) = 274，实测正是 274。

              接入阿里云验证码之前，我们没有那个占位 div，只有 4 个子元素 → 256，
 矮 18px（当时是有意为之：不为一个并不使用的控件补假空 div）。
 现在这个 div 是**真的**验证码挂载点，高度自然回到 274。

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
            </p>

            {/* 滑块人机校验 + 发送触发（自建服务，见 SmsSlider）。
                滑块就是「获取验证码」按钮：拖对拼图 → 服务端判分 → 发短信。
                位置与原阿里云挂载点一致：验证码行之后、立即登录之前。 */}
            <SmsSlider phone={phone} id="login-sms-slider" />

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

 {/* .form-control 是 .content 的直接子元素、.form 的兄弟
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

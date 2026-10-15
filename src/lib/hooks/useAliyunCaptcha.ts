"use client"

import { useCallback, useEffect, useRef, useState } from "react"

/**
 * 阿里云「验证码 2.0」客户端接入（V2 架构）。
 *
 * ── 为什么单独抽成 hook ──────────────────────────────────────────────────────
 * 发短信有两个入口（登录页 `/login`、设置页绑定手机号），两边都要同一套人机校验。
 * 而接入验证码**不能只是加个组件**：要动态加载官方 JS、设全局配置、调
 * initAliyunCaptcha、传回调、并在卸载时清理 SDK 插入的遮罩节点 —— 抄两遍必然漂移。
 *
 * ── 为什么环境变量在这里读、由调用方传 ───────────────────────────────────────
 * 服务端也有一份校验实现（`src/lib/aliyun-captcha.ts`），但那份顶部 import 了
 * Node 版 SDK（`@alicloud/captcha20230305`）。客户端组件**绝不能**从那里 import
 * 一个开关函数，否则打包器会把整个 Node SDK 拖进浏览器产物。所以这里自己用
 * `process.env.NEXT_PUBLIC_*`（构建期会被字面替换）判断是否启用。
 *
 * ── 四条硬约束（都踩过坑，别随手改）─────────────────────────────────────────
 *   1. **必须动态加载官方 CDN 的 JS**。官方原文：拉取 JS 代码本地部署会导致验证码
 * 无法正常更新、无法保证安全能力，甚至引起误拦截。基准实现把 
 *      放自己服务器上，那是官方明令禁止的做法，我们不要照抄这一点。
 *   2. `window.AliyunCaptchaConfig` 必须在主 JS **之前**设好（region + prefix）。
 *   3. `initAliyunCaptcha` **不支持重复调用**，所以用一个模块级 Set 按 buttonId
 *      去重 —— React 的 StrictMode 在 dev 下会把 effect 跑两遍（mount→unmount→mount），
 *      不去重就是两次初始化，官方说会导致回调触发多次。
 *   4. **SDK 自己接管按钮的点击**（这正是传 `button` 参数的目的）。所以按钮上的
 *      React onClick 在验证码就绪后**必须直接返回**，否则一次点击会既弹验证码、
 *      又立刻发一条没有验证参数的短信，被服务端拒绝成"人机验证无效"。
 *
 * 验证形态（滑块 / 拼图 / 图像复原 / 一点即过 / 无痕）由**控制台建场景时**决定，
 * 隐含在 SceneId 里，客户端改不了 —— 所以想要基准实现那种「拖动图片对齐」，
 * 是在控制台选「拼图验证」，不是改这里的代码。
 */

/** 官方 CDN，V2/V3 通用。**不要**换成本地自托管（见上面第 1 条）。 */
const CAPTCHA_SCRIPT_SRC =
  "https://o.alicdn.com/captcha-frontend/aliyunCaptcha/AliyunCaptcha.js"

/**
 * 与 region 匹配的配置。region 改成 sgp 时，客户端这里和服务端
 * （`src/lib/aliyun-captcha.ts` 的 CAPTCHA_ENDPOINT）必须同步改。
 * 官方铁律：客户端 cn 对服务端中国内地地址，客户端 sgp 对新加坡地址。
 */
const CAPTCHA_REGION = "cn"

const SCENE_ID = process.env.NEXT_PUBLIC_ALIYUN_CAPTCHA_SCENE_ID
const PREFIX = process.env.NEXT_PUBLIC_ALIYUN_CAPTCHA_PREFIX

/** 是否已配置人机校验。未配置时整条链路自动关闭（本地开发不受影响）。 */
export function isCaptchaEnabled(): boolean {
  return Boolean(SCENE_ID && PREFIX)
}

export type CaptchaStatus =
  /** 没配环境变量 —— 调用方走原来的直连逻辑。 */
  | "disabled"
  /** 正在加载 / 初始化，按钮应禁用。 */
  | "loading"
  /** 就绪：SDK 接管按钮点击，验证通过后会回调 verify。 */
  | "ready"
  /** 脚本或初始化失败 —— 调用方应给出明确提示，而不是留一个没反应的死按钮。 */
  | "failed"

export type CaptchaVerifyResult = {
  /** 人机验证本身是否通过（必填）。false 会让 SDK 刷新验证码让用户重试。 */
  captchaResult: boolean
  /** 业务（发短信）是否成功（可选）。会透传给 onBizResultCallback。 */
  bizResult?: boolean
}

declare global {
  interface Window {
    AliyunCaptchaConfig?: { region?: string; prefix?: string }
    initAliyunCaptcha?: (options: Record<string, unknown>) => void
  }
}

let scriptPromise: Promise<void> | null = null

function loadCaptchaScript(): Promise<void> {
  if (typeof window === "undefined") {
    return Promise.reject(new Error("人机验证脚本不能在服务端加载"))
  }
  if (window.initAliyunCaptcha) return Promise.resolve()
  if (scriptPromise) return scriptPromise

  scriptPromise = new Promise<void>((resolve, reject) => {
    // 失败时把缓存的 promise 清掉，否则一次网络抖动会让本次会话永远重试不了。
    const fail = (message: string) => {
      scriptPromise = null
      reject(new Error(message))
    }

    const existing = document.querySelector<HTMLScriptElement>(
      `script[src="${CAPTCHA_SCRIPT_SRC}"]`,
    )
    if (existing) {
      existing.addEventListener("load", () => resolve())
      existing.addEventListener("error", () => fail("人机验证脚本加载失败"))
      return
    }

    const script = document.createElement("script")
    script.src = CAPTCHA_SCRIPT_SRC
    script.async = true
    script.addEventListener("load", () => resolve())
    script.addEventListener("error", () => {
      script.remove()
      fail("人机验证加载失败，请刷新页面重试")
    })
    document.head.appendChild(script)
  })

  return scriptPromise
}

/** 已成功初始化过的 buttonId。见上面第 3 条：initAliyunCaptcha 不支持重复调用。 */
const initializedButtons = new Set<string>()

export function useAliyunCaptcha(options: {
  /**
   * 是否启用。默认 true（环境变量齐全即启用）。
   *
   * 调用方**必须**在自己的发送按钮不可见时传 false，原因是 SDK 在初始化时会去
   * 量按钮/容器的位置，而 `display:none` 的元素量出来全是 0，弹层会错位；
   * 而且表单条件渲染时按钮根本不在 DOM 里，初始化会直接失败。
   * 所以：登录页传 `activeTab === "phone"`，设置页传 `showPhoneBind`。
   */
  enabled?: boolean
  /** 触发验证码的按钮 id（不含 #）。SDK 会接管它的点击。 */
  buttonId: string
  /** 验证码挂载容器 id（不含 #）。popup 模式下它只是个 0 高度占位节点。 */
  elementId: string
  /**
   * 人机验证通过后由 SDK 调用；**必须返回 Promise**（官方 FAQ Q8：只在 .then
   * 里返回会让流程卡住）。业务请求（发短信）就在这里面发，返回值里的
   * `bizResult` 表示业务是否成功。
   */
  verify: (captchaVerifyParam: string) => Promise<CaptchaVerifyResult>
  /**
   * 业务结果回调，**由 SDK 在 `verify` 的 Promise resolve 之后调用**，
   * 收到的是上面返回的 `bizResult`。UI 收尾（起倒计时、弹提示）放这里 ——
   * 这是官方示例的标准分工：verify 里发业务请求，onBizResult 里做 UI 反馈。
   */
  onBizResult?: (bizResult: boolean) => void
  /** 加载 / 初始化失败时回调，用于给用户一句可读的提示。 */
  onError?: (message: string) => void
}): { status: CaptchaStatus; refresh: () => void } {
  const { buttonId, elementId } = options
  // 环境变量没配 → 整条链路关闭；调用方明确说按钮当前不可见 → 也不初始化（见上面 enabled 的说明）。
  const enabled = (options.enabled ?? true) && isCaptchaEnabled()

  const [status, setStatus] = useState<CaptchaStatus>(
    enabled ? "loading" : "disabled",
  )

  // 回调都放进 ref：SDK 只在初始化时拿一次函数引用，而 React 每次渲染都会
  // 生成新闭包。放进依赖数组会导致反复重新初始化（而 initAliyunCaptcha
  // 又不支持重复调用），所以用 ref 转一手，保证 SDK 调到的永远是最新的那版。
  const verifyRef = useRef(options.verify)
  verifyRef.current = options.verify
  const onErrorRef = useRef(options.onError)
  onErrorRef.current = options.onError
  const onBizResultRef = useRef(options.onBizResult)
  onBizResultRef.current = options.onBizResult
  const instanceRef = useRef<unknown>(null)

  useEffect(() => {
    if (!enabled || !SCENE_ID || !PREFIX) {
      setStatus("disabled")
      return
    }

    if (initializedButtons.has(buttonId)) {
      setStatus("ready")
      return
    }

    let cancelled = false
    setStatus("loading")

    // 约束 2：全局配置必须在主 JS 之前设好。
    window.AliyunCaptchaConfig = { region: CAPTCHA_REGION, prefix: PREFIX }

    loadCaptchaScript()
      .then(() => {
        if (cancelled) return

        window.initAliyunCaptcha?.({
          SceneId: SCENE_ID,
 // popup：点按钮弹出验证浮层。基准实现也是 popup，且 popup 支持全部形态
          // （embed 不支持无痕验证）。
          mode: "popup",
          element: `#${elementId}`,
          button: `#${buttonId}`,
          captchaVerifyCallback: (captchaVerifyParam: unknown) => {
            // 官方 FAQ Q17：**初始化调用失败时会自动触发验证回调**（容灾设计）。
            // 所以这个回调可能在"根本没验证过"的情况下被调到，且参数为空。
            // 这里绝不能把业务请求发出去 —— 否则掐断验证码 CDN 就等于绕过人机校验。
            // 服务端同样把「缺参」判为拒绝，两边口径一致。
            if (
              typeof captchaVerifyParam !== "string" ||
              !captchaVerifyParam.trim()
            ) {
              onErrorRef.current?.("人机验证初始化失败，请刷新页面重试")
              return Promise.resolve({ captchaResult: false })
            }
            return verifyRef.current(captchaVerifyParam)
          },
          // 必填参数。业务是否成功由 verify 返回值里的 bizResult 带到这来，
          // UI 反馈（起倒计时 / 弹提示）在调用方传入的 onBizResult 里做。
          onBizResultCallback: (bizResult: unknown) => {
            onBizResultRef.current?.(bizResult === true)
          },
          getInstance: (instance: unknown) => {
            instanceRef.current = instance
          },
          // 仅「滑块验证」生效；拼图 / 图像复原的尺寸由控制台决定，改不了。
          slideStyle: { width: 360, height: 40 },
          // 官方取值：cn（简体）/ tw（繁体）/ en（英文）—— 不是 "zh"。
          language: "cn",
          onError: (err: unknown) => {
            console.error("[captcha] 初始化失败", err)
            onErrorRef.current?.("人机验证加载失败，请刷新页面重试")
          },
        })

        initializedButtons.add(buttonId)
        setStatus("ready")
      })
      .catch((err: Error) => {
        if (cancelled) return
        console.error("[captcha] 脚本加载失败", err)
        setStatus("failed")
        onErrorRef.current?.(err.message)
      })

    return () => {
      cancelled = true
      // 释放去重标记：设置页的绑定表单可以反复展开/收起，按钮 DOM 会重建，
      // 旧的事件绑定随之失效，必须允许重新初始化。
      initializedButtons.delete(buttonId)
      // SDK 会往 body 里插入遮罩与浮层。真实卸载时不清掉，它会盖在新页面上。
      document.getElementById("aliyunCaptcha-mask")?.remove()
      document.getElementById("aliyunCaptcha-window-popup")?.remove()
    }
  }, [enabled, buttonId, elementId])

  const refresh = useCallback(() => {
    const inst = instanceRef.current as { refresh?: () => void } | null
    inst?.refresh?.()
  }, [])

  return { status, refresh }
}

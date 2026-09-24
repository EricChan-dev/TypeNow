import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { generateKeyPairSync, createSign, createVerify } from "crypto"
import { writeFileSync, mkdtempSync } from "fs"
import { tmpdir } from "os"
import { join } from "path"
import {
  verifyWechatPaySignature,
  verifyNotifySignature,
  matchesWechatPayMerchant,
  loadWechatPayPublicKey,
  resetWechatPayPublicKeyCache,
  resetWechatPayCertCache,
  WECHATPAY_PUBLIC_KEY_ID_PREFIX,
  WECHATPAY_TIMESTAMP_TOLERANCE_SECONDS,
} from "@/lib/wechat-pay"

/**
 * 微信支付「公钥模式」验签。
 *
 * 线上背景：本商户是公钥模式，平台证书接口对它直接返回
 *   404 {"code":"RESOURCE_NOT_EXISTS","message":"无可用的平台证书"}
 * 而旧代码只实现了平台证书模式的验签（先下载证书、再按 serial 找证书），
 * 于是**每一笔真实支付回调都被 401 顶回去**，履约只能靠前端每 3 秒轮询
 * /api/payment/order-status 兜着；用户付款后 3 秒内关掉收银台就永久停在 pending。
 *
 * 这里的测试不依赖微信：本地生成一对 RSA 密钥，用"微信的私钥"签名、用
 * "微信支付公钥"验签，报文格式与官方一致：
 *   message = timestamp + "\n" + nonce + "\n" + body + "\n"
 */

// 微信侧的密钥对：私钥用来签名（模拟微信），公钥就是我们要配置的"微信支付公钥"
const wechat = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
  publicKeyEncoding: { type: "spki", format: "pem" },
})

// 商户自己的密钥对：用来模拟"另一把公钥"（配错公钥时必须验签失败）
const other = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
  publicKeyEncoding: { type: "spki", format: "pem" },
})

const PUBLIC_KEY_ID = "PUB_KEY_ID_0111122210052026053000182085000202"
const BODY = JSON.stringify({ code: "SUCCESS", message: "OK" })

/** 按微信的格式签名 */
function sign(opts: { timestamp: string; nonce: string; body: string; key?: string }): string {
  const message = `${opts.timestamp}\n${opts.nonce}\n${opts.body}\n`
  const s = createSign("RSA-SHA256")
  s.update(message)
  return s.sign(opts.key ?? wechat.privateKey, "base64")
}

const nowTs = () => String(Math.floor(Date.now() / 1000))

const SAVED = { ...process.env }

beforeEach(() => {
  resetWechatPayPublicKeyCache()
  resetWechatPayCertCache()
  process.env.WECHAT_PAY_MCH_ID = "1112221005"
  process.env.WECHAT_PAY_APP_ID = "wxd663bd3d07ae0eb5"
  process.env.WECHAT_PAY_API_V3_KEY = "0123456789abcdef0123456789abcdef"
  process.env.WECHAT_PAY_SERIAL_NO = "ABCDEF0123456789"
  process.env.WECHAT_PAY_PRIVATE_KEY = other.privateKey
  process.env.WECHAT_PAY_PUBLIC_KEY_ID = PUBLIC_KEY_ID
  process.env.WECHAT_PAY_PUBLIC_KEY = wechat.publicKey
  delete process.env.WECHAT_PAY_PUBLIC_KEY_PATH
})

afterEach(() => {
  vi.unstubAllEnvs()
  process.env = { ...SAVED }
})

describe("公钥模式验签（PUB_KEY_ID_ 前缀）", () => {
  it("前缀常量与线上公钥ID一致", () => {
    expect(PUBLIC_KEY_ID.startsWith(WECHATPAY_PUBLIC_KEY_ID_PREFIX)).toBe(true)
  })

  it("公钥模式下用配置的微信支付公钥验签通过", async () => {
    const timestamp = nowTs()
    const nonce = "abc123"
    const signature = sign({ timestamp, nonce, body: BODY })

    await expect(
      verifyWechatPaySignature({
        timestamp,
        nonce,
        body: BODY,
        signature,
        serialNo: PUBLIC_KEY_ID,
      })
    ).resolves.toBe(true)
  })

  it("改了 body / nonce / timestamp 任意一项，验签必须失败（报文被篡改）", async () => {
    const timestamp = nowTs()
    const nonce = "abc123"
    const signature = sign({ timestamp, nonce, body: BODY })

    const cases = [
      { timestamp, nonce, body: JSON.stringify({ code: "SUCCESS", message: "OK!" }) },
      { timestamp, nonce: "abc124", body: BODY },
      { timestamp: String(Number(timestamp) + 1), nonce, body: BODY },
    ]
    for (const c of cases) {
      await expect(
        verifyWechatPaySignature({ ...c, signature, serialNo: PUBLIC_KEY_ID })
      ).resolves.toBe(false)
    }
  })

  it("配错公钥 → 验签失败（不能因为配了东西就放行）", async () => {
    const timestamp = nowTs()
    const nonce = "abc123"
    const signature = sign({ timestamp, nonce, body: BODY })

    process.env.WECHAT_PAY_PUBLIC_KEY = other.publicKey
    resetWechatPayPublicKeyCache()

    await expect(
      verifyWechatPaySignature({
        timestamp,
        nonce,
        body: BODY,
        signature,
        serialNo: PUBLIC_KEY_ID,
      })
    ).resolves.toBe(false)
  })

  it("公钥模式但没配公钥 → 拒绝（fail-closed，绝不 fail-open）", async () => {
    const timestamp = nowTs()
    const nonce = "abc123"
    const signature = sign({ timestamp, nonce, body: BODY })

    delete process.env.WECHAT_PAY_PUBLIC_KEY
    resetWechatPayPublicKeyCache()

    await expect(
      verifyWechatPaySignature({
        timestamp,
        nonce,
        body: BODY,
        signature,
        serialNo: PUBLIC_KEY_ID,
      })
    ).resolves.toBe(false)
  })

  it("公钥ID 不匹配只告警，仍按配置的公钥验签（微信轮换公钥时不至于直接断）", async () => {
    const timestamp = nowTs()
    const nonce = "abc123"
    const signature = sign({ timestamp, nonce, body: BODY })

    process.env.WECHAT_PAY_PUBLIC_KEY_ID = "PUB_KEY_ID_99999999999999999999999999999999"

    await expect(
      verifyWechatPaySignature({
        timestamp,
        nonce,
        body: BODY,
        signature,
        serialNo: PUBLIC_KEY_ID,
      })
    ).resolves.toBe(true)
  })
})

describe("报文时间戳窗口（防重放）", () => {
  it("窗口内的旧报文仍然接受", async () => {
    const timestamp = String(Math.floor(Date.now() / 1000) - 60)
    const nonce = "abc123"
    const signature = sign({ timestamp, nonce, body: BODY })

    await expect(
      verifyWechatPaySignature({ timestamp, nonce, body: BODY, signature, serialNo: PUBLIC_KEY_ID })
    ).resolves.toBe(true)
  })

  it("超出窗口的合法签名被拒绝：这正是重放攻击的形态", async () => {
    const timestamp = String(
      Math.floor(Date.now() / 1000) - WECHATPAY_TIMESTAMP_TOLERANCE_SECONDS - 60
    )
    const nonce = "abc123"
    const signature = sign({ timestamp, nonce, body: BODY })

    await expect(
      verifyWechatPaySignature({ timestamp, nonce, body: BODY, signature, serialNo: PUBLIC_KEY_ID })
    ).resolves.toBe(false)
  })

  it("时间戳不是数字 → 拒绝", async () => {
    const timestamp = "not-a-number"
    const nonce = "abc123"
    const signature = sign({ timestamp, nonce, body: BODY })

    await expect(
      verifyWechatPaySignature({ timestamp, nonce, body: BODY, signature, serialNo: PUBLIC_KEY_ID })
    ).resolves.toBe(false)
  })
})

describe("请求头字段完整性", () => {
  it.each([
    ["缺 serialNo", { serialNo: "" }],
    ["缺 signature", { signature: "" }],
    ["缺 timestamp", { timestamp: "" }],
    ["缺 nonce", { nonce: "" }],
  ])("%s → 拒绝", async (_name, patch) => {
    const timestamp = nowTs()
    const nonce = "abc123"
    const base = {
      timestamp,
      nonce,
      body: BODY,
      signature: sign({ timestamp, nonce, body: BODY }),
      serialNo: PUBLIC_KEY_ID,
    }
    await expect(verifyWechatPaySignature({ ...base, ...patch })).resolves.toBe(false)
  })
})

describe("公钥来源：PEM / base64 / 文件 / \\n 转义", () => {
  it("支持 WECHAT_PAY_PUBLIC_KEY_PATH 从文件读取", () => {
    const dir = mkdtempSync(join(tmpdir(), "typenow-pubkey-"))
    const file = join(dir, "pub_key.pem")
    writeFileSync(file, wechat.publicKey, "utf-8")

    delete process.env.WECHAT_PAY_PUBLIC_KEY
    process.env.WECHAT_PAY_PUBLIC_KEY_PATH = file
    resetWechatPayPublicKeyCache()

    expect(loadWechatPayPublicKey()).toBe(wechat.publicKey)
  })

  it("支持 base64 编码的 PEM（.env 里塞整行更方便）", () => {
    process.env.WECHAT_PAY_PUBLIC_KEY = Buffer.from(wechat.publicKey).toString("base64")
    resetWechatPayPublicKeyCache()

    expect(loadWechatPayPublicKey()).toBe(wechat.publicKey)
  })

  it("支持把换行写成 \\n 的 PEM（dotenv 双引号值的常见写法）", () => {
    process.env.WECHAT_PAY_PUBLIC_KEY = wechat.publicKey.replace(/\n/g, "\\n")
    resetWechatPayPublicKeyCache()

    expect(loadWechatPayPublicKey()).toBe(wechat.publicKey)
  })

  it("内容既不是 PEM 也不是 base64 → 抛错，而不是拿一段垃圾去验签", () => {
    process.env.WECHAT_PAY_PUBLIC_KEY = "!!!not-a-key!!!"
    resetWechatPayPublicKeyCache()

    expect(() => loadWechatPayPublicKey()).toThrow(/公钥内容非法/)
  })

  it("都没配置 → 返回 null", () => {
    delete process.env.WECHAT_PAY_PUBLIC_KEY
    delete process.env.WECHAT_PAY_PUBLIC_KEY_PATH
    resetWechatPayPublicKeyCache()

    expect(loadWechatPayPublicKey()).toBeNull()
  })
})

describe("回调入口 verifyNotifySignature", () => {
  it("生产环境下走公钥模式验签，签名正确即通过", async () => {
    const timestamp = nowTs()
    const nonce = "nonce-1"
    const signature = sign({ timestamp, nonce, body: BODY })

    await expect(
      verifyNotifySignature(timestamp, nonce, BODY, signature, PUBLIC_KEY_ID)
    ).resolves.toBe(true)
  })

  it("签名错误一律 false（回调路由据此返回 401）", async () => {
    const timestamp = nowTs()
    await expect(
      verifyNotifySignature(timestamp, "nonce-1", BODY, "bm90LWEtc2ln", PUBLIC_KEY_ID)
    ).resolves.toBe(false)
  })

  it("读完公钥后第二次调用命中缓存，结果一致", async () => {
    const timestamp = nowTs()
    const nonce = "nonce-2"
    const signature = sign({ timestamp, nonce, body: BODY })

    for (let i = 0; i < 3; i++) {
      await expect(
        verifyNotifySignature(timestamp, nonce, BODY, signature, PUBLIC_KEY_ID)
      ).resolves.toBe(true)
    }
  })
})

describe("mchid / appid 归属校验", () => {
  it("完全匹配 → ok", () => {
    expect(
      matchesWechatPayMerchant({ mchid: "1112221005", appid: "wxd663bd3d07ae0eb5" }).ok
    ).toBe(true)
  })

  it("字段缺失 → 不拦（兼容历史回调体）", () => {
    expect(matchesWechatPayMerchant({}).ok).toBe(true)
    expect(matchesWechatPayMerchant({ mchid: "1112221005" }).ok).toBe(true)
  })

  it("mchid 是别人的 → 拒绝，并给出可定位的原因", () => {
    const res = matchesWechatPayMerchant({ mchid: "9999999999" })
    expect(res.ok).toBe(false)
    expect(res.reason).toMatch(/mchid 不匹配/)
    expect(res.reason).toContain("1112221005")
  })

  it("appid 是别人的 → 拒绝", () => {
    const res = matchesWechatPayMerchant({ appid: "wx0000000000000000" })
    expect(res.ok).toBe(false)
    expect(res.reason).toMatch(/appid 不匹配/)
  })
})

describe("未配置商户密钥时的行为", () => {
  it("开发环境放行（便于本地模拟回调）", async () => {
    // process.env.NODE_ENV 的类型是只读的，用 vi.stubEnv 改写（vitest 会绕过类型）
    vi.stubEnv("NODE_ENV", "development")
    process.env.WECHAT_PAY_MCH_ID = ""
    process.env.WECHAT_PAY_PRIVATE_KEY = ""

    await expect(verifyNotifySignature("1", "n", "{}", "s", "x")).resolves.toBe(true)

    vi.unstubAllEnvs()
  })

  it("非开发环境且未配置 → false（绝不 fail-open）", async () => {
    process.env.WECHAT_PAY_MCH_ID = ""
    process.env.WECHAT_PAY_PRIVATE_KEY = ""

    await expect(verifyNotifySignature("1", "n", "{}", "s", "x")).resolves.toBe(false)
  })
})

describe("验签实现与微信规范一致", () => {
  it("待签串就是 timestamp\\nnonce\\nbody\\n（用独立实现交叉验证）", async () => {
    const timestamp = nowTs()
    const nonce = "cross-check"
    const signer = createSign("RSA-SHA256")
    signer.update(`${timestamp}\n${nonce}\n${BODY}\n`)
    const signature = signer.sign(wechat.privateKey, "base64")

    // 独立用公钥复验一次，确认这就是微信那种"对 message 签名"的形态
    const independant = createVerify("RSA-SHA256")
    independant.update(`${timestamp}\n${nonce}\n${BODY}\n`)
    expect(independant.verify(wechat.publicKey, signature, "base64")).toBe(true)

    await expect(
      verifyWechatPaySignature({ timestamp, nonce, body: BODY, signature, serialNo: PUBLIC_KEY_ID })
    ).resolves.toBe(true)
  })
})

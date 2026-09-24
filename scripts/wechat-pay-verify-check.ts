/**
 * 只读诊断：证明「微信支付公钥」能验通微信的真实应答签名。
 *
 * 为什么需要它：回调（notify）与应答（response）的签名报文格式**完全一致**
 *   message = timestamp \n nonce \n body \n
 * 因此只要能用同一把公钥验通一个真实的应答，就能证明回调也能验通——
 * 不必等到真的有用户付款才知道 notify 会不会再 401。
 *
 * 只用真实存在的订单号做 GET 查单，不产生任何资金副作用。
 * 运行方式（必须能在生产环境读到 .env.local 与仓库外的公钥文件）：
 *   cd /home/admin/TypeNow && npx tsx scripts/wechat-pay-verify-check.ts <out_trade_no>
 */
import { loadEnvConfig } from "@next/env"
import { randomUUID, createSign } from "crypto"

async function main() {
  loadEnvConfig(process.cwd())

  // 动态 import：loadEnvConfig 必须在模块读取 process.env 之前执行
  const { verifyWechatPaySignature, loadWechatPayPublicKey, getWechatPayCerts } = await import(
    "../src/lib/wechat-pay"
  )

  const outTradeNo = process.argv[2]
  if (!outTradeNo) throw new Error("用法: tsx scripts/wechat-pay-verify-check.ts <out_trade_no>")

  const mchId = process.env.WECHAT_PAY_MCH_ID || ""
  const serialNo = process.env.WECHAT_PAY_SERIAL_NO || ""
  const privateKey = (process.env.WECHAT_PAY_PRIVATE_KEY || "").includes("-----BEGIN")
    ? process.env.WECHAT_PAY_PRIVATE_KEY!
    : Buffer.from(process.env.WECHAT_PAY_PRIVATE_KEY || "", "base64").toString("utf-8")
  const publicKeyId = process.env.WECHAT_PAY_PUBLIC_KEY_ID || ""

  console.log("配置检查:")
  console.log("  mchId         =", mchId)
  console.log("  证书序列号     =", serialNo)
  console.log("  公钥ID        =", publicKeyId || "(未配置)")
  const pem = loadWechatPayPublicKey()
  console.log("  公钥已加载     =", pem ? `是 (${pem.split("\n")[0]}…)` : "否")

  // 复刻 buildAuthHeader（请求签名本身已被真实支付验证过，这里不需要测它）
  const urlPath = `/v3/pay/transactions/out-trade-no/${outTradeNo}?mchid=${mchId}`
  const timestamp = Math.floor(Date.now() / 1000)
  const nonce = randomUUID().replace(/-/g, "").substring(0, 32)
  const message = `GET\n${urlPath}\n${timestamp}\n${nonce}\n\n`
  const sign = createSign("RSA-SHA256")
  sign.update(message)
  const signature = sign.sign(privateKey, "base64")
  const authorization = `WECHATPAY2-SHA256-RSA2048 mchid="${mchId}",nonce_str="${nonce}",signature="${signature}",timestamp="${timestamp}",serial_no="${serialNo}"`

  const url = `https://api.mch.weixin.qq.com${urlPath}`
  console.log("\n请求:", url)
  const res = await fetch(url, {
    method: "GET",
    headers: {
      Accept: "application/json",
      "Accept-Language": "zh-CN",
      Authorization: authorization,
    },
  })
  const body = await res.text()

  const respSerial = res.headers.get("Wechatpay-Serial") || ""
  console.log("微信应答:")
  console.log("  HTTP 状态      =", res.status)
  console.log("  Wechatpay-Serial =", respSerial)
  console.log("  有 Signature 头 =", Boolean(res.headers.get("Wechatpay-Signature")))
  console.log("  body 前 120 字  =", body.slice(0, 120))

  const ok = await verifyWechatPaySignature({
    timestamp: res.headers.get("Wechatpay-Timestamp") || "",
    nonce: res.headers.get("Wechatpay-Nonce") || "",
    body,
    signature: res.headers.get("Wechatpay-Signature") || "",
    serialNo: respSerial,
  })
  console.log("\n>>> 用微信支付公钥验签真实应答:", ok ? "通过 ✅" : "失败 ❌")

  // 反向验证：换一把错误公钥必须失败，否则说明"验签"根本没在起作用
  const other = (await import("crypto")).generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  })
  const prev = process.env.WECHAT_PAY_PUBLIC_KEY
  const prevPath = process.env.WECHAT_PAY_PUBLIC_KEY_PATH
  const mod = await import("../src/lib/wechat-pay")
  mod.resetWechatPayPublicKeyCache()
  process.env.WECHAT_PAY_PUBLIC_KEY = other.publicKey
  delete process.env.WECHAT_PAY_PUBLIC_KEY_PATH
  const badOk = await verifyWechatPaySignature({
    timestamp: res.headers.get("Wechatpay-Timestamp") || "",
    nonce: res.headers.get("Wechatpay-Nonce") || "",
    body,
    signature: res.headers.get("Wechatpay-Signature") || "",
    serialNo: respSerial,
  })
  console.log(">>> 用错误公钥验同一份应答:", badOk ? "通过了 ❌（验签形同虚设！）" : "被拒绝 ✅")
  if (prev !== undefined) process.env.WECHAT_PAY_PUBLIC_KEY = prev
  if (prevPath !== undefined) process.env.WECHAT_PAY_PUBLIC_KEY_PATH = prevPath
  mod.resetWechatPayPublicKeyCache()

  // 顺带确认「平台证书接口对本商户确实不可用」——正是当初 401 的根因
  try {
    await getWechatPayCerts()
    console.log(">>> 平台证书接口: 可用（不是公钥模式？）")
  } catch (err) {
    console.log(">>> 平台证书接口:", (err as Error).message)
  }

  console.log("\n结论:", ok && !badOk ? "公钥模式验签可用 ✅" : "验签不可用 ❌")
  process.exit(ok && !badOk ? 0 : 1)
}

main().catch((err) => {
  console.error("诊断脚本异常:", err)
  process.exit(2)
})

import { describe, it, expect } from "vitest"
import { createCipheriv } from "crypto"
import { decryptAesGcm } from "@/lib/wechat-pay"

/**
 * 微信支付 v3 的 AES-256-GCM 报文格式：
 *   key             = APIv3 密钥原样的 32 字节 UTF-8
 *   nonce           = UTF-8 字符串字节
 *   associated_data = UTF-8 字符串字节
 *   ciphertext      = base64(cipher || authTag)，authTag 为末尾 16 字节
 *
 * 这组测试用"按规范加密"的密文反向验证解密实现。旧实现（key 先做 SHA-256、
 * nonce/AAD 按 base64 解码）在这里会直接抛错。
 */

const API_V3_KEY = "0123456789abcdef0123456789abcdef" // 32 字节
const NONCE = "abcdefghijkl" // 12 字节
const AAD = "transaction"

function wechatEncrypt(plaintext: string, aad = AAD): string {
  const cipher = createCipheriv(
    "aes-256-gcm",
    Buffer.from(API_V3_KEY, "utf-8"),
    Buffer.from(NONCE, "utf-8"),
  )
  if (aad) cipher.setAAD(Buffer.from(aad, "utf-8"))
  const enc = Buffer.concat([cipher.update(plaintext, "utf-8"), cipher.final()])
  return Buffer.concat([enc, cipher.getAuthTag()]).toString("base64")
}

describe("decryptAesGcm", () => {
  it("用原样 32 字节 APIv3 密钥解密交易回调报文", () => {
    const payload = JSON.stringify({
      out_trade_no: "TYPENOW-TEST-0001",
      transaction_id: "4200001234202601011234567890",
      trade_state: "SUCCESS",
    })
    expect(decryptAesGcm(wechatEncrypt(payload), NONCE, AAD, API_V3_KEY)).toBe(payload)
  })

  it("解密退款回调报文", () => {
    const payload = JSON.stringify({
      out_trade_no: "TYPENOW-TEST-0002",
      out_refund_no: "REFUND-0002",
      refund_status: "SUCCESS",
    })
    expect(decryptAesGcm(wechatEncrypt(payload), NONCE, AAD, API_V3_KEY)).toBe(payload)
  })

  it("支持中文内容且 associated_data 为空", () => {
    const payload = JSON.stringify({ description: "TypeNow 合伙人终身会员" })
    const cipher = createCipheriv(
      "aes-256-gcm",
      Buffer.from(API_V3_KEY, "utf-8"),
      Buffer.from(NONCE, "utf-8"),
    )
    const enc = Buffer.concat([cipher.update(payload, "utf-8"), cipher.final()])
    const ct = Buffer.concat([enc, cipher.getAuthTag()]).toString("base64")
    expect(decryptAesGcm(ct, NONCE, "", API_V3_KEY)).toBe(payload)
  })

  it("APIv3 密钥不是 32 字节时抛错", () => {
    expect(() => decryptAesGcm(wechatEncrypt("{}"), NONCE, AAD, "too-short")).toThrow(
      /32 字节/,
    )
  })

  it("associated_data 不匹配时认证失败（GCM 完整性保护生效）", () => {
    expect(() => decryptAesGcm(wechatEncrypt("{}"), NONCE, "wrong-aad", API_V3_KEY)).toThrow()
  })

  it("密文被篡改时认证失败", () => {
    const raw = Buffer.from(wechatEncrypt('{"a":1}'), "base64")
    raw[0] ^= 0xff
    expect(() => decryptAesGcm(raw.toString("base64"), NONCE, AAD, API_V3_KEY)).toThrow()
  })

  it("密文长度不足（缺少 auth tag）时抛错", () => {
    expect(() => decryptAesGcm(Buffer.alloc(8).toString("base64"), NONCE, AAD, API_V3_KEY)).toThrow(
      /密文长度非法/,
    )
  })
})

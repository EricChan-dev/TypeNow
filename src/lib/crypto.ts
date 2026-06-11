import crypto from "crypto"

const ALGORITHM = "aes-256-gcm"
const IV_LENGTH = 12
const TAG_LENGTH = 16

function getEncryptionKey(): Buffer | null {
  // Use dedicated key or fall back to OA secret (at least it's something)
  const raw = process.env.ENCRYPTION_KEY || process.env.WECHAT_OA_APP_SECRET
  if (!raw) return null
  return crypto.createHash("sha256").update(raw).digest()
}

/**
 * Encrypt a plaintext string. Returns `enc:<iv>:<tag>:<ciphertext>` or the original
 * string if encryption is not configured.
 */
export function encrypt(value: string | null): string | null {
  if (!value) return value
  const key = getEncryptionKey()
  if (!key) return value // No encryption key configured — store as-is

  const iv = crypto.randomBytes(IV_LENGTH)
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv)
  let encrypted = cipher.update(value, "utf8", "hex")
  encrypted += cipher.final("hex")
  const tag = cipher.getAuthTag()

  return `enc:${iv.toString("hex")}:${tag.toString("hex")}:${encrypted}`
}

/**
 * Decrypt a value encrypted with `encrypt()`. Plaintext values pass through.
 */
export function decrypt(value: string | null): string | null {
  if (!value) return value
  if (!value.startsWith("enc:")) return value // Not encrypted

  const key = getEncryptionKey()
  if (!key) return value // Can't decrypt without key — return as-is (may be garbage)

  const parts = value.slice(4).split(":")
  if (parts.length !== 3) return value
  const [ivHex, tagHex, ciphertext] = parts

  try {
    const decipher = crypto.createDecipheriv(ALGORITHM, key, Buffer.from(ivHex, "hex"))
    decipher.setAuthTag(Buffer.from(tagHex, "hex"))
    let decrypted = decipher.update(ciphertext, "hex", "utf8")
    decrypted += decipher.final("utf8")
    return decrypted
  } catch {
    return value // Decryption failed — return as-is
  }
}

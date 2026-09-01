import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto"

/**
 * Authenticated encryption for stored merchant credentials.
 *
 * AES-256-GCM: GCM rather than CBC so the ciphertext is tamper-evident - a modified blob fails the
 * auth tag check and throws, instead of silently decrypting to garbage that then gets sent to
 * Razorpay as someone's API secret.
 *
 * The key comes from RAZORPAY_CREDENTIAL_KEY. If it is missing, every function here throws rather
 * than falling back to a default key or to plaintext. A "temporarily insecure" fallback is exactly
 * how credentials end up stored in the clear forever, so there isn't one.
 */

const ALGORITHM = "aes-256-gcm"

function key(): Buffer {
  const secret = process.env.RAZORPAY_CREDENTIAL_KEY
  if (!secret || secret.length < 16) {
    throw new Error(
      "RAZORPAY_CREDENTIAL_KEY is not set (or is shorter than 16 characters). Refusing to store or read a Razorpay API secret without it. Generate one with: openssl rand -base64 32",
    )
  }
  // SHA-256 to get exactly 32 bytes from an arbitrary-length passphrase. Not a KDF: this protects
  // a secret at rest against database access, and the input is expected to be high-entropy already.
  return createHash("sha256").update(secret).digest()
}

export function credentialEncryptionAvailable(): boolean {
  const secret = process.env.RAZORPAY_CREDENTIAL_KEY
  return Boolean(secret && secret.length >= 16)
}

export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv(ALGORITHM, key(), iv)
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()])
  const tag = cipher.getAuthTag()
  // iv.tag.ciphertext, all base64url - one opaque column value, no separate columns to keep in sync.
  return [
    iv.toString("base64url"),
    tag.toString("base64url"),
    encrypted.toString("base64url"),
  ].join(".")
}

export function decryptSecret(payload: string): string {
  const [ivB64, tagB64, dataB64] = payload.split(".")
  if (!ivB64 || !tagB64 || !dataB64) {
    throw new Error("Stored credential is malformed - expected iv.tag.ciphertext")
  }
  const decipher = createDecipheriv(ALGORITHM, key(), Buffer.from(ivB64, "base64url"))
  decipher.setAuthTag(Buffer.from(tagB64, "base64url"))
  return Buffer.concat([
    decipher.update(Buffer.from(dataB64, "base64url")),
    decipher.final(),
  ]).toString("utf8")
}

/** Safe for logs and API responses: rzp_test_ABC…WXYZ */
export function maskKeyId(keyId: string): string {
  if (keyId.length <= 12) return `${keyId.slice(0, 4)}…`
  return `${keyId.slice(0, 8)}…${keyId.slice(-4)}`
}

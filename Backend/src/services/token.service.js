const crypto = require("crypto")

function encryptToken(token) {
  const iv = crypto.randomBytes(12)
  const key = Buffer.from(process.env.TOKEN_ENCRYPTION_KEY, "hex")
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv)
  const encrypted = Buffer.concat([
    cipher.update(token, "utf8"),
    cipher.final()
  ])

  return [iv, cipher.getAuthTag(), encrypted]
    .map(part => part.toString("base64url"))
    .join(".")
}

function decryptToken(value) {
  const [iv, tag, encrypted] = value
    .split(".")
    .map(part => Buffer.from(part, "base64url"))

  const key = Buffer.from(process.env.TOKEN_ENCRYPTION_KEY, "hex")
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv)

  decipher.setAuthTag(tag)

  return Buffer.concat([
    decipher.update(encrypted),
    decipher.final()
  ]).toString("utf8")
}

module.exports = { encryptToken, decryptToken }

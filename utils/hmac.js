const crypto = require("crypto")

function verifyHMAC(query, secret) {
  const { hmac, ...rest } = query
  const message = Object.keys(rest).sort().map(k => `${k}=${rest[k]}`).join("&")
  const digest = crypto.createHmac("sha256", secret).update(message).digest("hex")
  return crypto.timingSafeEqual(Buffer.from(hmac, 'utf-8'), Buffer.from(digest, 'utf-8'))
}

module.exports = { verifyHMAC }

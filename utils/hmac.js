const crypto = require("crypto");

exports.verifyHMAC = (query, secret) => {
  const sig = query.hmac || query.signature;
  if (!sig) return false;
  const { hmac, signature, ...rest } = query;
  const msg = Object.keys(rest)
    .sort()
    .map(k => `${k}=${rest[k]}`)
    .join("&");

  const digest = crypto.createHmac("sha256", secret).update(msg).digest("hex");
  return crypto.timingSafeEqual(Buffer.from(sig, "utf8"), Buffer.from(digest, "utf8"));
};

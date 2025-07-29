const express = require("express");
const bodyParser = require("body-parser");
const fs = require("fs");
const path = require("path");
const fetch = global.fetch || require("node-fetch");
const dotenv = require("dotenv");
const { verifyHMAC } = require("./utils/hmac");

dotenv.config();

const app = express();
app.use(bodyParser.json());

const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST;                       // https://cart-sync-app.onrender.com
const API_KEY = process.env.SHOPIFY_API_KEY;
const API_SECRET = process.env.SHOPIFY_API_SECRET;
const SCOPES = process.env.SCOPES;                   // read_customers,write_customers
const TOKEN_STORE = path.join(__dirname, "storage", "tokens.json");

/* ---------- token helpers ---------- */
const getToken = shop => {
  if (!fs.existsSync(TOKEN_STORE)) return null;
  return JSON.parse(fs.readFileSync(TOKEN_STORE))[shop];
};
const saveToken = (shop, token) => {
  const t = fs.existsSync(TOKEN_STORE) ? JSON.parse(fs.readFileSync(TOKEN_STORE)) : {};
  t[shop] = token;
  fs.writeFileSync(TOKEN_STORE, JSON.stringify(t, null, 2));
};

/* ---------- OAuth handshake ---------- */
app.get("/auth", (req, res) => {
  const { shop } = req.query;
  if (!shop) return res.status(400).send("no shop");
  const redirectUri = `${HOST}/auth/callback`;
  const url =
    `https://${shop}/admin/oauth/authorize?client_id=${API_KEY}` +
    `&scope=${SCOPES}&redirect_uri=${redirectUri}`;
  res.redirect(url);
});

app.get("/auth/callback", async (req, res) => {
  const { shop, code } = req.query;
  if (!verifyHMAC(req.query, API_SECRET)) return res.status(400).send("bad hmac");

  const r = await fetch(`https://${shop}/admin/oauth/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ client_id: API_KEY, client_secret: API_SECRET, code })
  }).then(r => r.json());

  saveToken(shop, r.access_token);
  res.send("✅ app installed");
});

/* ---------- restore & save ---------- */
const restoreHandler = async (req, res) => {
  const { shop, customer_id } = req.query;
  if (!verifyHMAC(req.query, API_SECRET)) return res.status(403).send("bad hmac");
  const token = getToken(shop);
  if (!token) return res.status(403).send("unknown shop");

  const url =
    `https://${shop}/admin/api/2023-04/customers/${customer_id}` +
    `/metafields.json?namespace=custom&key=cart_data`;

  const json = await fetch(url, { headers: { "X-Shopify-Access-Token": token } }).then(r => r.json());

  let cart = [];
  try {
    cart = JSON.parse(json.metafields?.[0]?.value || "[]");
  } catch (_) {
  }
  res.json({ cart });
};

app.get ("/app_proxy/cart/restore", restoreHandler);
app.post("/app_proxy/cart/restore", restoreHandler);

app.post("/app_proxy/cart/save", async (req, res) => {
  const { shop, customer_id } = req.query;
  if (!verifyHMAC(req.query, API_SECRET)) return res.status(403).send("bad hmac");
  const token = getToken(shop);
  if (!token) return res.status(403).send("unknown shop");

  const body = {
    metafield: {
      namespace: "custom",
      key: "cart_data",
      type: "json",
      owner_id: customer_id,
      owner_resource: "customer",
      value: JSON.stringify(req.body.cart || [])
    }
  };

  await fetch(`https://${shop}/admin/api/2023-04/metafields.json`, {
    method: "POST",
    headers: { "X-Shopify-Access-Token": token, "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });

  res.sendStatus(204);
});

/* ---------- kick it ---------- */
app.listen(PORT, () => console.log(`cart‑sync server on ${PORT}`));

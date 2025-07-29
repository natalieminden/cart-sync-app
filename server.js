const express = require("express")
const bodyParser = require("body-parser")
const fs = require("fs")
const path = require("path")
const fetch = global.fetch || require("node-fetch")
const dotenv = require("dotenv")
const { verifyHMAC } = require("./utils/hmac")

dotenv.config()

const app = express()
app.use(bodyParser.json())
app.use(express.urlencoded({ extended: true }))
app.use(express.static("public"))

const PORT = process.env.PORT || 3000
const HOST = process.env.HOST
const API_KEY = process.env.SHOPIFY_API_KEY
const API_SECRET = process.env.SHOPIFY_API_SECRET
const SCOPES = process.env.SCOPES
const TOKEN_STORE = path.join(__dirname, "storage", "tokens.json")

function getToken(shop) {
  if (!fs.existsSync(TOKEN_STORE)) return null
  const tokens = JSON.parse(fs.readFileSync(TOKEN_STORE))
  return tokens[shop]
}

function saveToken(shop, token) {
  const tokens = fs.existsSync(TOKEN_STORE) ? JSON.parse(fs.readFileSync(TOKEN_STORE)) : {}
  tokens[shop] = token
  fs.writeFileSync(TOKEN_STORE, JSON.stringify(tokens, null, 2))
}

// install endpoint
app.get("/auth", (req, res) => {
  const shop = req.query.shop
  if (!shop) return res.status(400).send("Missing shop param")
  const redirectUri = `${HOST}/auth/callback`
  const installUrl = `https://${shop}/admin/oauth/authorize?client_id=${API_KEY}&scope=${SCOPES}&redirect_uri=${redirectUri}`
  res.redirect(installUrl)
})

// oauth callback
app.get("/auth/callback", async (req, res) => {
  const { shop, code, hmac } = req.query
  if (!verifyHMAC(req.query, API_SECRET)) return res.status(400).send("HMAC failed")

  const result = await fetch(`https://${shop}/admin/oauth/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: API_KEY,
      client_secret: API_SECRET,
      code
    })
  })

  const json = await result.json()
  saveToken(shop, json.access_token)
  res.send("✅ App installed! You can now sync carts.")
})

// app proxy restore endpoint
app.post("/app_proxy/cart/restore", async (req, res) => {
  const { shop, customer_id } = req.query
  if (!verifyHMAC(req.query, API_SECRET)) return res.status(403).send("Invalid HMAC")
  const token = getToken(shop)
  if (!token) return res.status(403).send("Unknown shop")

  const response = await fetch(`https://${shop}/admin/api/2023-04/customers/${customer_id}/metafields.json?namespace=custom&key=cart_data`, {
    headers: { "X-Shopify-Access-Token": token, "Content-Type": "application/json" }
  })
  const data = await response.json()
  const value = data.metafields?.[0]?.value || null
  res.json({ cart: value })
})

// app proxy save endpoint
app.post("/app_proxy/cart/save", async (req, res) => {
  const { shop, customer_id } = req.query
  if (!verifyHMAC(req.query, API_SECRET)) return res.status(403).send("Invalid HMAC")
  const token = getToken(shop)
  if (!token) return res.status(403).send("Unknown shop")

  const metafield = {
    metafield: {
      namespace: "cart",
      key: "cart_data",
      type: "json",
      value: JSON.stringify(req.body.cart),
      owner_id: customer_id,
      owner_resource: "customer"
    }
  }

  await fetch(`https://${shop}/admin/api/2023-04/metafields.json`, {
    method: "POST",
    headers: { "X-Shopify-Access-Token": token, "Content-Type": "application/json" },
    body: JSON.stringify(metafield)
  })

  res.sendStatus(204)
})

app.listen(PORT, () => {
  console.log(`server running on port ${PORT}`)
})

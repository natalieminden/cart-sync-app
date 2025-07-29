const express = require("express");
const body = require("body-parser");
const fs = require("fs");
const path = require("path");
const fetch = global.fetch || require("node-fetch");
const dotenv = require("dotenv");
const { verifyHMAC } = require("./utils/hmac");

dotenv.config();
const { PORT=3000, HOST, SHOPIFY_API_KEY, SHOPIFY_API_SECRET, SCOPES } = process.env;
const TOKENS = path.join(__dirname, "storage", "tokens.json");

const app = express();
app.use(body.json());
app.use(express.static("public"));          // serves /cart-sync.js

/* ------------ helpers ------------ */
const getToken = s => fs.existsSync(TOKENS)?JSON.parse(fs.readFileSync(TOKENS))[s]:null;
const saveToken = (s,t)=>{
  const j = fs.existsSync(TOKENS)?JSON.parse(fs.readFileSync(TOKENS)):{};
  j[s]=t; fs.mkdirSync("storage",{recursive:true});
  fs.writeFileSync(TOKENS, JSON.stringify(j,null,2));
};

/* ------------ OAuth ------------ */
app.get("/auth",(req,res)=>{
  const { shop } = req.query;
  const redirect = `${HOST}/auth/callback`;
  res.redirect(`https://${shop}/admin/oauth/authorize?client_id=${SHOPIFY_API_KEY}&scope=${SCOPES}&redirect_uri=${redirect}`);
});
app.get("/auth/callback", async (req,res)=>{
  if(!verifyHMAC(req.query, SHOPIFY_API_SECRET)) return res.status(400).send("bad hmac");
  const { shop, code } = req.query;
  const tokenResp = await fetch(`https://${shop}/admin/oauth/access_token`,{
    method:"POST", headers:{ "Content-Type":"application/json" },
    body: JSON.stringify({ client_id:SHOPIFY_API_KEY, client_secret:SHOPIFY_API_SECRET, code })
  }).then(r=>r.json());
  saveToken(shop, tokenResp.access_token);
  res.send("✅ installed");
});

/* ------------ restore ------------ */
const restore = async (req,res)=>{
  if(!verifyHMAC(req.query, SHOPIFY_API_SECRET)) return res.status(403).send("bad hmac");
  const { shop, customer_id } = req.query;
  const token = getToken(shop); if(!token) return res.status(403).send("no token");

  const url = `https://${shop}/admin/api/2025-07/customers/${customer_id}/metafields.json?namespace=custom&key=cart_data`;
  const json = await fetch(url, { headers:{ "X-Shopify-Access-Token":token } }).then(r=>r.json());
  let cart=[];
  try{ cart = JSON.parse(json.metafields?.[0]?.value || "[]"); }catch(_){}
  res.json({ cart });
};
app.get ("/app_proxy/cart/restore", restore);
app.post("/app_proxy/cart/restore", restore);

/* ------------ save ------------ */
app.post("/app_proxy/cart/save", async (req,res)=>{
  if(!verifyHMAC(req.query, SHOPIFY_API_SECRET)) return res.status(403).send("bad hmac");
  const { shop, customer_id } = req.query;
  const token = getToken(shop); if(!token) return res.status(403).send("no token");

  await fetch(`https://${shop}/admin/api/2025-07/metafields.json`,{
    method:"POST",
    headers:{ "X-Shopify-Access-Token":token, "Content-Type":"application/json" },
    body: JSON.stringify({
      metafield:{
        namespace:"custom", key:"cart_data", type:"json",
        owner_id:customer_id, owner_resource:"customer",
        value: JSON.stringify(req.body.cart || [])
      }
    })
  });
  res.sendStatus(204);
});

app.listen(PORT,()=>console.log("cart‑sync running on",PORT));

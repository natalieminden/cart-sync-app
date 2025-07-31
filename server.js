// Load environment variables
require('dotenv').config();
const express = require('express');
const crypto = require('crypto');
const fetch = require('node-fetch');  // Use node-fetch for Admin API calls
const app = express();
app.use(express.json());

// Config from .env
const { SHOP, SHOPIFY_API_SECRET, SHOPIFY_ADMIN_TOKEN } = process.env;

// Middleware to verify HMAC on all proxy requests
function verifyProxy(req, res, next) {
  const query = { ...req.query };
  const signature = query.signature;
  if (!signature) return res.status(401).send('Missing signature');
  delete query.signature;
  // Create message by sorting query params alphabetically and concatenating "key=value"
  const message = Object.keys(query).sort().map(key => `${key}=${query[key]}`).join('');
  const hmac = crypto.createHmac('sha256', SHOPIFY_API_SECRET).update(message).digest('hex');
  if (hmac !== signature) {
    console.error('Proxy HMAC validation failed');
    return res.status(401).send('Invalid signature');  // Reject if signature doesn’t match
  }
  return next();
}

// Apply HMAC verification to all routes under /proxy
app.use('/proxy', verifyProxy);

// POST /proxy/save - Save the current cart (items) to the customer metafield
app.post('/proxy/save', async (req, res) => {
  const customerId = req.query.logged_in_customer_id;
  if (!customerId) {
    return res.status(401).json({ error: 'Not logged in' });
  }
  const { items } = req.body;
  if (!Array.isArray(items)) {
    return res.status(400).json({ error: 'No items provided' });
  }
  try {
    // Prepare metafield payload
    const metafield = {
      namespace: 'custom',
      key: 'cart_data',
      type: 'json',
      value: JSON.stringify({ items })  // store { items: [ ... ] }
    };
    // Check if metafield exists for this customer
    const getUrl = `https://${SHOP}/admin/api/2023-04/customers/${customerId}/metafields.json?namespace=${metafield.namespace}&key=${metafield.key}`;
    const apiHeaders = { 'X-Shopify-Access-Token': SHOPIFY_ADMIN_TOKEN, 'Content-Type': 'application/json' };
    const getResp = await fetch(getUrl, { method: 'GET', headers: apiHeaders });
    const getData = await getResp.json();
    if (getData.metafields && getData.metafields.length) {
      // Update existing metafield
      const existingId = getData.metafields[0].id;
      const updateUrl = `https://${SHOP}/admin/api/2023-04/metafields/${existingId}.json`;
      await fetch(updateUrl, { method: 'PUT', headers: apiHeaders, body: JSON.stringify({ metafield }) });
    } else {
      // Create new metafield for this customer
      metafield.owner_id = customerId;
      metafield.owner_resource = 'customer';
      const createUrl = `https://${SHOP}/admin/api/2023-04/metafields.json`;
      await fetch(createUrl, { method: 'POST', headers: apiHeaders, body: JSON.stringify({ metafield }) });
    }
    return res.json({ success: true });
  } catch (error) {
    console.error('Error saving cart metafield:', error);
    // Do NOT fail the store experience; just report an error status
    return res.status(500).json({ success: false, error: 'Server error saving cart' });
  }
});

// GET /proxy/restore - Retrieve saved cart from metafield
app.get('/proxy/restore', async (req, res) => {
  const customerId = req.query.logged_in_customer_id;
  if (!customerId) {
    return res.status(401).json({ error: 'Not logged in' });
  }
  try {
    const url = `https://${SHOP}/admin/api/2023-04/customers/${customerId}/metafields.json?namespace=custom&key=cart_data`;
    const resp = await fetch(url, { headers: { 'X-Shopify-Access-Token': SHOPIFY_ADMIN_TOKEN } });
    const data = await resp.json();
    if (!data.metafields || data.metafields.length === 0) {
      return res.json({ items: [] });  // No saved cart found
    }
    const metafield = data.metafields[0];
    // Parse metafield value (JSON string) to object
    let savedItems = [];
    try {
      const parsed = JSON.parse(metafield.value);
      savedItems = parsed.items || [];
    } catch (e) {
      console.error('Could not parse saved cart JSON:', e);
    }
    return res.json({ items: savedItems });
  } catch (error) {
    console.error('Error retrieving cart metafield:', error);
    return res.status(500).json({ error: 'Server error restoring cart' });
  }
});

// root endpoint to verify app is running
app.get('/', (req, res) => res.send('Cart Sync App Running'));

// Start the server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`App listening on port ${PORT}`);
});

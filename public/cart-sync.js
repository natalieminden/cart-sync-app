/*
 * Theme script for account‑based cart sync.
 *
 * This script restores a saved cart from the server when a logged‑in
 * customer visits the storefront, and automatically persists cart
 * changes back to the server.  It is written to be theme‑agnostic
 * and should work with modern Shopify themes like Dawn and Symmetry.
 *
 * Usage: Upload this file to your theme’s assets directory (for
 * example `assets/cart-sync.js`), then include it in your theme
 * layout with `{{ 'cart-sync.js' | asset_url | script_tag }}`.
 */

(() => {
  // Fetch the current cart JSON using the Ajax API.
  async function fetchCart() {
    const response = await fetch('/cart.js');
    if (!response.ok) throw new Error('Failed to fetch cart');
    return response.json();
  }

  // Compare two sets of cart items.  We only compare variant IDs,
  // quantities and properties.  The order of items doesn’t matter.
  function cartsAreEqual(a, b) {
    if (a.length !== b.length) return false;
    const repr = (items) =>
      items
        .map((item) => {
          const props = item.properties && Object.keys(item.properties).length
            ? JSON.stringify(item.properties)
            : '';
          const plan = item.selling_plan || '';
          return `${item.id}:${item.quantity}:${props}:${plan}`;
        })
        .sort()
        .join('|');
    return repr(a) === repr(b);
  }

  // Restore the saved cart for the logged‑in customer.  This calls
  // `/apps/cart-sync/restore` which returns an array of items.  If the
  // saved cart differs from the current cart, the current cart is
  // replaced using `/cart/clear.js` followed by a single call to
  // `/cart/add.js` with the array of items.
  async function restoreCart() {
    try {
      const res = await fetch('/apps/cart-sync/restore');
      // Not logged in or invalid signature – abort silently.
      if (!res.ok) return;
      const data = await res.json();
      const savedItems = (data && data.items) || [];
      if (!Array.isArray(savedItems) || savedItems.length === 0) return;
      const currentCart = await fetchCart();
      const currentItems = (currentCart && currentCart.items) || [];
      if (cartsAreEqual(
        currentItems.map((i) => ({ id: i.variant_id, quantity: i.quantity, properties: i.properties || {}, selling_plan: i.selling_plan })),
        savedItems
      )) {
        return;
      }
      // Clear existing cart and add saved items.
      await fetch('/cart/clear.js', { method: 'POST' });
      await fetch('/cart/add.js', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: savedItems })
      });
    } catch (err) {
      // Errors are swallowed to avoid breaking the customer flow.
      console.error('Cart restore failed', err);
    }
  }

  // Save the current cart to the server for the logged‑in customer.
  // It serializes the cart items into an array of objects with id,
  // quantity, properties and selling_plan, then posts them to
  // `/apps/cart-sync/save`.  The server handles updating the
  // metafield.
  async function saveCart() {
    try {
      const cart = await fetchCart();
      const items = (cart.items || []).map((line) => {
        const obj = {
          id: line.variant_id,
          quantity: line.quantity
        };
        if (line.properties && Object.keys(line.properties).length) {
          obj.properties = line.properties;
        }
        if (line.selling_plan) {
          obj.selling_plan = line.selling_plan;
        }
        return obj;
      });
      await fetch('/apps/cart-sync/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(items)
      });
    } catch (err) {
      console.error('Cart save failed', err);
    }
  }

  // Hook into theme cart events.  Many themes, including Dawn and
  // Symmetry, use fetch requests to `/cart/add.js`, `/cart/change.js`,
  // `/cart/update.js`, and `/cart/clear.js` when the cart changes.
  // We override the global fetch function to detect these requests and
  // call `saveCart` after they complete.  Other network requests are
  // forwarded unchanged.
  function patchFetchForCart() {
    const originalFetch = window.fetch;
    window.fetch = async function(resource, config) {
      const response = await originalFetch.call(this, resource, config);
      try {
        const url = typeof resource === 'string' ? resource : resource.url;
        if (/\/cart\/(add|change|update|clear)\.js(?:\?.*)?$/.test(url)) {
          // Clone the response to avoid consuming its body.
          response.clone().json().then(() => saveCart()).catch(() => {});
        }
      } catch (e) {
        console.error(e);
      }
      return response;
    };
  }

  document.addEventListener('DOMContentLoaded', () => {
    restoreCart();
    patchFetchForCart();
  });
})();
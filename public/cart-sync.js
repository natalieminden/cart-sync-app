(() => {
  /* ---------------------------------
     read shop + customer ID from query
  --------------------------------- */
  const p     = new URLSearchParams(location.search);
  const shop  = p.get("shop");
  const cid   = p.get("cid");
  if (!shop || !cid) return;           // bail if guest

  /*  tiny helpers  */
  const j   = (u, o = {}) =>
    fetch(u, o).then(r => {
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.text().then(t => (t ? JSON.parse(t) : {}));
    });
  const map = items => items.map(l => ({ id: l.id, quantity: l.quantity }));

  /*  ---- RESTORE on first load ----------------------------- */
  document.addEventListener("DOMContentLoaded", async () => {
    try {
      const data = await j(
        `/apps/cart-sync/restore?shop=${shop}&customer_id=${cid}`
      );
      console.log("cart‑sync restore →", data);
      if (!Array.isArray(data.cart) || !data.cart.length) return;

      await fetch("/cart/clear.js", { method: "POST" });
      for (const line of data.cart) {
        await fetch("/cart/add.js", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: line.id, quantity: line.quantity })
        });
      }
    } catch (e) {
      console.warn("cart‑sync restore failed:", e);
    }
  });

  /*  ---- SAVE after every change --------------------------- */
  const save = async () => {
    try {
      const cart = await j("/cart.js");
      await j(
        `/apps/cart-sync/save?shop=${shop}&customer_id=${cid}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ cart: map(cart.items) })
        }
      );
    } catch (e) {
      console.warn("cart‑sync save failed:", e);
    }
  };

  /*  intercept Shopify AJAX cart calls  */
  const nativeFetch = window.fetch.bind(window);
  window.fetch = async (...args) => {
    const [url] = args;
    const res = await nativeFetch(...args);
    if (
      typeof url === "string" &&
      /\\/cart\\/(add|update|change|clear)\\.js/.test(url)
    ) {
      save();
    }
    return res;
  };

  window.addEventListener("beforeunload", save);
})();

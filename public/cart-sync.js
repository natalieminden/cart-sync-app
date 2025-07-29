(() => {
  const p    = new URLSearchParams(location.search);
  const shop = p.get("shop");
  const cid  = p.get("cid");
  if (!shop || !cid) return;

  const j   = (u,o={}) => fetch(u,o).then(r => r.json());
  const map = a => a.map(l => ({ id:l.id, quantity:l.quantity }));

  /* restore */
  document.addEventListener("DOMContentLoaded", async () => {
    try {
      const data = await j(`/apps/cart-sync/restore?shop=${shop}&customer_id=${cid}`);
      if (!Array.isArray(data.cart) || !data.cart.length) return;
      await fetch("/cart/clear.js", { method:"POST" });
      for (const l of data.cart) {
        await fetch("/cart/add.js", {
          method:"POST",
          headers:{ "Content-Type":"application/json" },
          body: JSON.stringify({ id:l.id, quantity:l.quantity })
        });
      }
    } catch(e){ console.warn("restore fail",e); }
  });

  /* save */
  async function save(){
    try{
      const cart = await j("/cart.js");
      await j(`/apps/cart-sync/save?shop=${shop}&customer_id=${cid}`,{
        method:"POST",
        headers:{ "Content-Type":"application/json" },
        body: JSON.stringify({ cart: map(cart.items) })
      });
    }catch(e){ console.warn("save fail",e); }
  }

  const orig = window.fetch.bind(window);
  window.fetch = async (...a)=>{
    const [url] = a;
    const r = await orig(...a);
    if (typeof url==="string" && /\\/cart\\/(add|update|change|clear)\\.js/.test(url)) save();
    return r;
  };
  window.addEventListener("beforeunload", save);
})();

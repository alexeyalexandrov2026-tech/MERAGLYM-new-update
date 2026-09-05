(() => {
"use strict";
const $ = (id) => document.getElementById(id);
const state = { products: [], cart: JSON.parse(localStorage.getItem("cart") || "{}"), view: "catalog", order: null, error: "" };

const money = (m, c) => (m/100).toFixed(2) + " " + (c||"USD").toUpperCase();
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, ch => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[ch]));
const saveCart = () => { localStorage.setItem("cart", JSON.stringify(state.cart)); renderPill(); };
const cartCount = () => Object.values(state.cart).reduce((a,b)=>a+b,0);
const cartLines = () => Object.entries(state.cart)
  .map(([sku,q]) => ({ p: state.products.find(x=>x.sku===sku), q }))
  .filter(x => x.p);
const subtotal = () => cartLines().reduce((a,l)=>a + l.p.unit_price_minor*l.q, 0);

function renderPill(){ const n = cartCount(); $("pill").hidden = n===0; $("pill").textContent = n; }
const go = (v) => { state.view = v; state.error=""; render(); window.scrollTo(0,0); };

function catalogView(){
  if(!state.products.length) return `<div class="empty">Каталог пуст. Загрузите товары: <code>python -m app.seed</code></div>`;
  return `<h1>Обжарка и всё для заваривания</h1>
  <p class="lede">Небольшая обжарочная. Свежее зерно и оборудование — цену всегда считает сервер, не браузер.</p>
  <div class="grid">${state.products.map(p => {
    const inCart = state.cart[p.sku] || 0;
    const low = p.stock_available > 0 && p.stock_available <= 5;
    return `<article class="card">
      <div class="sku">${esc(p.sku)}</div>
      <h3>${esc(p.name)}</h3>
      <p>${esc(p.description)}</p>
      <div class="price">${money(p.unit_price_minor, p.currency)}</div>
      <div class="stock ${low?'low':''}">${p.stock_available>0 ? (low?`осталось ${p.stock_available}`:`в наличии: ${p.stock_available}`) : "нет в наличии"}</div>
      <div class="row">${
        p.stock_available<=0 ? `<button class="btn" disabled>Нет в наличии</button>`
        : inCart ? `<div class="qty"><button data-act="dec" data-sku="${esc(p.sku)}">−</button><span>${inCart}</span><button data-act="inc" data-sku="${esc(p.sku)}">+</button></div>`
        : `<button class="btn" data-act="inc" data-sku="${esc(p.sku)}">В корзину</button>`
      }</div></article>`;
  }).join("")}</div>`;
}

const inc = (sku) => { const p = state.products.find(x=>x.sku===sku);
  const n = (state.cart[sku]||0)+1; if(p && n<=p.stock_available){ state.cart[sku]=n; saveCart(); render(); } };
const dec = (sku) => { const n=(state.cart[sku]||0)-1; if(n<=0) delete state.cart[sku]; else state.cart[sku]=n; saveCart(); render(); };

function cartView(){
  const lines = cartLines();
  if(!lines.length) return `<h1>Корзина</h1><div class="empty">Пока пусто. <button class="ghost" data-act="go" data-view="catalog">К каталогу</button></div>`;
  return `<h1>Корзина</h1>
  <table><thead><tr><th>Товар</th><th>Кол-во</th><th class="num">Сумма</th></tr></thead><tbody>
  ${lines.map(l=>`<tr><td>${esc(l.p.name)}<div class="sku">${esc(l.p.sku)}</div></td>
    <td><div class="qty"><button data-act="dec" data-sku="${esc(l.p.sku)}">−</button><span>${l.q}</span><button data-act="inc" data-sku="${esc(l.p.sku)}">+</button></div></td>
    <td class="num">${money(l.p.unit_price_minor*l.q, l.p.currency)}</td></tr>`).join("")}
  <tr class="total"><td colspan="2">Товары</td><td class="num">${money(subtotal(), lines[0].p.currency)}</td></tr>
  </tbody></table>
  <p class="note">Доставка добавляется на следующем шаге — её тоже считает сервер.</p>
  <div class="row"><button class="btn" data-act="go" data-view="checkout">Оформить заказ</button>
  <button class="ghost" data-act="go" data-view="catalog">Продолжить покупки</button></div>`;
}

function checkoutView(){
  return `<h1>Оформление</h1>
  <p class="lede">Дальше вы перейдёте на страницу оплаты провайдера. Реквизиты карты в магазин не попадают.</p>
  ${state.error?`<p class="err">${esc(state.error)}</p>`:""}
  <form id="checkout-form">
    <label>Электронная почта<input name="email" type="email" required placeholder="you@example.com" value="buyer@example.com"></label>
    <label>Имя<input name="customer_name" placeholder="Иван Петров" value="Sam Buyer"></label>
    <label>Адрес<input name="line1" required placeholder="ул. Примерная, 12" value="12 Example Street"></label>
    <div class="two">
      <label>Город<input name="city" required value="Springfield"></label>
      <label>Индекс<input name="postal_code" required value="12345"></label>
    </div>
    <label>Страна (2 буквы)<input name="country" required maxlength="2" value="US" style="text-transform:uppercase"></label>
    <div class="row"><button class="btn" type="submit" id="pay">Перейти к оплате — ${money(subtotal(), (cartLines()[0]||{p:{}}).p.currency)} + доставка</button>
    <button class="ghost" type="button" data-act="go" data-view="cart">Назад</button></div>
  </form>`;
}

const submitOrder = async (ev) => {
  ev.preventDefault();
  const f = new FormData(ev.target), btn = $("pay");
  btn.disabled = true; btn.textContent = "Создаём заказ…";
  const body = {
    email: f.get("email"), customer_name: f.get("customer_name") || null,
    items: cartLines().map(l => ({ sku: l.p.sku, quantity: l.q })),
    shipping_address: { line1: f.get("line1"), city: f.get("city"),
      postal_code: f.get("postal_code"), country: String(f.get("country")).toUpperCase() }
  };
  try{
    const r = await fetch("/api/checkout/sessions", { method:"POST",
      headers:{"Content-Type":"application/json"}, body: JSON.stringify(body) });
    const data = await r.json();
    if(!r.ok) throw new Error(data?.error?.message || "Не удалось создать заказ");
    localStorage.setItem("lastOrder", JSON.stringify({ id:data.order_id, url:data.order_status_url, ref:data.reference }));
    state.cart = {}; saveCart();
    window.location.href = data.checkout_url;      // provider-hosted payment page
  }catch(e){
    state.error = e.message; btn.disabled = false; render();
  }
};

const ORDER_STATUS = {
  pending_payment: "ожидает оплаты", paid: "оплачен", fulfilled: "выполнен",
  partially_refunded: "частично возвращён", refunded: "возвращён",
  cancelled: "отменён", expired: "просрочен", failed: "не прошёл",
};
const FULFILLMENT_STATUS = {
  unfulfilled: "не отправлен", in_progress: "собирается",
  shipped: "отправлен", delivered: "доставлен", cancelled: "отменён",
};

function orderView(){
  const o = state.order;
  if(!o) return `<div class="empty">Заказ не найден.</div>`;
  const good = ["paid","fulfilled","partially_refunded","refunded"].includes(o.status);
  const refunded = o.amount_refunded_minor || 0;
  const ship = o.shipping_address;
  return `<h1>Заказ ${esc(o.reference)}</h1>
  <p><span class="badge ${good?'paid':'pending'}">${esc(ORDER_STATUS[o.status] || o.status)}</span>
  ${o.fulfillment_status ? `<span class="badge">${esc(FULFILLMENT_STATUS[o.fulfillment_status] || o.fulfillment_status)}</span>` : ""}</p>
  <table><thead><tr><th>Товар</th><th>Кол-во</th><th class="num">Сумма</th></tr></thead><tbody>
  ${o.items.map(i=>`<tr><td>${esc(i.name)}<div class="sku">${esc(i.sku)}</div></td><td>${i.quantity}</td>
    <td class="num">${money(i.line_total_minor,o.currency)}</td></tr>`).join("")}
  <tr><td colspan="2">Доставка</td><td class="num">${money(o.shipping_minor,o.currency)}</td></tr>
  <tr class="total"><td colspan="2">Итого</td><td class="num">${money(o.total_minor,o.currency)}</td></tr>
  ${refunded ? `<tr><td colspan="2">Возвращено</td><td class="num">− ${money(refunded,o.currency)}</td></tr>
  <tr class="total"><td colspan="2">Осталось оплаченным</td>
    <td class="num">${money(o.total_minor - refunded, o.currency)}</td></tr>` : ""}
  </tbody></table>
  ${(o.refunds && o.refunds.length) ? `<h2>Возвраты</h2><table><tbody>${o.refunds.map(r=>
    `<tr><td>${esc(r.reason || "возврат")}<div class="sku">${esc(r.status)}</div></td>
     <td class="num">${money(r.amount_minor, r.currency || o.currency)}</td></tr>`).join("")}</tbody></table>` : ""}
  ${ship ? `<h2>Доставка</h2><p class="lede">${esc(ship.line1)}${ship.line2?", "+esc(ship.line2):""}<br>
    ${esc(ship.city)}, ${esc(ship.postal_code)}<br>${esc(ship.country)}</p>` : ""}
  <p class="note">Чек уходит на ${esc(o.customer_email)} фоновым процессом. Если письмо не отправится, заказ от этого не отменится.</p>
  <button class="ghost" data-act="go" data-view="catalog">В каталог</button>`;
}

function render(){
  renderPill();
  $("view").innerHTML = state.view==="catalog" ? catalogView()
    : state.view==="cart" ? cartView()
    : state.view==="checkout" ? checkoutView()
    : orderView();
}

// One delegated listener instead of inline on* attributes: the storefront is
// served under `script-src 'self'`, which blocks inline event handlers.
document.addEventListener("click", (ev) => {
  const el = ev.target.closest("[data-act]");
  if(!el) return;
  const { act, sku, view } = el.dataset;
  if(act === "inc") inc(sku);
  else if(act === "dec") dec(sku);
  else if(act === "go") go(view);
});
document.addEventListener("submit", (ev) => {
  if(ev.target.id === "checkout-form") submitOrder(ev);
});

async function boot(){
  const q = new URLSearchParams(location.search);
  const orderId = q.get("order"), token = q.get("token");
  try{
    const r = await fetch("/api/catalog/products?limit=100");
    state.products = (await r.json()).items || [];
  }catch{ state.products = []; }
  if(orderId && token){
    try{
      const r = await fetch(`/api/orders/${encodeURIComponent(orderId)}?token=${encodeURIComponent(token)}`);
      if(r.ok){ state.order = await r.json(); state.view = "order"; }
    }catch{}
  }
  render();
}
boot();
})();

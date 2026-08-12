let loggedInUser = null;
let pendingOrder = null;
let cartProducts = {};
let cartEventsBound = false;

function calcCartTotal() {
  let total = 0;
  for (const item of Cart.get()) {
    const product = cartProducts[item.productId];
    if (!product) continue;
    total += getItemPrice(product, item.unitType || 'pack') * item.quantity;
  }
  return total;
}

function renderCartItem(product, item) {
  const unitType = item.unitType || 'pack';
  const price = getItemPrice(product, unitType);
  const lineTotal = price * item.quantity;
  const unavailable = !isProductInStock(product);

  return `
    <article class="cart-item${unavailable ? ' cart-item-unavailable' : ''}" data-product="${product.id}" data-unit="${unitType}">
      <h3 class="cart-item-name">${escapeHtml(product.name)}</h3>
      ${unavailable ? '<p class="cart-item-warning">Нет в наличии</p>' : ''}
      <p class="cart-item-sub">${unitLabel(unitType)} · ${formatPrice(price)} за ед.</p>
      <div class="cart-item-row">
        ${renderQtyStepper(item.quantity)}
        <strong class="cart-item-total" data-line-total>${formatPrice(lineTotal)}</strong>
        <button type="button" class="btn btn-outline btn-sm cart-item-remove"
          data-remove="${product.id}" data-unit="${unitType}">Удалить</button>
      </div>
    </article>`;
}

function renderCartTableRow(product, item) {
  const unitType = item.unitType || 'pack';
  const price = getItemPrice(product, unitType);
  const lineTotal = price * item.quantity;
  const unavailable = !isProductInStock(product);

  return `
    <tr class="${unavailable ? 'cart-item-unavailable' : ''}" data-product="${product.id}" data-unit="${unitType}">
      <td>
        ${escapeHtml(product.name)}
        ${unavailable ? '<div class="cart-item-warning">Нет в наличии</div>' : ''}
      </td>
      <td>${unitLabel(unitType)}</td>
      <td>${formatPrice(price)}</td>
      <td>${renderQtyStepper(item.quantity)}</td>
      <td data-line-total>${formatPrice(lineTotal)}</td>
      <td>
        <button type="button" class="btn btn-danger btn-sm" data-remove="${product.id}" data-unit="${unitType}">Удалить</button>
      </td>
    </tr>`;
}

function renderCheckoutHintHtml() {
  if (loggedInUser?.is_admin) {
    return 'Оформление доступно только клиентам';
  }
  if (!loggedInUser) {
    return 'Для оформления <a href="/login.html">войдите</a> в аккаунт';
  }
  return '';
}

function renderDesktopSummaryHtml(total, canCheckout, checkoutLabel) {
  const hint = renderCheckoutHintHtml();
  return `
    <h3>Итого</h3>
    <div class="summary-row summary-total">
      <span>К оплате:</span>
      <span data-cart-total>${formatPrice(total)}</span>
    </div>
    ${!canCheckout && hint ? `<p class="cart-checkout-hint">${hint}</p>` : ''}
    <div class="cart-summary-actions">
      <button type="button" class="btn btn-primary cart-checkout-btn"
        ${canCheckout ? '' : 'disabled'}>${checkoutLabel}</button>
      <button type="button" class="btn btn-outline cart-clear-btn">Очистить корзину</button>
    </div>`;
}

function renderMobileBarHtml(total, canCheckout, checkoutLabel) {
  const hint = renderCheckoutHintHtml();
  return `
    <div class="cart-bar-total">
      <span>К оплате:</span>
      <strong data-cart-total>${formatPrice(total)}</strong>
    </div>
    ${!canCheckout && hint ? `<p class="cart-bar-note">${hint}</p>` : ''}
    <div class="cart-bar-actions">
      <button type="button" class="btn btn-primary cart-checkout-btn"
        ${canCheckout ? '' : 'disabled'}>${checkoutLabel}</button>
      <button type="button" class="btn btn-outline cart-clear-btn">Очистить</button>
    </div>`;
}

let checkoutBound = false;

function bindCheckoutButtons() {
  if (checkoutBound) return;
  checkoutBound = true;

  document.body.addEventListener('click', (e) => {
    if (e.target.closest('.cart-clear-btn')) {
      if (confirm('Очистить корзину?')) {
        Cart.clear();
        renderCart();
      }
      return;
    }
    if (e.target.closest('.cart-checkout-btn')) {
      onCheckout();
    }
  });
}

function updateCartDisplay() {
  document.querySelectorAll('[data-cart-total]').forEach(el => {
    el.textContent = formatPrice(calcCartTotal());
  });

  for (const item of Cart.get()) {
    const product = cartProducts[item.productId];
    if (!product) continue;
    const unitType = item.unitType || 'pack';
    const price = getItemPrice(product, unitType);
    const lineTotal = price * item.quantity;

    document.querySelectorAll(`[data-product="${item.productId}"][data-unit="${unitType}"]`).forEach(row => {
      const qtyEl = row.querySelector('[data-qty-value]');
      const totalEl = row.querySelector('[data-line-total]');
      if (qtyEl) qtyEl.textContent = item.quantity;
      if (totalEl) totalEl.textContent = formatPrice(lineTotal);
    });
  }
}

function bindCartEvents() {
  if (cartEventsBound) return;
  cartEventsBound = true;

  document.getElementById('cart-content').addEventListener('click', (e) => {
    const stepBtn = e.target.closest('[data-step]');
    const removeBtn = e.target.closest('[data-remove]');

    if (removeBtn) {
      Cart.remove(parseInt(removeBtn.dataset.remove), removeBtn.dataset.unit);
      renderCart();
      return;
    }

    if (!stepBtn) return;

    const row = stepBtn.closest('[data-product]');
    if (!row) return;

    const productId = parseInt(row.dataset.product);
    const unitType = row.dataset.unit;
    const delta = parseInt(stepBtn.dataset.step);
    const item = Cart.get().find(i => i.productId === productId && (i.unitType || 'pack') === unitType);
    if (!item) return;

    const newQty = item.quantity + delta;
    if (newQty < 1) {
      if (confirm('Убрать товар из корзины?')) {
        Cart.remove(productId, unitType);
        renderCart();
      }
      return;
    }

    Cart.updateQuantity(productId, unitType, newQty);
    updateCartDisplay();
  });
}

async function onCheckout() {
  const canCheckout = loggedInUser && !loggedInUser.is_admin;
  if (!canCheckout) return;

  const alertArea = document.getElementById('alert-area');
  try {
    const result = await api('/api/orders/checkout', {
      method: 'POST',
      body: JSON.stringify({ items: Cart.get() }),
    });

    Cart.clear();
    const msg = result.merged
      ? `Товары добавлены к заказу #${result.orderId}! Новая сумма: ${formatPrice(result.total)}`
      : `Заказ #${result.orderId} оформлен! Статус: Ожидание`;
    showAlert(alertArea, msg, 'success');
    loadUserInfo();
    setTimeout(() => { location.href = '/account.html'; }, 1500);
  } catch (err) {
    showAlert(alertArea, err.message, 'error');
  }
}

async function renderCart() {
  const container = document.getElementById('cart-content');
  const bar = document.getElementById('cart-bar');
  const cartItems = Cart.get();

  try {
    loggedInUser = await api('/api/auth/me');
    pendingOrder = loggedInUser && !loggedInUser.is_admin
      ? await api('/api/orders/pending').catch(() => null)
      : null;
  } catch {
    loggedInUser = null;
    pendingOrder = null;
  }

  bindCartEvents();

  if (!cartItems.length) {
    bar.hidden = true;
    bar.innerHTML = '';
    document.body.classList.remove('cart-has-hint');
    container.innerHTML = `
      <div class="empty-state">
        <h2>Корзина пуста</h2>
        <p><a href="/">Перейти в каталог</a></p>
      </div>`;
    return;
  }

  let products;
  try {
    products = await api('/api/products');
  } catch (err) {
    bar.hidden = true;
    container.innerHTML = `<p class="alert alert-error">${err.message}</p>`;
    return;
  }

  cartProducts = Object.fromEntries(products.map(p => [p.id, p]));
  let total = 0;
  const mobileItems = [];
  const tableRows = [];

  for (const item of cartItems) {
    const product = cartProducts[item.productId];
    if (!product) continue;
    const unitType = item.unitType || 'pack';
    total += getItemPrice(product, unitType) * item.quantity;
    mobileItems.push(renderCartItem(product, item));
    tableRows.push(renderCartTableRow(product, item));
  }

  const hasUnavailable = cartItems.some(item => {
    const product = cartProducts[item.productId];
    return product && !isProductInStock(product);
  });
  const canCheckout = loggedInUser && !loggedInUser.is_admin && !hasUnavailable;
  document.body.classList.toggle('cart-has-hint', !canCheckout);
  const checkoutLabel = pendingOrder
    ? `Добавить к заказу #${pendingOrder.id}`
    : 'Оформить заказ';
  const pendingAlert = pendingOrder ? `
    <div class="alert alert-success cart-alert">
      У вас заказ в ожидании #${pendingOrder.id}. Новые товары будут добавлены к нему.
    </div>
  ` : '';
  const unavailableAlert = hasUnavailable ? `
    <div class="alert alert-error cart-alert">
      В корзине есть товары, которых нет в наличии. Удалите их, чтобы оформить заказ.
    </div>
  ` : '';

  container.innerHTML = `
    ${pendingAlert}
    ${unavailableAlert}
    <div class="cart-layout cart-desktop-only">
      <table class="cart-table">
        <thead>
          <tr>
            <th>Товар</th>
            <th>Ед.</th>
            <th>Цена</th>
            <th>Кол-во</th>
            <th>Сумма</th>
            <th></th>
          </tr>
        </thead>
        <tbody>${tableRows.join('')}</tbody>
      </table>
      <aside class="cart-summary">${renderDesktopSummaryHtml(total, canCheckout, checkoutLabel)}</aside>
    </div>
    <div class="cart-mobile-only">
      <div class="cart-items">${mobileItems.join('')}</div>
    </div>`;

  bar.hidden = false;
  bar.innerHTML = `<div class="cart-bar-inner cart-mobile-only">${renderMobileBarHtml(total, canCheckout, checkoutLabel)}</div>`;

  bindCheckoutButtons();
}

renderCart();

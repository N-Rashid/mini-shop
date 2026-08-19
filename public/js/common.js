const CART_KEY = 'izberbash-cart';
const SITE_PHONE = '+79034779706';
const SITE_PHONE_DISPLAY = '+7 (903) 477-97-06';
const SITE_EMAIL = 'morozhenoe-izberbash@yandex.ru';
const SITE_NAME = 'Мороженое Избербаш';
const SHOP_ADDRESS = 'Советская 11/1, Избербаш';
const SHOP_HOURS = 'График работы: 8:00–18:00, без выходных';
const SHOP_WHATSAPP = '79034779706';
const SHOP_WHATSAPP_URL = `https://wa.me/${SHOP_WHATSAPP}`;

const Cart = {
  get() {
    try {
      return JSON.parse(localStorage.getItem(CART_KEY)) || [];
    } catch {
      return [];
    }
  },

  save(items) {
    localStorage.setItem(CART_KEY, JSON.stringify(items));
    Cart.updateBadge();
    updateMiniCartBar();
  },

  add(productId, quantity = 1, unitType = 'pack') {
    const items = Cart.get();
    const existing = items.find(i => i.productId === productId && i.unitType === unitType);
    if (existing) {
      existing.quantity += quantity;
    } else {
      items.push({ productId, quantity, unitType });
    }
    Cart.save(items);
  },

  remove(productId, unitType) {
    Cart.save(Cart.get().filter(i => !(i.productId === productId && i.unitType === unitType)));
  },

  updateQuantity(productId, unitType, quantity) {
    const items = Cart.get();
    const item = items.find(i => i.productId === productId && i.unitType === unitType);
    if (item) {
      if (quantity <= 0) {
        Cart.remove(productId, unitType);
      } else {
        item.quantity = quantity;
        Cart.save(items);
      }
    }
  },

  clear() {
    localStorage.removeItem(CART_KEY);
    Cart.updateBadge();
    updateMiniCartBar();
  },

  count() {
    return Cart.get().reduce((sum, i) => sum + i.quantity, 0);
  },

  updateBadge() {
    const badge = document.getElementById('cart-badge');
    if (badge) {
      const count = Cart.count();
      badge.textContent = count;
      badge.style.display = count > 0 ? 'inline-flex' : 'none';
    }
  },
};

const Favorites = {
  ids: new Set(),

  async load() {
    try {
      const data = await api('/api/favorites/ids');
      this.ids = new Set((data.ids || []).map(Number));
    } catch {
      this.ids = new Set();
    }
    this.syncButtons();
  },

  isFavorite(productId) {
    return this.ids.has(Number(productId));
  },

  async add(productId) {
    await api(`/api/favorites/${productId}`, { method: 'POST' });
    this.ids.add(Number(productId));
    this.syncButtons();
  },

  async remove(productId) {
    await api(`/api/favorites/${productId}`, { method: 'DELETE' });
    this.ids.delete(Number(productId));
    this.syncButtons();
  },

  async toggle(productId) {
    if (this.isFavorite(productId)) {
      await this.remove(productId);
      return false;
    }
    await this.add(productId);
    return true;
  },

  syncButtons(root = document) {
    root.querySelectorAll('[data-favorite]').forEach(btn => {
      const id = parseInt(btn.dataset.favorite, 10);
      const active = this.isFavorite(id);
      btn.classList.toggle('is-active', active);
      btn.setAttribute('aria-pressed', active ? 'true' : 'false');
      btn.setAttribute('aria-label', active ? 'Убрать из избранного' : 'В избранное');
      btn.title = active ? 'Убрать из избранного' : 'В избранное';
    });
  },
};

async function api(url, options = {}) {
  const res = await fetch(url, {
    credentials: 'same-origin',
    headers: {
      'Content-Type': 'application/json',
      'ngrok-skip-browser-warning': 'true',
      ...options.headers,
    },
    ...options,
  });

  const { data } = await readJsonResponse(res);

  if (!res.ok) {
    throw new Error(data?.error || `Ошибка ${res.status}`);
  }

  return data;
}

async function readJsonResponse(res) {
  const text = await res.text();
  if (!text) return { data: null, text: '' };

  try {
    return { data: JSON.parse(text), text };
  } catch {
    if (res.status === 413) {
      throw new Error('Файл слишком большой. Сожмите фото или загрузите меньше файлов.');
    }
    if (res.status >= 500) {
      throw new Error(`Ошибка сервера (${res.status}). Обновите страницу и попробуйте снова.`);
    }
    throw new Error(`Ошибка запроса (${res.status}). Обновите страницу и попробуйте снова.`);
  }
}

function formatPrice(amount) {
  return new Intl.NumberFormat('ru-RU', {
    style: 'currency',
    currency: 'RUB',
    minimumFractionDigits: 0,
  }).format(amount);
}

function formatDate(dateStr) {
  if (!dateStr) return '—';
  const d = new Date(dateStr.includes('T') ? dateStr : dateStr.replace(' ', 'T') + 'Z');
  if (Number.isNaN(d.getTime())) return dateStr;
  return d.toLocaleString('ru-RU', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

function orderStatusLabel(status) {
  const labels = {
    pending: 'Ожидание',
    accepted: 'Заказ принят',
    completed: 'Выполнен',
  };
  return labels[status] || status;
}

function orderStatusClass(status) {
  return {
    pending: 'badge-pending',
    accepted: 'badge-accepted',
    completed: 'badge-completed',
  }[status] || 'badge-active';
}

function addOrderItemsToCart(items) {
  let added = 0;
  for (const item of items || []) {
    if (!item.product_id || item.product_unavailable) continue;
    Cart.add(item.product_id, item.quantity, item.unit_type || 'pack');
    added += 1;
  }
  Cart.updateBadge();
  return added;
}

function formatMultilineText(text) {
  return escapeHtml(text || '').replace(/\n/g, '<br>');
}

function initSiteHeader() {
  const header = document.querySelector('header[data-site-header]');
  if (!header) return;

  const active = header.dataset.nav || '';
  const navLink = (href, label, key) =>
    `<a href="${href}"${active === key ? ' class="active"' : ''}>${label}</a>`;
  const cartLink = (key) => {
    const activeClass = active === key ? ' active' : '';
    return `<a href="/cart.html" class="cart-nav-link${activeClass}" aria-label="Корзина">
      <svg class="cart-nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <circle cx="9" cy="21" r="1"></circle>
        <circle cx="20" cy="21" r="1"></circle>
        <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"></path>
      </svg>
      <span id="cart-badge" class="cart-badge" style="display:none">0</span>
    </a>`;
  };
  const favoritesLink = (key) => {
    const activeClass = active === key ? ' active' : '';
    return `<a href="/favorites.html" class="favorites-nav-link${activeClass}" aria-label="Избранное">
      <svg class="favorites-nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78L12 21.23l8.84-8.84a5.5 5.5 0 0 0 0-7.78z"></path>
      </svg>
    </a>`;
  };

  header.innerHTML = `
    <div class="container header-inner">
      <a href="/" class="logo"><span class="logo-icon">🍦</span> Мороженое Избербаш</a>
      <div class="header-contact-nav">
        <div class="header-phone-col">
          <a href="tel:${SITE_PHONE}" class="header-phone-link">
            <span class="header-info-icon" aria-hidden="true">📞</span>
            ${SITE_PHONE_DISPLAY}
          </a>
          <span class="header-address">
            <span class="header-info-icon" aria-hidden="true">📍</span>
            ${SHOP_ADDRESS}
          </span>
        </div>
        <nav class="header-nav">
          ${navLink('/', 'Каталог', 'catalog')}
          ${favoritesLink('favorites')}
          ${cartLink('cart')}
          ${navLink('/about.html', 'О нас', 'about')}
          <span id="user-info" class="user-info"></span>
        </nav>
      </div>
    </div>`;
}

function renderSiteFooterHtml(showBrand = false) {
  const year = new Date().getFullYear();
  return `
    ${showBrand ? `<p class="site-footer-brand"><strong>${escapeHtml(SITE_NAME)}</strong></p>` : ''}
    <p class="site-footer-row">
      <a href="tel:${SITE_PHONE}">${SITE_PHONE_DISPLAY}</a>
      <span class="site-footer-sep" aria-hidden="true">·</span>
      <a href="mailto:${SITE_EMAIL}">${SITE_EMAIL}</a>
      <span class="site-footer-sep" aria-hidden="true">·</span>
      <a class="site-footer-wa-link" href="${SHOP_WHATSAPP_URL}" target="_blank" rel="noopener">WhatsApp</a>
    </p>
    <p class="site-footer-row">${escapeHtml(SHOP_ADDRESS)}<span class="site-footer-sep" aria-hidden="true">·</span>${escapeHtml(SHOP_HOURS)}</p>
    <nav class="site-footer-nav" aria-label="Навигация в подвале">
      <a href="/">Каталог</a>
      <a href="/favorites.html">Избранное</a>
      <a href="/cart.html">Корзина</a>
      <a href="/about.html">О нас</a>
      <a href="/account.html">Личный кабинет</a>
    </nav>
    <p class="site-footer-copy">© ${year} ${escapeHtml(SITE_NAME)}</p>`;
}

function initSiteFooter() {
  document.querySelectorAll('footer[data-site-footer]').forEach(footer => {
    const showBrand = footer.dataset.showBrand === 'true';
    footer.innerHTML = renderSiteFooterHtml(showBrand);
  });
}

function showAlert(container, message, type = 'error') {
  const el = document.createElement('div');
  el.className = `alert alert-${type}`;
  el.textContent = message;
  container.prepend(el);
  setTimeout(() => el.remove(), 5000);
}

function escapeHtml(str) {
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}

function productCategoryIds(product) {
  if (product.category_ids?.length) return product.category_ids.map(String);
  if (product.categories?.length) return product.categories.map(c => String(c.id));
  if (product.category_id) return [String(product.category_id)];
  if (product.category?.id) return [String(product.category.id)];
  return [];
}

function productCategoryNames(product) {
  if (product.categories?.length) return product.categories.map(c => c.name);
  if (product.category?.name) return [product.category.name];
  return [];
}

function productHasCategory(product, categoryId) {
  return productCategoryIds(product).includes(String(categoryId));
}

function renderCategoryPicker(categories, selectedIds = [], inputName = 'category_ids') {
  if (!categories.length) {
    return '<p class="form-hint category-picker-empty">Сначала добавьте категории</p>';
  }
  const selected = new Set(selectedIds.map(String));
  return `
    <div class="category-picker">
      ${categories.map(c => `
        <label class="category-picker-chip">
          <input type="checkbox" name="${inputName}" value="${c.id}"${selected.has(String(c.id)) ? ' checked' : ''}>
          <span>${escapeHtml(c.name)}</span>
        </label>
      `).join('')}
    </div>`;
}

function getSelectedCategoryIds(form) {
  return [...form.querySelectorAll('input[name="category_ids"]:checked')]
    .map(input => parseInt(input.value, 10))
    .filter(Boolean);
}

function initSearchClear(input) {
  if (!input || input.closest('.search-input-wrap')) return input;

  const wrap = document.createElement('div');
  wrap.className = 'search-input-wrap';
  input.parentNode.insertBefore(wrap, input);
  wrap.appendChild(input);

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'search-input-clear';
  btn.setAttribute('aria-label', 'Очистить');
  btn.textContent = '×';
  btn.hidden = true;
  wrap.appendChild(btn);

  const sync = () => {
    btn.hidden = !input.value;
  };

  input.addEventListener('input', sync);
  btn.addEventListener('click', () => {
    input.value = '';
    sync();
    input.focus();
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });

  input._syncSearchClear = sync;
  sync();
  return input;
}

function initPasswordToggle(input) {
  if (!input || input.type !== 'password' || input.closest('.password-input-wrap')) return input;

  const wrap = document.createElement('div');
  wrap.className = 'password-input-wrap';
  input.parentNode.insertBefore(wrap, input);
  wrap.appendChild(input);

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'password-toggle-btn';
  btn.setAttribute('aria-label', 'Показать пароль');
  btn.setAttribute('aria-pressed', 'false');
  btn.innerHTML = `
    <svg class="password-toggle-icon password-toggle-icon--show" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z"></path>
      <circle cx="12" cy="12" r="3"></circle>
    </svg>
    <svg class="password-toggle-icon password-toggle-icon--hide" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M17.94 17.94A10.94 10.94 0 0 1 12 19c-7 0-11-7-11-7a20.3 20.3 0 0 1 5.06-5.94"></path>
      <path d="M9.9 4.24A10.94 10.94 0 0 1 12 5c7 0 11 7 11 7a20.3 20.3 0 0 1-3.16 4.19"></path>
      <path d="M1 1l22 22"></path>
      <path d="M14.12 14.12A3 3 0 0 1 9.88 9.88"></path>
    </svg>
  `;

  btn.addEventListener('click', () => {
    const show = input.type === 'password';
    input.type = show ? 'text' : 'password';
    btn.classList.toggle('is-visible', show);
    btn.setAttribute('aria-label', show ? 'Скрыть пароль' : 'Показать пароль');
    btn.setAttribute('aria-pressed', show ? 'true' : 'false');
    input.focus();
  });

  wrap.appendChild(btn);
  return input;
}

function initAllPasswordToggles(root = document) {
  root.querySelectorAll('input[type="password"]').forEach(initPasswordToggle);
}

function isProductInStock(product) {
  return product?.in_stock !== false;
}

function unitLabel(unitType) {
  return unitType === 'piece' ? 'шт.' : 'уп.';
}

function renderQtyStepper(value = 1) {
  return `
    <div class="qty-stepper" role="group" aria-label="Количество">
      <button type="button" class="qty-step" data-step="-1" aria-label="Уменьшить">−</button>
      <span class="qty-value" data-qty-value>${value}</span>
      <button type="button" class="qty-step" data-step="1" aria-label="Увеличить">+</button>
    </div>`;
}

function getQtyStepperValue(stepperEl) {
  return parseInt(stepperEl?.querySelector('[data-qty-value]')?.textContent) || 1;
}

function setQtyStepperValue(stepperEl, value) {
  const el = stepperEl?.querySelector('[data-qty-value]');
  if (el) el.textContent = Math.max(1, value);
}

function changeQtyStepper(stepperEl, delta, min = 1) {
  const next = getQtyStepperValue(stepperEl) + delta;
  if (next < min) return null;
  setQtyStepperValue(stepperEl, next);
  return next;
}

function getItemPrice(product, unitType) {
  if (unitType === 'piece') {
    if (product.is_on_sale && product.sale_price_piece != null) {
      return product.sale_price_piece;
    }
    return product.price_piece || 0;
  }
  if (product.is_on_sale && product.sale_price_pack != null) {
    return product.sale_price_pack;
  }
  return product.price_pack || product.cost || 0;
}

let miniCartProductsCache = null;
let miniCartProductsPromise = null;
let miniCartUpdateTimer = null;
let miniCartLastCount = 0;

function setMiniCartProductsCache(products) {
  if (!Array.isArray(products)) return;
  miniCartProductsCache = Object.fromEntries(products.map(p => [p.id, p]));
  miniCartProductsPromise = Promise.resolve(miniCartProductsCache);
  updateMiniCartBar();
}

function invalidateMiniCartProductsCache() {
  miniCartProductsCache = null;
  miniCartProductsPromise = null;
}

async function getMiniCartProducts() {
  const items = Cart.get();
  if (miniCartProductsCache) {
    const missingProduct = items.some(item => !miniCartProductsCache[item.productId]);
    if (!missingProduct) return miniCartProductsCache;
    invalidateMiniCartProductsCache();
  }

  if (!miniCartProductsPromise) {
    miniCartProductsPromise = api('/api/products')
      .then(products => {
        miniCartProductsCache = Object.fromEntries(products.map(p => [p.id, p]));
        return miniCartProductsCache;
      })
      .catch(() => ({}));
  }
  return miniCartProductsPromise;
}

function calcCartTotalWithProducts(productsMap) {
  let total = 0;
  for (const item of Cart.get()) {
    const product = productsMap[item.productId];
    if (!product) continue;
    total += getItemPrice(product, item.unitType || 'pack') * item.quantity;
  }
  return total;
}

function formatCartCount(count) {
  const n = Math.abs(count) % 100;
  const n1 = n % 10;
  if (n > 10 && n < 20) return `${count} товаров`;
  if (n1 > 1 && n1 < 5) return `${count} товара`;
  if (n1 === 1) return `${count} товар`;
  return `${count} товаров`;
}

function initScrollToTop() {
  if (document.body.classList.contains('admin-page') || document.getElementById('scroll-to-top')) {
    return;
  }

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.id = 'scroll-to-top';
  btn.className = 'scroll-to-top';
  btn.hidden = true;
  btn.setAttribute('aria-label', 'Наверх');
  btn.innerHTML = `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M12 19V5"></path>
      <path d="M5 12l7-7 7 7"></path>
    </svg>`;
  document.body.appendChild(btn);

  let ticking = false;
  const updateVisibility = () => {
    btn.hidden = window.scrollY < 320;
    ticking = false;
  };

  window.addEventListener('scroll', () => {
    if (!ticking) {
      ticking = true;
      requestAnimationFrame(updateVisibility);
    }
  }, { passive: true });

  btn.addEventListener('click', () => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });

  updateVisibility();
}

function initMiniCartBar() {
  if (document.body.classList.contains('cart-page') || document.getElementById('mini-cart-bar')) {
    return;
  }

  const bar = document.createElement('a');
  bar.id = 'mini-cart-bar';
  bar.className = 'mini-cart-bar';
  bar.href = '/cart.html';
  bar.hidden = true;
  bar.innerHTML = `
    <div class="mini-cart-bar-main">
      <span class="mini-cart-bar-icon" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="9" cy="21" r="1"></circle>
          <circle cx="20" cy="21" r="1"></circle>
          <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"></path>
        </svg>
      </span>
      <div class="mini-cart-bar-text">
        <span class="mini-cart-bar-count">0 товаров</span>
        <strong class="mini-cart-bar-total">0 ₽</strong>
      </div>
    </div>
    <span class="mini-cart-bar-action">В корзину</span>`;
  document.body.appendChild(bar);
}

function updateMiniCartBar() {
  clearTimeout(miniCartUpdateTimer);
  miniCartUpdateTimer = setTimeout(refreshMiniCartBar, 30);
}

async function refreshMiniCartBar() {
  if (document.body.classList.contains('cart-page')) return;

  initMiniCartBar();
  const bar = document.getElementById('mini-cart-bar');
  if (!bar) return;

  const count = Cart.count();
  if (!count) {
    bar.hidden = true;
    bar.classList.remove('mini-cart-bar--pulse');
    document.body.classList.remove('has-mini-cart-bar');
    miniCartLastCount = 0;
    return;
  }

  bar.querySelector('.mini-cart-bar-count').textContent = formatCartCount(count);
  bar.hidden = false;
  document.body.classList.add('has-mini-cart-bar');

  let total = 0;
  try {
    const products = await getMiniCartProducts();
    total = calcCartTotalWithProducts(products);
  } catch {
    total = 0;
  }
  bar.querySelector('.mini-cart-bar-total').textContent = formatPrice(total);

  if (count > miniCartLastCount) {
    bar.classList.remove('mini-cart-bar--pulse');
    void bar.offsetWidth;
    bar.classList.add('mini-cart-bar--pulse');
  }
  miniCartLastCount = count;
}

function showStoredCheckoutNotice(containerId = 'alert-area') {
  const raw = sessionStorage.getItem('checkoutNotice');
  if (!raw) return;

  sessionStorage.removeItem('checkoutNotice');
  try {
    const notice = JSON.parse(raw);
    const container = document.getElementById(containerId);
    if (container && notice?.message) {
      showAlert(container, notice.message, notice.type || 'success');
    }
  } catch {
    /* ignore malformed notice */
  }
}

function renderPriceRow(regularPrice, salePrice, unit, isMain = false) {
  const rowClass = isMain ? 'price-line price-line-main' : 'price-line';
  if (salePrice != null && salePrice !== '') {
    return `<div class="${rowClass}">
      <span class="price-old">${formatPrice(regularPrice)}</span>
      <span class="price-current price-sale">${formatPrice(salePrice)}</span>
      <span class="price-unit">/ ${unit}</span>
    </div>`;
  }
  return `<div class="${rowClass}">
    <span class="price-current">${formatPrice(regularPrice)}</span>
    <span class="price-unit">/ ${unit}</span>
  </div>`;
}

function renderProductPrices(p) {
  const lines = [];
  lines.push(renderPriceRow(
    p.price_piece,
    p.is_on_sale ? p.sale_price_piece : null,
    'шт.',
    !!p.allow_piece_sale
  ));
  lines.push(renderPriceRow(
    p.price_pack,
    p.is_on_sale ? p.sale_price_pack : null,
    'уп.',
    !p.allow_piece_sale
  ));
  return `<div class="product-prices">${lines.join('')}</div>`;
}

function formatProductMeta(p) {
  const gramsPiece = p.grams_per_piece || p.weight_grams || 0;
  const parts = [];
  if (gramsPiece > 0) parts.push(`${gramsPiece} г/шт.`);
  if (p.pieces_per_pack > 1) parts.push(`${p.pieces_per_pack} шт. в упаковке`);
  return parts.join(' · ') || '—';
}

function renderProductStickerHtml(p) {
  const hit = p.is_bestseller ? '<span class="product-hit-sticker">Хит продаж</span>' : '';
  const sale = p.is_on_sale ? '<span class="product-sale-sticker">Акция</span>' : '';
  const oos = p.in_stock === false ? '<span class="product-oos-sticker">Нет в наличии</span>' : '';
  return hit + sale + oos;
}

function renderProductFavoriteButton(productId, currentUser) {
  if (!currentUser || currentUser.is_admin) return '';
  const active = Favorites.isFavorite(productId);
  return `<button type="button" class="product-favorite-btn${active ? ' is-active' : ''}" data-favorite="${productId}" aria-pressed="${active ? 'true' : 'false'}" aria-label="${active ? 'Убрать из избранного' : 'В избранное'}" title="${active ? 'Убрать из избранного' : 'В избранное'}">
    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78L12 21.23l8.84-8.84a5.5 5.5 0 0 0 0-7.78z"></path></svg>
  </button>`;
}

function renderCatalogProductCard(p, currentUser = null) {
  const outOfStock = p.in_stock === false;
  const imgUrl = p.images?.[0]?.url;
  const imageUrls = (p.images || []).map(img => img.url);
  const stickers = renderProductStickerHtml(p);
  const favoriteBtn = renderProductFavoriteButton(p.id, currentUser);

  const img = imgUrl
    ? `<div class="product-image-wrap" data-lightbox="${imgUrl}" data-lightbox-set='${JSON.stringify(imageUrls)}' data-alt="${escapeHtml(p.name)}" role="button" tabindex="0" aria-label="Фото ${escapeHtml(p.name)}">
         <img class="product-image" src="${imgUrl}" alt="${escapeHtml(p.name)}" loading="lazy" decoding="async">
         ${imageUrls.length > 1 ? `<span class="product-photo-count">${imageUrls.length} фото</span>` : ''}
         ${favoriteBtn}
         ${stickers}
       </div>`
    : `<div class="product-image-placeholder">${favoriteBtn}${stickers}🍦</div>`;

  const pieceBtn = p.allow_piece_sale
    ? `<button type="button" class="unit-btn" data-unit="piece">Штучно</button>`
    : '';

  const adminBtns = currentUser?.is_admin
    ? `<button type="button" class="btn btn-outline btn-sm" data-edit="${p.id}">Изменить</button>`
    : '';

  return `
    <article class="product-card${outOfStock ? ' product-card-out-of-stock' : ''}" data-id="${p.id}">
      ${img}
      <div class="product-body">
        ${productCategoryNames(p).length ? `
          <div class="product-categories">
            ${productCategoryNames(p).map(name => `<span class="product-category-tag">${escapeHtml(name)}</span>`).join('')}
          </div>` : ''}
        <div class="product-badges">
          ${p.is_new ? '<span class="badge badge-new">Новинка</span>' : ''}
          ${p.is_on_sale ? '<span class="badge badge-sale">Акция</span>' : ''}
          ${outOfStock ? '<span class="badge badge-oos">Нет в наличии</span>' : ''}
        </div>
        <h2 class="product-name">${escapeHtml(p.name)}</h2>
        <div class="product-meta">${formatProductMeta(p)}</div>
        ${renderProductPrices(p)}
        <p class="product-desc">${escapeHtml(p.description || '')}</p>
        ${p.description ? '<button type="button" class="desc-toggle" data-desc-toggle hidden>Показать полностью</button>' : ''}
        <div class="product-footer">
          <div class="unit-select">
            <button type="button" class="unit-btn active" data-unit="pack">Упаковка</button>
            ${pieceBtn}
          </div>
          <div class="qty-row">
            <span class="qty-row-label">Кол-во:</span>
            ${renderQtyStepper(1)}
          </div>
          <div class="product-actions">
            <button class="btn btn-primary btn-sm" data-add="${p.id}" ${outOfStock ? 'disabled' : ''}>
              ${outOfStock ? 'Нет в наличии' : 'В корзину'}
            </button>
            ${adminBtns}
          </div>
        </div>
      </div>
    </article>`;
}

function bindCatalogProductCards(container, options = {}) {
  const { allProducts = [], currentUser = null, onEdit, onFavoriteChange } = options;
  if (!container) return;

  container.querySelectorAll('.product-card').forEach(card => {
    const desc = card.querySelector('.product-desc');
    const toggle = card.querySelector('[data-desc-toggle]');
    if (desc && toggle) {
      requestAnimationFrame(() => {
        if (desc.scrollHeight > desc.clientHeight + 2) {
          toggle.hidden = false;
          toggle.addEventListener('click', () => {
            const expanded = desc.classList.toggle('expanded');
            toggle.textContent = expanded ? 'Свернуть' : 'Показать полностью';
          });
        }
      });
    }
  });

  container.querySelectorAll('[data-lightbox]').forEach(wrap => {
    const openFromWrap = () => {
      let urls = [wrap.dataset.lightbox];
      try {
        const parsed = JSON.parse(wrap.dataset.lightboxSet || '[]');
        if (parsed.length) urls = parsed;
      } catch {
        /* keep single url */
      }
      openLightbox(urls, wrap.dataset.alt || '');
    };

    wrap.addEventListener('click', (e) => {
      if (e.target.closest('[data-favorite]')) return;
      openFromWrap();
    });
    wrap.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        openFromWrap();
      }
    });
  });

  container.querySelectorAll('[data-favorite]').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      const productId = parseInt(btn.dataset.favorite, 10);
      btn.disabled = true;
      try {
        const added = await Favorites.toggle(productId);
        onFavoriteChange?.(productId, added);
      } catch (err) {
        if (String(err.message || '').includes('авториза')) {
          location.href = `/login.html?next=${encodeURIComponent(location.pathname + location.search)}`;
          return;
        }
        alert(err.message);
      } finally {
        btn.disabled = false;
      }
    });
  });

  container.querySelectorAll('.product-card').forEach(card => {
    card.querySelector('[data-edit]')?.addEventListener('click', () => {
      const productId = parseInt(card.dataset.id, 10);
      if (typeof onEdit === 'function') {
        onEdit(productId);
      } else if (typeof openProductEditModal === 'function') {
        openProductEditModal(productId, allProducts);
      }
    });

    const addBtn = card.querySelector('[data-add]');
    if (addBtn?.disabled) return;

    const unitBtns = card.querySelectorAll('.unit-btn:not([disabled])');
    let selectedUnit = 'pack';

    unitBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        unitBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        selectedUnit = btn.dataset.unit;
      });
    });

    addBtn.addEventListener('click', (e) => {
      const btn = e.target;
      const qty = getQtyStepperValue(card.querySelector('.qty-stepper'));
      Cart.add(parseInt(btn.dataset.add, 10), qty, selectedUnit);
      btn.textContent = '✓ Добавлено';
      updateMiniCartBar();
      setTimeout(() => { btn.textContent = 'В корзину'; }, 1200);
    });

    card.querySelectorAll('.qty-step').forEach(stepBtn => {
      stepBtn.addEventListener('click', () => {
        changeQtyStepper(card.querySelector('.qty-stepper'), parseInt(stepBtn.dataset.step, 10));
      });
    });
  });

  Favorites.syncButtons(container);
}

let scrollLockCount = 0;
let scrollLockY = 0;

function lockPageScroll() {
  scrollLockCount += 1;
  if (scrollLockCount !== 1) return;

  scrollLockY = window.scrollY;
  document.documentElement.classList.add('scroll-locked');
  document.body.classList.add('scroll-locked');
  document.body.style.top = `-${scrollLockY}px`;
}

function unlockPageScroll() {
  scrollLockCount = Math.max(0, scrollLockCount - 1);
  if (scrollLockCount !== 0) return;

  document.documentElement.classList.remove('scroll-locked');
  document.body.classList.remove('scroll-locked');
  document.body.style.top = '';
  window.scrollTo(0, scrollLockY);
}

function bindOverlayScrollGuard(overlay) {
  if (!overlay || overlay.dataset.scrollGuardBound) return;
  overlay.dataset.scrollGuardBound = '1';

  overlay.addEventListener('wheel', (e) => {
    const scrollable = e.target.closest('.modal');
    if (!scrollable) {
      e.preventDefault();
      return;
    }

    const delta = e.deltaY;
    const atTop = scrollable.scrollTop <= 0;
    const atBottom = scrollable.scrollTop + scrollable.clientHeight >= scrollable.scrollHeight - 1;
    if ((atTop && delta < 0) || (atBottom && delta > 0)) {
      e.preventDefault();
    }
  }, { passive: false });
}

function initStaticModalScrollLocks() {
  document.querySelectorAll('.modal-overlay').forEach(bindOverlayScrollGuard);
}

function getTouchDistance(t1, t2) {
  return Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
}

function initLightboxZoomViewport(viewport) {
  viewport._zoomState = { scale: 1, tx: 0, ty: 0 };
  const img = viewport.querySelector('.lightbox-zoom-img');
  if (!img) return;

  viewport._applyTransform = () => {
    const { scale, tx, ty } = viewport._zoomState;
    img.style.transform = `translate3d(${tx}px, ${ty}px, 0) scale(${scale})`;
    viewport.classList.toggle('is-zoomed', scale > 1.01);
  };

  viewport._resetZoom = () => {
    viewport._zoomState = { scale: 1, tx: 0, ty: 0 };
    viewport._applyTransform();
  };

  viewport._applyTransform();
}

function openLightbox(urlOrUrls, alt = '', startIndex = 0) {
  const urls = (Array.isArray(urlOrUrls) ? urlOrUrls : [urlOrUrls]).filter(Boolean);
  if (!urls.length) return;

  let index = Math.max(0, Math.min(startIndex, urls.length - 1));
  document.querySelector('.lightbox')?.remove();

  lockPageScroll();

  const overlay = document.createElement('div');
  overlay.className = 'lightbox lightbox-opening';

  const isGallery = urls.length > 1;

  overlay.innerHTML = `
    <button class="lightbox-close" aria-label="Закрыть">&times;</button>
    ${isGallery ? `
      <button type="button" class="lightbox-nav lightbox-prev" aria-label="Предыдущее фото">‹</button>
      <button type="button" class="lightbox-nav lightbox-next" aria-label="Следующее фото">›</button>
      <div class="lightbox-counter">${index + 1} / ${urls.length}</div>
    ` : ''}
    <div class="lightbox-content">
      ${isGallery ? `
        <div class="lightbox-stage">
          <div class="lightbox-track">
            ${urls.map(url => `
              <div class="lightbox-slide">
                <div class="lightbox-zoom-viewport">
                  <img class="lightbox-zoom-img" src="${url}" alt="${escapeHtml(alt)}" draggable="false">
                </div>
              </div>
            `).join('')}
          </div>
        </div>
      ` : `
        <div class="lightbox-zoom-viewport lightbox-zoom-viewport-single">
          <img class="lightbox-zoom-img lightbox-single" src="${urls[0]}" alt="${escapeHtml(alt)}" draggable="false">
        </div>
      `}
    </div>`;

  overlay.querySelectorAll('.lightbox-zoom-viewport').forEach(initLightboxZoomViewport);

  const track = overlay.querySelector('.lightbox-track');
  const stage = overlay.querySelector('.lightbox-stage');
  const content = overlay.querySelector('.lightbox-content');
  const counter = overlay.querySelector('.lightbox-counter');
  let slideWidth = 0;
  let dragging = false;
  let dragAxis = null;
  let pinchMode = false;
  let panMode = false;
  let zoomPanPending = false;
  let activeViewport = null;
  let pinchStartDist = 0;
  let pinchStartScale = 1;
  let panStartX = 0;
  let panStartY = 0;
  let panStartTx = 0;
  let panStartTy = 0;
  let startX = 0;
  let startY = 0;
  let currentX = 0;
  let currentY = 0;
  let lastTapTime = 0;
  let hasMoved = false;

  const getCurrentViewport = () => {
    if (!isGallery) return overlay.querySelector('.lightbox-zoom-viewport');
    const slide = overlay.querySelectorAll('.lightbox-slide')[index];
    return slide?.querySelector('.lightbox-zoom-viewport') || null;
  };

  const isZoomed = () => {
    const viewport = getCurrentViewport();
    return Boolean(viewport && viewport._zoomState.scale > 1.01);
  };

  const resetAllZoom = () => {
    overlay.querySelectorAll('.lightbox-zoom-viewport').forEach(viewport => viewport._resetZoom?.());
  };

  const updateSlideWidth = () => {
    if (!stage) return;
    slideWidth = stage.clientWidth;
  };

  const setTrackPosition = (offsetPx = 0, animate = true) => {
    if (!track) return;
    track.classList.toggle('is-animating', animate);
    track.style.transform = `translate3d(${-index * slideWidth + offsetPx}px, 0, 0)`;
  };

  const updateCounter = () => {
    if (counter) counter.textContent = `${index + 1} / ${urls.length}`;
  };

  const updateNavButtons = () => {
    overlay.querySelector('.lightbox-prev')?.classList.toggle('is-disabled', index === 0);
    overlay.querySelector('.lightbox-next')?.classList.toggle('is-disabled', index === urls.length - 1);
  };

  const goTo = (newIndex, animate = true) => {
    resetAllZoom();
    index = Math.max(0, Math.min(newIndex, urls.length - 1));
    setTrackPosition(0, animate);
    updateCounter();
    updateNavButtons();
  };

  const goPrev = () => {
    if (index > 0) goTo(index - 1);
  };

  const goNext = () => {
    if (index < urls.length - 1) goTo(index + 1);
  };

  const cleanup = () => {
    window.removeEventListener('resize', onResize);
    document.removeEventListener('keydown', onKey);
    overlay.removeEventListener('touchstart', onTouchStart);
    overlay.removeEventListener('touchmove', onTouchMove);
    overlay.removeEventListener('touchend', onTouchEnd);
    overlay.removeEventListener('touchcancel', onTouchEnd);
    unlockPageScroll();
  };

  const setDismissOffset = (dy, animate = false) => {
    if (!content) return;
    content.classList.toggle('is-animating', animate);
    if (!dy) {
      content.style.transform = '';
      overlay.style.backgroundColor = '';
      return;
    }
    const scale = Math.max(0.9, 1 - Math.abs(dy) / 900);
    content.style.transform = `translate3d(0, ${dy}px, 0) scale(${scale})`;
    overlay.style.backgroundColor = `rgba(0, 0, 0, ${Math.max(0.15, 0.88 - Math.abs(dy) / 420)})`;
  };

  const resetDismiss = (animate = true) => {
    setDismissOffset(0, animate);
  };

  const close = () => {
    overlay.classList.remove('lightbox-opening');
    overlay.classList.add('lightbox-closing');
    cleanup();
    setTimeout(() => overlay.remove(), 220);
  };

  const closeWithSwipe = (dy) => {
    if (!content) {
      close();
      return;
    }
    cleanup();
    content.classList.add('is-animating');
    const targetY = dy >= 0 ? window.innerHeight * 0.55 : -window.innerHeight * 0.55;
    content.style.transform = `translate3d(0, ${targetY}px, 0) scale(0.88)`;
    overlay.style.backgroundColor = 'rgba(0, 0, 0, 0)';
    overlay.classList.add('lightbox-closing');
    setTimeout(() => overlay.remove(), 220);
  };

  const onKey = (e) => {
    if (e.key === 'Escape') close();
    if (isGallery && !isZoomed() && e.key === 'ArrowLeft') goPrev();
    if (isGallery && !isZoomed() && e.key === 'ArrowRight') goNext();
  };

  const onResize = () => {
    updateSlideWidth();
    setTrackPosition(0, false);
  };

  const handleZoomDoubleTap = (viewport) => {
    if (!viewport) return;
    if (viewport._zoomState.scale > 1.01) viewport._resetZoom();
    else {
      viewport._zoomState.scale = 2.5;
      viewport._applyTransform();
    }
  };

  const onTouchStart = (e) => {
    if (e.touches.length === 2) {
      dragging = false;
      dragAxis = null;
      zoomPanPending = false;
      activeViewport = e.target.closest('.lightbox-zoom-viewport') || getCurrentViewport();
      if (!activeViewport) return;
      pinchStartDist = getTouchDistance(e.touches[0], e.touches[1]);
      pinchStartScale = activeViewport._zoomState.scale;
      pinchMode = true;
      return;
    }

    if (e.touches.length !== 1) return;

    const viewport = e.target.closest('.lightbox-zoom-viewport') || getCurrentViewport();
    if (viewport && viewport._zoomState.scale > 1.01) {
      zoomPanPending = true;
      panMode = false;
      activeViewport = viewport;
      panStartX = e.touches[0].clientX;
      panStartY = e.touches[0].clientY;
      panStartTx = viewport._zoomState.tx;
      panStartTy = viewport._zoomState.ty;
      hasMoved = false;
      return;
    }

    dragging = true;
    dragAxis = null;
    hasMoved = false;
    updateSlideWidth();
    startX = currentX = e.touches[0].clientX;
    startY = currentY = e.touches[0].clientY;
    content?.classList.remove('is-animating');
    if (isGallery) setTrackPosition(0, false);
  };

  const onTouchMove = (e) => {
    if (pinchMode && e.touches.length === 2 && activeViewport) {
      const dist = getTouchDistance(e.touches[0], e.touches[1]);
      const scale = Math.min(4, Math.max(1, pinchStartScale * (dist / pinchStartDist)));
      activeViewport._zoomState.scale = scale;
      if (scale <= 1.01) {
        activeViewport._zoomState.tx = 0;
        activeViewport._zoomState.ty = 0;
      }
      activeViewport._applyTransform();
      e.preventDefault();
      return;
    }

    if (panMode && e.touches.length === 1 && activeViewport) {
      activeViewport._zoomState.tx = panStartTx + (e.touches[0].clientX - panStartX);
      activeViewport._zoomState.ty = panStartTy + (e.touches[0].clientY - panStartY);
      activeViewport._applyTransform();
      e.preventDefault();
      return;
    }

    if (zoomPanPending && e.touches.length === 1 && activeViewport) {
      const dx = e.touches[0].clientX - panStartX;
      const dy = e.touches[0].clientY - panStartY;
      if (Math.abs(dx) > 10 || Math.abs(dy) > 10) {
        hasMoved = true;
        zoomPanPending = false;
        panMode = true;
        activeViewport._zoomState.tx = panStartTx + dx;
        activeViewport._zoomState.ty = panStartTy + dy;
        activeViewport._applyTransform();
        e.preventDefault();
      }
      return;
    }

    if (!dragging || isZoomed()) return;

    currentX = e.touches[0].clientX;
    currentY = e.touches[0].clientY;
    const dx = currentX - startX;
    const dy = currentY - startY;

    if (!dragAxis && (Math.abs(dx) > 10 || Math.abs(dy) > 10)) {
      hasMoved = true;
      dragAxis = Math.abs(dy) > Math.abs(dx) ? 'y' : 'x';
    }

    if (dragAxis === 'y') {
      setDismissOffset(dy, false);
      e.preventDefault();
      return;
    }

    if (dragAxis === 'x' && isGallery && track) {
      let offsetX = dx;
      const maxDrag = slideWidth * 0.45;

      if (index === 0 && offsetX > 0) {
        offsetX = offsetX * 0.22;
      } else if (index === urls.length - 1 && offsetX < 0) {
        offsetX = offsetX * 0.22;
      } else {
        offsetX = Math.max(-maxDrag, Math.min(maxDrag, offsetX));
      }

      setTrackPosition(offsetX, false);
      e.preventDefault();
    }
  };

  const onTouchEnd = (e) => {
    if (pinchMode) {
      pinchMode = false;
      if (activeViewport) {
        if (activeViewport._zoomState.scale <= 1.15) activeViewport._resetZoom();
        activeViewport = null;
      }
      return;
    }

    if (panMode) {
      panMode = false;
      activeViewport = null;
      return;
    }

    if (zoomPanPending) {
      zoomPanPending = false;
      const viewport = activeViewport || getCurrentViewport();
      activeViewport = null;

      const now = Date.now();
      if (!hasMoved && e.changedTouches.length === 1 && viewport) {
        if (now - lastTapTime < 300) {
          handleZoomDoubleTap(viewport);
          lastTapTime = 0;
          dragging = false;
          dragAxis = null;
          return;
        }
        lastTapTime = now;
      }
      return;
    }

    const now = Date.now();
    if (!hasMoved && e.changedTouches.length === 1) {
      const viewport = getCurrentViewport();
      if (viewport && now - lastTapTime < 300) {
        handleZoomDoubleTap(viewport);
        lastTapTime = 0;
        dragging = false;
        dragAxis = null;
        return;
      }
      lastTapTime = now;
    }

    if (!dragging) return;
    dragging = false;
    const dx = currentX - startX;
    const dy = currentY - startY;

    if (dragAxis === 'y') {
      const threshold = Math.min(90, window.innerHeight * 0.12);
      if (Math.abs(dy) > threshold) closeWithSwipe(dy);
      else resetDismiss(true);
      dragAxis = null;
      return;
    }

    if (dragAxis === 'x' && isGallery && track) {
      const threshold = Math.min(80, slideWidth * 0.16);
      if (dx < -threshold && index < urls.length - 1) goNext();
      else if (dx > threshold && index > 0) goPrev();
      else setTrackPosition(0, true);
    }

    dragAxis = null;
  };

  overlay.querySelector('.lightbox-close')?.addEventListener('click', close);
  overlay.querySelector('.lightbox-prev')?.addEventListener('click', (e) => {
    e.stopPropagation();
    goPrev();
  });
  overlay.querySelector('.lightbox-next')?.addEventListener('click', (e) => {
    e.stopPropagation();
    goNext();
  });
  overlay.querySelector('.lightbox-single')?.addEventListener('click', (e) => e.stopPropagation());
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) close();
  });

  overlay.addEventListener('wheel', (e) => e.preventDefault(), { passive: false });
  overlay.addEventListener('touchstart', onTouchStart, { passive: false });
  overlay.addEventListener('touchmove', onTouchMove, { passive: false });
  overlay.addEventListener('touchend', onTouchEnd, { passive: true });
  overlay.addEventListener('touchcancel', onTouchEnd, { passive: true });

  document.addEventListener('keydown', onKey);
  window.addEventListener('resize', onResize);
  document.body.appendChild(overlay);

  requestAnimationFrame(() => {
    overlay.classList.remove('lightbox-opening');
    if (isGallery) {
      updateSlideWidth();
      setTrackPosition(0, false);
      updateNavButtons();
    }
  });
}

async function loadUserInfo() {
  const el = document.getElementById('user-info');
  if (!el) return null;

  try {
    const user = await api('/api/auth/me');
    if (user && !user.is_admin) {
      el.className = 'user-info';
      el.innerHTML = `
        <a href="/account.html" class="user-info-link">Личный кабинет</a>
        <span class="user-info-name">${escapeHtml(user.name)}</span>
        <button type="button" class="btn btn-outline btn-sm user-info-logout" id="logout-btn">Выйти</button>
      `;
      document.getElementById('logout-btn')?.addEventListener('click', async () => {
        await api('/api/auth/logout', { method: 'POST' });
        location.reload();
      });
      await Favorites.load();
      return user;
    } else if (user?.is_admin) {
      el.className = 'user-info';
      el.innerHTML = `
        <a href="/admin/dashboard.html" class="user-info-link">Админ</a>
        <span class="user-info-name"></span>
        <button type="button" class="btn btn-outline btn-sm user-info-logout" id="logout-btn">Выйти</button>
      `;
      document.getElementById('logout-btn')?.addEventListener('click', async () => {
        await api('/api/auth/logout', { method: 'POST' });
        location.reload();
      });
      Favorites.ids = new Set();
      return user;
    } else {
      el.className = 'user-info user-info-guest';
      el.innerHTML = `<a href="/login.html" class="user-info-login">Войти</a>`;
      Favorites.ids = new Set();
      return null;
    }
  } catch {
    el.className = 'user-info user-info-guest';
    el.innerHTML = `<a href="/login.html" class="user-info-login">Войти</a>`;
    Favorites.ids = new Set();
    return null;
  }
}

function bootSiteChrome() {
  initSiteHeader();
  initSiteFooter();
  initStaticModalScrollLocks();
  initMiniCartBar();
  initScrollToTop();
  initAllPasswordToggles();
  Cart.updateBadge();
  updateMiniCartBar();
  loadUserInfo();

  window.addEventListener('pageshow', () => {
    Cart.updateBadge();
    updateMiniCartBar();
  });
}

if (document.body) {
  bootSiteChrome();
} else {
  document.addEventListener('DOMContentLoaded', bootSiteChrome);
}

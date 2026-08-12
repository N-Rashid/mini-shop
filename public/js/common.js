const CART_KEY = 'izberbash-cart';
const SITE_PHONE = '+79034779706';
const SITE_PHONE_DISPLAY = '+7 (903) 477-97-06';
const SITE_NAME = 'Мороженое Избербаш';
const SHOP_ADDRESS = 'Советская 11/1, Избербаш';
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
  },

  count() {
    return Cart.get().reduce((sum, i) => sum + i.quantity, 0);
  },

  updateBadge() {
    const badge = document.getElementById('cart-badge');
    if (badge) {
      const count = Cart.count();
      badge.textContent = count;
      badge.style.display = count > 0 ? 'inline' : 'none';
    }
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

  const data = await res.json().catch(() => null);

  if (!res.ok) {
    throw new Error(data?.error || `Ошибка ${res.status}`);
  }

  return data;
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
          ${navLink('/cart.html', 'Корзина <span id="cart-badge" class="cart-badge" style="display:none">0</span>', 'cart')}
          ${navLink('/about.html', 'О нас', 'about')}
          <span id="user-info" class="user-info"></span>
        </nav>
      </div>
    </div>`;
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
  if (p.allow_piece_sale) {
    lines.push(renderPriceRow(
      p.price_piece,
      p.is_on_sale ? p.sale_price_piece : null,
      'шт.',
      true
    ));
  }
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

function openLightbox(urlOrUrls, alt = '', startIndex = 0) {
  const urls = (Array.isArray(urlOrUrls) ? urlOrUrls : [urlOrUrls]).filter(Boolean);
  if (!urls.length) return;

  let index = Math.max(0, Math.min(startIndex, urls.length - 1));
  document.querySelector('.lightbox')?.remove();

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
                <img src="${url}" alt="${escapeHtml(alt)}" draggable="false">
              </div>
            `).join('')}
          </div>
        </div>
      ` : `
        <img class="lightbox-single" src="${urls[0]}" alt="${escapeHtml(alt)}" draggable="false">
      `}
    </div>`;

  const track = overlay.querySelector('.lightbox-track');
  const stage = overlay.querySelector('.lightbox-stage');
  const content = overlay.querySelector('.lightbox-content');
  const counter = overlay.querySelector('.lightbox-counter');
  let slideWidth = 0;
  let dragging = false;
  let dragAxis = null;
  let startX = 0;
  let startY = 0;
  let currentX = 0;
  let currentY = 0;

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
    if (isGallery && e.key === 'ArrowLeft') goPrev();
    if (isGallery && e.key === 'ArrowRight') goNext();
  };

  const onResize = () => {
    updateSlideWidth();
    setTrackPosition(0, false);
  };

  const onTouchStart = (e) => {
    if (e.touches.length !== 1) return;
    dragging = true;
    dragAxis = null;
    updateSlideWidth();
    startX = currentX = e.touches[0].clientX;
    startY = currentY = e.touches[0].clientY;
    content?.classList.remove('is-animating');
    if (isGallery) setTrackPosition(0, false);
  };

  const onTouchMove = (e) => {
    if (!dragging) return;
    currentX = e.touches[0].clientX;
    currentY = e.touches[0].clientY;
    const dx = currentX - startX;
    const dy = currentY - startY;

    if (!dragAxis && (Math.abs(dx) > 10 || Math.abs(dy) > 10)) {
      dragAxis = Math.abs(dy) > Math.abs(dx) ? 'y' : 'x';
    }

    if (dragAxis === 'y') {
      setDismissOffset(dy, false);
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
    }
  };

  const onTouchEnd = () => {
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

  overlay.addEventListener('touchstart', onTouchStart, { passive: true });
  overlay.addEventListener('touchmove', onTouchMove, { passive: true });
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
      return user;
    } else {
      el.className = 'user-info user-info-guest';
      el.innerHTML = `<a href="/login.html" class="user-info-login">Войти</a>`;
      return null;
    }
  } catch {
    el.className = 'user-info user-info-guest';
    el.innerHTML = `<a href="/login.html" class="user-info-login">Войти</a>`;
    return null;
  }
}

function bootSiteChrome() {
  initSiteHeader();
  Cart.updateBadge();
  loadUserInfo();
}

if (document.body) {
  bootSiteChrome();
} else {
  document.addEventListener('DOMContentLoaded', bootSiteChrome);
}

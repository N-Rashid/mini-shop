async function requireAdmin() {
  try {
    const admin = await api('/api/admin/me');
    startAdminOrderAlerts();
    return admin;
  } catch {
    location.href = '/admin/index.html';
    return null;
  }
}

async function adminLogout() {
  stopAdminOrderAlerts();
  await api('/api/auth/logout', { method: 'POST' });
  location.href = '/admin/index.html';
}

function adminSidebar(active) {
  return `
    <aside class="admin-sidebar admin-desktop-only">
      <h3>Админ</h3>
      <a href="/admin/dashboard.html" ${active === 'dashboard' ? 'class="active"' : ''}>Обзор</a>
      <a href="/admin/products.html" ${active === 'products' ? 'class="active"' : ''}>Товары</a>
      <a href="/admin/categories.html" ${active === 'categories' ? 'class="active"' : ''}>Категории</a>
      <a href="/admin/users.html" ${active === 'users' ? 'class="active"' : ''}>Клиенты</a>
      <a href="/admin/orders.html" ${active === 'orders' ? 'class="active"' : ''}>Заказы</a>
      <a href="/admin/content.html" ${active === 'content' ? 'class="active"' : ''}>Контент</a>
      <hr style="margin:16px 0;border:none;border-top:1px solid var(--border)">
      <a href="#" id="admin-logout">Выйти</a>
      <a href="/">На сайт</a>
    </aside>`;
}

const ADMIN_MOBILE_NAV_MAIN = [
  { id: 'dashboard', href: '/admin/dashboard.html', label: 'Обзор' },
  { id: 'products', href: '/admin/products.html', label: 'Товары' },
  { id: 'orders', href: '/admin/orders.html', label: 'Заказы' },
];

const ADMIN_MOBILE_NAV_MORE = [
  { id: 'categories', href: '/admin/categories.html', label: 'Категории' },
  { id: 'users', href: '/admin/users.html', label: 'Клиенты' },
  { id: 'content', href: '/admin/content.html', label: 'Контент' },
  { href: '/', label: 'На сайт' },
  { action: 'logout', label: 'Выйти' },
];

function getAdminActivePage() {
  const path = location.pathname.toLowerCase();
  if (path.includes('/admin/dashboard')) return 'dashboard';
  if (path.includes('/admin/products')) return 'products';
  if (path.includes('/admin/categories')) return 'categories';
  if (path.includes('/admin/users') || path.includes('/admin/user.html')) return 'users';
  if (path.includes('/admin/orders')) return 'orders';
  if (path.includes('/admin/content')) return 'content';
  return '';
}

function setAdminMobileMoreOpen(open) {
  const sheet = document.getElementById('admin-mobile-more-sheet');
  const toggle = document.getElementById('admin-mobile-more-toggle');
  if (!sheet || !toggle) return;

  sheet.hidden = !open;
  toggle.classList.toggle('is-open', open);
  toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
  if (open) lockPageScroll();
  else unlockPageScroll();
}

function mountAdminMobileNav(active) {
  if (!document.body.classList.contains('admin-page')) return;
  if (document.getElementById('admin-mobile-nav')) return;

  const moreActive = ADMIN_MOBILE_NAV_MORE.some(item => item.id === active);
  const nav = document.createElement('nav');
  nav.id = 'admin-mobile-nav';
  nav.className = 'admin-mobile-nav';
  nav.setAttribute('aria-label', 'Навигация админки');
  nav.innerHTML = `
    ${ADMIN_MOBILE_NAV_MAIN.map(item => `
      <a href="${item.href}" class="admin-mobile-nav-item${item.id === active ? ' is-active' : ''}">
        <span class="admin-mobile-nav-label">${item.label}</span>
      </a>`).join('')}
    <button type="button" class="admin-mobile-nav-item${moreActive ? ' is-active' : ''}" id="admin-mobile-more-toggle" aria-expanded="false" aria-haspopup="true">
      <span class="admin-mobile-nav-label">Ещё</span>
    </button>`;

  const sheet = document.createElement('div');
  sheet.id = 'admin-mobile-more-sheet';
  sheet.className = 'admin-mobile-more-sheet';
  sheet.hidden = true;
  sheet.innerHTML = `
    <div class="admin-mobile-more-backdrop" data-close-admin-more></div>
    <div class="admin-mobile-more-panel" role="menu">
      <div class="admin-mobile-more-head">
        <strong>Меню</strong>
        <button type="button" class="admin-mobile-more-close" data-close-admin-more aria-label="Закрыть">×</button>
      </div>
      ${ADMIN_MOBILE_NAV_MORE.map(item => {
        if (item.action === 'logout') {
          return `<button type="button" class="admin-mobile-more-link" data-admin-logout-mobile>${item.label}</button>`;
        }
        const isActive = item.id === active ? ' is-active' : '';
        return `<a href="${item.href}" class="admin-mobile-more-link${isActive}">${item.label}</a>`;
      }).join('')}
    </div>`;

  document.body.appendChild(nav);
  document.body.appendChild(sheet);

  nav.querySelector('#admin-mobile-more-toggle')?.addEventListener('click', () => {
    setAdminMobileMoreOpen(sheet.hidden);
  });
  sheet.querySelectorAll('[data-close-admin-more]').forEach(el => {
    el.addEventListener('click', () => setAdminMobileMoreOpen(false));
  });
  sheet.querySelector('[data-admin-logout-mobile]')?.addEventListener('click', (e) => {
    e.preventDefault();
    setAdminMobileMoreOpen(false);
    adminLogout();
  });
}

function initAdminMobileChrome() {
  mountAdminMobileNav(getAdminActivePage());
}

function escapeHtml(str) {
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}

function adminCollapsibleHtml(contentHtml, count, label, threshold = 10) {
  if (count <= threshold) return contentHtml;
  return `
    <details class="admin-collapsible-section">
      <summary class="admin-collapsible-summary">${escapeHtml(label)} (${count})</summary>
      <div class="admin-collapsible-body">${contentHtml}</div>
    </details>`;
}

const ADMIN_ORDER_POLL_MS = 15000;
const ADMIN_ORDER_SOUND_URL = '/sounds/new-order.wav';
const ADMIN_SOUND_ACTIVATED_KEY = 'adminOrderSoundActivated';
const ADMIN_SOUND_PROMPT_DISMISSED_KEY = 'adminOrderSoundPromptDismissed';
let adminOrderPollTimer = null;
let knownPendingOrderIds = null;
let adminTitleFlashTimer = null;
let adminOriginalTitle = document.title;
let adminNotificationsRequested = false;
let adminOrderAudio = null;
let adminAudioUnlocked = false;
let adminSoundPromptEl = null;
let adminSoundHintEl = null;

function isAdminOrderSoundEnabled() {
  return localStorage.getItem('adminOrderSound') !== '0';
}

function isAdminSoundPromptDismissed() {
  return localStorage.getItem(ADMIN_SOUND_PROMPT_DISMISSED_KEY) === '1';
}

function hasAdminSoundActivatedBefore() {
  return localStorage.getItem(ADMIN_SOUND_ACTIVATED_KEY) === '1';
}

function markAdminSoundActivated() {
  localStorage.setItem(ADMIN_SOUND_ACTIVATED_KEY, '1');
}

function dismissAdminSoundPromptPermanent() {
  localStorage.setItem(ADMIN_SOUND_PROMPT_DISMISSED_KEY, '1');
  hideAdminSoundPrompt();
  hideAdminSoundHint();
}

function ensureAdminOrderAudio() {
  if (adminOrderAudio) return adminOrderAudio;
  adminOrderAudio = new Audio(ADMIN_ORDER_SOUND_URL);
  adminOrderAudio.preload = 'auto';
  return adminOrderAudio;
}

function hideAdminSoundHint() {
  if (!adminSoundHintEl) return;
  adminSoundHintEl.classList.remove('is-visible');
  window.setTimeout(() => {
    adminSoundHintEl?.remove();
    adminSoundHintEl = null;
  }, 300);
}

function hideAdminSoundPrompt() {
  if (!adminSoundPromptEl) return;
  adminSoundPromptEl.classList.remove('is-visible');
  window.setTimeout(() => {
    adminSoundPromptEl?.remove();
    adminSoundPromptEl = null;
  }, 300);
}

function showAdminSoundSessionHint() {
  if (sessionStorage.getItem('adminSoundHintShown') === '1') return;
  if (!isAdminOrderSoundEnabled() || adminAudioUnlocked || adminSoundHintEl) return;

  sessionStorage.setItem('adminSoundHintShown', '1');
  adminSoundHintEl = document.createElement('div');
  adminSoundHintEl.className = 'admin-sound-hint';
  adminSoundHintEl.textContent = 'Коснитесь экрана — включится звук о новых заказах';
  document.body.appendChild(adminSoundHintEl);
  window.requestAnimationFrame(() => adminSoundHintEl.classList.add('is-visible'));

  const hide = () => hideAdminSoundHint();
  adminSoundHintEl.addEventListener('click', hide);
  window.setTimeout(hide, 6000);
}

function showAdminSoundPrompt() {
  if (adminAudioUnlocked || !isAdminOrderSoundEnabled() || adminSoundPromptEl) return;
  if (isAdminSoundPromptDismissed() || hasAdminSoundActivatedBefore()) return;

  adminSoundPromptEl = document.createElement('div');
  adminSoundPromptEl.className = 'admin-sound-prompt';
  adminSoundPromptEl.innerHTML = `
    <span>Нажмите, чтобы включить звук при новых заказах</span>
    <div class="admin-sound-prompt-actions">
      <button type="button" class="btn btn-primary btn-sm" data-enable-sound>Включить звук</button>
      <button type="button" class="btn btn-outline btn-sm" data-dismiss-sound>Не сейчас</button>
    </div>`;
  adminSoundPromptEl.querySelector('[data-enable-sound]').addEventListener('click', () => {
    unlockAdminAudio(true);
  });
  adminSoundPromptEl.querySelector('[data-dismiss-sound]').addEventListener('click', () => {
    dismissAdminSoundPromptPermanent();
  });
  document.body.appendChild(adminSoundPromptEl);
  window.requestAnimationFrame(() => adminSoundPromptEl.classList.add('is-visible'));
}

async function unlockAdminAudio(playTest = false) {
  if (!isAdminOrderSoundEnabled()) return false;
  ensureAdminOrderAudio();
  try {
    if (adminOrderAudio.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
      await adminOrderAudio.load();
    }
    adminOrderAudio.volume = playTest ? 1 : 0.001;
    adminOrderAudio.currentTime = 0;
    await adminOrderAudio.play();
    if (!playTest) {
      adminOrderAudio.pause();
      adminOrderAudio.currentTime = 0;
    }
    adminOrderAudio.volume = 1;
    adminAudioUnlocked = true;
    markAdminSoundActivated();
    hideAdminSoundPrompt();
    hideAdminSoundHint();
    if (playTest) {
      adminOrderAudio.currentTime = 0;
      await adminOrderAudio.play();
    }
    return true;
  } catch {
    if (playTest) {
      showAdminSoundPrompt();
    }
    return false;
  }
}

function playNewOrderSound() {
  if (!isAdminOrderSoundEnabled()) return;
  ensureAdminOrderAudio();
  adminOrderAudio.volume = 1;
  adminOrderAudio.currentTime = 0;
  const playPromise = adminOrderAudio.play();
  if (playPromise) {
    playPromise.catch(() => {
      adminAudioUnlocked = false;
      if (!isAdminSoundPromptDismissed() && !hasAdminSoundActivatedBefore()) {
        showAdminSoundPrompt();
      }
    });
  }
}

function requestAdminNotifications() {
  if (adminNotificationsRequested || !('Notification' in window)) return;
  adminNotificationsRequested = true;
  if (Notification.permission === 'default') {
    Notification.requestPermission();
  }
}

function showBrowserOrderNotification(order) {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  const number = order.number ?? order.id;
  const total = typeof formatPrice === 'function' ? formatPrice(order.total) : `${order.total} ₽`;
  try {
    const notification = new Notification('Новый заказ!', {
      body: `№${number} · ${order.user_name} · ${total}`,
      tag: `order-${order.id}`,
      requireInteraction: true,
    });
    notification.onclick = () => {
      window.focus();
      location.href = '/admin/orders.html';
      notification.close();
    };
  } catch {
    // ignore
  }
}

function flashAdminTitle(message) {
  adminOriginalTitle = document.title.replace(/^🔔\s*/, '');
  if (adminTitleFlashTimer) window.clearInterval(adminTitleFlashTimer);
  let showAlert = true;
  adminTitleFlashTimer = window.setInterval(() => {
    document.title = showAlert ? message : adminOriginalTitle;
    showAlert = !showAlert;
  }, 1000);
}

function stopAdminTitleFlash() {
  if (adminTitleFlashTimer) {
    window.clearInterval(adminTitleFlashTimer);
    adminTitleFlashTimer = null;
  }
  document.title = adminOriginalTitle;
}

function updateOrdersNavBadge(count) {
  document.querySelectorAll(
    '.admin-sidebar a[href="/admin/orders.html"], .admin-mobile-nav-item[href="/admin/orders.html"]'
  ).forEach(link => {
    let badge = link.querySelector('.admin-nav-badge');
    if (count > 0) {
      if (!badge) {
        badge = document.createElement('span');
        badge.className = 'admin-nav-badge';
        link.appendChild(badge);
      }
      badge.textContent = count;
    } else if (badge) {
      badge.remove();
    }
  });
}

function showAdminOrderToast(orders) {
  let container = document.getElementById('admin-order-toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'admin-order-toast-container';
    container.className = 'admin-order-toast-container';
    document.body.appendChild(container);
  }

  orders.forEach((order) => {
    const number = order.number ?? order.id;
    const total = typeof formatPrice === 'function' ? formatPrice(order.total) : `${order.total} ₽`;
    const toast = document.createElement('div');
    toast.className = 'admin-order-toast';
    toast.innerHTML = `
      <div class="admin-order-toast-body">
        <strong>Новый заказ №${escapeHtml(String(number))}</strong>
        <span>${escapeHtml(order.user_name)} · ${escapeHtml(total)}</span>
      </div>
      <div class="admin-order-toast-actions">
        <a href="/admin/orders.html" class="btn btn-primary btn-sm">Открыть</a>
        <button type="button" class="btn btn-outline btn-sm" data-dismiss-toast>Закрыть</button>
      </div>`;
    toast.querySelector('[data-dismiss-toast]').addEventListener('click', () => toast.remove());
    container.appendChild(toast);
    window.setTimeout(() => toast.classList.add('is-visible'), 10);
    window.setTimeout(() => {
      toast.classList.remove('is-visible');
      window.setTimeout(() => toast.remove(), 300);
    }, 12000);
  });
}

function notifyNewOrders(orders) {
  if (!orders.length) return;
  playNewOrderSound();
  orders.forEach(showBrowserOrderNotification);
  showAdminOrderToast(orders);
  flashAdminTitle('🔔 Новый заказ!');
  window.dispatchEvent(new CustomEvent('admin:new-order', { detail: { orders } }));
}

async function pollAdminPendingOrders() {
  try {
    const data = await api('/api/admin/orders/pending-summary');
    const orders = data.orders || [];
    const ids = new Set(orders.map(o => o.id));
    updateOrdersNavBadge(data.count || 0);

    if (knownPendingOrderIds === null) {
      knownPendingOrderIds = ids;
      return;
    }

    const newOrders = orders.filter(o => !knownPendingOrderIds.has(o.id));
    knownPendingOrderIds = ids;

    if (newOrders.length) {
      notifyNewOrders(newOrders);
    }
  } catch {
    // ignore transient network errors during polling
  }
}

function startAdminOrderAlerts() {
  if (adminOrderPollTimer) return;
  requestAdminNotifications();
  ensureAdminOrderAudio();
  knownPendingOrderIds = null;
  pollAdminPendingOrders();
  adminOrderPollTimer = window.setInterval(pollAdminPendingOrders, ADMIN_ORDER_POLL_MS);
  if (!hasAdminSoundActivatedBefore() && !isAdminSoundPromptDismissed()) {
    window.setTimeout(showAdminSoundSessionHint, 800);
  }
}

function stopAdminOrderAlerts() {
  if (adminOrderPollTimer) {
    window.clearInterval(adminOrderPollTimer);
    adminOrderPollTimer = null;
  }
  knownPendingOrderIds = null;
  stopAdminTitleFlash();
}

document.addEventListener('DOMContentLoaded', () => {
  initAdminMobileChrome();
  document.getElementById('admin-logout')?.addEventListener('click', (e) => {
    e.preventDefault();
    adminLogout();
  });
});

document.addEventListener('visibilitychange', () => {
  if (!document.hidden) stopAdminTitleFlash();
});

function onAdminUserGesture() {
  requestAdminNotifications();
  if (!adminAudioUnlocked && isAdminOrderSoundEnabled()) {
    unlockAdminAudio(false).then((ok) => {
      if (ok) hideAdminSoundHint();
    });
  }
}

document.addEventListener('click', onAdminUserGesture);
document.addEventListener('keydown', onAdminUserGesture);
document.addEventListener('touchstart', onAdminUserGesture, { passive: true });

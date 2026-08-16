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
    <aside class="admin-sidebar">
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
let adminOrderPollTimer = null;
let knownPendingOrderIds = null;
let adminTitleFlashTimer = null;
let adminOriginalTitle = document.title;
let adminNotificationsRequested = false;
let adminOrderAudio = null;
let adminAudioUnlocked = false;
let adminSoundPromptEl = null;

function isAdminOrderSoundEnabled() {
  return localStorage.getItem('adminOrderSound') !== '0';
}

function ensureAdminOrderAudio() {
  if (adminOrderAudio) return adminOrderAudio;
  adminOrderAudio = new Audio(ADMIN_ORDER_SOUND_URL);
  adminOrderAudio.preload = 'auto';
  return adminOrderAudio;
}

function hideAdminSoundPrompt() {
  if (!adminSoundPromptEl) return;
  adminSoundPromptEl.classList.remove('is-visible');
  window.setTimeout(() => {
    adminSoundPromptEl?.remove();
    adminSoundPromptEl = null;
  }, 300);
}

function showAdminSoundPrompt() {
  if (adminAudioUnlocked || !isAdminOrderSoundEnabled() || adminSoundPromptEl) return;
  adminSoundPromptEl = document.createElement('div');
  adminSoundPromptEl.className = 'admin-sound-prompt';
  adminSoundPromptEl.innerHTML = `
    <span>🔊 Нажмите, чтобы включить звук при новых заказах</span>
    <button type="button" class="btn btn-primary btn-sm" data-enable-sound>Включить звук</button>`;
  adminSoundPromptEl.querySelector('[data-enable-sound]').addEventListener('click', () => {
    unlockAdminAudio(true);
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
    hideAdminSoundPrompt();
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
      showAdminSoundPrompt();
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
  const link = document.querySelector('.admin-sidebar a[href="/admin/orders.html"]');
  if (!link) return;
  let badge = link.querySelector('.admin-nav-badge');
  if (count > 0) {
    if (!badge) {
      badge = document.createElement('span');
      badge.className = 'admin-nav-badge';
      link.appendChild(document.createTextNode(' '));
      link.appendChild(badge);
    }
    badge.textContent = count;
  } else if (badge) {
    badge.remove();
  }
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
  window.setTimeout(showAdminSoundPrompt, 500);
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
  if (!adminAudioUnlocked) unlockAdminAudio(false);
}

document.addEventListener('click', onAdminUserGesture);
document.addEventListener('keydown', onAdminUserGesture);
document.addEventListener('touchstart', onAdminUserGesture, { passive: true });

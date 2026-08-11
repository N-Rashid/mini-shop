async function requireAdmin() {
  try {
    return await api('/api/admin/me');
  } catch {
    location.href = '/admin/index.html';
    return null;
  }
}

async function adminLogout() {
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
      <a href="/admin/content.html" ${active === 'content' ? 'class="active"' : ''}>О нас</a>
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

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('admin-logout')?.addEventListener('click', (e) => {
    e.preventDefault();
    adminLogout();
  });
});

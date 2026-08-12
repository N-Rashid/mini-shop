let categories = [];
let productFilter = 'all';
let productSearchQuery = '';
let productCategoryFilter = '';
let productSortIds = [];

function sortControlsHtml(id, enabled = true) {
  if (!enabled) return '';
  return `
    <div class="admin-sort-controls">
      <button type="button" class="admin-sort-handle" data-sort-handle="${id}" draggable="true" title="Перетащить" aria-label="Перетащить">⋮⋮</button>
      <button type="button" class="admin-sort-btn" data-sort-up="${id}" aria-label="Выше">↑</button>
      <button type="button" class="admin-sort-btn" data-sort-down="${id}" aria-label="Ниже">↓</button>
    </div>`;
}

async function persistSortOrder(url, ids) {
  await api(url, { method: 'PUT', body: JSON.stringify({ order: ids }) });
}

function swapSortIds(ids, id, delta) {
  const order = [...ids];
  const idx = order.indexOf(id);
  if (idx < 0) return null;
  const targetIdx = idx + delta;
  if (targetIdx < 0 || targetIdx >= order.length) return null;
  [order[idx], order[targetIdx]] = [order[targetIdx], order[idx]];
  return order;
}

function readSortIdsFromDom(container) {
  if (!container) return [];
  return [...container.querySelectorAll('[data-sort-id]')].map(el => parseInt(el.dataset.sortId, 10));
}

function refreshSortNumbers(root) {
  root.querySelectorAll('#products-sortable [data-sort-id], #products-sortable-mobile [data-sort-id]').forEach((el, index) => {
    const num = index + 1;
    el.querySelectorAll('.admin-row-num').forEach(cell => {
      cell.textContent = cell.closest('.admin-card-name') ? `${num}.` : String(num);
    });
  });
}

function syncSortViews(root, ids) {
  ['#products-sortable', '#products-sortable-mobile'].forEach(selector => {
    const container = root.querySelector(selector);
    if (!container) return;
    const insertBefore = [...container.children].find(el => !el.matches('[data-sort-id]')) || null;
    ids.forEach(id => {
      const el = container.querySelector(`[data-sort-id="${id}"]`);
      if (el) container.insertBefore(el, insertBefore);
    });
  });
  refreshSortNumbers(root);
}

function bindSortableList(root, config) {
  if (!root || root.dataset.sortBound === '1') return;
  root.dataset.sortBound = '1';

  const { itemSelector, getIds, setIds, reorderUrl, onReload } = config;
  let draggedRow = null;

  root.addEventListener('click', async (e) => {
    const upBtn = e.target.closest('[data-sort-up]');
    const downBtn = e.target.closest('[data-sort-down]');
    const btn = upBtn || downBtn;
    if (!btn || !root.contains(btn)) return;

    e.preventDefault();
    const id = parseInt(upBtn ? upBtn.dataset.sortUp : downBtn.dataset.sortDown, 10);
    const delta = upBtn ? -1 : 1;
    const nextOrder = swapSortIds(getIds(), id, delta);
    if (!nextOrder) return;

    root.querySelectorAll('.admin-sort-btn').forEach(b => { b.disabled = true; });
    try {
      await persistSortOrder(reorderUrl, nextOrder);
      setIds(nextOrder);
      await onReload();
    } catch (err) {
      alert(err.message);
      await onReload();
    }
  });

  root.addEventListener('dragstart', (e) => {
    const handle = e.target.closest('[data-sort-handle]');
    if (!handle || !root.contains(handle)) return;
    draggedRow = handle.closest(itemSelector);
    if (!draggedRow) return;
    draggedRow.classList.add('sortable-dragging');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', draggedRow.dataset.sortId || '');
  });

  root.addEventListener('dragend', () => {
    draggedRow?.classList.remove('sortable-dragging');
    root.querySelectorAll(itemSelector).forEach(el => el.classList.remove('sortable-over'));
    draggedRow = null;
  });

  root.addEventListener('dragover', (e) => {
    if (!draggedRow) return;
    const item = e.target.closest(itemSelector);
    if (!item || !root.contains(item) || item === draggedRow) return;
    e.preventDefault();
    item.classList.add('sortable-over');
    const rect = item.getBoundingClientRect();
    const after = e.clientY > rect.top + rect.height / 2;
    const parent = item.parentNode;
    if (after) parent.insertBefore(draggedRow, item.nextSibling);
    else parent.insertBefore(draggedRow, item);
    refreshSortNumbers(root);
  });

  root.addEventListener('dragleave', (e) => {
    const item = e.target.closest?.(itemSelector);
    if (item) item.classList.remove('sortable-over');
  });

  root.addEventListener('drop', async (e) => {
    const item = e.target.closest(itemSelector);
    if (!item || !root.contains(item) || !draggedRow) return;
    e.preventDefault();
    item.classList.remove('sortable-over');

    const sortContainer = draggedRow.closest('#products-sortable, #products-sortable-mobile');
    const nextOrder = readSortIdsFromDom(sortContainer);
    if (!nextOrder.length) return;

    syncSortViews(root, nextOrder);

    try {
      await persistSortOrder(reorderUrl, nextOrder);
      setIds(nextOrder);
      await onReload();
    } catch (err) {
      alert(err.message);
      await onReload();
    } finally {
      draggedRow = null;
    }
  });
}

function productBadges(p) {
  const badges = [];
  if (p.deleted) badges.push('<span class="badge badge-deleted">Удалён</span>');
  else if (p.is_new) badges.push('<span class="badge badge-new">Новый</span>');
  if (p.is_on_sale) badges.push('<span class="badge badge-sale">Акция</span>');
  if (p.is_bestseller) badges.push('<span class="badge badge-hit">Хит</span>');
  if (p.in_stock === false) badges.push('<span class="badge badge-oos">Нет в наличии</span>');
  if (p.allow_piece_sale) badges.push('<span class="badge badge-piece">Штучно</span>');
  return badges.join(' ');
}

function renderProductCard(p, sortable, num) {
  const priceLine = p.allow_piece_sale && p.price_piece
    ? `${formatPrice(p.price_pack)} · ${formatPrice(p.price_piece)}/шт`
    : formatPrice(p.price_pack);
  const badges = productBadges(p);
  const categoryLabel = productCategoryNames(p).join(', ') || '—';

  return `
    <article class="admin-card admin-card-compact ${p.deleted ? 'admin-card-muted' : ''}${p.in_stock === false && !p.deleted ? ' admin-card-oos' : ''}"${sortable ? ` data-sort-id="${p.id}"` : ''}>
      <div class="admin-card-row">
        ${sortable ? sortControlsHtml(p.id) : ''}
        <div class="admin-card-main">
          <strong class="admin-card-name">${typeof num === 'number' ? `<span class="admin-row-num">${num}.</span> ` : ''}${escapeHtml(p.name)}</strong>
          <span class="admin-card-meta">${escapeHtml(categoryLabel)} · ${priceLine}</span>
        </div>
        ${badges ? `<div class="admin-card-badges">${badges}</div>` : ''}
      </div>
      <div class="admin-card-actions admin-card-actions-row">
        ${!p.deleted ? `
          <button type="button" class="btn btn-outline btn-sm" data-edit="${p.id}">Изменить</button>
          <button type="button" class="btn btn-danger btn-sm" data-delete="${p.id}">Удалить</button>
        ` : `
          <button type="button" class="btn btn-outline btn-sm" data-restore="${p.id}">Восстановить</button>
        `}
      </div>
    </article>`;
}

async function loadProductCategoryOptions() {
  categories = await api('/api/admin/categories');

  const addBox = document.getElementById('add-category-checkboxes');
  const listFilter = document.getElementById('product-category-filter');
  const categoryOptions = categories.map(c => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join('');

  if (addBox) {
    addBox.innerHTML = renderCategoryPicker(categories);
  }

  if (listFilter) {
    const prev = listFilter.value;
    listFilter.innerHTML = `
      <option value="">Все категории</option>
      ${categoryOptions}
      <option value="none">— без категории —</option>
    `;
    if (prev && [...listFilter.options].some(o => o.value === prev)) {
      listFilter.value = prev;
    }
  }
}

function setupProductFilters() {
  const container = document.getElementById('product-filters');
  if (!container) return;

  container.querySelectorAll('.filter-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      container.querySelectorAll('.filter-chip').forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      productFilter = chip.dataset.filter;
      loadProductsList();
    });
  });

  const searchInput = initSearchClear(document.getElementById('product-search'));
  searchInput?.addEventListener('input', (e) => {
    productSearchQuery = e.target.value;
    loadProductsList();
  });

  document.getElementById('product-category-filter')?.addEventListener('change', (e) => {
    productCategoryFilter = e.target.value;
    loadProductsList();
  });
}

function filterAdminProducts(products) {
  let list = products;
  const q = productSearchQuery.trim().toLowerCase();

  if (q) {
    list = list.filter(p => (p.name || '').toLowerCase().includes(q));
  }

  if (productCategoryFilter === 'none') {
    list = list.filter(p => productCategoryIds(p).length === 0);
  } else if (productCategoryFilter) {
    const catId = parseInt(productCategoryFilter, 10);
    list = list.filter(p => productHasCategory(p, catId));
  }

  return list;
}

function isProductListFiltered() {
  return Boolean(productSearchQuery.trim() || productCategoryFilter);
}

function bindProductActions(container, products) {
  container.querySelectorAll('[data-delete]').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!confirm('Удалить товар?')) return;
      await api(`/api/admin/products/${btn.dataset.delete}`, { method: 'DELETE' });
      loadProductsList();
    });
  });

  container.querySelectorAll('[data-restore]').forEach(btn => {
    btn.addEventListener('click', async () => {
      await api(`/api/admin/products/${btn.dataset.restore}/restore`, { method: 'POST' });
      loadProductsList();
    });
  });

  container.querySelectorAll('[data-edit]').forEach(btn => {
    btn.addEventListener('click', () => openProductEditModal(parseInt(btn.dataset.edit), products, loadProductsList));
  });
}

async function loadProductsList() {
  const container = document.getElementById('products-list');
  const searchInput = document.getElementById('product-search');
  if (searchInput && searchInput.value !== productSearchQuery) {
    searchInput.value = productSearchQuery;
    searchInput._syncSearchClear?.();
  }

  const allProducts = await api(`/api/admin/products?filter=${productFilter}`);
  const products = filterAdminProducts(allProducts);
  const activeProducts = allProducts.filter(p => !p.deleted);
  productSortIds = activeProducts.map(p => p.id);
  const canSortProducts = productFilter === 'all'
    && !isProductListFiltered()
    && activeProducts.length > 1;

  if (!allProducts.length) {
    container.innerHTML = '<p style="color:var(--muted)">Товаров нет</p>';
    return;
  }

  if (!products.length) {
    container.innerHTML = '<p style="color:var(--muted)">Ничего не найдено. Измените поиск или категорию.</p>';
    return;
  }

  container.innerHTML = `
    ${canSortProducts ? '<p class="admin-section-hint">Порядок товаров в каталоге: перетащите ⋮⋮ или нажмите ↑↓</p>' : ''}
    ${isProductListFiltered() ? '<p class="admin-section-hint">Показаны отфильтрованные товары. Сортировка каталога доступна без фильтров.</p>' : ''}
    <div class="admin-desktop-only">
      <table class="data-table data-table-compact">
        <thead>
          <tr>
            <th></th>
            <th>№</th>
            <th>Название</th>
            <th>Категория</th>
            <th>Упак.</th>
            <th>Метки</th>
            <th></th>
          </tr>
        </thead>
        <tbody id="products-sortable">
          ${products.map((p, index) => {
            const num = canSortProducts && !p.deleted
              ? activeProducts.findIndex(x => x.id === p.id) + 1
              : index + 1;
            return `
            <tr style="${p.deleted ? 'opacity:0.5' : ''}"${canSortProducts && !p.deleted ? ` data-sort-id="${p.id}"` : ''}>
              <td>${canSortProducts && !p.deleted ? sortControlsHtml(p.id) : ''}</td>
              <td class="admin-row-num">${num}</td>
              <td>${escapeHtml(p.name)}</td>
              <td>${escapeHtml(productCategoryNames(p).join(', ') || '—')}</td>
              <td>${formatPrice(p.price_pack)}</td>
              <td class="data-table-badges">${productBadges(p) || '—'}</td>
              <td class="data-table-actions">
                ${!p.deleted ? `
                  <button type="button" class="btn btn-outline btn-sm" data-edit="${p.id}">Изменить</button>
                  <button type="button" class="btn btn-danger btn-sm" data-delete="${p.id}">Удалить</button>
                ` : `<button type="button" class="btn btn-outline btn-sm" data-restore="${p.id}">Восстановить</button>`}
              </td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>
    </div>
    <div class="admin-mobile-only admin-cards admin-cards-compact" id="products-sortable-mobile">
      ${products.map((p, index) => renderProductCard(
        p,
        canSortProducts && !p.deleted,
        canSortProducts && !p.deleted
          ? activeProducts.findIndex(x => x.id === p.id) + 1
          : index + 1
      )).join('')}
    </div>`;

  bindProductActions(container, allProducts);

  if (canSortProducts) {
    bindSortableList(container, {
      itemSelector: '[data-sort-id]',
      getIds: () => productSortIds,
      setIds: (ids) => { productSortIds = ids; },
      reorderUrl: '/api/admin/products/reorder',
      onReload: loadProductsList,
    });
  }
}

(async () => {
  const admin = await requireAdmin();
  if (!admin) return;

  document.getElementById('admin-name').textContent = admin.name;
  document.getElementById('sidebar').innerHTML = adminSidebar('products');

  document.getElementById('admin-logout')?.addEventListener('click', (e) => {
    e.preventDefault();
    adminLogout();
  });

  document.getElementById('add-product-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const alertArea = document.getElementById('alert-area');
    const form = e.target;
    const submitBtn = form.querySelector('button[type="submit"]');
    const formData = new FormData(form);
    const btnText = submitBtn?.textContent;

    try {
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = 'Загрузка...';
      }
      const res = await fetch('/api/admin/products', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'ngrok-skip-browser-warning': 'true' },
        body: formData,
      });
      const { data } = await readJsonResponse(res);
      if (!res.ok) throw new Error(data?.error || `Ошибка ${res.status}`);

      showAlert(alertArea, `Товар «${data.name}» добавлен`, 'success');
      form.reset();
      await loadProductCategoryOptions();
      loadProductsList();
    } catch (err) {
      showAlert(alertArea, err.message, 'error');
    } finally {
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = btnText || 'Добавить товар';
      }
    }
  });

  setupProductFilters();
  await loadProductCategoryOptions();
  loadProductsList();
})();

let categories = [];
let editingCategoryId = null;
let categorySortIds = [];

function sortControlsHtml(id) {
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
  root.querySelectorAll('#categories-sortable [data-sort-id], #categories-sortable-mobile [data-sort-id]').forEach((el, index) => {
    const num = index + 1;
    el.querySelectorAll('.admin-row-num').forEach(cell => {
      cell.textContent = cell.closest('.admin-card-name') ? `${num}.` : String(num);
    });
  });
}

function syncSortViews(root, ids) {
  ['#categories-sortable', '#categories-sortable-mobile'].forEach(selector => {
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

    const sortContainer = draggedRow.closest('#categories-sortable, #categories-sortable-mobile');
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

async function saveCategory(catId, name) {
  await api(`/api/admin/categories/${catId}`, {
    method: 'PUT',
    body: JSON.stringify({ name }),
  });
  editingCategoryId = null;
  await loadCategories();
}

function bindCategoryActions(container) {
  container.querySelectorAll('[data-edit-cat]').forEach(btn => {
    btn.addEventListener('click', () => {
      editingCategoryId = parseInt(btn.dataset.editCat, 10);
      loadCategories();
    });
  });

  container.querySelectorAll('[data-cancel-cat]').forEach(btn => {
    btn.addEventListener('click', () => {
      editingCategoryId = null;
      loadCategories();
    });
  });

  container.querySelectorAll('[data-save-cat]').forEach(form => {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const name = e.target.name.value.trim();
      if (!name) return;
      try {
        await saveCategory(parseInt(form.dataset.saveCat, 10), name);
      } catch (err) {
        alert(err.message);
      }
    });
  });

  container.querySelectorAll('[data-del-cat]').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!confirm('Удалить категорию?')) return;
      await api(`/api/admin/categories/${btn.dataset.delCat}`, { method: 'DELETE' });
      loadCategories();
    });
  });
}

function renderCategoryCard(c, editing, sortable, num) {
  if (editing) {
    return `
      <article class="admin-card admin-card-compact">
        <form class="admin-inline-edit" data-save-cat="${c.id}">
          <input name="name" value="${escapeHtml(c.name)}" required maxlength="100">
          <div class="admin-card-actions admin-card-actions-row">
            <button type="submit" class="btn btn-primary btn-sm">Сохранить</button>
            <button type="button" class="btn btn-outline btn-sm" data-cancel-cat="${c.id}">Отмена</button>
          </div>
        </form>
      </article>`;
  }

  return `
    <article class="admin-card admin-card-compact"${sortable ? ` data-sort-id="${c.id}"` : ''}>
      <div class="admin-card-row">
        ${sortable ? sortControlsHtml(c.id) : ''}
        <div class="admin-card-main">
          <strong class="admin-card-name">${typeof num === 'number' ? `<span class="admin-row-num">${num}.</span> ` : ''}${escapeHtml(c.name)}</strong>
        </div>
        <span class="badge badge-active">Активна</span>
      </div>
      <div class="admin-card-actions admin-card-actions-row">
        <button type="button" class="btn btn-outline btn-sm" data-edit-cat="${c.id}">Изменить</button>
        <button type="button" class="btn btn-danger btn-sm" data-del-cat="${c.id}">Удалить</button>
      </div>
    </article>`;
}

async function loadCategories() {
  categories = await api('/api/admin/categories');
  categorySortIds = categories.map(c => c.id);
  const canSortCategories = !editingCategoryId;

  const list = document.getElementById('categories-list');
  if (!list) return;

  if (!categories.length) {
    list.innerHTML = '<p style="color:var(--muted)">Категорий нет</p>';
    return;
  }

  list.innerHTML = `
    ${canSortCategories && categories.length > 1 ? '<p class="admin-section-hint">Порядок категорий на сайте: перетащите ⋮⋮ или нажмите ↑↓</p>' : ''}
    <div class="admin-desktop-only">
      <table class="data-table data-table-compact">
        <thead><tr><th></th><th>№</th><th>Название</th><th>Статус</th><th></th></tr></thead>
        <tbody id="categories-sortable">
          ${categories.map((c) => {
            const num = categories.findIndex(x => x.id === c.id) + 1;
            if (editingCategoryId === c.id) {
              return `
                <tr>
                  <td></td>
                  <td class="admin-row-num">${num}</td>
                  <td colspan="2">
                    <form class="admin-table-edit" data-save-cat="${c.id}">
                      <input name="name" value="${escapeHtml(c.name)}" required maxlength="100">
                      <button type="submit" class="btn btn-primary btn-sm">OK</button>
                      <button type="button" class="btn btn-outline btn-sm" data-cancel-cat="${c.id}">×</button>
                    </form>
                  </td>
                  <td></td>
                </tr>`;
            }
            return `
            <tr data-sort-id="${c.id}">
              <td>${canSortCategories ? sortControlsHtml(c.id) : ''}</td>
              <td class="admin-row-num">${num}</td>
              <td>${escapeHtml(c.name)}</td>
              <td><span class="badge badge-active">Активна</span></td>
              <td class="data-table-actions">
                <button type="button" class="btn btn-outline btn-sm" data-edit-cat="${c.id}">Изменить</button>
                <button type="button" class="btn btn-danger btn-sm" data-del-cat="${c.id}">Удалить</button>
              </td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>
    </div>
    <div class="admin-mobile-only admin-cards admin-cards-compact" id="categories-sortable-mobile">
      ${categories.map((c, index) => renderCategoryCard(
        c,
        editingCategoryId === c.id,
        canSortCategories,
        index + 1
      )).join('')}
    </div>`;

  bindCategoryActions(list);

  if (canSortCategories && categories.length > 1) {
    bindSortableList(list, {
      itemSelector: '[data-sort-id]',
      getIds: () => categorySortIds,
      setIds: (ids) => { categorySortIds = ids; },
      reorderUrl: '/api/admin/categories/reorder',
      onReload: loadCategories,
    });
  }
}

(async () => {
  const admin = await requireAdmin();
  if (!admin) return;

  document.getElementById('admin-name').textContent = admin.name;
  document.getElementById('sidebar').innerHTML = adminSidebar('categories');

  document.getElementById('admin-logout')?.addEventListener('click', (e) => {
    e.preventDefault();
    adminLogout();
  });

  document.getElementById('add-category-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const alertArea = document.getElementById('alert-area');
    const name = e.target.name.value.trim();
    try {
      await api('/api/admin/categories', {
        method: 'POST',
        body: JSON.stringify({ name }),
      });
      e.target.reset();
      showAlert(alertArea, 'Категория добавлена', 'success');
      loadCategories();
    } catch (err) {
      showAlert(alertArea, err.message, 'error');
    }
  });

  loadCategories();
})();

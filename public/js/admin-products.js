let categories = [];
let productFilter = 'all';
let productSearchQuery = '';
let productCategoryFilter = '';
let productDateSort = 'default';
let productSortIds = [];
let productReorderModalDirty = false;
let productReorderModalOrder = [];
let productReorderProducts = [];
let productReorderSource = [];
let productReorderContext = null;
let productsListLoading = false;
let productsSortAbort = null;
let productReorderSortAbort = null;
let productReorderScrollLocked = false;

const PRODUCT_SORT_LIST_SELECTOR = '#product-reorder-list, #products-sortable, #products-sortable-mobile';
const ADMIN_PRODUCTS_COLLAPSE_THRESHOLD = 10;
const REORDER_LIST_COLLAPSE_THRESHOLD = 12;

function sortControlsCompactHtml(id, num, total) {
  return `
    <div class="admin-sort-controls admin-sort-controls-compact">
      <button type="button" class="admin-sort-handle" data-sort-handle="${id}" draggable="true" title="Перетащить" aria-label="Перетащить">⋮⋮</button>
      <button type="button" class="admin-sort-btn" data-sort-top="${id}" title="В начало" aria-label="В начало">⤒</button>
      <button type="button" class="admin-sort-btn" data-sort-up="${id}" aria-label="Выше">↑</button>
      <input type="number" class="admin-sort-pos-input" min="1" max="${total}" value="${num}" data-sort-pos="${id}" aria-label="Позиция">
      <button type="button" class="admin-sort-btn" data-sort-down="${id}" aria-label="Ниже">↓</button>
      <button type="button" class="admin-sort-btn" data-sort-bottom="${id}" title="В конец" aria-label="В конец">⤓</button>
    </div>`;
}

function reorderPosOptionsHtml(num, total) {
  let html = '';
  for (let i = 1; i <= total; i += 1) {
    html += `<option value="${i}"${i === num ? ' selected' : ''}>${i}</option>`;
  }
  return html;
}

function sortControlsMobileHtml(id, num, total) {
  return `
    <div class="product-reorder-controls">
      <label class="product-reorder-pos-box" for="sort-pos-${id}">
        <span class="product-reorder-pos-label">Место</span>
        <select id="sort-pos-${id}" class="product-reorder-pos-select admin-sort-pos-input" data-sort-pos="${id}" aria-label="Номер места в списке">
          ${reorderPosOptionsHtml(num, total)}
        </select>
      </label>
      <div class="product-reorder-arrows">
        <button type="button" class="product-reorder-arrow admin-sort-btn" data-sort-up="${id}" aria-label="Выше">↑</button>
        <button type="button" class="product-reorder-arrow admin-sort-btn" data-sort-down="${id}" aria-label="Ниже">↓</button>
      </div>
    </div>`;
}

function isAdminMobileView() {
  return window.matchMedia('(max-width: 768px)').matches;
}

async function persistSortOrder(url, ids, categoryId = null) {
  const body = { order: ids };
  if (categoryId) body.category_id = categoryId;
  await api(url, { method: 'PUT', body: JSON.stringify(body) });
}

function productCategorySortOrder(product, categoryId) {
  const orders = product.category_sort_orders || {};
  const key = String(categoryId);
  if (orders[key] != null) return orders[key];
  return product.sort_order || 0;
}

function sortProductsForCatalogOrder(products, categoryId = null) {
  return [...products].sort((a, b) => {
    const aKey = categoryId ? productCategorySortOrder(a, categoryId) : (a.sort_order || 0);
    const bKey = categoryId ? productCategorySortOrder(b, categoryId) : (b.sort_order || 0);
    return aKey - bKey || a.id - b.id;
  });
}

function getReorderContext() {
  if (productFilter !== 'all') return null;
  if (productSearchQuery.trim()) return null;
  if (productCategoryFilter === 'none') return null;
  if (productDateSort !== 'default') return null;

  if (productCategoryFilter) {
    const categoryId = parseInt(productCategoryFilter, 10);
    const category = categories.find(c => c.id === categoryId);
    return {
      type: 'category',
      categoryId,
      categoryName: category?.name || 'Категория',
    };
  }

  return { type: 'global' };
}

function getReorderProductList(activeProducts) {
  const ctx = getReorderContext();
  let list = activeProducts.filter(p => !p.deleted);
  if (ctx?.type === 'category') {
    list = list.filter(p => productHasCategory(p, ctx.categoryId));
    list = sortProductsForCatalogOrder(list, ctx.categoryId);
  } else {
    list = sortProductsForCatalogOrder(list);
  }
  return list;
}

function getReorderHintText(ctx) {
  if (ctx?.type === 'category') {
    const category = categories.find(c => c.id === ctx.categoryId);
    if (category?.is_featured_home) {
      return `Порядок на главной — первые товары в каталоге («${ctx.categoryName}»)`;
    }
    return `Порядок в категории «${ctx.categoryName}» на сайте`;
  }
  return 'Порядок товаров в общем каталоге (не главная страница)';
}

function renderReorderCategorySelect(selectedValue = '') {
  const activeCategories = categories.filter(c => !c.deleted);
  return `
    <div class="product-reorder-category-field">
      <label class="product-reorder-category-label" for="product-reorder-category">Категория</label>
      <select id="product-reorder-category" class="admin-products-category-filter product-reorder-category-select" aria-label="Категория для сортировки">
        <option value=""${selectedValue === '' ? ' selected' : ''}>Все категории</option>
        ${activeCategories.map(c => `
          <option value="${c.id}"${String(c.id) === String(selectedValue) ? ' selected' : ''}>${escapeHtml(c.name)}</option>
        `).join('')}
      </select>
    </div>`;
}

function switchProductReorderCategory(newValue, activeProducts) {
  productCategoryFilter = newValue;
  const mainFilter = document.getElementById('product-category-filter');
  if (mainFilter) mainFilter.value = newValue;
  productReorderModalDirty = false;
  openProductReorderModal(activeProducts);
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

function moveToPosition(ids, id, position) {
  const order = [...ids];
  const from = order.indexOf(id);
  if (from < 0) return null;
  const to = Math.max(0, Math.min(order.length - 1, position - 1));
  if (from === to) return order;
  order.splice(from, 1);
  order.splice(to, 0, id);
  return order;
}

function updateSortRowNumbers(el, num, total) {
  el.querySelectorAll('.admin-row-num').forEach(cell => {
    cell.textContent = cell.closest('.admin-card-name') ? `${num}.` : String(num);
  });
  el.querySelectorAll('.product-reorder-num').forEach(cell => {
    cell.textContent = String(num);
  });
  el.querySelectorAll('.admin-sort-pos-input').forEach(input => {
    if (input.tagName === 'SELECT') {
      if (!input.querySelector(`option[value="${num}"]`)) {
        input.innerHTML = reorderPosOptionsHtml(num, total);
      }
      input.value = String(num);
    } else {
      input.value = num;
      input.max = total;
    }
  });
}

function refreshSortNumbers(root) {
  const reorderList = root.querySelector('#product-reorder-list');
  if (reorderList) {
    const rows = reorderList.querySelectorAll('[data-sort-id]');
    rows.forEach((el, index) => updateSortRowNumbers(el, index + 1, rows.length));
    return;
  }

  root.querySelectorAll('#products-sortable [data-sort-id], #products-sortable-mobile [data-sort-id]').forEach((el, index) => {
    updateSortRowNumbers(el, index + 1, 0);
  });
}

function syncSortViews(root, ids) {
  const selectors = root.querySelector('#product-reorder-list')
    ? ['#product-reorder-list']
    : ['#products-sortable', '#products-sortable-mobile'];

  selectors.forEach(selector => {
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

function readCurrentSortIds(root) {
  const reorderList = root.querySelector('#product-reorder-list');
  if (reorderList) return readSortIdsFromDom(reorderList);

  const desktop = root.querySelector('#products-sortable');
  const mobile = root.querySelector('#products-sortable-mobile');
  const desktopWrap = desktop?.closest('.admin-desktop-only');
  if (desktopWrap && getComputedStyle(desktopWrap).display === 'none') {
    return readSortIdsFromDom(mobile);
  }
  const fromDesktop = readSortIdsFromDom(desktop);
  if (fromDesktop.length) return fromDesktop;
  return readSortIdsFromDom(mobile);
}

function ordersEqual(a, b) {
  return a.length === b.length && a.every((id, index) => id === b[index]);
}

function renderProductReorderRows(root, productsById, order, query = '') {
  const list = root.querySelector('#product-reorder-list');
  if (!list) return;

  const q = query.trim().toLowerCase();
  const mobile = isAdminMobileView();
  list.classList.toggle('product-reorder-list--mobile', mobile);
  list.innerHTML = order.map((id, index) => {
    const product = productsById.get(id);
    if (!product) return '';
    const hidden = q && !(product.name || '').toLowerCase().includes(q);
    if (mobile) {
      return `
      <div class="product-reorder-row product-reorder-row--mobile"${hidden ? ' hidden' : ''} data-sort-id="${id}">
        <div class="product-reorder-row-top">
          <span class="product-reorder-num">${index + 1}</span>
          <span class="product-reorder-name">${escapeHtml(product.name)}</span>
        </div>
        ${sortControlsMobileHtml(id, index + 1, order.length)}
      </div>`;
    }
    return `
      <div class="product-reorder-row"${hidden ? ' hidden' : ''} data-sort-id="${id}">
        <span class="admin-row-num product-reorder-num">${index + 1}</span>
        ${sortControlsCompactHtml(id, index + 1, order.length)}
        <span class="product-reorder-name">${escapeHtml(product.name)}</span>
      </div>`;
  }).join('');
  refreshSortNumbers(root);
}

function filterProductReorderSearch(root, query) {
  const q = query.trim().toLowerCase();
  const list = root.querySelector('#product-reorder-list');
  if (q.length >= 2) {
    setReorderListCollapsed(root, false);
  } else if (list?.dataset.autoCollapse === '1') {
    setReorderListCollapsed(root, true);
  }

  root.querySelectorAll('#product-reorder-list [data-sort-id]').forEach(row => {
    const name = row.querySelector('.product-reorder-name')?.textContent.toLowerCase() || '';
    row.hidden = Boolean(q && !name.includes(q));
  });
}

function setReorderListCollapsed(root, collapsed) {
  root.classList.toggle('product-reorder--list-collapsed', collapsed);
  const btn = root.querySelector('#toggle-product-reorder-list');
  const count = root.querySelectorAll('#product-reorder-list [data-sort-id]').length;
  if (btn) {
    btn.textContent = collapsed ? `Показать весь список (${count})` : 'Скрыть список';
    btn.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
  }
}

function closeProductReorderModal() {
  productReorderSortAbort?.abort();
  productReorderSortAbort = null;
  const host = document.getElementById('product-reorder-modal');
  if (!host) return;
  host.innerHTML = '';
  host.style.display = 'none';
  host.className = '';
  host.removeAttribute('style');
  document.body.classList.remove('product-reorder-open');
  if (productReorderScrollLocked) {
    unlockPageScroll();
    productReorderScrollLocked = false;
  }
  productReorderModalDirty = false;
  productReorderContext = null;
}

async function saveProductReorderModal() {
  const host = document.getElementById('product-reorder-modal');
  const order = readCurrentSortIds(host);
  if (!order.length) return;

  const saveBtn = host.querySelector('#save-product-reorder-modal');
  if (saveBtn) {
    saveBtn.disabled = true;
    saveBtn.textContent = 'Сохранение...';
  }

  try {
    const ctx = productReorderContext;
    const bodyCategoryId = ctx?.type === 'category'
      ? ctx.categoryId
      : null;
    await persistSortOrder('/api/admin/products/reorder', order, bodyCategoryId);
    productSortIds = order;
    closeProductReorderModal();
    await loadProductsList();
    const alertArea = document.getElementById('alert-area');
    const savedWhere = ctx?.type === 'category'
      ? `в категории «${ctx.categoryName}»`
      : 'в общем каталоге';
    if (alertArea) showAlert(alertArea, `Порядок товаров ${savedWhere} сохранён`, 'success');
  } catch (err) {
    alert(err.message);
    if (saveBtn) {
      saveBtn.disabled = false;
      saveBtn.textContent = 'Сохранить порядок';
    }
  }
}

function openProductReorderModal(activeProducts) {
  const host = document.getElementById('product-reorder-modal');
  if (!host) return;

  const alreadyOpen = host.style.display === 'flex';
  productReorderSortAbort?.abort();
  productReorderSortAbort = null;

  const ctx = getReorderContext();
  const reorderProducts = getReorderProductList(activeProducts);
  productReorderContext = ctx;
  productReorderProducts = reorderProducts;
  productReorderModalOrder = reorderProducts.map(p => p.id);
  productReorderModalDirty = false;
  const productsById = new Map(reorderProducts.map(p => [p.id, p]));
  const longReorderList = reorderProducts.length > REORDER_LIST_COLLAPSE_THRESHOLD;
  const mobile = isAdminMobileView();
  const canReorderInModal = reorderProducts.length > 1;
  const modalTitle = ctx?.type === 'category'
    ? `Порядок: ${ctx.categoryName} (${reorderProducts.length})`
    : `Порядок в каталоге (${reorderProducts.length})`;
  const modalHint = !canReorderInModal
    ? (mobile ? 'Выберите другую категорию — здесь меньше двух товаров' : 'В этой категории меньше двух товаров — выберите другую категорию или вернитесь к списку')
    : longReorderList
      ? (mobile ? 'Длинный список — найдите товар через поиск' : 'Длинный список скрыт — найдите товар через поиск или откройте весь список')
      : ctx?.type === 'category'
        ? (mobile ? 'Выберите место в списке или нажмите ↑↓' : 'Этот порядок виден на сайте при выборе этой категории.')
        : (mobile ? 'Выберите место в списке или нажмите ↑↓' : 'Общий порядок товаров в каталоге (не главная страница).');

  host.style.display = 'flex';
  host.className = `modal-overlay product-reorder-overlay${mobile ? ' product-reorder-overlay--mobile' : ''}`;
  host.innerHTML = `
    <div class="modal modal-reorder${mobile ? ' modal-reorder--mobile' : ''}" role="dialog" aria-modal="true" aria-labelledby="product-reorder-title">
      <div class="modal-reorder-header">
        <div class="modal-reorder-title-row">
          <h2 id="product-reorder-title">${escapeHtml(modalTitle)}</h2>
          <p class="admin-section-hint">${modalHint}</p>
        </div>
        ${renderReorderCategorySelect(productCategoryFilter)}
        <input type="search" id="product-reorder-search" class="admin-products-search" placeholder="Найти товар..." autocomplete="off"${canReorderInModal ? '' : ' disabled'}>
        <div class="admin-sort-toolbar-actions modal-reorder-actions">
          ${longReorderList && canReorderInModal ? '<button type="button" class="btn btn-outline btn-sm btn-block" id="toggle-product-reorder-list">Показать весь список</button>' : ''}
          <button type="button" class="btn btn-primary btn-sm btn-block" id="save-product-reorder-modal"${canReorderInModal ? '' : ' disabled'}>Сохранить</button>
          <button type="button" class="btn btn-outline btn-sm btn-block" id="cancel-product-reorder-modal">Отменить</button>
        </div>
      </div>
      <p class="product-reorder-collapsed-hint">Список скрыт. Введите название в поиск или нажмите «Показать весь список».</p>
      <div class="product-reorder-list" id="product-reorder-list"${longReorderList && canReorderInModal ? ' data-auto-collapse="1"' : ''}></div>
    </div>`;

  if (!alreadyOpen) {
    lockPageScroll();
    productReorderScrollLocked = true;
    if (mobile) {
      document.body.classList.add('product-reorder-open');
      closeAdminMobileChrome();
    }
  }

  if (canReorderInModal) {
    renderProductReorderRows(host, productsById, productReorderModalOrder);
    if (longReorderList) setReorderListCollapsed(host, true);
  } else {
    const list = host.querySelector('#product-reorder-list');
    if (list) {
      list.innerHTML = '<p class="product-reorder-empty">Нужно минимум 2 товара. Выберите другую категорию выше.</p>';
    }
  }

  host.querySelector('#product-reorder-category')?.addEventListener('change', (e) => {
    const newValue = e.target.value;
    if (newValue === productCategoryFilter) return;
    if (productReorderModalDirty && !confirm('Сменить категорию без сохранения?')) {
      e.target.value = productCategoryFilter;
      return;
    }
    switchProductReorderCategory(newValue, activeProducts);
  });

  host.querySelector('#product-reorder-search')?.addEventListener('input', (e) => {
    filterProductReorderSearch(host, e.target.value);
  });

  host.querySelector('#toggle-product-reorder-list')?.addEventListener('click', () => {
    const collapsed = host.classList.contains('product-reorder--list-collapsed');
    setReorderListCollapsed(host, !collapsed);
    if (!collapsed) {
      host.querySelector('#product-reorder-search').value = '';
      filterProductReorderSearch(host, '');
    }
  });

  host.querySelector('#save-product-reorder-modal')?.addEventListener('click', saveProductReorderModal);
  host.querySelector('#cancel-product-reorder-modal')?.addEventListener('click', () => {
    if (productReorderModalDirty && !confirm('Закрыть без сохранения?')) return;
    closeProductReorderModal();
    loadProductsList();
  });

  host.addEventListener('click', (e) => {
    if (e.target === host) {
      if (productReorderModalDirty && !confirm('Закрыть без сохранения?')) return;
      closeProductReorderModal();
      loadProductsList();
    }
  });

  bindSortableList(host, {
    itemSelector: '[data-sort-id]',
    getIds: () => productReorderModalOrder,
    setIds: (ids) => { productReorderModalOrder = ids; },
    reorderUrl: '/api/admin/products/reorder',
    onReload: () => {},
    autoPersist: false,
    onOrderChange: () => { productReorderModalDirty = true; },
    sortAbortRef: 'productReorder',
  });

  if (!canReorderInModal) {
    productReorderSortAbort?.abort();
    productReorderSortAbort = null;
  }
}

function bindSortableList(root, config) {
  if (!root) return;

  const useReorderAbort = config.sortAbortRef === 'productReorder';
  if (useReorderAbort) {
    productReorderSortAbort?.abort();
    productReorderSortAbort = new AbortController();
  } else {
    productsSortAbort?.abort();
    productsSortAbort = new AbortController();
  }
  const { signal } = useReorderAbort ? productReorderSortAbort : productsSortAbort;

  const {
    itemSelector,
    getIds,
    setIds,
    reorderUrl,
    onReload,
    autoPersist = true,
    onOrderChange,
  } = config;

  let draggedRow = null;
  let dragStartOrder = null;

  const finishLocalReorder = (nextOrder) => {
    setIds(nextOrder);
    syncSortViews(root, nextOrder);
    refreshSortNumbers(root);
    onOrderChange?.(nextOrder);
  };

  const finalizeDragReorder = () => {
    if (!draggedRow) return;
    const sortContainer = draggedRow.closest(PRODUCT_SORT_LIST_SELECTOR);
    const nextOrder = readSortIdsFromDom(sortContainer);
    if (!nextOrder.length) return;
    if (dragStartOrder && ordersEqual(nextOrder, dragStartOrder)) return;
    finishLocalReorder(nextOrder);
  };

  root.addEventListener('click', async (e) => {
    if (!useReorderAbort && productsListLoading) return;

    const posInput = e.target.closest('[data-sort-pos]');
    if (posInput && root.contains(posInput)) return;

    const topBtn = e.target.closest('[data-sort-top]');
    const bottomBtn = e.target.closest('[data-sort-bottom]');
    const upBtn = e.target.closest('[data-sort-up]');
    const downBtn = e.target.closest('[data-sort-down]');
    const btn = topBtn || bottomBtn || upBtn || downBtn;
    if (!btn || !root.contains(btn)) return;

    e.preventDefault();
    const id = parseInt(
      topBtn?.dataset.sortTop || bottomBtn?.dataset.sortBottom || upBtn?.dataset.sortUp || downBtn?.dataset.sortDown,
      10
    );
    const currentOrder = readCurrentSortIds(root);
    const baseOrder = currentOrder.length ? currentOrder : getIds();
    let nextOrder = null;

    if (topBtn) nextOrder = moveToPosition(baseOrder, id, 1);
    else if (bottomBtn) nextOrder = moveToPosition(baseOrder, id, baseOrder.length);
    else nextOrder = swapSortIds(baseOrder, id, upBtn ? -1 : 1);

    if (!nextOrder) return;

    if (autoPersist) {
      root.querySelectorAll('.admin-sort-btn').forEach(b => { b.disabled = true; });
      try {
        await persistSortOrder(reorderUrl, nextOrder);
        setIds(nextOrder);
        await onReload();
      } catch (err) {
        alert(err.message);
        await onReload();
      }
      return;
    }

    finishLocalReorder(nextOrder);
  }, { signal });

  root.addEventListener('change', (e) => {
    const posInput = e.target.closest('[data-sort-pos]');
    if (!posInput || !root.contains(posInput)) return;

    const id = parseInt(posInput.dataset.sortPos, 10);
    const position = parseInt(posInput.value, 10);
    if (!position) return;

    const currentOrder = readCurrentSortIds(root);
    const nextOrder = moveToPosition(currentOrder.length ? currentOrder : getIds(), id, position);
    if (!nextOrder) return;
    finishLocalReorder(nextOrder);
  }, { signal });

  root.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    const posInput = e.target.closest('[data-sort-pos]');
    if (!posInput || !root.contains(posInput)) return;
    posInput.blur();
  }, { signal });

  root.addEventListener('dragstart', (e) => {
    if (!useReorderAbort && productsListLoading) return;
    const handle = e.target.closest('[data-sort-handle]');
    if (!handle || !root.contains(handle)) return;
    draggedRow = handle.closest(itemSelector);
    if (!draggedRow) return;
    dragStartOrder = readCurrentSortIds(root);
    draggedRow.classList.add('sortable-dragging');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', draggedRow.dataset.sortId || '');
  }, { signal });

  root.addEventListener('dragend', () => {
    if (!autoPersist) finalizeDragReorder();
    draggedRow?.classList.remove('sortable-dragging');
    root.querySelectorAll(itemSelector).forEach(el => el.classList.remove('sortable-over'));
    draggedRow = null;
    dragStartOrder = null;
  }, { signal });

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
  }, { signal });

  root.addEventListener('dragleave', (e) => {
    const item = e.target.closest?.(itemSelector);
    if (item) item.classList.remove('sortable-over');
  }, { signal });

  root.addEventListener('drop', async (e) => {
    if ((!useReorderAbort && productsListLoading) || !draggedRow) return;
    e.preventDefault();
    root.querySelectorAll(itemSelector).forEach(el => el.classList.remove('sortable-over'));

    const sortContainer = draggedRow.closest(PRODUCT_SORT_LIST_SELECTOR);
    const nextOrder = readSortIdsFromDom(sortContainer);
    draggedRow = null;
    dragStartOrder = null;
    if (!nextOrder.length) return;

    if (autoPersist) {
      try {
        await persistSortOrder(reorderUrl, nextOrder);
        setIds(nextOrder);
        await onReload();
      } catch (err) {
        alert(err.message);
        await onReload();
      }
      return;
    }

    finishLocalReorder(nextOrder);
  }, { signal });
}

function productAddedDateHtml(p) {
  const full = formatDate(p.created_at);
  const short = formatDateShort(p.created_at);
  return `<span class="admin-product-date" title="${escapeHtml(full)}">${short}</span>`;
}

function sortAdminProductsByDate(products) {
  if (productDateSort === 'date_desc') {
    return [...products].sort((a, b) => productCreatedTime(b) - productCreatedTime(a) || b.id - a.id);
  }
  if (productDateSort === 'date_asc') {
    return [...products].sort((a, b) => productCreatedTime(a) - productCreatedTime(b) || a.id - b.id);
  }
  return products;
}

function buildDisplayProducts(products, reorderContext) {
  if (productDateSort === 'date_desc' || productDateSort === 'date_asc') {
    const active = sortAdminProductsByDate(products.filter(p => !p.deleted));
    const deleted = sortAdminProductsByDate(products.filter(p => p.deleted));
    return [...active, ...deleted];
  }
  if (reorderContext?.type === 'category') {
    return sortProductsForCatalogOrder(products.filter(p => !p.deleted), reorderContext.categoryId)
      .concat(products.filter(p => p.deleted));
  }
  return products;
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

function adminProductCategoryLabels(p) {
  const cats = p.categories?.length
    ? p.categories
    : (p.category ? [p.category] : []);
  return cats.map(c => c.name);
}
function adminProductCategoriesHtml(p) {
  const cats = p.categories?.length
    ? p.categories
    : (p.category ? [p.category] : []);
  return cats.map(c => {
    const cls = c.is_featured_home
      ? 'admin-card-category admin-card-category-featured'
      : 'admin-card-category';
    return `<span class="${cls}">${escapeHtml(c.name)}</span>`;
  }).join('');
}

function renderProductCard(p, num) {
  const priceLine = p.allow_piece_sale && p.price_piece
    ? `${formatPrice(p.price_pack)} · ${formatPrice(p.price_piece)}/шт`
    : formatPrice(p.price_pack);
  const badges = productBadges(p);
  const categoryHtml = adminProductCategoriesHtml(p);

  return `
    <article class="admin-card admin-card-compact ${p.deleted ? 'admin-card-muted' : ''}${p.in_stock === false && !p.deleted ? ' admin-card-oos' : ''}">
      <div class="admin-card-row">
        <div class="admin-card-main">
          <strong class="admin-card-name">${typeof num === 'number' ? `<span class="admin-row-num">${num}.</span> ` : ''}${escapeHtml(p.name)}</strong>
          ${categoryHtml ? `
            <div class="admin-card-categories">${categoryHtml}</div>` : ''}
          <div class="admin-card-price">${priceLine}</div>
          <div class="admin-card-date">На сайте: ${productAddedDateHtml(p)}</div>
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
  const filterCategories = categories
    .filter(c => !c.deleted)
    .sort((a, b) => (b.is_featured_home || 0) - (a.is_featured_home || 0) || (a.sort_order || 0) - (b.sort_order || 0) || a.id - b.id);
  const categoryOptions = filterCategories
    .map(c => `<option value="${c.id}">${escapeHtml(c.name)}</option>`)
    .join('');

  if (addBox) {
    addBox.innerHTML = renderCategoryPicker(categories, [], 'category_ids', true);
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

  container.querySelectorAll('.admin-product-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      container.querySelectorAll('.admin-product-tab').forEach(t => {
        t.classList.remove('active');
        t.setAttribute('aria-selected', 'false');
      });
      tab.classList.add('active');
      tab.setAttribute('aria-selected', 'true');
      productFilter = tab.dataset.filter;
      loadProductsList();
    });
  });

  syncProductStatusTabs();

  const searchInput = initSearchClear(document.getElementById('product-search'));
  searchInput?.addEventListener('input', (e) => {
    productSearchQuery = e.target.value;
    loadProductsList();
  });

  document.getElementById('product-category-filter')?.addEventListener('change', (e) => {
    productCategoryFilter = e.target.value;
    loadProductsList();
  });

  document.getElementById('product-date-sort')?.addEventListener('change', (e) => {
    productDateSort = e.target.value || 'default';
    loadProductsList();
  });

  document.getElementById('download-price-list')?.addEventListener('click', () => {
    const categoryId = productCategoryFilter || 'all';
    window.location.href = `/api/admin/products/export?category_id=${encodeURIComponent(categoryId)}`;
  });
}

function syncProductStatusTabs() {
  const container = document.getElementById('product-filters');
  if (!container) return;
  container.querySelectorAll('.admin-product-tab').forEach(tab => {
    const active = tab.dataset.filter === productFilter;
    tab.classList.toggle('active', active);
    tab.setAttribute('aria-selected', active ? 'true' : 'false');
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

function isProductDateSorted() {
  return productDateSort !== 'default';
}

function isProductListFiltered() {
  return Boolean(productSearchQuery.trim() || productCategoryFilter === 'none');
}

function isProductStatusFiltered() {
  return productFilter !== 'all';
}

function syncAdminProductsSections(activeCount, shownCount) {
  const addSection = document.getElementById('add-product-section');
  const listSection = document.getElementById('products-list-section');
  const listSummary = document.getElementById('products-list-summary');

  if (listSummary) {
    listSummary.textContent = shownCount === activeCount
      ? `Список товаров (${activeCount})`
      : `Список товаров (${shownCount} из ${activeCount})`;
  }

  if (activeCount <= ADMIN_PRODUCTS_COLLAPSE_THRESHOLD) {
    if (addSection) addSection.open = true;
    if (listSection) listSection.open = true;
    return;
  }

  if (listSection && listSection.dataset.userOpened !== '1') {
    listSection.open = true;
  }
  if (addSection && addSection.dataset.userOpened !== '1') {
    addSection.open = false;
  }
}

function bindAdminCollapsibleMemory(section) {
  if (!section || section.dataset.bound === '1') return;
  section.dataset.bound = '1';
  section.addEventListener('toggle', () => {
    if (section.open) section.dataset.userOpened = '1';
  });
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
  productsListLoading = true;
  try {
  syncProductStatusTabs();
  const searchInput = document.getElementById('product-search');
  if (searchInput && searchInput.value !== productSearchQuery) {
    searchInput.value = productSearchQuery;
    searchInput._syncSearchClear?.();
  }

  const allProducts = await api(`/api/admin/products?filter=${productFilter}`);
  const activeProducts = allProducts.filter(p => !p.deleted);
  const reorderContext = getReorderContext();
  const reorderProducts = getReorderProductList(activeProducts);
  const products = filterAdminProducts(allProducts);
  const displayProducts = buildDisplayProducts(products, reorderContext);
  productSortIds = reorderProducts.map(p => p.id);
  const canSortProducts = Boolean(reorderContext) && reorderProducts.length > 1;

  if (!allProducts.length) {
    container.innerHTML = '<p style="color:var(--muted)">Товаров нет</p>';
    return;
  }

  if (!products.length) {
    container.innerHTML = '<p style="color:var(--muted)">Ничего не найдено. Измените поиск или категорию.</p>';
    return;
  }

  const productsListHtml = `
    <div class="admin-desktop-only admin-table-wrap">
      <table class="data-table data-table-compact">
        <thead>
          <tr>
            <th>№</th>
            <th>Название</th>
            <th>Категория</th>
            <th>На сайте</th>
            <th>Упак.</th>
            <th>Метки</th>
            <th></th>
          </tr>
        </thead>
        <tbody id="products-table-body">
          ${displayProducts.map((p, index) => {
            const num = canSortProducts && !p.deleted
              ? reorderProducts.findIndex(x => x.id === p.id) + 1
              : index + 1;
            return `
            <tr style="${p.deleted ? 'opacity:0.5' : ''}">
              <td class="admin-row-num">${num}</td>
              <td>${escapeHtml(p.name)}</td>
              <td>${escapeHtml(adminProductCategoryLabels(p).join(', ') || '—')}</td>
              <td class="admin-product-date-cell">${productAddedDateHtml(p)}</td>
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
    <div class="admin-mobile-only admin-cards admin-cards-compact" id="products-cards">
      ${displayProducts.map((p, index) => renderProductCard(
        p,
        canSortProducts && !p.deleted
          ? reorderProducts.findIndex(x => x.id === p.id) + 1
          : index + 1
      )).join('')}
    </div>`;

  const reorderBar = document.getElementById('products-reorder-bar');
  if (reorderBar) {
    if (canSortProducts) {
      reorderBar.hidden = false;
      const mobileHint = isAdminMobileView()
        ? ' В окне выберите место из списка или нажмите ↑↓.'
        : '';
      reorderBar.innerHTML = `
        <div class="admin-sort-toolbar">
          <p class="admin-section-hint">${getReorderHintText(reorderContext)}${mobileHint}</p>
          <button type="button" class="btn btn-primary btn-sm" id="open-product-reorder">Изменить порядок</button>
        </div>`;
    } else {
      reorderBar.hidden = true;
      reorderBar.innerHTML = '';
    }
  }

  container.innerHTML = `
    ${isProductDateSorted() ? '<p class="admin-section-hint">Сортировка каталога недоступна при сортировке по дате.</p>' : ''}
    ${isProductListFiltered() ? '<p class="admin-section-hint">Показаны отфильтрованные товары. Сортировка доступна для общего списка или одной категории без поиска.</p>' : ''}
    ${isProductStatusFiltered() ? '<p class="admin-section-hint">Сортировка каталога доступна только во вкладке «Все».</p>' : ''}
    ${productsListHtml}`;

  productReorderSource = activeProducts;
  syncAdminProductsSections(activeProducts.length, products.length);
  bindProductActions(container, allProducts);
  } finally {
    productsListLoading = false;
  }
}

(async () => {
  const admin = await requireAdmin();
  if (!admin) return;

  if (window.matchMedia('(max-width: 768px)').matches) {
    document.getElementById('add-product-section')?.removeAttribute('open');
  }

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

    if (!getSelectedCategoryIds(form).length) {
      showAlert(alertArea, 'Выберите хотя бы одну категорию', 'error');
      return;
    }

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
      await loadProductsList();
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

  bindAdminCollapsibleMemory(document.getElementById('add-product-section'));
  bindAdminCollapsibleMemory(document.getElementById('products-list-section'));

  document.getElementById('products-reorder-bar')?.addEventListener('click', (e) => {
    if (e.target.closest('#open-product-reorder')) {
      e.preventDefault();
      openProductReorderModal(productReorderSource);
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    const host = document.getElementById('product-reorder-modal');
    if (!host || host.style.display === 'none') return;
    if (productReorderModalDirty && !confirm('Закрыть без сохранения?')) return;
    closeProductReorderModal();
    loadProductsList();
  });

  loadProductsList();
})();

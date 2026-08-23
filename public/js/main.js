let allProducts = [];

let activeCategory = '';
let activeTag = '';
let productSort = 'default';
let catalogCategories = [];

let searchQuery = '';

let searchTimer = null;

let currentUser = null;

let featuredProductIds = [];

let visibleProductCount = 0;

function getCatalogPageSize() {
  return window.matchMedia('(max-width: 768px)').matches ? 8 : 12;
}

function resetCatalogPagination() {
  visibleProductCount = getCatalogPageSize();
}

const CATALOG_DROPDOWNS = [
  ['catalog-category-dropdown', 'catalog-category-toggle', 'catalog-category-menu'],
  ['catalog-filter-dropdown', 'catalog-filter-toggle', 'catalog-filter-menu'],
];

async function loadHomeContent() {
  const titleEl = document.getElementById('hero-title');
  const subtitleEl = document.getElementById('hero-subtitle');
  if (!titleEl && !subtitleEl) return;

  try {
    const data = await api('/api/site/home');
    if (titleEl && data.title) titleEl.textContent = data.title;
    if (subtitleEl && data.subtitle) subtitleEl.textContent = data.subtitle;
  } catch {
    /* оставляем текст из HTML */
  }
}

function renderHighlightChip(filter, label, modifier, icon) {
  const isActive = activeCategory === filter && activeTag === filter;
  return `
    <button type="button" class="category-chip category-chip-highlight category-chip--${modifier}${isActive ? ' active' : ''}" data-filter="${filter}">
      <span class="category-chip-icon" aria-hidden="true">${icon}</span>${label}
    </button>
  `;
}

function renderDesktopCategoryChips(categories) {
  return `
    <button class="category-chip${activeCategory === '' && activeTag === '' ? ' active' : ''}" data-filter="">Все</button>
    ${renderHighlightChip('new', 'Новинки', 'new', '✦')}
    ${renderHighlightChip('sale', 'Акции', 'sale', '%')}
    ${categories.map(c => `
      <button class="category-chip${activeCategory === `cat-${c.id}` ? ' active' : ''}" data-filter="cat-${c.id}">${escapeHtml(c.name)}</button>
    `).join('')}
  `;
}

function renderQuickCategoryChips() {
  return `
    ${renderHighlightChip('new', 'Новинки', 'new', '✦')}
    ${renderHighlightChip('sale', 'Акции', 'sale', '%')}
  `;
}

function renderCategoryMenu(categories) {
  const selected = activeCategory.startsWith('cat-') ? activeCategory : '';
  return `
    <div class="catalog-filter-section">
      <p class="catalog-filter-section-title">Категория</p>
      <button type="button" class="catalog-filter-option${selected === '' ? ' active' : ''}" data-category="">Все категории</button>
      ${categories.map(c => {
        const filter = `cat-${c.id}`;
        return `<button type="button" class="catalog-filter-option${selected === filter ? ' active' : ''}" data-category="${filter}">${escapeHtml(c.name)}</button>`;
      }).join('')}
    </div>
  `;
}

function applyCategoryFilter(filter) {
  activeCategory = filter;
  if (filter === 'new') activeTag = 'new';
  else if (filter === 'sale') activeTag = 'sale';
  else if (filter.startsWith('cat-')) {
    if (activeTag === 'new' || activeTag === 'sale') activeTag = '';
  } else if (filter === '') {
    if (activeTag === 'new' || activeTag === 'sale') activeTag = '';
  }
}

function bindCategoryChips(container) {
  container.querySelectorAll('.category-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      applyCategoryFilter(chip.dataset.filter);
      syncCategoryUi();
      renderProducts();
    });
  });
}

async function loadCategories() {
  const desktopContainer = document.getElementById('category-filters');
  const quickContainer = document.getElementById('category-quick-filters');
  const categoryMenu = document.getElementById('catalog-category-menu');

  if (!desktopContainer && !quickContainer && !categoryMenu) return;

  try {
    catalogCategories = await api('/api/categories');

    if (desktopContainer) {
      desktopContainer.innerHTML = renderDesktopCategoryChips(catalogCategories);
      bindCategoryChips(desktopContainer);
    }

    if (quickContainer) {
      quickContainer.innerHTML = renderQuickCategoryChips();
      bindCategoryChips(quickContainer);
    }

    if (categoryMenu) {
      categoryMenu.innerHTML = renderCategoryMenu(catalogCategories);
      categoryMenu.querySelectorAll('[data-category]').forEach(btn => {
        btn.addEventListener('click', () => {
          applyCategoryFilter(btn.dataset.category);
          syncCategoryUi();
          renderProducts();
          setCatalogDropdownOpen('catalog-category-dropdown', false);
        });
      });
    }

    syncCategoryUi();
  } catch {
    if (desktopContainer) desktopContainer.innerHTML = '';
    if (quickContainer) quickContainer.innerHTML = '';
    if (categoryMenu) categoryMenu.innerHTML = '';
  }
}

function syncCategoryChips(container) {
  if (!container) return;

  container.querySelectorAll('.category-chip').forEach(chip => {
    const filter = chip.dataset.filter;
    let isActive = false;
    if (filter === 'new' || filter === 'sale') {
      isActive = activeCategory === filter && activeTag === filter;
    } else if (filter === '') {
      isActive = activeCategory === '' && activeTag === '';
    } else {
      isActive = activeCategory === filter;
    }
    chip.classList.toggle('active', isActive);
  });
}

function getCategoryDropdownLabel() {
  if (activeCategory.startsWith('cat-')) {
    const id = activeCategory.replace('cat-', '');
    const cat = catalogCategories.find(c => String(c.id) === id);
    return cat ? cat.name : 'Категория';
  }
  return 'Все категории';
}

function syncCategoryDropdown() {
  const menu = document.getElementById('catalog-category-menu');
  const label = document.getElementById('catalog-category-label');
  if (!menu && !label) return;

  const selected = activeCategory.startsWith('cat-') ? activeCategory : '';
  if (menu) {
    menu.querySelectorAll('[data-category]').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.category === selected);
    });
  }
  if (label) label.textContent = getCategoryDropdownLabel();
}

function syncCategoryUi() {
  syncCategoryChips(document.getElementById('category-filters'));
  syncCategoryChips(document.getElementById('category-quick-filters'));
  syncCategoryDropdown();
  syncCatalogFilterMenu();
}

function syncCatalogFilterMenu() {
  const menu = document.getElementById('catalog-filter-menu');
  if (!menu) return;

  const mobileQuickTag = window.matchMedia('(max-width: 768px)').matches
    && (activeTag === 'new' || activeTag === 'sale');
  const tagForMenu = mobileQuickTag ? '' : activeTag;

  menu.querySelectorAll('[data-tag]').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tag === tagForMenu);
  });
  menu.querySelectorAll('[data-sort]').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.sort === productSort);
  });
  updateCatalogFilterLabel();
}

function getCatalogFilterLabel() {
  const tagLabels = {
    '': 'Все товары',
    hit: 'Хит продаж',
    new: 'Новинки',
    sale: 'Акции',
  };
  const sortLabels = {
    default: 'как в каталоге',
    date_desc: 'сначала новые',
    date_asc: 'сначала старые',
  };

  const mobileQuickTag = window.matchMedia('(max-width: 768px)').matches
    && (activeTag === 'new' || activeTag === 'sale');
  const tagKey = mobileQuickTag ? '' : activeTag;

  const tag = tagLabels[tagKey] || tagLabels[''];
  const sort = sortLabels[productSort] || sortLabels.default;

  if (!tagKey && productSort === 'default') return 'Фильтр';
  if (!tagKey) return `Сортировка: ${sort}`;
  if (productSort === 'default') return tag;
  return `${tag} · ${sort}`;
}

function updateCatalogFilterLabel() {
  const label = document.getElementById('catalog-filter-label');
  if (label) label.textContent = getCatalogFilterLabel();
}

function isAnyCatalogDropdownOpen() {
  return CATALOG_DROPDOWNS.some(([id]) => document.getElementById(id)?.classList.contains('open'));
}

function closeAllCatalogDropdowns() {
  setCatalogDropdownOpen('', false);
}

function ensureCatalogDropdownBackdrop() {
  let backdrop = document.getElementById('catalog-dropdown-backdrop');
  if (backdrop) return backdrop;

  backdrop = document.createElement('button');
  backdrop.type = 'button';
  backdrop.id = 'catalog-dropdown-backdrop';
  backdrop.className = 'catalog-dropdown-backdrop';
  backdrop.hidden = true;
  backdrop.setAttribute('aria-label', 'Закрыть меню');
  backdrop.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    closeAllCatalogDropdowns();
  });
  document.body.appendChild(backdrop);
  return backdrop;
}

function syncCatalogDropdownBackdrop() {
  const backdrop = ensureCatalogDropdownBackdrop();
  backdrop.hidden = !isAnyCatalogDropdownOpen();
}

function setupCatalogDropdownDismiss() {
  document.addEventListener('pointerdown', (e) => {
    if (!isAnyCatalogDropdownOpen()) return;
    const inside = CATALOG_DROPDOWNS.some(([id]) => document.getElementById(id)?.contains(e.target));
    const onBackdrop = e.target.id === 'catalog-dropdown-backdrop';
    if (inside || onBackdrop) return;
    e.preventDefault();
    e.stopPropagation();
    closeAllCatalogDropdowns();
  }, true);

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeAllCatalogDropdowns();
  });
}

function setCatalogDropdownOpen(dropdownId, open) {
  CATALOG_DROPDOWNS.forEach(([id, toggleId, menuId]) => {
    const dropdown = document.getElementById(id);
    const toggle = document.getElementById(toggleId);
    const menu = document.getElementById(menuId);
    if (!dropdown || !toggle || !menu) return;

    const isOpen = open && dropdownId ? id === dropdownId : false;
    dropdown.classList.toggle('open', isOpen);
    toggle.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
    menu.hidden = !isOpen;
  });
  syncCatalogDropdownBackdrop();
}

function setupCatalogCategoryDropdown() {
  const dropdown = document.getElementById('catalog-category-dropdown');
  const toggle = document.getElementById('catalog-category-toggle');
  if (!dropdown || !toggle) return;

  toggle.addEventListener('click', (e) => {
    e.stopPropagation();
    const open = !dropdown.classList.contains('open');
    setCatalogDropdownOpen('catalog-category-dropdown', open);
  });
}

function setupCatalogFilterDropdown() {
  const dropdown = document.getElementById('catalog-filter-dropdown');
  const toggle = document.getElementById('catalog-filter-toggle');
  const menu = document.getElementById('catalog-filter-menu');
  if (!dropdown || !toggle || !menu) return;

  toggle.addEventListener('click', (e) => {
    e.stopPropagation();
    const open = !dropdown.classList.contains('open');
    setCatalogDropdownOpen('catalog-filter-dropdown', open);
  });

  menu.querySelectorAll('[data-tag]').forEach(btn => {
    btn.addEventListener('click', () => {
      activeTag = btn.dataset.tag;

      if (activeCategory.startsWith('cat-')) {
        // Внутри категории меняем только фильтр, категорию не сбрасываем
      } else if (activeTag === 'new') {
        activeCategory = 'new';
      } else if (activeTag === 'sale') {
        activeCategory = 'sale';
      } else if (activeTag === '' && (activeCategory === 'new' || activeCategory === 'sale')) {
        activeCategory = '';
      }

      syncCategoryUi();
      renderProducts();
      setCatalogDropdownOpen('catalog-filter-dropdown', false);
    });
  });

  menu.querySelectorAll('[data-sort]').forEach(btn => {
    btn.addEventListener('click', () => {
      productSort = btn.dataset.sort;
      syncCategoryUi();
      renderProducts();
      setCatalogDropdownOpen('catalog-filter-dropdown', false);
    });
  });

  updateCatalogFilterLabel();
}

function productCatalogSortOrder(product) {
  if (activeCategory.startsWith('cat-')) {
    const catId = activeCategory.replace('cat-', '');
    const orders = product.category_sort_orders || {};
    if (orders[catId] != null) return orders[catId];
  }
  return product.sort_order || 0;
}

function usesHomeCategorySort() {
  return !searchQuery && !activeCategory && !activeTag && productSort === 'default';
}

function getProductPrimaryCategoryId(product) {
  const ids = product.categories?.length
    ? product.categories.filter(c => !c.is_featured_home).map(c => String(c.id))
    : productCategoryIds(product);
  if (!ids.length) return null;

  let bestId = ids[0];
  let bestOrder = Infinity;
  ids.forEach(id => {
    const cat = catalogCategories.find(c => String(c.id) === id);
    const order = cat ? (cat.sort_order ?? cat.id) : 999999;
    if (order < bestOrder || (order === bestOrder && Number(id) < Number(bestId))) {
      bestOrder = order;
      bestId = id;
    }
  });
  return bestId;
}

function getCategorySortOrderForProduct(product) {
  const catId = getProductPrimaryCategoryId(product);
  if (!catId) return 999999;
  const cat = catalogCategories.find(c => String(c.id) === catId);
  return cat ? (cat.sort_order ?? cat.id) : 999999;
}

function productOrderInPrimaryCategory(product) {
  const catId = getProductPrimaryCategoryId(product);
  if (!catId) return product.sort_order || 0;
  const orders = product.category_sort_orders || {};
  if (orders[catId] != null) return orders[catId];
  return product.sort_order || 0;
}

function compareCatalogAvailability(a, b) {
  const aOut = a.in_stock === false ? 1 : 0;
  const bOut = b.in_stock === false ? 1 : 0;
  if (aOut !== bOut) return aOut - bOut;
  return 0;
}

function compareBestsellerRank(a, b) {
  const aHit = a.is_bestseller ? 0 : 1;
  const bHit = b.is_bestseller ? 0 : 1;
  return aHit - bHit;
}

function sortProductsByCategoryGroups(list) {
  return [...list].sort((a, b) => {
    const stockCmp = compareCatalogAvailability(a, b);
    if (stockCmp) return stockCmp;

    const catCmp = getCategorySortOrderForProduct(a) - getCategorySortOrderForProduct(b);
    if (catCmp) return catCmp;

    return productOrderInPrimaryCategory(a) - productOrderInPrimaryCategory(b) || a.id - b.id;
  });
}

function sortProductsHomeDefault(list) {
  const featuredSet = new Set(featuredProductIds.map(String));
  const byId = new Map(list.map(p => [String(p.id), p]));

  const featured = featuredProductIds
    .map(id => byId.get(String(id)))
    .filter(Boolean);
  const rest = featured.length
    ? list.filter(p => !featuredSet.has(String(p.id)))
    : list;

  const hits = rest.filter(p => p.is_bestseller);
  const regular = rest.filter(p => !p.is_bestseller);

  return [
    ...featured,
    ...sortProductsByCategoryGroups(hits),
    ...sortProductsByCategoryGroups(regular),
  ];
}

function sortProducts(list) {
  if (usesHomeCategorySort()) {
    return sortProductsHomeDefault(list);
  }

  const sorted = [...list];

  sorted.sort((a, b) => {
    const aOut = a.in_stock === false ? 1 : 0;
    const bOut = b.in_stock === false ? 1 : 0;
    if (aOut !== bOut) return aOut - bOut;

    if (productSort === 'date_desc') {
      return productCreatedTime(b) - productCreatedTime(a) || a.id - b.id;
    }
    if (productSort === 'date_asc') {
      return productCreatedTime(a) - productCreatedTime(b) || a.id - b.id;
    }

    const hitCmp = compareBestsellerRank(a, b);
    if (hitCmp) return hitCmp;

    return productCatalogSortOrder(a) - productCatalogSortOrder(b) || a.id - b.id;
  });

  return sorted;
}

function getFilteredProducts() {
  let list = allProducts;

  if (activeCategory.startsWith('cat-')) {
    const catId = activeCategory.replace('cat-', '');
    list = list.filter(p => productHasCategory(p, catId));
  } else if (activeCategory === 'new') {
    list = list.filter(p => p.is_new);
  } else if (activeCategory === 'sale') {
    list = list.filter(p => p.is_on_sale);
  }

  if (activeTag === 'new') {
    list = list.filter(p => p.is_new);
  } else if (activeTag === 'sale') {
    list = list.filter(p => p.is_on_sale);
  } else if (activeTag === 'hit') {
    list = list.filter(p => p.is_bestseller);
  }

  if (searchQuery) {
    const q = searchQuery.toLowerCase();
    list = list.filter(p =>
      p.name.toLowerCase().includes(q) ||
      (p.description || '').toLowerCase().includes(q) ||
      productCategoryNames(p).some(name => name.toLowerCase().includes(q))
    );
  }

  return sortProducts(list);
}

async function loadFeaturedOrder() {
  try {
    featuredProductIds = await api('/api/featured-products');
  } catch {
    featuredProductIds = [];
  }
}

function renderProducts({ resetPagination = true } = {}) {
  const container = document.getElementById('products');
  const loadMoreWrap = document.getElementById('products-load-more');
  const products = getFilteredProducts();

  if (resetPagination) {
    resetCatalogPagination();
  }

  if (!products.length) {
    container.innerHTML = `
      <div class="empty-state" style="grid-column:1/-1">
        <h2>${searchQuery || activeCategory || activeTag ? 'Ничего не найдено' : 'Товаров пока нет'}</h2>
        <p>${searchQuery ? 'Попробуйте другой запрос' : 'Скоро появится вкусное мороженое!'}</p>
      </div>`;
    if (loadMoreWrap) {
      loadMoreWrap.hidden = true;
      loadMoreWrap.innerHTML = '';
    }
    return;
  }

  const visibleProducts = products.slice(0, visibleProductCount);
  const hasMore = visibleProductCount < products.length;

  container.innerHTML = visibleProducts.map(p => renderCatalogProductCard(p, currentUser)).join('');

  bindCatalogProductCards(container, {
    allProducts,
    currentUser,
    onEdit: (productId) => openProductEditModal(productId, allProducts, async () => {
      await loadProducts();
    }),
  });

  if (!loadMoreWrap) return;

  if (hasMore) {
    const remaining = products.length - visibleProducts.length;
    const nextCount = Math.min(getCatalogPageSize(), remaining);
    loadMoreWrap.hidden = false;
    loadMoreWrap.innerHTML = `
      <p class="catalog-load-more-meta">Показано ${visibleProducts.length} из ${products.length}</p>
      <button type="button" class="btn btn-outline catalog-load-more-btn" id="catalog-load-more-btn">
        Показать ещё ${nextCount}
      </button>`;
    loadMoreWrap.querySelector('#catalog-load-more-btn')?.addEventListener('click', () => {
      visibleProductCount += getCatalogPageSize();
      renderProducts({ resetPagination: false });
    });
  } else if (products.length > getCatalogPageSize()) {
    loadMoreWrap.hidden = false;
    loadMoreWrap.innerHTML = `<p class="catalog-load-more-meta">Показаны все товары (${products.length})</p>`;
  } else {
    loadMoreWrap.hidden = true;
    loadMoreWrap.innerHTML = '';
  }
}

async function loadProducts() {
  const container = document.getElementById('products');

  try {
    allProducts = await api('/api/products');
    setMiniCartProductsCache(allProducts);
    renderProducts();
  } catch (err) {
    container.innerHTML = `<p class="alert alert-error">${err.message}</p>`;
  }
}

function setupSearch() {
  const input = initSearchClear(document.getElementById('search-input'));
  if (!input) return;

  input.addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      searchQuery = input.value.trim();
      renderProducts();
    }, 300);
  });
}

(async () => {
  try {
    currentUser = await api('/api/auth/me');
  } catch {
    currentUser = null;
  }

  if (currentUser && !currentUser.is_admin) {
    await Favorites.load();
  }

  await Promise.all([loadHomeContent(), loadCategories(), loadFeaturedOrder()]);
  setupCatalogDropdownDismiss();
  setupCatalogCategoryDropdown();
  setupCatalogFilterDropdown();
  await loadProducts();
  showStoredCheckoutNotice();
  setupSearch();
})();

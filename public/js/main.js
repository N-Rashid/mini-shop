let allProducts = [];

let activeCategory = '';
let activeTag = '';
let productSort = 'default';
let catalogCategories = [];

let searchQuery = '';

let searchTimer = null;

let currentUser = null;

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

function renderDesktopCategoryChips(categories) {
  return `
    <button class="category-chip${activeCategory === '' && activeTag === '' ? ' active' : ''}" data-filter="">Все</button>
    <button class="category-chip category-chip-highlight${activeCategory === 'new' && activeTag === 'new' ? ' active' : ''}" data-filter="new">Новинки</button>
    <button class="category-chip category-chip-highlight${activeCategory === 'sale' && activeTag === 'sale' ? ' active' : ''}" data-filter="sale">Акции</button>
    ${categories.map(c => `
      <button class="category-chip${activeCategory === `cat-${c.id}` ? ' active' : ''}" data-filter="cat-${c.id}">${escapeHtml(c.name)}</button>
    `).join('')}
  `;
}

function renderQuickCategoryChips() {
  return `
    <button class="category-chip category-chip-highlight${activeCategory === 'new' && activeTag === 'new' ? ' active' : ''}" data-filter="new">Новинки</button>
    <button class="category-chip category-chip-highlight${activeCategory === 'sale' && activeTag === 'sale' ? ' active' : ''}" data-filter="sale">Акции</button>
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
      isActive = activeCategory === filter && activeTag === '';
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

function setCatalogDropdownOpen(dropdownId, open) {
  CATALOG_DROPDOWNS.forEach(([id, toggleId, menuId]) => {
    const dropdown = document.getElementById(id);
    const toggle = document.getElementById(toggleId);
    const menu = document.getElementById(menuId);
    if (!dropdown || !toggle || !menu) return;

    const isOpen = id === dropdownId && open;
    dropdown.classList.toggle('open', isOpen);
    toggle.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
    menu.hidden = !isOpen;
  });
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
      if (activeTag === 'new') activeCategory = 'new';
      else if (activeTag === 'sale') activeCategory = 'sale';
      else if (activeTag === 'hit') {
        if (activeCategory === 'new' || activeCategory === 'sale') activeCategory = '';
      } else {
        if (activeCategory === 'new' || activeCategory === 'sale') activeCategory = '';
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

  document.addEventListener('click', (e) => {
    CATALOG_DROPDOWNS.forEach(([id]) => {
      const dropdown = document.getElementById(id);
      if (dropdown && !dropdown.contains(e.target)) {
        setCatalogDropdownOpen(id, false);
      }
    });
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      CATALOG_DROPDOWNS.forEach(([id]) => setCatalogDropdownOpen(id, false));
    }
  });

  updateCatalogFilterLabel();
}

function productCreatedTime(product) {
  if (!product.created_at) return 0;
  const raw = product.created_at.includes('T')
    ? product.created_at
    : `${product.created_at.replace(' ', 'T')}Z`;
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? 0 : date.getTime();
}

function productCatalogSortOrder(product) {
  if (activeCategory.startsWith('cat-')) {
    const catId = activeCategory.replace('cat-', '');
    const orders = product.category_sort_orders || {};
    if (orders[catId] != null) return orders[catId];
  }
  return product.sort_order || 0;
}

function sortProducts(list) {
  const sorted = [...list];

  sorted.sort((a, b) => {
    const aOut = a.in_stock === false ? 1 : 0;
    const bOut = b.in_stock === false ? 1 : 0;
    if (aOut !== bOut) return aOut - bOut;

    const aHit = a.is_bestseller ? 0 : 1;
    const bHit = b.is_bestseller ? 0 : 1;
    if (aHit !== bHit) return aHit - bHit;

    if (productSort === 'date_desc') {
      return productCreatedTime(b) - productCreatedTime(a) || a.id - b.id;
    }
    if (productSort === 'date_asc') {
      return productCreatedTime(a) - productCreatedTime(b) || a.id - b.id;
    }

    return productCatalogSortOrder(a) - productCatalogSortOrder(b) || a.id - b.id;
  });

  return sorted;
}

function getFilteredProducts() {
  let list = allProducts;

  if (activeCategory.startsWith('cat-')) {
    const catId = activeCategory.replace('cat-', '');
    list = list.filter(p => productHasCategory(p, catId));
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

function renderProducts() {
  const container = document.getElementById('products');
  const products = getFilteredProducts();

  if (!products.length) {
    container.innerHTML = `
      <div class="empty-state" style="grid-column:1/-1">
        <h2>${searchQuery || activeCategory || activeTag ? 'Ничего не найдено' : 'Товаров пока нет'}</h2>
        <p>${searchQuery ? 'Попробуйте другой запрос' : 'Скоро появится вкусное мороженое!'}</p>
      </div>`;
    return;
  }

  container.innerHTML = products.map(p => renderCatalogProductCard(p, currentUser)).join('');

  bindCatalogProductCards(container, {
    allProducts,
    currentUser,
    onEdit: (productId) => openProductEditModal(productId, allProducts, async () => {
      await loadProducts();
    }),
  });
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

  loadHomeContent();
  loadCategories();
  setupCatalogCategoryDropdown();
  setupCatalogFilterDropdown();
  loadProducts();
  showStoredCheckoutNotice();
  setupSearch();
})();

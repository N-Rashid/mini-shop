let allProducts = [];

let activeCategory = '';
let activeTag = '';
let productSort = 'default';

let searchQuery = '';

let searchTimer = null;

let currentUser = null;



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

async function loadCategories() {

  const container = document.getElementById('category-filters');

  if (!container) return;



  try {

    const categories = await api('/api/categories');

    container.innerHTML = `
      <button class="category-chip${activeCategory === '' && activeTag === '' ? ' active' : ''}" data-filter="">Все</button>
      <button class="category-chip category-chip-highlight${activeCategory === 'new' && activeTag === 'new' ? ' active' : ''}" data-filter="new">Новинки</button>
      <button class="category-chip category-chip-highlight${activeCategory === 'sale' && activeTag === 'sale' ? ' active' : ''}" data-filter="sale">Акции</button>
      ${categories.map(c => `
        <button class="category-chip${activeCategory === `cat-${c.id}` ? ' active' : ''}" data-filter="cat-${c.id}">${escapeHtml(c.name)}</button>
      `).join('')}
    `;



    container.querySelectorAll('.category-chip').forEach(chip => {

      chip.addEventListener('click', () => {

        const filter = chip.dataset.filter;
        activeCategory = filter;
        if (filter === 'new') activeTag = 'new';
        else if (filter === 'sale') activeTag = 'sale';
        else activeTag = '';

        syncCategoryChips();
        syncCatalogFilterMenu();
        renderProducts();

      });

    });

  } catch {

    container.innerHTML = '';

  }

}



function syncCategoryChips() {
  const container = document.getElementById('category-filters');
  if (!container) return;

  container.querySelectorAll('.category-chip').forEach(chip => {
    const filter = chip.dataset.filter;
    let isActive = false;
    if (filter === '') {
      isActive = activeCategory === '' && activeTag === '';
    } else if (filter === 'new' || filter === 'sale') {
      isActive = activeCategory === filter && activeTag === filter;
    } else {
      isActive = activeCategory === filter && activeTag === '';
    }
    chip.classList.toggle('active', isActive);
  });
}

function syncCatalogFilterMenu() {
  const menu = document.getElementById('catalog-filter-menu');
  if (!menu) return;

  menu.querySelectorAll('[data-tag]').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tag === activeTag);
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
  const tag = tagLabels[activeTag] || tagLabels[''];
  const sort = sortLabels[productSort] || sortLabels.default;
  if (!activeTag && productSort === 'default') return 'Фильтр';
  if (!activeTag) return `Сортировка: ${sort}`;
  if (productSort === 'default') return tag;
  return `${tag} · ${sort}`;
}

function updateCatalogFilterLabel() {
  const label = document.getElementById('catalog-filter-label');
  if (label) label.textContent = getCatalogFilterLabel();
}

function setCatalogFilterMenuOpen(open) {
  const dropdown = document.getElementById('catalog-filter-dropdown');
  const toggle = document.getElementById('catalog-filter-toggle');
  const menu = document.getElementById('catalog-filter-menu');
  if (!dropdown || !toggle || !menu) return;

  dropdown.classList.toggle('open', open);
  toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
  menu.hidden = !open;
}

function setupCatalogFilterDropdown() {
  const dropdown = document.getElementById('catalog-filter-dropdown');
  const toggle = document.getElementById('catalog-filter-toggle');
  const menu = document.getElementById('catalog-filter-menu');
  if (!dropdown || !toggle || !menu) return;

  toggle.addEventListener('click', (e) => {
    e.stopPropagation();
    setCatalogFilterMenuOpen(!dropdown.classList.contains('open'));
  });

  menu.querySelectorAll('[data-tag]').forEach(btn => {
    btn.addEventListener('click', () => {
      activeTag = btn.dataset.tag;
      if (activeTag === 'new') activeCategory = 'new';
      else if (activeTag === 'sale') activeCategory = 'sale';
      else activeCategory = '';

      menu.querySelectorAll('[data-tag]').forEach(b => b.classList.toggle('active', b === btn));
      syncCategoryChips();
      updateCatalogFilterLabel();
      renderProducts();
      setCatalogFilterMenuOpen(false);
    });
  });

  menu.querySelectorAll('[data-sort]').forEach(btn => {
    btn.addEventListener('click', () => {
      productSort = btn.dataset.sort;
      menu.querySelectorAll('[data-sort]').forEach(b => b.classList.toggle('active', b === btn));
      updateCatalogFilterLabel();
      renderProducts();
      setCatalogFilterMenuOpen(false);
    });
  });

  document.addEventListener('click', (e) => {
    if (!dropdown.contains(e.target)) setCatalogFilterMenuOpen(false);
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') setCatalogFilterMenuOpen(false);
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
  setupCatalogFilterDropdown();
  loadProducts();
  showStoredCheckoutNotice();

  setupSearch();

})();



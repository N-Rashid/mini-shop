let allProducts = [];

let activeCategory = '';
let activeTag = '';
let productSort = 'default';

let searchQuery = '';

let searchTimer = null;

let currentUser = null;



async function loadCategories() {

  const container = document.getElementById('category-filters');

  if (!container) return;



  try {

    const categories = await api('/api/categories');

    container.innerHTML = `
      <button class="category-chip active" data-filter="">Все</button>
      ${categories.map(c => `
        <button class="category-chip" data-filter="cat-${c.id}">${escapeHtml(c.name)}</button>
      `).join('')}
    `;



    container.querySelectorAll('.category-chip').forEach(chip => {

      chip.addEventListener('click', () => {

        container.querySelectorAll('.category-chip').forEach(c => c.classList.remove('active'));

        chip.classList.add('active');

        activeCategory = chip.dataset.filter;

        renderProducts();

      });

    });

  } catch {

    container.innerHTML = '';

  }

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
      menu.querySelectorAll('[data-tag]').forEach(b => b.classList.toggle('active', b === btn));
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

function sortProducts(list) {
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

    return (a.sort_order || 0) - (b.sort_order || 0) || a.id - b.id;
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



function renderHitSticker(p) {
  return p.is_bestseller ? '<span class="product-hit-sticker">Хит продаж</span>' : '';
}

function renderSaleSticker(p) {
  return p.is_on_sale ? '<span class="product-sale-sticker">Акция</span>' : '';
}

function renderOutOfStockSticker(p) {
  return p.in_stock === false ? '<span class="product-oos-sticker">Нет в наличии</span>' : '';
}

function renderProductCard(p) {

  const outOfStock = p.in_stock === false;
  const imgUrl = p.images?.[0]?.url;
  const imageUrls = (p.images || []).map(img => img.url);
  const hitSticker = renderHitSticker(p);
  const saleSticker = renderSaleSticker(p);
  const oosSticker = renderOutOfStockSticker(p);

  const img = imgUrl

    ? `<div class="product-image-wrap" data-lightbox="${imgUrl}" data-lightbox-set='${JSON.stringify(imageUrls)}' data-alt="${escapeHtml(p.name)}" role="button" tabindex="0" aria-label="Фото ${escapeHtml(p.name)}">
         <img class="product-image" src="${imgUrl}" alt="${escapeHtml(p.name)}" loading="lazy" decoding="async">
         ${imageUrls.length > 1 ? `<span class="product-photo-count">${imageUrls.length} фото</span>` : ''}
         ${hitSticker}
         ${saleSticker}
         ${oosSticker}
       </div>`

    : `<div class="product-image-placeholder">${hitSticker}${saleSticker}${oosSticker}🍦</div>`;



  const pieceOption = p.allow_piece_sale

    ? `<button type="button" class="unit-btn" data-unit="piece">Штучно</button>`

    : `<button type="button" class="unit-btn" disabled title="Только упаковками">Штучно</button>`;



  const adminBtns = currentUser?.is_admin ? `

    <button type="button" class="btn btn-outline btn-sm" data-edit="${p.id}">Изменить</button>

  ` : '';



  return `

    <article class="product-card${outOfStock ? ' product-card-out-of-stock' : ''}" data-id="${p.id}">

      ${img}

      <div class="product-body">

        ${productCategoryNames(p).length ? `
          <div class="product-categories">
            ${productCategoryNames(p).map(name => `<span class="product-category-tag">${escapeHtml(name)}</span>`).join('')}
          </div>` : ''}

        <div class="product-badges">

          ${p.is_new ? '<span class="badge badge-new">Новинка</span>' : ''}

          ${p.is_on_sale ? '<span class="badge badge-sale">Акция</span>' : ''}

          ${outOfStock ? '<span class="badge badge-oos">Нет в наличии</span>' : ''}

        </div>

        <h2 class="product-name">${escapeHtml(p.name)}</h2>

        <div class="product-meta">${formatProductMeta(p)}</div>

        ${renderProductPrices(p)}

        <p class="product-desc">${escapeHtml(p.description || '')}</p>
        ${p.description ? '<button type="button" class="desc-toggle" data-desc-toggle hidden>Показать полностью</button>' : ''}

        <div class="product-footer">

          <div class="unit-select">

            <button type="button" class="unit-btn active" data-unit="pack">Упаковка</button>

            ${pieceOption}

          </div>

          <div class="qty-row">
            <span class="qty-row-label">Кол-во:</span>
            ${renderQtyStepper(1)}
          </div>

          <div class="product-actions">

            <button class="btn btn-primary btn-sm" data-add="${p.id}" ${outOfStock ? 'disabled' : ''}>
              ${outOfStock ? 'Нет в наличии' : 'В корзину'}
            </button>

            ${adminBtns}

          </div>

        </div>

      </div>

    </article>`;

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



  container.innerHTML = products.map(renderProductCard).join('');

  container.querySelectorAll('.product-card').forEach(card => {
    const desc = card.querySelector('.product-desc');
    const toggle = card.querySelector('[data-desc-toggle]');
    if (desc && toggle) {
      requestAnimationFrame(() => {
        if (desc.scrollHeight > desc.clientHeight + 2) {
          toggle.hidden = false;
          toggle.addEventListener('click', () => {
            const expanded = desc.classList.toggle('expanded');
            toggle.textContent = expanded ? 'Свернуть' : 'Показать полностью';
          });
        }
      });
    }
  });

  container.querySelectorAll('[data-lightbox]').forEach(wrap => {
    const openFromWrap = () => {
      let urls = [wrap.dataset.lightbox];
      try {
        const parsed = JSON.parse(wrap.dataset.lightboxSet || '[]');
        if (parsed.length) urls = parsed;
      } catch {
        /* keep single url */
      }
      openLightbox(urls, wrap.dataset.alt || '');
    };

    wrap.addEventListener('click', openFromWrap);
    wrap.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        openFromWrap();
      }
    });
  });



  container.querySelectorAll('.product-card').forEach(card => {

    card.querySelector('[data-edit]')?.addEventListener('click', () => {

      openProductEditModal(parseInt(card.dataset.id), allProducts, async () => {

        await loadProducts();

      });

    });

    const addBtn = card.querySelector('[data-add]');
    if (addBtn?.disabled) return;

    const unitBtns = card.querySelectorAll('.unit-btn:not([disabled])');

    let selectedUnit = 'pack';



    unitBtns.forEach(btn => {

      btn.addEventListener('click', () => {

        unitBtns.forEach(b => b.classList.remove('active'));

        btn.classList.add('active');

        selectedUnit = btn.dataset.unit;

      });

    });



    card.querySelector('[data-add]').addEventListener('click', (e) => {

      const btn = e.target;

      const qty = getQtyStepperValue(card.querySelector('.qty-stepper'));

      Cart.add(parseInt(btn.dataset.add), qty, selectedUnit);

      btn.textContent = '✓ Добавлено';
      updateMiniCartBar();

      setTimeout(() => { btn.textContent = 'В корзину'; }, 1200);

    });



    card.querySelectorAll('.qty-step').forEach(stepBtn => {

      stepBtn.addEventListener('click', () => {

        changeQtyStepper(card.querySelector('.qty-stepper'), parseInt(stepBtn.dataset.step));

      });

    });



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

  loadCategories();
  setupCatalogFilterDropdown();
  loadProducts();
  showStoredCheckoutNotice();

  setupSearch();

})();



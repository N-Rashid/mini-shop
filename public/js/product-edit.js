let editCategories = [];

async function loadEditCategories() {
  try {
    const user = await api('/api/auth/me');
    if (user?.is_admin) {
      editCategories = await api('/api/admin/categories');
    } else {
      editCategories = await api('/api/categories');
    }
  } catch {
    editCategories = [];
  }
  return editCategories;
}

async function openProductEditModal(productId, products, onSaved) {
  await loadEditCategories();
  let p = products.find(x => x.id === productId);
  if (!p) return;

  try {
    p = await api(`/api/products/${productId}`);
  } catch {
    // use cached product from list
  }

  const modalHost = document.getElementById('edit-modal') || document.body;
  const activeCats = editCategories;

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.id = 'edit-overlay';
  overlay.innerHTML = `
    <div class="modal" role="dialog">
      <h2>Редактировать: ${escapeHtml(p.name)}</h2>
      <form id="edit-product-form">
        <div class="form-group">
          <label>Название *</label>
          <input name="name" value="${escapeHtml(p.name)}" required>
        </div>
        <div class="form-group">
          <label>Категории</label>
          <p class="form-hint">Можно выбрать несколько</p>
          ${renderCategoryPicker(activeCats, productCategoryIds(p))}
        </div>
        <div class="form-row">
          <div class="form-group">
            <label>Цена за штуку (₽)</label>
            <input name="price_piece" type="number" step="0.01" min="0" value="${p.price_piece || 0}">
          </div>
          <div class="form-group">
            <label>Цена за упаковку (₽) *</label>
            <input name="price_pack" type="number" step="0.01" min="0" value="${p.price_pack}" required>
          </div>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label>Штук в упаковке</label>
            <input name="pieces_per_pack" type="number" min="1" value="${p.pieces_per_pack}">
          </div>
          <div class="form-group">
            <label>Вес штуки (г)</label>
            <input name="weight_grams" type="number" step="1" min="0" value="${p.grams_per_piece || p.weight_grams || 0}">
          </div>
        </div>
        <div class="form-check">
          <input type="checkbox" name="allow_piece_sale" id="edit-allow-piece" ${p.allow_piece_sale ? 'checked' : ''}>
          <label for="edit-allow-piece">Можно покупать штучно</label>
        </div>
        <div class="form-check">
          <input type="checkbox" name="is_on_sale" id="edit-is-sale" ${p.is_on_sale ? 'checked' : ''}>
          <label for="edit-is-sale">Акция</label>
        </div>
        <div class="form-check">
          <input type="checkbox" name="is_bestseller" id="edit-is-bestseller" ${p.is_bestseller ? 'checked' : ''}>
          <label for="edit-is-bestseller">Хит продаж</label>
        </div>
        <div class="form-check">
          <input type="checkbox" name="out_of_stock" id="edit-out-of-stock" ${p.in_stock === false ? 'checked' : ''}>
          <label for="edit-out-of-stock">Нет в наличии</label>
        </div>
        <div id="edit-sale-fields" class="form-row" style="display:${p.is_on_sale ? 'grid' : 'none'}">
          <div class="form-group">
            <label>Акционная цена за штуку (₽)</label>
            <input name="sale_price_piece" type="number" step="0.01" min="0" value="${p.sale_price_piece || ''}">
          </div>
          <div class="form-group">
            <label>Акционная цена за упаковку (₽)</label>
            <input name="sale_price_pack" type="number" step="0.01" min="0" value="${p.sale_price_pack || ''}">
          </div>
        </div>
        <div class="form-group">
          <label>Описание</label>
          <textarea name="description">${escapeHtml(p.description || '')}</textarea>
        </div>
        <div class="form-group">
          <label>Фото${p.images?.length ? ` (${p.images.length})` : ''}</label>
          ${p.images?.length ? `
            <div class="image-preview-list">
              ${p.images.map(img => `
                <div class="image-preview-item">
                  <img class="image-preview" src="${img.url}" alt="" data-lightbox="${img.url}">
                  <button type="button" class="image-preview-delete" data-del-image="${img.id}" aria-label="Удалить фото">×</button>
                </div>
              `).join('')}
            </div>
          ` : '<p class="form-hint" style="margin:0 0 8px">Фото пока нет</p>'}
        </div>
        <div class="form-group">
          <label>Добавить фото (можно несколько)</label>
          <input name="new_images" type="file" accept="image/*" multiple>
        </div>
        <div class="modal-actions">
          <button type="submit" class="btn btn-primary">Сохранить</button>
          <button type="button" class="btn btn-outline" id="cancel-edit">Отмена</button>
        </div>
      </form>
    </div>`;

  if (modalHost.id === 'edit-modal') {
    modalHost.style.display = 'block';
    modalHost.innerHTML = '';
    modalHost.appendChild(overlay);
  } else {
    document.body.appendChild(overlay);
  }

  lockPageScroll();
  bindOverlayScrollGuard(overlay);

  const close = () => {
    overlay.remove();
    unlockPageScroll();
    if (modalHost.id === 'edit-modal') {
      modalHost.style.display = 'none';
      modalHost.innerHTML = '';
    }
  };

  document.getElementById('cancel-edit').addEventListener('click', close);

  let backdropMouseDown = false;
  overlay.addEventListener('mousedown', (e) => {
    backdropMouseDown = e.target === overlay;
  });
  overlay.addEventListener('mouseup', (e) => {
    if (backdropMouseDown && e.target === overlay) close();
    backdropMouseDown = false;
  });

  overlay.querySelector('.modal')?.addEventListener('mousedown', (e) => {
    e.stopPropagation();
  });

  overlay.querySelectorAll('[data-lightbox]').forEach(img => {
    img.addEventListener('click', () => openLightbox(img.dataset.lightbox));
  });

  overlay.querySelectorAll('[data-del-image]').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!confirm('Удалить это фото?')) return;
      try {
        await api(`/api/admin/images/${btn.dataset.delImage}`, { method: 'DELETE' });
        const refreshed = await api(`/api/admin/products?filter=all`);
        const updated = refreshed.find(x => x.id === productId);
        close();
        if (updated) openProductEditModal(productId, refreshed, onSaved);
        else if (onSaved) onSaved();
      } catch (err) {
        alert(err.message);
      }
    });
  });

  document.getElementById('edit-is-sale').addEventListener('change', (e) => {
    document.getElementById('edit-sale-fields').style.display = e.target.checked ? 'grid' : 'none';
  });

  document.getElementById('edit-product-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.target;
    const submitBtn = form.querySelector('button[type="submit"]');
    const btnText = submitBtn?.textContent;
    const fd = new FormData(form);
    const categoryIds = getSelectedCategoryIds(form);

    try {
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = 'Сохранение...';
      }
      await api(`/api/admin/products/${productId}`, {
        method: 'PUT',
        body: JSON.stringify({
          name: fd.get('name'),
          category_ids: categoryIds,
          price_pack: parseFloat(fd.get('price_pack')),
          price_piece: parseFloat(fd.get('price_piece') || 0),
          pieces_per_pack: parseInt(fd.get('pieces_per_pack') || 1),
          weight_grams: parseFloat(fd.get('weight_grams') || 0),
          description: fd.get('description') || '',
          allow_piece_sale: form.allow_piece_sale.checked,
          is_on_sale: form.is_on_sale.checked,
          is_bestseller: form.is_bestseller.checked,
          in_stock: !form.out_of_stock.checked,
          sale_price_pack: form.is_on_sale.checked ? parseFloat(fd.get('sale_price_pack') || 0) : null,
          sale_price_piece: form.is_on_sale.checked ? parseFloat(fd.get('sale_price_piece') || 0) : null,
        }),
      });

      const newImages = form.querySelector('[name="new_images"]').files;
      if (newImages.length) {
        if (submitBtn) submitBtn.textContent = 'Загрузка фото...';
        const imgData = new FormData();
        for (const f of newImages) imgData.append('images', f);
        const res = await fetch(`/api/admin/products/${productId}/images`, {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'ngrok-skip-browser-warning': 'true' },
          body: imgData,
        });
        const { data } = await readJsonResponse(res);
        if (!res.ok) throw new Error(data?.error || 'Ошибка загрузки фото');
      }

      close();
      if (onSaved) onSaved();
    } catch (err) {
      alert(err.message);
    } finally {
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = btnText || 'Сохранить';
      }
    }
  });
}

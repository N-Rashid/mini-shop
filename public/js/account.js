async function loadAccount() {
  const infoEl = document.getElementById('account-info');

  let user;
  try {
    user = await api('/api/auth/me');
  } catch {
    location.href = '/login.html';
    return;
  }

  if (!user || user.is_admin) {
    location.href = '/login.html';
    return;
  }

  infoEl.innerHTML = `
    <h2>${escapeHtml(user.name)}</h2>
    <p>Логин: ${escapeHtml(user.login)}</p>
    ${user.address ? `<p>Адрес доставки: ${escapeHtml(user.address)}</p>` : ''}
  `;

  setupAccountTabs();
  bindOrderActions();
  await renderAllOrders();
}

function setupAccountTabs() {
  const tabs = document.querySelectorAll('.account-tab');
  const panels = {
    orders: document.getElementById('tab-orders'),
    history: document.getElementById('tab-history'),
  };

  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      const name = tab.dataset.tab;
      tabs.forEach(t => t.classList.toggle('active', t === tab));
      Object.entries(panels).forEach(([key, panel]) => {
        if (!panel) return;
        const active = key === name;
        panel.classList.toggle('active', active);
        panel.hidden = !active;
      });
    });
  });
}

function isCurrentOrder(o) {
  return o.status === 'pending' && !o.deleted;
}

function orderHasRepeatableItems(order) {
  return (order.items || []).some(i => i.product_id && !i.product_unavailable);
}

function canRepeatOrder(o) {
  return (o.status === 'accepted' || o.status === 'completed')
    && !o.deleted
    && orderHasRepeatableItems(o);
}

function renderOrderItems(o, editing) {
  return (o.items || []).map(i => {
    if (editing && o.can_edit) {
      return `
        <li class="order-item-edit" data-order-id="${o.id}" data-item-id="${i.id}">
          <span class="order-item-name">${escapeHtml(i.product_name)}</span>
          <div class="order-item-controls">
            <span class="order-item-unit">${unitLabel(i.unit_type || 'pack')}</span>
            ${renderQtyStepper(i.quantity)}
            <span class="order-item-price">× ${formatPrice(i.price)}</span>
            <button type="button" class="btn btn-danger btn-sm order-item-remove"
              data-remove-item="${i.id}" data-order-id="${o.id}">✕</button>
          </div>
        </li>`;
    }
    return `
      <li>${escapeHtml(i.product_name)} — ${i.quantity} ${unitLabel(i.unit_type || 'pack')} × ${formatPrice(i.price)}</li>`;
  }).join('');
}

function renderOrderCard(o, editing, mode) {
  const statusBadges = [];
  if (o.deleted) {
    statusBadges.push('<span class="badge badge-deleted">Отменён</span>');
  } else {
    statusBadges.push(`<span class="badge ${orderStatusClass(o.status)}">${escapeHtml(o.status_label || orderStatusLabel(o.status))}</span>`);
  }
  if (o.is_archived) statusBadges.push('<span class="badge badge-archived">Архив</span>');

  return `
    <div class="order-card${o.deleted ? ' order-deleted' : ''}" data-order-id="${o.id}">
      <div class="order-header">
        <div>
          <strong>Заказ #${o.number ?? o.client_number ?? o.id}</strong>
          <p class="order-date">Оформлен: ${formatDate(o.created_at)}</p>
        </div>
        <div class="order-badges">${statusBadges.join(' ')}</div>
      </div>
      <p class="order-meta">Сумма: <span data-order-total="${o.id}">${formatPrice(o.total)}</span></p>
      <ul class="order-items${editing && o.can_edit ? ' order-items-edit' : ''}" data-order-items="${o.id}">
        ${renderOrderItems(o, editing)}
      </ul>
      <div class="order-actions">
        ${mode === 'history' && canRepeatOrder(o) ? `
          <button type="button" class="btn btn-primary btn-sm" data-repeat-order="${o.id}">Повторить заказ</button>
        ` : ''}
        ${mode === 'current' && o.can_edit ? `
          ${editing ? `
            <button type="button" class="btn btn-outline btn-sm" data-done-edit="${o.id}">Готово</button>
          ` : `
            <button type="button" class="btn btn-outline btn-sm" data-start-edit="${o.id}">Редактировать</button>
          `}
          <a href="/" class="btn btn-outline btn-sm">Добавить товары</a>
          <button type="button" class="btn btn-danger btn-sm" data-cancel-order="${o.id}">Отменить заказ</button>
        ` : ''}
      </div>
      ${mode === 'current' && o.can_edit && !editing ? `
        <p class="order-hint">Можно изменить состав, пока заказ в ожидании</p>
      ` : ''}
    </div>`;
}

const editingOrders = new Set();
let orderEventsBound = false;
let ordersCache = [];

function renderOrderList(container, orders, mode) {
  if (!orders.length) {
    container.innerHTML = mode === 'current'
      ? '<p class="orders-empty">Нет заказов в ожидании. <a href="/">Перейти в каталог</a></p>'
      : '<p class="orders-empty">История заказов пуста</p>';
    return;
  }
  container.innerHTML = orders.map(o => renderOrderCard(o, editingOrders.has(o.id), mode)).join('');
}

async function renderAllOrders() {
  const ordersEl = document.getElementById('orders-list');
  const historyEl = document.getElementById('history-list');

  try {
    ordersCache = await api('/api/orders');
    const current = ordersCache.filter(isCurrentOrder);
    const history = ordersCache.filter(o => !isCurrentOrder(o));

    renderOrderList(ordersEl, current, 'current');
    renderOrderList(historyEl, history, 'history');
  } catch (err) {
    ordersEl.innerHTML = `<p class="alert alert-error">${escapeHtml(err.message)}</p>`;
    historyEl.innerHTML = '';
  }
}

async function saveOrderItemQty(orderId, itemId, quantity) {
  const res = await api(`/api/orders/${orderId}/items/${itemId}`, {
    method: 'PUT',
    body: JSON.stringify({ quantity }),
  });
  document.querySelectorAll(`[data-order-total="${orderId}"]`).forEach(el => {
    el.textContent = formatPrice(res.total);
  });
}

function bindOrderActions() {
  if (orderEventsBound) return;
  orderEventsBound = true;

  const area = document.getElementById('account-orders-area');
  if (!area) return;

  area.addEventListener('click', async (e) => {
    const repeatBtn = e.target.closest('[data-repeat-order]');
    if (repeatBtn) {
      const orderId = parseInt(repeatBtn.dataset.repeatOrder, 10);
      const order = ordersCache.find(o => o.id === orderId);
      if (!order) return;

      const added = addOrderItemsToCart(order.items);
      const alertArea = document.getElementById('alert-area');
      if (!added) {
        showAlert(alertArea, 'Товары из этого заказа больше недоступны', 'error');
        return;
      }

      showAlert(alertArea, 'Товары добавлены в корзину', 'success');
      if (confirm('Перейти в корзину?')) {
        location.href = '/cart.html';
      }
      return;
    }

    const startEditBtn = e.target.closest('[data-start-edit]');
    if (startEditBtn) {
      editingOrders.add(parseInt(startEditBtn.dataset.startEdit, 10));
      await renderAllOrders();
      return;
    }

    const doneEditBtn = e.target.closest('[data-done-edit]');
    if (doneEditBtn) {
      editingOrders.delete(parseInt(doneEditBtn.dataset.doneEdit, 10));
      await renderAllOrders();
      return;
    }

    const cancelOrderBtn = e.target.closest('[data-cancel-order]');
    if (cancelOrderBtn) {
      if (!confirm('Отменить заказ?')) return;
      const orderId = parseInt(cancelOrderBtn.dataset.cancelOrder, 10);
      try {
        await api(`/api/orders/${orderId}`, { method: 'DELETE' });
        editingOrders.delete(orderId);
        await renderAllOrders();
      } catch (err) {
        alert(err.message);
      }
      return;
    }

    const stepBtn = e.target.closest('.order-item-edit .qty-step');
    if (stepBtn) {
      const row = stepBtn.closest('.order-item-edit');
      const orderId = parseInt(row.dataset.orderId, 10);
      const itemId = parseInt(row.dataset.itemId, 10);
      const stepper = row.querySelector('.qty-stepper');
      const delta = parseInt(stepBtn.dataset.step, 10);
      const current = getQtyStepperValue(stepper);
      const next = current + delta;

      if (next < 1) {
        if (confirm('Убрать эту позицию из заказа?')) {
          try {
            const res = await api(`/api/orders/${orderId}/items/${itemId}`, { method: 'DELETE' });
            if (res.order_cancelled) editingOrders.delete(orderId);
            await renderAllOrders();
          } catch (err) {
            alert(err.message);
          }
        }
        return;
      }

      setQtyStepperValue(stepper, next);
      stepBtn.disabled = true;
      try {
        await saveOrderItemQty(orderId, itemId, next);
      } catch (err) {
        setQtyStepperValue(stepper, current);
        alert(err.message);
      } finally {
        stepBtn.disabled = false;
      }
      return;
    }

    const removeBtn = e.target.closest('[data-remove-item]');
    if (removeBtn) {
      if (!confirm('Убрать эту позицию из заказа?')) return;
      const orderId = parseInt(removeBtn.dataset.orderId, 10);
      const itemId = parseInt(removeBtn.dataset.removeItem, 10);
      try {
        const res = await api(`/api/orders/${orderId}/items/${itemId}`, { method: 'DELETE' });
        if (res.order_cancelled) editingOrders.delete(orderId);
        await renderAllOrders();
      } catch (err) {
        alert(err.message);
      }
    }
  });
}

loadAccount();

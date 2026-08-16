let favoriteProducts = [];
let currentUser = null;

function renderFavorites() {
  const container = document.getElementById('products');
  if (!container) return;

  if (!favoriteProducts.length) {
    container.innerHTML = `
      <div class="empty-state" style="grid-column:1/-1">
        <h2>В избранном пока пусто</h2>
        <p>Откройте каталог и нажмите ♥ на понравившемся товаре.</p>
        <p><a href="/" class="btn btn-primary">Перейти в каталог</a></p>
      </div>`;
    return;
  }

  container.innerHTML = favoriteProducts.map(p => renderCatalogProductCard(p, currentUser)).join('');
  bindCatalogProductCards(container, {
    allProducts: favoriteProducts,
    currentUser,
    onFavoriteChange: (productId, added) => {
      if (added) return;
      favoriteProducts = favoriteProducts.filter(p => p.id !== productId);
      renderFavorites();
    },
  });
}

(async () => {
  const container = document.getElementById('products');
  const alertArea = document.getElementById('alert-area');

  try {
    currentUser = await api('/api/auth/me');
  } catch {
    currentUser = null;
  }

  if (!currentUser || currentUser.is_admin) {
    location.href = `/login.html?next=${encodeURIComponent('/favorites.html')}`;
    return;
  }

  await Favorites.load();

  try {
    favoriteProducts = await api('/api/favorites');
    renderFavorites();
  } catch (err) {
    if (container) {
      container.innerHTML = `<p class="alert alert-error" style="grid-column:1/-1">${escapeHtml(err.message)}</p>`;
    } else if (alertArea) {
      showAlert(alertArea, err.message, 'error');
    }
  }
})();

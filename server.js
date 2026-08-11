const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { initDatabase } = require('./db/database');

const app = express();
const PORT = process.env.PORT || 3000;
const db = initDatabase();

const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

const storage = multer.diskStorage({
  destination: uploadsDir,
  filename: (_req, file, cb) => {
    const unique = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, unique + path.extname(file.originalname));
  },
});
const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (/^image\//.test(file.mimetype)) cb(null, true);
    else cb(new Error('Только изображения'));
  },
});

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(session({
  secret: 'mini-shop-secret-change-in-production',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 24 * 60 * 60 * 1000 },
}));

app.use('/uploads', express.static(uploadsDir));
app.use(express.static(path.join(__dirname, 'public')));

function now() {
  return new Date().toISOString();
}

function softDelete(table, id) {
  db.prepare(`UPDATE ${table} SET deleted_at = ? WHERE id = ? AND deleted_at IS NULL`).run(now(), id);
}

function requireAuth(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ error: 'Необходима авторизация' });
  next();
}

function requireAdmin(req, res, next) {
  if (!req.session.userId || !req.session.isAdmin) {
    return res.status(403).json({ error: 'Доступ запрещён' });
  }
  next();
}

function getProductImages(productId) {
  return db.prepare(`
    SELECT id, filename FROM product_images
    WHERE product_id = ? AND deleted_at IS NULL
  `).all(productId);
}

function mapProduct(row) {
  return {
    ...row,
    images: getProductImages(row.id).map(img => ({
      id: img.id,
      url: '/uploads/' + img.filename,
    })),
  };
}

// --- Auth ---

app.post('/api/auth/login', (req, res) => {
  const { login, password } = req.body;
  const user = db.prepare(`
    SELECT * FROM users WHERE login = ? AND deleted_at IS NULL AND is_admin = 0
  `).get(login);

  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: 'Неверный логин или пароль' });
  }

  req.session.userId = user.id;
  req.session.isAdmin = false;
  req.session.userName = user.name;

  res.json({
    id: user.id,
    name: user.name,
    login: user.login,
    wallet_balance: user.wallet_balance,
    address: user.address,
  });
});

app.post('/api/auth/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

app.get('/api/auth/me', (req, res) => {
  if (!req.session.userId) return res.json(null);

  const user = db.prepare(`
    SELECT id, name, login, wallet_balance, address, is_admin
    FROM users WHERE id = ? AND deleted_at IS NULL
  `).get(req.session.userId);

  if (!user) return res.json(null);
  res.json(user);
});

// --- Admin auth ---

app.post('/api/admin/login', (req, res) => {
  const { login, password } = req.body;
  const user = db.prepare(`
    SELECT * FROM users WHERE login = ? AND deleted_at IS NULL AND is_admin = 1
  `).get(login);

  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: 'Неверный логин или пароль' });
  }

  req.session.userId = user.id;
  req.session.isAdmin = true;
  req.session.userName = user.name;

  res.json({ id: user.id, name: user.name, login: user.login });
});

app.get('/api/admin/me', requireAdmin, (req, res) => {
  res.json({ id: req.session.userId, name: req.session.userName });
});

// --- Products (public) ---

app.get('/api/products', (_req, res) => {
  const products = db.prepare(`
    SELECT id, name, cost, pieces_per_box, weight, description
    FROM products WHERE deleted_at IS NULL ORDER BY id DESC
  `).all();
  res.json(products.map(mapProduct));
});

app.get('/api/products/:id', (req, res) => {
  const product = db.prepare(`
    SELECT id, name, cost, pieces_per_box, weight, description
    FROM products WHERE id = ? AND deleted_at IS NULL
  `).get(req.params.id);

  if (!product) return res.status(404).json({ error: 'Товар не найден' });
  res.json(mapProduct(product));
});

// --- Orders ---

app.post('/api/orders/checkout', requireAuth, (req, res) => {
  const { items } = req.body;
  if (!items || !items.length) {
    return res.status(400).json({ error: 'Корзина пуста' });
  }

  const user = db.prepare(`
    SELECT * FROM users WHERE id = ? AND deleted_at IS NULL AND is_admin = 0
  `).get(req.session.userId);

  if (!user) return res.status(401).json({ error: 'Пользователь не найден' });

  let total = 0;
  const orderItems = [];

  for (const item of items) {
    const product = db.prepare(`
      SELECT * FROM products WHERE id = ? AND deleted_at IS NULL
    `).get(item.productId);

    if (!product) return res.status(400).json({ error: `Товар #${item.productId} не найден` });
    if (item.quantity < 1) return res.status(400).json({ error: 'Некорректное количество' });

    const lineTotal = product.cost * item.quantity;
    total += lineTotal;
    orderItems.push({ product, quantity: item.quantity, price: product.cost });
  }

  if (user.wallet_balance < total) {
    return res.status(400).json({
      error: 'Недостаточно средств на кошельке',
      required: total,
      balance: user.wallet_balance,
    });
  }

  const createOrder = db.transaction(() => {
    db.prepare(`
      UPDATE users SET wallet_balance = wallet_balance - ? WHERE id = ?
    `).run(total, user.id);

    const order = db.prepare(`
      INSERT INTO orders (user_id, total, status) VALUES (?, ?, 'completed')
    `).run(user.id, total);

    const insertItem = db.prepare(`
      INSERT INTO order_items (order_id, product_id, quantity, price)
      VALUES (?, ?, ?, ?)
    `);

    for (const oi of orderItems) {
      insertItem.run(order.lastInsertRowid, oi.product.id, oi.quantity, oi.price);
    }

    return order.lastInsertRowid;
  });

  const orderId = createOrder();
  const newBalance = db.prepare('SELECT wallet_balance FROM users WHERE id = ?').get(user.id);

  res.json({ orderId, total, wallet_balance: newBalance.wallet_balance });
});

app.get('/api/orders', requireAuth, (req, res) => {
  const orders = db.prepare(`
    SELECT o.id, o.total, o.status, o.created_at
    FROM orders o
    WHERE o.user_id = ? AND o.deleted_at IS NULL
    ORDER BY o.created_at DESC
  `).all(req.session.userId);

  res.json(orders);
});

// --- Admin: products ---

app.get('/api/admin/products', requireAdmin, (_req, res) => {
  const products = db.prepare(`
    SELECT id, name, cost, pieces_per_box, weight, description, deleted_at
    FROM products ORDER BY id DESC
  `).all();

  res.json(products.map(p => ({
    ...mapProduct(p),
    deleted: !!p.deleted_at,
  })));
});

app.post('/api/admin/products', requireAdmin, upload.array('images', 10), (req, res) => {
  const { name, cost, pieces_per_box, weight, description } = req.body;

  if (!name || cost == null) {
    return res.status(400).json({ error: 'Название и стоимость обязательны' });
  }

  const result = db.prepare(`
    INSERT INTO products (name, cost, pieces_per_box, weight, description)
    VALUES (?, ?, ?, ?, ?)
  `).run(
    name,
    parseFloat(cost),
    parseInt(pieces_per_box) || 1,
    parseFloat(weight) || 0,
    description || ''
  );

  const productId = result.lastInsertRowid;
  const insertImage = db.prepare(`
    INSERT INTO product_images (product_id, filename) VALUES (?, ?)
  `);

  if (req.files) {
    for (const file of req.files) {
      insertImage.run(productId, file.filename);
    }
  }

  const product = db.prepare('SELECT * FROM products WHERE id = ?').get(productId);
  res.status(201).json(mapProduct(product));
});

app.put('/api/admin/products/:id', requireAdmin, (req, res) => {
  const { name, cost, pieces_per_box, weight, description } = req.body;
  const id = req.params.id;

  const existing = db.prepare('SELECT id FROM products WHERE id = ? AND deleted_at IS NULL').get(id);
  if (!existing) return res.status(404).json({ error: 'Товар не найден' });

  db.prepare(`
    UPDATE products SET name = ?, cost = ?, pieces_per_box = ?, weight = ?, description = ?
    WHERE id = ?
  `).run(name, parseFloat(cost), parseInt(pieces_per_box), parseFloat(weight), description || '', id);

  const product = db.prepare('SELECT * FROM products WHERE id = ?').get(id);
  res.json(mapProduct(product));
});

app.delete('/api/admin/products/:id', requireAdmin, (req, res) => {
  softDelete('products', req.params.id);
  db.prepare(`
    UPDATE product_images SET deleted_at = ? WHERE product_id = ? AND deleted_at IS NULL
  `).run(now(), req.params.id);
  res.json({ ok: true });
});

app.post('/api/admin/products/:id/restore', requireAdmin, (req, res) => {
  db.prepare('UPDATE products SET deleted_at = NULL WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

app.post('/api/admin/products/:id/images', requireAdmin, upload.array('images', 10), (req, res) => {
  const productId = req.params.id;
  const existing = db.prepare('SELECT id FROM products WHERE id = ? AND deleted_at IS NULL').get(productId);
  if (!existing) return res.status(404).json({ error: 'Товар не найден' });

  const insertImage = db.prepare(`
    INSERT INTO product_images (product_id, filename) VALUES (?, ?)
  `);

  const added = [];
  if (req.files) {
    for (const file of req.files) {
      const r = insertImage.run(productId, file.filename);
      added.push({ id: r.lastInsertRowid, url: '/uploads/' + file.filename });
    }
  }

  res.json(added);
});

app.delete('/api/admin/images/:id', requireAdmin, (req, res) => {
  softDelete('product_images', req.params.id);
  res.json({ ok: true });
});

// --- Admin: users ---

app.get('/api/admin/users', requireAdmin, (_req, res) => {
  const users = db.prepare(`
    SELECT id, name, address, login, wallet_balance, is_admin, deleted_at
    FROM users ORDER BY id DESC
  `).all();
  res.json(users.map(u => ({ ...u, deleted: !!u.deleted_at })));
});

app.post('/api/admin/users', requireAdmin, (req, res) => {
  const { name, address, login, password, wallet_balance, is_admin } = req.body;

  if (!name || !login || !password) {
    return res.status(400).json({ error: 'Имя, логин и пароль обязательны' });
  }

  const dup = db.prepare('SELECT id FROM users WHERE login = ? AND deleted_at IS NULL').get(login);
  if (dup) return res.status(400).json({ error: 'Логин уже занят' });

  const hash = bcrypt.hashSync(password, 10);
  const result = db.prepare(`
    INSERT INTO users (name, address, login, password_hash, wallet_balance, is_admin)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(name, address || '', login, hash, parseFloat(wallet_balance) || 0, is_admin ? 1 : 0);

  res.status(201).json({ id: result.lastInsertRowid });
});

app.put('/api/admin/users/:id/balance', requireAdmin, (req, res) => {
  const { amount } = req.body;
  db.prepare(`
    UPDATE users SET wallet_balance = wallet_balance + ? WHERE id = ? AND deleted_at IS NULL
  `).run(parseFloat(amount), req.params.id);
  res.json({ ok: true });
});

app.delete('/api/admin/users/:id', requireAdmin, (req, res) => {
  const user = db.prepare('SELECT is_admin FROM users WHERE id = ?').get(req.params.id);
  if (user && user.is_admin) {
    return res.status(400).json({ error: 'Нельзя удалить администратора' });
  }
  softDelete('users', req.params.id);
  res.json({ ok: true });
});

// --- Admin: orders ---

app.get('/api/admin/orders', requireAdmin, (_req, res) => {
  const orders = db.prepare(`
    SELECT o.id, o.total, o.status, o.created_at, o.deleted_at,
           u.name as user_name, u.login as user_login
    FROM orders o
    JOIN users u ON u.id = o.user_id
    ORDER BY o.created_at DESC
  `).all();

  const getItems = db.prepare(`
    SELECT oi.id, oi.quantity, oi.price, oi.deleted_at, p.name as product_name
    FROM order_items oi
    JOIN products p ON p.id = oi.product_id
    WHERE oi.order_id = ?
  `);

  res.json(orders.map(o => ({
    ...o,
    deleted: !!o.deleted_at,
    items: getItems.all(o.id),
  })));
});

app.delete('/api/admin/orders/:id', requireAdmin, (req, res) => {
  softDelete('orders', req.params.id);
  db.prepare(`
    UPDATE order_items SET deleted_at = ? WHERE order_id = ? AND deleted_at IS NULL
  `).run(now(), req.params.id);
  res.json({ ok: true });
});

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: err.message || 'Внутренняя ошибка сервера' });
});

app.listen(PORT, () => {
  console.log(`Магазин запущен: http://localhost:${PORT}`);
});

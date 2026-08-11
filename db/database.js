const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const path = require('path');
const fs = require('fs');

const DB_PATH = path.join(__dirname, 'shop.db');

function initDatabase() {
  const db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      address TEXT DEFAULT '',
      login TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      wallet_balance REAL DEFAULT 0,
      is_admin INTEGER DEFAULT 0,
      deleted_at TEXT NULL
    );

    CREATE TABLE IF NOT EXISTS products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      cost REAL NOT NULL,
      pieces_per_box INTEGER NOT NULL DEFAULT 1,
      weight REAL DEFAULT 0,
      description TEXT DEFAULT '',
      deleted_at TEXT NULL
    );

    CREATE TABLE IF NOT EXISTS product_images (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id INTEGER NOT NULL REFERENCES products(id),
      filename TEXT NOT NULL,
      deleted_at TEXT NULL
    );

    CREATE TABLE IF NOT EXISTS orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id),
      total REAL NOT NULL,
      status TEXT DEFAULT 'completed',
      created_at TEXT DEFAULT (datetime('now')),
      deleted_at TEXT NULL
    );

    CREATE TABLE IF NOT EXISTS order_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id INTEGER NOT NULL REFERENCES orders(id),
      product_id INTEGER NOT NULL REFERENCES products(id),
      quantity INTEGER NOT NULL,
      price REAL NOT NULL,
      deleted_at TEXT NULL
    );
  `);

  const adminExists = db.prepare(
    "SELECT id FROM users WHERE login = 'admin' AND deleted_at IS NULL"
  ).get();

  if (!adminExists) {
    const hash = bcrypt.hashSync('admin123', 10);
    db.prepare(`
      INSERT INTO users (name, address, login, password_hash, wallet_balance, is_admin)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run('Администратор', '', 'admin', hash, 0, 1);
  }

  const demoClient = db.prepare(
    "SELECT id FROM users WHERE login = 'client' AND deleted_at IS NULL"
  ).get();

  if (!demoClient) {
    const hash = bcrypt.hashSync('client123', 10);
    db.prepare(`
      INSERT INTO users (name, address, login, password_hash, wallet_balance, is_admin)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run('Демо Клиент', 'ул. Примерная, 1', 'client', hash, 5000, 0);
  }

  return db;
}

module.exports = { initDatabase, DB_PATH };

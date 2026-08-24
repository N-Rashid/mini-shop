import os
import sqlite3
import sys
import uuid
from datetime import datetime, timezone, timedelta
from functools import wraps
from html import escape
from urllib.parse import quote

from flask import (
    Flask, jsonify, request, send_from_directory, session, Response
)
import bcrypt
from werkzeug.security import check_password_hash
from werkzeug.exceptions import RequestEntityTooLarge
from werkzeug.utils import secure_filename

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(BASE_DIR, 'db', 'shop.db')
UPLOADS_DIR = os.path.join(BASE_DIR, 'uploads')
PUBLIC_DIR = os.path.join(BASE_DIR, 'public')

ALLOWED_EXTENSIONS = {'png', 'jpg', 'jpeg', 'gif', 'webp'}
PRODUCT_IMAGE_MAX_SIDE = 1600
PRODUCT_IMAGE_JPEG_QUALITY = 85
PROCESSABLE_IMAGE_EXTENSIONS = {'png', 'jpg', 'jpeg', 'webp'}

Image = None
try:
    from PIL import Image
except ImportError:
    pass

TOOLS_DIR = os.path.join(BASE_DIR, 'tools')
if TOOLS_DIR not in sys.path:
    sys.path.insert(0, TOOLS_DIR)

apply_product_watermark = None
load_watermark_logo = None
try:
    from watermark_lib import apply_product_watermark, load_logo_image as load_watermark_logo
except ImportError:
    pass

WATERMARK_LOGO_PATH = os.path.join(BASE_DIR, 'demo', 'watermark.png')
_watermark_logo_cache = False
_watermark_status_logged = False
ARCHIVE_ORDERS_AFTER_MONTHS = 5
PURGE_ARCHIVED_AFTER_MONTHS = 1
PURGE_DELETED_USERS_AFTER_DAYS = 7

DEFAULT_ABOUT = '''Добро пожаловать в «Мороженое Избербаш»!

Мы предлагаем натуральное мороженое с доставкой по Избербашу.

Приходите или заказывайте — поможем с выбором и доставим свежим.'''

DEFAULT_HOME_TITLE = 'Мороженое Избербаш'
DEFAULT_HOME_SUBTITLE = (
    'Большой Ассортимент. Низкие Цены. Доставка. Мороженое для Кафе и Ресторанов'
)

app = Flask(__name__, static_folder=PUBLIC_DIR, static_url_path='')
app.secret_key = 'mini-shop-secret-change-in-production'
app.config['MAX_CONTENT_LENGTH'] = 20 * 1024 * 1024
app.config['PERMANENT_SESSION_LIFETIME'] = timedelta(days=30)
app.config['SESSION_COOKIE_SAMESITE'] = 'Lax'
app.config['SESSION_COOKIE_HTTPONLY'] = True
app.config['SESSION_REFRESH_EACH_REQUEST'] = True
SESSION_DEFAULT_DAYS = 1

os.makedirs(UPLOADS_DIR, exist_ok=True)
os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)


@app.errorhandler(RequestEntityTooLarge)
def handle_file_too_large(_e):
    return jsonify({'error': 'Файл слишком большой. Максимум 20 МБ на запрос.'}), 413


def now_iso():
    return datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')


def hash_password(password):
    return bcrypt.hashpw(password.encode('utf-8'), bcrypt.gensalt()).decode('utf-8')


def verify_password(stored_hash, password):
    if stored_hash.startswith('$2'):
        return bcrypt.checkpw(password.encode('utf-8'), stored_hash.encode('utf-8'))
    return check_password_hash(stored_hash, password)


def get_db():
    conn = sqlite3.connect(DB_PATH, timeout=30)
    conn.row_factory = sqlite3.Row
    conn.execute('PRAGMA foreign_keys = ON')
    conn.execute('PRAGMA journal_mode = WAL')
    conn.execute('PRAGMA synchronous = NORMAL')
    conn.execute('PRAGMA busy_timeout = 30000')
    return conn


def ensure_migrations_table(conn):
    conn.execute('''
        CREATE TABLE IF NOT EXISTS schema_migrations (
            name TEXT PRIMARY KEY,
            applied_at TEXT NOT NULL DEFAULT (datetime('now'))
        )
    ''')


def migration_done(conn, name):
    ensure_migrations_table(conn)
    return conn.execute(
        'SELECT 1 FROM schema_migrations WHERE name = ?', (name,)
    ).fetchone() is not None


def mark_migration(conn, name):
    conn.execute(
        'INSERT OR IGNORE INTO schema_migrations (name) VALUES (?)',
        (name,),
    )


def table_columns(conn, table):
    return {row[1] for row in conn.execute(f'PRAGMA table_info({table})').fetchall()}


def add_column_if_missing(conn, table, col, typedef):
    if col in table_columns(conn, table):
        return
    try:
        conn.execute(f'ALTER TABLE {table} ADD COLUMN {col} {typedef}')
    except sqlite3.OperationalError as exc:
        if 'duplicate column' not in str(exc).lower():
            raise


def migrate_db(conn):
    conn.executescript('''
        CREATE TABLE IF NOT EXISTS categories (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL UNIQUE,
            sort_order INTEGER DEFAULT 0,
            deleted_at TEXT NULL
        );
    ''')
    add_column_if_missing(conn, 'categories', 'sort_order', 'INTEGER DEFAULT 0')
    add_column_if_missing(conn, 'categories', 'deleted_at', 'TEXT NULL')
    add_column_if_missing(conn, 'categories', 'is_featured_home', 'INTEGER DEFAULT 0')

    product_cols = table_columns(conn, 'products')
    for col, typedef in [
        ('category_id', 'INTEGER REFERENCES categories(id)'),
        ('price_piece', 'REAL'),
        ('price_pack', 'REAL'),
        ('allow_piece_sale', 'INTEGER DEFAULT 0'),
        ('is_on_sale', 'INTEGER DEFAULT 0'),
        ('sale_price_pack', 'REAL'),
        ('sale_price_piece', 'REAL'),
        ('is_bestseller', 'INTEGER DEFAULT 0'),
        ('sort_order', 'INTEGER DEFAULT 0'),
        ('in_stock', 'INTEGER DEFAULT 1'),
    ]:
        add_column_if_missing(conn, 'products', col, typedef)

    if not migration_done(conn, 'products_sort_order_init'):
        if conn.execute(
            'SELECT COUNT(*) AS c FROM products WHERE sort_order > 0'
        ).fetchone()['c'] == 0:
            rows = conn.execute(
                'SELECT id FROM products ORDER BY id DESC'
            ).fetchall()
            for idx, row in enumerate(rows):
                conn.execute(
                    'UPDATE products SET sort_order = ? WHERE id = ?',
                    (idx + 1, row['id']),
                )
        mark_migration(conn, 'products_sort_order_init')

    conn.execute(
        'UPDATE products SET price_pack = cost '
        'WHERE price_pack IS NULL AND cost IS NOT NULL'
    )
    conn.execute(
        'UPDATE products SET price_piece = cost / MAX(pieces_per_box, 1) '
        'WHERE price_piece IS NULL AND cost IS NOT NULL'
    )
    conn.execute(
        'UPDATE products SET in_stock = 1 WHERE in_stock IS NULL'
    )

    order_cols = table_columns(conn, 'order_items')
    add_column_if_missing(conn, 'order_items', 'unit_type', "TEXT DEFAULT 'pack'")

    if 'created_at' not in table_columns(conn, 'products'):
        add_column_if_missing(conn, 'products', 'created_at', 'TEXT')
        conn.execute("UPDATE products SET created_at = datetime('now') WHERE created_at IS NULL")

    order_table_cols = table_columns(conn, 'orders')
    add_column_if_missing(conn, 'orders', 'archived_at', 'TEXT NULL')
    add_column_if_missing(conn, 'orders', 'client_number', 'INTEGER')

    if not migration_done(conn, 'orders_client_number_backfill'):
        user_ids = conn.execute('SELECT DISTINCT user_id FROM orders').fetchall()
        for row in user_ids:
            orders = conn.execute('''
                SELECT id FROM orders
                WHERE user_id = ?
                ORDER BY created_at ASC, id ASC
            ''', (row['user_id'],)).fetchall()
            for idx, order in enumerate(orders, start=1):
                conn.execute(
                    'UPDATE orders SET client_number = ? WHERE id = ?',
                    (idx, order['id']),
                )
        mark_migration(conn, 'orders_client_number_backfill')

    if not migration_done(conn, 'products_weight_kg_to_g'):
        conn.execute(
            "UPDATE products SET weight = weight * 1000 WHERE weight > 0 AND weight < 50"
        )
        mark_migration(conn, 'products_weight_kg_to_g')

    if not migration_done(conn, 'products_weight_pack_to_piece'):
        conn.execute('''
            UPDATE products
            SET weight = ROUND(weight * 1.0 / MAX(pieces_per_box, 1))
            WHERE weight > 0
        ''')
        mark_migration(conn, 'products_weight_pack_to_piece')

    if not migration_done(conn, 'categories_purge_soft_deleted'):
        conn.execute('''
            UPDATE products SET category_id = NULL
            WHERE category_id IN (SELECT id FROM categories WHERE deleted_at IS NOT NULL)
        ''')
        conn.execute('DELETE FROM categories WHERE deleted_at IS NOT NULL')
        mark_migration(conn, 'categories_purge_soft_deleted')

    if not migration_done(conn, 'default_categories_seed'):
        if conn.execute('SELECT COUNT(*) AS c FROM categories').fetchone()['c'] == 0:
            default_categories = [
                ('Эскимо', 1),
                ('Рожки', 2),
                ('Стаканчики', 3),
                ('Брикеты', 4),
                ('Семейные упаковки', 5),
                ('Леденцы', 6),
            ]
            for name, sort_order in default_categories:
                conn.execute(
                    'INSERT INTO categories (name, sort_order) VALUES (?, ?)',
                    (name, sort_order),
                )
        mark_migration(conn, 'default_categories_seed')

    if not migration_done(conn, 'cleanup_reseeded_default_categories'):
        for name in ('Эскимо', 'Рожки', 'Стаканчики', 'Брикеты', 'Семейные упаковки', 'Леденцы'):
            rows = conn.execute(
                'SELECT id FROM categories WHERE name = ? ORDER BY id',
                (name,),
            ).fetchall()
            for row in rows[1:]:
                conn.execute(
                    'UPDATE products SET category_id = NULL WHERE category_id = ?',
                    (row['id'],),
                )
                conn.execute('DELETE FROM categories WHERE id = ?', (row['id'],))

        pal = conn.execute(
            "SELECT id FROM categories WHERE name = 'Эскимо на палочке'"
        ).fetchone()
        eskimo = conn.execute(
            "SELECT id FROM categories WHERE name = 'Эскимо'"
        ).fetchone()
        if pal and eskimo:
            conn.execute(
                'UPDATE products SET category_id = ? WHERE category_id = ?',
                (pal['id'], eskimo['id']),
            )
            conn.execute('DELETE FROM categories WHERE id = ?', (eskimo['id'],))

        mark_migration(conn, 'cleanup_reseeded_default_categories')

    if not migration_done(conn, 'cleanup_orphan_eskimo_v2'):
        eskimo = conn.execute(
            "SELECT id FROM categories WHERE name = 'Эскимо'"
        ).fetchone()
        if eskimo:
            replacement = conn.execute(
                "SELECT id FROM categories WHERE name LIKE 'Эскимо на %' AND id != ?",
                (eskimo['id'],),
            ).fetchone()
            if replacement:
                conn.execute(
                    'UPDATE products SET category_id = ? WHERE category_id = ?',
                    (replacement['id'], eskimo['id']),
                )
                conn.execute('DELETE FROM categories WHERE id = ?', (eskimo['id'],))
        mark_migration(conn, 'cleanup_orphan_eskimo_v2')

    conn.executescript('''
        CREATE TABLE IF NOT EXISTS product_categories (
            product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
            category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
            PRIMARY KEY (product_id, category_id)
        );
    ''')

    if not migration_done(conn, 'product_categories_from_category_id'):
        conn.execute('''
            INSERT OR IGNORE INTO product_categories (product_id, category_id)
            SELECT id, category_id FROM products
            WHERE category_id IS NOT NULL
        ''')
        mark_migration(conn, 'product_categories_from_category_id')

    add_column_if_missing(conn, 'product_categories', 'sort_order', 'INTEGER DEFAULT 0')

    if not migration_done(conn, 'product_categories_sort_order_init'):
        conn.execute('''
            UPDATE product_categories
            SET sort_order = COALESCE((
                SELECT sort_order FROM products WHERE products.id = product_categories.product_id
            ), 0)
        ''')
        mark_migration(conn, 'product_categories_sort_order_init')

    if not migration_done(conn, 'featured_home_category'):
        featured = conn.execute(
            'SELECT id FROM categories WHERE is_featured_home = 1 LIMIT 1'
        ).fetchone()
        if not featured:
            conn.execute(
                'INSERT INTO categories (name, sort_order, is_featured_home) VALUES (?, 0, 1)',
                ('Избранное (главная)',),
            )
            featured = conn.execute(
                'SELECT id FROM categories WHERE is_featured_home = 1 LIMIT 1'
            ).fetchone()
        featured_id = featured['id']
        legacy = conn.execute(
            'SELECT name FROM sqlite_master WHERE type = ? AND name = ?',
            ('table', 'featured_products'),
        ).fetchone()
        if legacy:
            rows = conn.execute(
                'SELECT product_id, sort_order FROM featured_products ORDER BY sort_order ASC, product_id ASC'
            ).fetchall()
            for row in rows:
                conn.execute('''
                    INSERT OR IGNORE INTO product_categories (product_id, category_id, sort_order)
                    VALUES (?, ?, ?)
                ''', (row['product_id'], featured_id, row['sort_order']))
            conn.execute('DROP TABLE featured_products')
        mark_migration(conn, 'featured_home_category')

    conn.executescript('''
        CREATE TABLE IF NOT EXISTS favorites (
            user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
            created_at TEXT NOT NULL,
            PRIMARY KEY (user_id, product_id)
        );
    ''')

    conn.executescript('''
        CREATE TABLE IF NOT EXISTS site_settings (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL DEFAULT ''
        );
    ''')
    if not conn.execute(
        "SELECT 1 FROM site_settings WHERE key = 'about_content'"
    ).fetchone():
        conn.execute(
            "INSERT INTO site_settings (key, value) VALUES ('about_content', ?)",
            (DEFAULT_ABOUT,),
        )
    if not conn.execute(
        "SELECT 1 FROM site_settings WHERE key = 'home_title'"
    ).fetchone():
        conn.execute(
            "INSERT INTO site_settings (key, value) VALUES ('home_title', ?)",
            (DEFAULT_HOME_TITLE,),
        )
    if not conn.execute(
        "SELECT 1 FROM site_settings WHERE key = 'home_subtitle'"
    ).fetchone():
        conn.execute(
            "INSERT INTO site_settings (key, value) VALUES ('home_subtitle', ?)",
            (DEFAULT_HOME_SUBTITLE,),
        )


def init_db():
    conn = get_db()
    conn.executescript('''
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
    ''')

    migrate_db(conn)

    if not conn.execute(
        "SELECT id FROM users WHERE login = 'admin' AND deleted_at IS NULL"
    ).fetchone():
        conn.execute(
            'INSERT INTO users (name, address, login, password_hash, wallet_balance, is_admin) VALUES (?, ?, ?, ?, ?, ?)',
            ('Администратор', '', 'admin', hash_password('admin123'), 0, 1)
        )

    if not conn.execute(
        "SELECT id FROM users WHERE login = 'client' AND deleted_at IS NULL"
    ).fetchone():
        conn.execute(
            'INSERT INTO users (name, address, login, password_hash, wallet_balance, is_admin) VALUES (?, ?, ?, ?, ?, ?)',
            ('Демо Клиент', 'ул. Примерная, 1', 'client', hash_password('client123'), 5000, 0)
        )

    conn.commit()
    conn.close()


def row_to_dict(row):
    return dict(row) if row else None


def get_setting(conn, key, default=''):
    row = conn.execute(
        'SELECT value FROM site_settings WHERE key = ?', (key,)
    ).fetchone()
    return row['value'] if row else default


def set_setting(conn, key, value):
    conn.execute('''
        INSERT INTO site_settings (key, value) VALUES (?, ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value
    ''', (key, value))


def fetch_order_items(conn, order_id):
    rows = conn.execute('''
        SELECT oi.id, oi.quantity, oi.price, oi.unit_type, oi.product_id,
               p.name AS product_name,
               CASE WHEN p.deleted_at IS NOT NULL THEN 1 ELSE 0 END AS product_unavailable
        FROM order_items oi
        JOIN products p ON p.id = oi.product_id
        WHERE oi.order_id = ? AND oi.deleted_at IS NULL
    ''', (order_id,)).fetchall()
    items = []
    for r in rows:
        d = row_to_dict(r)
        d['product_unavailable'] = bool(d.get('product_unavailable'))
        items.append(d)
    return items


def map_user_order(conn, order_row):
    d = row_to_dict(order_row)
    d['number'] = order_row['client_number'] if order_row['client_number'] is not None else order_row['id']
    d['status_label'] = map_order_status(order_row['status'])
    d['is_archived'] = bool(order_row['archived_at'])
    d['deleted'] = bool(order_row['deleted_at'])
    d['can_edit'] = (
        order_row['status'] == 'pending'
        and not d['is_archived']
        and not order_row['deleted_at']
    )
    d['can_add_items'] = d['can_edit']
    d['items'] = fetch_order_items(conn, order_row['id'])
    return d


def soft_delete(conn, table, record_id):
    conn.execute(
        f'UPDATE {table} SET deleted_at = ? WHERE id = ? AND deleted_at IS NULL',
        (now_iso(), record_id)
    )


def archive_old_orders(conn):
    """Архивировать заказы старше ARCHIVE_ORDERS_AFTER_MONTHS месяцев."""
    conn.execute(
        f'''
        UPDATE orders SET archived_at = ?
        WHERE archived_at IS NULL
          AND deleted_at IS NULL
          AND datetime(created_at) < datetime('now', '-{ARCHIVE_ORDERS_AFTER_MONTHS} months')
        ''',
        (now_iso(),)
    )


def purge_archived_orders(conn):
    """Удалить из БД заказы, которые в архиве дольше PURGE_ARCHIVED_AFTER_MONTHS месяцев."""
    rows = conn.execute(
        f'''
        SELECT id FROM orders
        WHERE archived_at IS NOT NULL
          AND datetime(archived_at) < datetime('now', '-{PURGE_ARCHIVED_AFTER_MONTHS} months')
        '''
    ).fetchall()
    for row in rows:
        conn.execute('DELETE FROM order_items WHERE order_id = ?', (row['id'],))
        conn.execute('DELETE FROM orders WHERE id = ?', (row['id'],))


def purge_deleted_users(conn):
    """Полностью удалить клиентов, помеченных удалёнными дольше недели."""
    rows = conn.execute(
        f'''
        SELECT id FROM users
        WHERE deleted_at IS NOT NULL
          AND is_admin = 0
          AND datetime(deleted_at) < datetime('now', '-{PURGE_DELETED_USERS_AFTER_DAYS} days')
        '''
    ).fetchall()
    for row in rows:
        user_id = row['id']
        order_ids = conn.execute(
            'SELECT id FROM orders WHERE user_id = ?', (user_id,)
        ).fetchall()
        for order in order_ids:
            conn.execute('DELETE FROM order_items WHERE order_id = ?', (order['id'],))
        conn.execute('DELETE FROM orders WHERE user_id = ?', (user_id,))
        conn.execute('DELETE FROM users WHERE id = ?', (user_id,))


def get_product_images(conn, product_id):
    rows = conn.execute(
        'SELECT id, filename FROM product_images WHERE product_id = ? AND deleted_at IS NULL',
        (product_id,)
    ).fetchall()
    return [{'id': r['id'], 'url': f'/uploads/{r["filename"]}'} for r in rows]


def get_product_categories(conn, product_id):
    rows = conn.execute('''
        SELECT c.id, c.name, COALESCE(c.is_featured_home, 0) AS is_featured_home
        FROM product_categories pc
        JOIN categories c ON c.id = pc.category_id
        WHERE pc.product_id = ?
        ORDER BY c.sort_order ASC, c.id ASC
    ''', (product_id,)).fetchall()
    return [row_to_dict(r) for r in rows]


def get_featured_home_category(conn):
    return conn.execute(
        'SELECT id, name, sort_order, is_featured_home FROM categories WHERE is_featured_home = 1 LIMIT 1'
    ).fetchone()


def get_featured_home_category_id(conn):
    row = get_featured_home_category(conn)
    return row['id'] if row else None


def get_featured_product_ids(conn):
    featured_id = get_featured_home_category_id(conn)
    if not featured_id:
        return []
    rows = conn.execute('''
        SELECT pc.product_id
        FROM product_categories pc
        JOIN products p ON p.id = pc.product_id
        WHERE pc.category_id = ? AND p.deleted_at IS NULL
        ORDER BY pc.sort_order ASC, pc.product_id ASC
    ''', (featured_id,)).fetchall()
    return [row['product_id'] for row in rows]


def parse_category_ids(raw_values):
    ids = []
    for value in raw_values or []:
        if value is None or value == '':
            continue
        try:
            cat_id = int(value)
        except (TypeError, ValueError):
            continue
        if cat_id > 0 and cat_id not in ids:
            ids.append(cat_id)
    return ids


def primary_category_id_from_list(conn, category_ids):
    featured_id = get_featured_home_category_id(conn)
    for cat_id in category_ids:
        if cat_id != featured_id:
            return cat_id
    return category_ids[0] if category_ids else None


def parse_category_ids_from_form():
    if 'category_ids' in request.form:
        return parse_category_ids(request.form.getlist('category_ids'))
    category_id = request.form.get('category_id')
    return parse_category_ids([category_id]) if category_id else []


def parse_category_ids_from_data(data):
    if 'category_ids' in data:
        return parse_category_ids(data.get('category_ids'))
    category_id = data.get('category_id')
    return parse_category_ids([category_id]) if category_id else []


def refresh_product_primary_category(conn, product_id):
    row = conn.execute('''
        SELECT pc.category_id
        FROM product_categories pc
        JOIN categories c ON c.id = pc.category_id
        WHERE pc.product_id = ? AND COALESCE(c.is_featured_home, 0) = 0
        ORDER BY c.sort_order ASC, c.id ASC
        LIMIT 1
    ''', (product_id,)).fetchone()
    conn.execute(
        'UPDATE products SET category_id = ? WHERE id = ?',
        (row['category_id'] if row else None, product_id),
    )


def get_product_category_sort_orders(conn, product_id):
    rows = conn.execute(
        'SELECT category_id, sort_order FROM product_categories WHERE product_id = ?',
        (product_id,),
    ).fetchall()
    return {str(row['category_id']): row['sort_order'] for row in rows}


def set_product_categories(conn, product_id, category_ids):
    featured_id = get_featured_home_category_id(conn)
    normalized_ids = []
    for raw_id in category_ids or []:
        try:
            cat_id = int(raw_id)
        except (TypeError, ValueError):
            continue
        if cat_id > 0 and cat_id not in normalized_ids:
            normalized_ids.append(cat_id)

    wants_featured = bool(featured_id and featured_id in normalized_ids)
    regular_ids = [cat_id for cat_id in normalized_ids if cat_id != featured_id]

    existing = {
        row['category_id']: row['sort_order']
        for row in conn.execute(
            'SELECT category_id, sort_order FROM product_categories WHERE product_id = ?',
            (product_id,),
        ).fetchall()
    }
    conn.execute('DELETE FROM product_categories WHERE product_id = ?', (product_id,))

    for cat_id in regular_ids:
        if not conn.execute('SELECT id FROM categories WHERE id = ?', (cat_id,)).fetchone():
            continue
        sort_order = existing.get(cat_id)
        if sort_order is None:
            sort_order = conn.execute(
                'SELECT COALESCE(MAX(sort_order), 0) FROM product_categories WHERE category_id = ?',
                (cat_id,),
            ).fetchone()[0] + 1
        conn.execute(
            'INSERT INTO product_categories (product_id, category_id, sort_order) VALUES (?, ?, ?)',
            (product_id, cat_id, sort_order),
        )

    if wants_featured and featured_id:
        sort_order = existing.get(featured_id)
        if sort_order is None:
            sort_order = conn.execute(
                'SELECT COALESCE(MAX(sort_order), 0) FROM product_categories WHERE category_id = ?',
                (featured_id,),
            ).fetchone()[0] + 1
        conn.execute(
            'INSERT INTO product_categories (product_id, category_id, sort_order) VALUES (?, ?, ?)',
            (product_id, featured_id, sort_order),
        )

    refresh_product_primary_category(conn, product_id)


def strip_featured_home_from_product(d, featured_id=None):
    cats = [c for c in d.get('categories', []) if not c.get('is_featured_home')]
    d['categories'] = cats
    d['category_ids'] = [c['id'] for c in cats]
    visible = [c for c in cats if not c.get('is_featured_home')]
    d['category'] = visible[0] if visible else None
    if featured_id is not None and d.get('category_sort_orders'):
        orders = dict(d['category_sort_orders'])
        orders.pop(str(featured_id), None)
        d['category_sort_orders'] = orders
    return d


def map_product(conn, row, for_public=False):
    d = row_to_dict(row)
    d['images'] = get_product_images(conn, d['id'])
    d['price_pack'] = d.get('price_pack') if d.get('price_pack') is not None else d.get('cost', 0)
    d['price_piece'] = d.get('price_piece') if d.get('price_piece') is not None else 0
    d['pieces_per_pack'] = d.get('pieces_per_box', 1)
    d['allow_piece_sale'] = bool(d.get('allow_piece_sale', 0))
    d['is_on_sale'] = bool(d.get('is_on_sale', 0))
    d['is_bestseller'] = bool(d.get('is_bestseller', 0))
    d['in_stock'] = bool(d.get('in_stock', 1))
    d['sale_price_pack'] = d.get('sale_price_pack')
    d['sale_price_piece'] = d.get('sale_price_piece')
    d['weight_grams'] = int(d.get('weight') or 0)
    d['grams_per_piece'] = d['weight_grams']
    d['is_new'] = False
    if d.get('created_at'):
        try:
            raw = d['created_at'].replace('Z', '').replace('T', ' ')
            created = datetime.strptime(raw[:19], '%Y-%m-%d %H:%M:%S').replace(tzinfo=timezone.utc)
            d['is_new'] = (datetime.now(timezone.utc) - created).days <= 14
        except ValueError:
            d['is_new'] = True

    cats = get_product_categories(conn, d['id'])
    d['categories'] = cats
    d['category_ids'] = [c['id'] for c in cats]
    d['category_sort_orders'] = get_product_category_sort_orders(conn, d['id'])
    visible_cats = [c for c in cats if not c.get('is_featured_home')]
    d['category'] = visible_cats[0] if visible_cats else (cats[0] if cats else None)
    if not cats and d.get('category_id'):
        cat = conn.execute(
            '''SELECT id, name FROM categories
               WHERE id = ? AND deleted_at IS NULL AND COALESCE(is_featured_home, 0) = 0''',
            (d['category_id'],)
        ).fetchone()
        if cat:
            cat_dict = row_to_dict(cat)
            d['category'] = cat_dict
            d['categories'] = [cat_dict]
            d['category_ids'] = [cat_dict['id']]
    if for_public:
        strip_featured_home_from_product(d, get_featured_home_category_id(conn))
    return d


def product_price(product, unit_type):
    if unit_type == 'piece':
        if product.get('is_on_sale') and product.get('sale_price_piece') is not None:
            return product['sale_price_piece']
        return product['price_piece'] or 0
    if product.get('is_on_sale') and product.get('sale_price_pack') is not None:
        return product['sale_price_pack']
    return product['price_pack'] if product['price_pack'] is not None else product['cost']


PRODUCT_SELECT = '''
    id, name, cost, pieces_per_box, weight, description, created_at,
    category_id, price_piece, price_pack, allow_piece_sale,
    is_on_sale, sale_price_pack, sale_price_piece, is_bestseller, sort_order, in_stock
'''

PRODUCT_SELECT_QUALIFIED = '''
    products.id, products.name, products.cost, products.pieces_per_box, products.weight,
    products.description, products.created_at, products.category_id, products.price_piece,
    products.price_pack, products.allow_piece_sale, products.is_on_sale,
    products.sale_price_pack, products.sale_price_piece, products.is_bestseller,
    products.sort_order, products.in_stock
'''


def build_order_lines(conn, items):
    total = 0
    order_items = []

    for item in items:
        product_row = conn.execute(
            f'SELECT {PRODUCT_SELECT} FROM products WHERE id = ? AND deleted_at IS NULL',
            (item.get('productId'),)
        ).fetchone()
        qty = item.get('quantity', 0)
        unit_type = item.get('unitType', 'pack')

        if not product_row:
            raise ValueError(f'Товар #{item.get("productId")} не найден')
        if qty < 1:
            raise ValueError('Некорректное количество')
        if unit_type not in ('pack', 'piece'):
            raise ValueError('Некорректный тип единицы')
        if unit_type == 'piece' and not product_row['allow_piece_sale']:
            raise ValueError(f'«{product_row["name"]}» продаётся только упаковками')
        if not product_row['in_stock']:
            raise ValueError(f'«{product_row["name"]}» нет в наличии')

        product = dict(product_row)
        price = product_price(product, unit_type)
        line_total = price * qty
        total += line_total
        order_items.append({
            'product_id': product['id'],
            'quantity': qty,
            'price': price,
            'unit_type': unit_type,
        })

    return total, order_items


def get_pending_order(conn, user_id):
    return conn.execute('''
        SELECT id, total, status FROM orders
        WHERE user_id = ? AND status = 'pending'
          AND deleted_at IS NULL AND archived_at IS NULL
        ORDER BY created_at ASC LIMIT 1
    ''', (user_id,)).fetchone()


def consolidate_pending_orders(conn, user_id):
    rows = conn.execute('''
        SELECT id FROM orders
        WHERE user_id = ? AND status = 'pending'
          AND deleted_at IS NULL AND archived_at IS NULL
        ORDER BY created_at ASC
    ''', (user_id,)).fetchall()
    if len(rows) <= 1:
        return get_pending_order(conn, user_id)

    primary_id = rows[0]['id']
    for row in rows[1:]:
        extra_id = row['id']
        extra_items = conn.execute('''
            SELECT product_id, quantity, price, unit_type
            FROM order_items
            WHERE order_id = ? AND deleted_at IS NULL
        ''', (extra_id,)).fetchall()
        for item in extra_items:
            append_items_to_order(conn, primary_id, [{
                'product_id': item['product_id'],
                'quantity': item['quantity'],
                'price': item['price'],
                'unit_type': item['unit_type'],
            }])
        conn.execute(
            'UPDATE orders SET deleted_at = ? WHERE id = ?',
            (now_iso(), extra_id)
        )

    total = recalculate_order_total(conn, primary_id)
    return conn.execute(
        'SELECT id, total, status FROM orders WHERE id = ?',
        (primary_id,)
    ).fetchone()


def get_user_order(conn, order_id, user_id):
    return conn.execute('''
        SELECT id, total, status, user_id FROM orders
        WHERE id = ? AND user_id = ?
          AND deleted_at IS NULL AND archived_at IS NULL
    ''', (order_id, user_id)).fetchone()


def recalculate_order_total(conn, order_id):
    row = conn.execute('''
        SELECT COALESCE(SUM(quantity * price), 0) AS total
        FROM order_items WHERE order_id = ? AND deleted_at IS NULL
    ''', (order_id,)).fetchone()
    total = float(row['total'])
    conn.execute('UPDATE orders SET total = ? WHERE id = ?', (total, order_id))
    return total


def next_client_order_number(conn, user_id):
    row = conn.execute(
        'SELECT COALESCE(MAX(client_number), 0) + 1 AS n FROM orders WHERE user_id = ?',
        (user_id,),
    ).fetchone()
    return int(row['n'])


def append_items_to_order(conn, order_id, order_items):
    for oi in order_items:
        existing = conn.execute('''
            SELECT id, quantity FROM order_items
            WHERE order_id = ? AND product_id = ? AND unit_type = ?
              AND deleted_at IS NULL
        ''', (order_id, oi['product_id'], oi['unit_type'])).fetchone()

        if existing:
            conn.execute(
                'UPDATE order_items SET quantity = quantity + ? WHERE id = ?',
                (oi['quantity'], existing['id'])
            )
        else:
            conn.execute('''
                INSERT INTO order_items (order_id, product_id, quantity, price, unit_type)
                VALUES (?, ?, ?, ?, ?)
            ''', (order_id, oi['product_id'], oi['quantity'], oi['price'], oi['unit_type']))


ORDER_STATUSES = {'pending', 'accepted', 'completed'}


def map_order_status(status):
    labels = {
        'pending': 'Ожидание',
        'accepted': 'Заказ принят',
        'completed': 'Выполнен',
    }
    return labels.get(status, status)


def require_auth(f):
    @wraps(f)
    def wrapper(*args, **kwargs):
        if clear_expired_session() or not session.get('user_id'):
            return jsonify({'error': 'Необходима авторизация'}), 401
        return f(*args, **kwargs)
    return wrapper


def require_client(f):
    @wraps(f)
    def wrapper(*args, **kwargs):
        if clear_expired_session() or not session.get('user_id'):
            return jsonify({'error': 'Необходима авторизация'}), 401
        if session.get('is_admin'):
            return jsonify({'error': 'Избранное доступно только клиентам'}), 403
        return f(*args, **kwargs)
    return wrapper


def require_admin(f):
    @wraps(f)
    def wrapper(*args, **kwargs):
        if clear_expired_session() or not session.get('user_id') or not session.get('is_admin'):
            return jsonify({'error': 'Доступ запрещён'}), 403
        return f(*args, **kwargs)
    return wrapper


def allowed_file(filename):
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS


def prepare_product_image(img):
    if img.mode not in ('RGB', 'L'):
        img = img.convert('RGB')
    elif img.mode == 'L':
        img = img.convert('RGB')

    width, height = img.size
    max_side = max(width, height)
    if max_side > PRODUCT_IMAGE_MAX_SIDE:
        scale = PRODUCT_IMAGE_MAX_SIDE / max_side
        new_size = (max(1, int(width * scale)), max(1, int(height * scale)))
        img = img.resize(new_size, Image.Resampling.LANCZOS)
    return img


def log_watermark_status_once():
    global _watermark_status_logged
    if _watermark_status_logged:
        return
    _watermark_status_logged = True
    if not apply_product_watermark or not Image:
        app.logger.warning('Watermark disabled: Pillow or watermark_lib unavailable')
        return
    if not os.path.isfile(WATERMARK_LOGO_PATH):
        app.logger.warning('Watermark disabled: logo not found at %s', WATERMARK_LOGO_PATH)
        return
    app.logger.info('Watermark enabled: %s', WATERMARK_LOGO_PATH)


def get_watermark_logo():
    global _watermark_logo_cache
    if _watermark_logo_cache is not False:
        return _watermark_logo_cache
    log_watermark_status_once()
    if not load_watermark_logo or not os.path.isfile(WATERMARK_LOGO_PATH):
        _watermark_logo_cache = None
        return None
    try:
        _watermark_logo_cache = load_watermark_logo(WATERMARK_LOGO_PATH)
    except Exception as exc:
        app.logger.warning('Watermark logo load failed: %s', exc)
        _watermark_logo_cache = None
    return _watermark_logo_cache


def maybe_watermark_product_image(img):
    if not apply_product_watermark or not Image:
        return img
    logo = get_watermark_logo()
    if logo is None:
        return img
    try:
        return apply_product_watermark(img, logo)
    except Exception as exc:
        app.logger.warning('Watermark apply failed: %s', exc)
        return img


def save_prepared_jpg(img, product_id):
    unique_name = f'{product_id}-{uuid.uuid4().hex[:12]}.jpg'
    path = os.path.join(UPLOADS_DIR, unique_name)
    prepared = maybe_watermark_product_image(prepare_product_image(img))
    prepared.save(path, 'JPEG', quality=PRODUCT_IMAGE_JPEG_QUALITY)
    return unique_name


def save_uploaded_product_image(file, product_id):
    if not allowed_file(file.filename):
        return None

    ext = file.filename.rsplit('.', 1)[1].lower()
    if Image and ext in PROCESSABLE_IMAGE_EXTENSIONS:
        with Image.open(file.stream) as img:
            img.load()
            return save_prepared_jpg(img.copy(), product_id)

    unique_name = f'{product_id}-{uuid.uuid4().hex[:12]}.{ext}'
    file.save(os.path.join(UPLOADS_DIR, unique_name))
    return unique_name


def parse_amount(value, default=0.0):
    if value is None or value == '':
        return default
    return float(value)


def set_user_session(user, is_admin=False, remember=False):
    session.permanent = True
    session['user_id'] = user['id']
    session['is_admin'] = is_admin
    session['user_name'] = user['name']
    session['remember'] = remember
    if remember:
        session.pop('session_expires_at', None)
    else:
        expires = datetime.now(timezone.utc) + timedelta(days=SESSION_DEFAULT_DAYS)
        session['session_expires_at'] = expires.timestamp()


def clear_expired_session():
    expires_at = session.get('session_expires_at')
    if expires_at and datetime.now(timezone.utc).timestamp() > expires_at:
        session.clear()
        return True
    return False


def save_product_images(conn, product_id, files):
    for file in files:
        if not file or not file.filename or not allowed_file(file.filename):
            continue
        unique_name = save_uploaded_product_image(file, product_id)
        if not unique_name:
            continue
        conn.execute(
            'INSERT INTO product_images (product_id, filename) VALUES (?, ?)',
            (product_id, unique_name)
        )


_db_initialized = False


def ensure_db():
    global _db_initialized
    if _db_initialized:
        return
    init_db()
    _db_initialized = True


ensure_db()


@app.route('/')
def index():
    return send_from_directory(PUBLIC_DIR, 'index.html')


@app.route('/uploads/<path:filename>')
def uploaded_file(filename):
    return send_from_directory(UPLOADS_DIR, filename)


# --- Auth ---

@app.post('/api/auth/login')
def auth_login():
    data = request.get_json(silent=True) or {}
    login = data.get('login', '')
    password = data.get('password', '')

    conn = get_db()
    user = conn.execute(
        'SELECT * FROM users WHERE login = ? AND deleted_at IS NULL AND is_admin = 0',
        (login,)
    ).fetchone()
    conn.close()

    if not user or not verify_password(user['password_hash'], password):
        return jsonify({'error': 'Неверный логин или пароль'}), 401

    remember = bool(data.get('remember'))
    set_user_session(user, is_admin=False, remember=remember)

    return jsonify({
        'id': user['id'],
        'name': user['name'],
        'login': user['login'],
        'address': user['address'],
    })


@app.post('/api/auth/logout')
def auth_logout():
    session.clear()
    return jsonify({'ok': True})


@app.get('/api/auth/me')
def auth_me():
    if clear_expired_session() or not session.get('user_id'):
        return jsonify(None)

    conn = get_db()
    user = conn.execute(
        'SELECT id, name, login, address, is_admin FROM users WHERE id = ? AND deleted_at IS NULL',
        (session['user_id'],)
    ).fetchone()
    conn.close()

    if not user:
        session.clear()
        return jsonify(None)

    session.permanent = True
    return jsonify(row_to_dict(user))


# --- Favorites (clients only) ---

@app.get('/api/favorites/ids')
@require_client
def favorite_ids():
    conn = get_db()
    rows = conn.execute(
        '''
        SELECT f.product_id
        FROM favorites f
        JOIN products p ON p.id = f.product_id
        WHERE f.user_id = ? AND p.deleted_at IS NULL
        ORDER BY f.created_at DESC
        ''',
        (session['user_id'],),
    ).fetchall()
    conn.close()
    return jsonify({'ids': [row['product_id'] for row in rows]})


@app.get('/api/favorites')
@require_client
def list_favorites():
    conn = get_db()
    rows = conn.execute(
        f'''
        SELECT {PRODUCT_SELECT_QUALIFIED}
        FROM favorites f
        JOIN products ON products.id = f.product_id
        WHERE f.user_id = ? AND products.deleted_at IS NULL
        ORDER BY f.created_at DESC
        ''',
        (session['user_id'],),
    ).fetchall()
    result = [map_product(conn, r, for_public=True) for r in rows]
    conn.close()
    return jsonify(result)


@app.post('/api/favorites/<int:product_id>')
@require_client
def add_favorite(product_id):
    conn = get_db()
    product = conn.execute(
        'SELECT id FROM products WHERE id = ? AND deleted_at IS NULL',
        (product_id,),
    ).fetchone()
    if not product:
        conn.close()
        return jsonify({'error': 'Товар не найден'}), 404

    conn.execute(
        '''
        INSERT OR IGNORE INTO favorites (user_id, product_id, created_at)
        VALUES (?, ?, ?)
        ''',
        (session['user_id'], product_id, now_iso()),
    )
    conn.commit()
    conn.close()
    return jsonify({'ok': True})


@app.delete('/api/favorites/<int:product_id>')
@require_client
def remove_favorite(product_id):
    conn = get_db()
    conn.execute(
        'DELETE FROM favorites WHERE user_id = ? AND product_id = ?',
        (session['user_id'], product_id),
    )
    conn.commit()
    conn.close()
    return jsonify({'ok': True})


# --- Admin auth ---

@app.post('/api/admin/login')
def admin_login():
    data = request.get_json(silent=True) or {}
    login = data.get('login', '')
    password = data.get('password', '')

    conn = get_db()
    user = conn.execute(
        'SELECT * FROM users WHERE login = ? AND deleted_at IS NULL AND is_admin = 1',
        (login,)
    ).fetchone()
    conn.close()

    if not user or not verify_password(user['password_hash'], password):
        return jsonify({'error': 'Неверный логин или пароль'}), 401

    set_user_session(user, is_admin=True)

    return jsonify({'id': user['id'], 'name': user['name'], 'login': user['login']})


@app.get('/api/admin/me')
@require_admin
def admin_me():
    return jsonify({'id': session['user_id'], 'name': session.get('user_name')})


# --- Categories ---

@app.get('/api/categories')
def list_categories():
    conn = get_db()
    rows = conn.execute('''
        SELECT id, name, sort_order
        FROM categories
        WHERE deleted_at IS NULL AND COALESCE(is_featured_home, 0) = 0
        ORDER BY sort_order ASC, id ASC
    ''').fetchall()
    conn.close()
    return jsonify([row_to_dict(r) for r in rows])


@app.get('/api/featured-products')
def list_featured_products():
    conn = get_db()
    ids = get_featured_product_ids(conn)
    conn.close()
    return jsonify(ids)


@app.get('/api/admin/categories')
@require_admin
def admin_list_categories():
    conn = get_db()
    rows = conn.execute('''
        SELECT id, name, sort_order, COALESCE(is_featured_home, 0) AS is_featured_home
        FROM categories
        ORDER BY sort_order ASC, id ASC
    ''').fetchall()
    conn.close()
    return jsonify([row_to_dict(r) for r in rows])


@app.post('/api/admin/categories')
@require_admin
def admin_create_category():
    data = request.get_json(silent=True) or {}
    name = (data.get('name') or '').strip()
    if not name:
        return jsonify({'error': 'Название категории обязательно'}), 400

    conn = get_db()
    if conn.execute(
        'SELECT id FROM categories WHERE name = ?', (name,)
    ).fetchone():
        conn.close()
        return jsonify({'error': 'Категория уже существует'}), 400

    cur = conn.execute(
        'INSERT INTO categories (name, sort_order) VALUES (?, ?)',
        (name, int(data.get('sort_order') or (
            conn.execute('SELECT COALESCE(MAX(sort_order), 0) FROM categories').fetchone()[0] + 1
        )))
    )
    cat_id = cur.lastrowid
    conn.commit()
    conn.close()
    return jsonify({'id': cat_id, 'name': name}), 201


@app.put('/api/admin/categories/reorder')
@require_admin
def admin_reorder_categories():
    data = request.get_json(silent=True) or {}
    order = data.get('order')
    if not isinstance(order, list) or not order:
        return jsonify({'error': 'Укажите порядок категорий'}), 400

    conn = get_db()
    try:
        featured_id = get_featured_home_category_id(conn)
        for idx, cat_id in enumerate(order):
            cat_id = int(cat_id)
            if featured_id and cat_id == featured_id:
                continue
            updated = conn.execute(
                'UPDATE categories SET sort_order = ? WHERE id = ?',
                (idx + 1, cat_id),
            ).rowcount
            if not updated:
                raise ValueError(f'Категория #{cat_id} не найдена')
        conn.commit()
    except ValueError as exc:
        conn.rollback()
        conn.close()
        return jsonify({'error': str(exc)}), 400
    conn.close()
    return jsonify({'ok': True})


@app.put('/api/admin/categories/<int:category_id>')
@require_admin
def admin_update_category(category_id):
    data = request.get_json(silent=True) or {}
    name = (data.get('name') or '').strip()
    if not name:
        return jsonify({'error': 'Название категории обязательно'}), 400

    conn = get_db()
    category = conn.execute(
        'SELECT sort_order, COALESCE(is_featured_home, 0) AS is_featured_home FROM categories WHERE id = ?',
        (category_id,),
    ).fetchone()
    if not category:
        conn.close()
        return jsonify({'error': 'Категория не найдена'}), 404
    if category['is_featured_home']:
        conn.close()
        return jsonify({'error': 'Системную категорию нельзя переименовать'}), 400

    sort_order = (
        int(data['sort_order']) if 'sort_order' in data else category['sort_order']
    )
    conn.execute(
        'UPDATE categories SET name = ?, sort_order = ? WHERE id = ?',
        (name, sort_order, category_id)
    )
    conn.commit()
    conn.close()
    return jsonify({'ok': True})


@app.delete('/api/admin/categories/<int:category_id>')
@require_admin
def admin_delete_category(category_id):
    conn = get_db()
    category = conn.execute(
        'SELECT id, COALESCE(is_featured_home, 0) AS is_featured_home FROM categories WHERE id = ?',
        (category_id,),
    ).fetchone()
    if not category:
        conn.close()
        return jsonify({'error': 'Категория не найдена'}), 404
    if category['is_featured_home']:
        conn.close()
        return jsonify({'error': 'Системную категорию нельзя удалить'}), 400

    conn.execute(
        'UPDATE products SET category_id = NULL WHERE category_id = ?',
        (category_id,),
    )
    affected = conn.execute(
        'SELECT DISTINCT product_id FROM product_categories WHERE category_id = ?',
        (category_id,),
    ).fetchall()
    conn.execute('DELETE FROM product_categories WHERE category_id = ?', (category_id,))
    for row in affected:
        refresh_product_primary_category(conn, row['product_id'])
    conn.execute('DELETE FROM categories WHERE id = ?', (category_id,))
    conn.commit()
    conn.close()
    return jsonify({'ok': True})


# --- Products ---

@app.get('/api/products')
def list_products():
    q = request.args.get('q', '').strip()
    category_id = request.args.get('category')

    conn = get_db()
    params = []

    if category_id:
        category_id = int(category_id)
        featured = conn.execute(
            'SELECT COALESCE(is_featured_home, 0) AS is_featured_home FROM categories WHERE id = ?',
            (category_id,),
        ).fetchone()
        if featured and featured['is_featured_home']:
            conn.close()
            return jsonify([])
        sql = f'''
            SELECT {PRODUCT_SELECT_QUALIFIED}
            FROM products
            JOIN product_categories pc ON pc.product_id = products.id AND pc.category_id = ?
            WHERE products.deleted_at IS NULL
        '''
        params.append(category_id)
    else:
        sql = f'''
            SELECT {PRODUCT_SELECT}
            FROM products WHERE deleted_at IS NULL
        '''

    if q:
        if category_id:
            sql += ' AND (products.name LIKE ? OR products.description LIKE ?)'
        else:
            sql += ' AND (name LIKE ? OR description LIKE ?)'
        like = f'%{q}%'
        params.extend([like, like])

    if category_id:
        sql += ' ORDER BY products.is_bestseller DESC, pc.sort_order ASC, products.id ASC'
    else:
        sql += ' ORDER BY is_bestseller DESC, sort_order ASC, id ASC'
    rows = conn.execute(sql, params).fetchall()
    result = [map_product(conn, r, for_public=True) for r in rows]
    conn.close()
    return jsonify(result)


@app.get('/api/products/<int:product_id>')
def get_product(product_id):
    conn = get_db()
    row = conn.execute(
        f'SELECT {PRODUCT_SELECT} FROM products WHERE id = ? AND deleted_at IS NULL',
        (product_id,)
    ).fetchone()
    if not row:
        conn.close()
        return jsonify({'error': 'Товар не найден'}), 404
    result = map_product(conn, row, for_public=True)
    conn.close()
    return jsonify(result)


# --- Orders ---

@app.get('/api/orders/pending')
@require_auth
def user_pending_order():
    conn = get_db()
    order = get_pending_order(conn, session['user_id'])
    conn.close()
    if not order:
        return jsonify(None)
    return jsonify({'id': order['id'], 'total': order['total'], 'status': order['status']})


@app.post('/api/orders/checkout')
@require_auth
def checkout():
    data = request.get_json(silent=True) or {}
    items = data.get('items', [])
    if not items:
        return jsonify({'error': 'Корзина пуста'}), 400

    conn = get_db()
    user = conn.execute(
        'SELECT * FROM users WHERE id = ? AND deleted_at IS NULL AND is_admin = 0',
        (session['user_id'],)
    ).fetchone()

    if not user:
        conn.close()
        return jsonify({'error': 'Пользователь не найден'}), 401

    try:
        total, order_items = build_order_lines(conn, items)
    except ValueError as e:
        conn.close()
        return jsonify({'error': str(e)}), 400

    try:
        conn.execute('BEGIN IMMEDIATE')
        pending = consolidate_pending_orders(conn, user['id'])
        merged = False

        if pending:
            order_id = pending['id']
            append_items_to_order(conn, order_id, order_items)
            new_total = recalculate_order_total(conn, order_id)
            merged = True
        else:
            client_number = next_client_order_number(conn, user['id'])
            cur = conn.execute(
                'INSERT INTO orders (user_id, total, status, client_number) VALUES (?, ?, ?, ?)',
                (user['id'], total, 'pending', client_number)
            )
            order_id = cur.lastrowid
            for oi in order_items:
                conn.execute(
                    'INSERT INTO order_items (order_id, product_id, quantity, price, unit_type) VALUES (?, ?, ?, ?, ?)',
                    (order_id, oi['product_id'], oi['quantity'], oi['price'], oi['unit_type'])
                )
            new_total = total

        conn.commit()
    except sqlite3.Error:
        conn.rollback()
        return jsonify({'error': 'Не удалось оформить заказ'}), 500
    finally:
        conn.close()

    return jsonify({
        'orderId': order_id,
        'total': new_total,
        'added': total,
        'merged': merged,
    })


@app.get('/api/orders')
@require_auth
def user_orders():
    conn = get_db()
    archive_old_orders(conn)
    purge_archived_orders(conn)
    conn.commit()
    rows = conn.execute('''
        SELECT id, client_number, total, status, created_at, archived_at, deleted_at FROM orders
        WHERE user_id = ? AND deleted_at IS NULL
        ORDER BY created_at DESC
    ''', (session['user_id'],)).fetchall()

    result = [map_user_order(conn, o) for o in rows]

    conn.close()
    return jsonify(result)


@app.put('/api/orders/<int:order_id>/items/<int:item_id>')
@require_auth
def user_update_order_item(order_id, item_id):
    data = request.get_json(silent=True) or {}
    try:
        quantity = int(data.get('quantity', 0))
    except (TypeError, ValueError):
        return jsonify({'error': 'Некорректное количество'}), 400
    if quantity < 1:
        return jsonify({'error': 'Минимальное количество — 1'}), 400

    conn = get_db()
    order = get_user_order(conn, order_id, session['user_id'])
    if not order:
        conn.close()
        return jsonify({'error': 'Заказ не найден'}), 404
    if order['status'] != 'pending':
        conn.close()
        return jsonify({'error': 'Редактировать можно только заказ в ожидании'}), 400

    item = conn.execute('''
        SELECT id, quantity, price FROM order_items
        WHERE id = ? AND order_id = ? AND deleted_at IS NULL
    ''', (item_id, order_id)).fetchone()
    if not item:
        conn.close()
        return jsonify({'error': 'Позиция не найдена'}), 404

    conn.execute('UPDATE order_items SET quantity = ? WHERE id = ?', (quantity, item_id))
    new_total = recalculate_order_total(conn, order_id)
    conn.commit()
    conn.close()
    return jsonify({'ok': True, 'total': new_total})


@app.delete('/api/orders/<int:order_id>/items/<int:item_id>')
@require_auth
def user_delete_order_item(order_id, item_id):
    conn = get_db()
    order = get_user_order(conn, order_id, session['user_id'])
    if not order:
        conn.close()
        return jsonify({'error': 'Заказ не найден'}), 404
    if order['status'] != 'pending':
        conn.close()
        return jsonify({'error': 'Изменять можно только заказ в ожидании'}), 400

    item = conn.execute('''
        SELECT id, quantity, price FROM order_items
        WHERE id = ? AND order_id = ? AND deleted_at IS NULL
    ''', (item_id, order_id)).fetchone()
    if not item:
        conn.close()
        return jsonify({'error': 'Позиция не найдена'}), 404

    soft_delete(conn, 'order_items', item_id)

    remaining = conn.execute('''
        SELECT COUNT(*) AS cnt FROM order_items
        WHERE order_id = ? AND deleted_at IS NULL
    ''', (order_id,)).fetchone()['cnt']

    if remaining == 0:
        soft_delete(conn, 'orders', order_id)
        new_total = 0
    else:
        new_total = recalculate_order_total(conn, order_id)

    conn.commit()
    conn.close()
    return jsonify({
        'ok': True,
        'total': new_total,
        'order_cancelled': remaining == 0,
    })


@app.delete('/api/orders/<int:order_id>')
@require_auth
def user_cancel_order(order_id):
    conn = get_db()
    order = get_user_order(conn, order_id, session['user_id'])
    if not order:
        conn.close()
        return jsonify({'error': 'Заказ не найден'}), 404
    if order['status'] != 'pending':
        conn.close()
        return jsonify({'error': 'Отменить можно только заказ в ожидании'}), 400

    for item in conn.execute(
        'SELECT id FROM order_items WHERE order_id = ? AND deleted_at IS NULL',
        (order_id,),
    ).fetchall():
        soft_delete(conn, 'order_items', item['id'])
    soft_delete(conn, 'orders', order_id)

    conn.commit()
    conn.close()
    return jsonify({'ok': True})


# --- Admin products ---

@app.get('/api/admin/products')
@require_admin
def admin_list_products():
    product_filter = request.args.get('filter', 'all')
    conn = get_db()
    sql = f'''
        SELECT {PRODUCT_SELECT}, deleted_at
        FROM products WHERE 1=1
    '''
    if product_filter == 'deleted':
        sql += ' AND deleted_at IS NOT NULL'
    elif product_filter == 'new':
        sql += " AND deleted_at IS NULL AND datetime(created_at) >= datetime('now', '-14 days')"
    elif product_filter == 'out_of_stock':
        sql += ' AND deleted_at IS NULL AND COALESCE(in_stock, 1) = 0'
    else:
        sql += ' AND deleted_at IS NULL'
    sql += ' ORDER BY sort_order ASC, id ASC'
    rows = conn.execute(sql).fetchall()
    result = []
    for r in rows:
        d = map_product(conn, r)
        d['deleted'] = bool(r['deleted_at'])
        result.append(d)
    conn.close()
    return jsonify(result)


def _export_price_value(value):
    if value is None or value == '':
        return ''
    return f'{float(value):.2f}'.replace('.', ',')


def _export_pack_price(product):
    if product.get('is_on_sale') and product.get('sale_price_pack') is not None:
        return _export_price_value(product.get('sale_price_pack'))
    return _export_price_value(product.get('price_pack'))


def _export_piece_price(product):
    if not product.get('allow_piece_sale'):
        return ''
    if product.get('is_on_sale') and product.get('sale_price_piece') is not None:
        return _export_price_value(product.get('sale_price_piece'))
    return _export_price_value(product.get('price_piece'))


def _product_visible_category_ids(product, featured_id):
    return [
        cat_id for cat_id in (product.get('category_ids') or [])
        if featured_id is None or cat_id != featured_id
    ]


def _sort_products_in_category(products, category_id):
    cat_key = str(category_id)

    def sort_key(product):
        orders = product.get('category_sort_orders') or {}
        return (
            orders.get(cat_key, product.get('sort_order') or 0),
            product.get('id') or 0,
        )

    return sorted(products, key=sort_key)


def _get_price_list_sections(conn, category_id='all'):
    featured_id = get_featured_home_category_id(conn)
    categories = [
        row_to_dict(row) for row in conn.execute('''
            SELECT id, name, sort_order
            FROM categories
            WHERE deleted_at IS NULL AND COALESCE(is_featured_home, 0) = 0
            ORDER BY sort_order ASC, id ASC
        ''').fetchall()
    ]
    rows = conn.execute(
        f'''
        SELECT {PRODUCT_SELECT}, deleted_at
        FROM products
        WHERE deleted_at IS NULL
        ORDER BY sort_order ASC, id ASC
        '''
    ).fetchall()
    products = [map_product(conn, row) for row in rows]

    if category_id == 'none':
        uncategorized = [
            product for product in products
            if not _product_visible_category_ids(product, featured_id)
        ]
        if not uncategorized:
            return []
        return [{
            'name': 'Без категории',
            'products': _sort_products_in_category(uncategorized, '0'),
        }]

    if category_id and category_id != 'all':
        try:
            cat_id = int(category_id)
        except (TypeError, ValueError):
            cat_id = None
        if not cat_id or cat_id == featured_id:
            return []
        category = next((cat for cat in categories if cat['id'] == cat_id), None)
        if not category:
            return []
        in_category = [
            product for product in products
            if cat_id in _product_visible_category_ids(product, featured_id)
        ]
        if not in_category:
            return []
        return [{
            'name': category['name'],
            'products': _sort_products_in_category(in_category, cat_id),
        }]

    sections = []
    used = set()
    for category in categories:
        cat_id = category['id']
        in_category = [
            product for product in products
            if cat_id in _product_visible_category_ids(product, featured_id)
            and product['id'] not in used
        ]
        in_category = _sort_products_in_category(in_category, cat_id)
        if not in_category:
            continue
        for product in in_category:
            used.add(product['id'])
        sections.append({
            'name': category['name'],
            'products': in_category,
        })
    return sections


def _build_price_list_doc(sections):
    price_list_date = datetime.now().strftime('%d.%m.%Y')
    table_head = (
        '<table class="price-table" cellspacing="0" cellpadding="0">'
        '<colgroup>'
        '<col class="col-num">'
        '<col class="col-name">'
        '<col class="col-price">'
        '<col class="col-price">'
        '</colgroup>'
        '<tr>'
        '<th width="28">№</th>'
        '<th>Товар</th>'
        '<th width="38">за шт.</th>'
        '<th width="38">за уп.</th>'
        '</tr>'
    )
    parts = [
        '<!DOCTYPE html>',
        '<html xmlns:o="urn:schemas-microsoft-com:office:office" '
        'xmlns:w="urn:schemas-microsoft-com:office:word">',
        '<head><meta charset="utf-8">',
        '<style>',
        '@page { size: A4; margin: 14mm 12mm; }',
        'body { font-family: Calibri, Arial, sans-serif; font-size: 8pt; line-height: 1.2; margin: 0; }',
        'h1 { font-size: 11pt; margin: 0 0 4pt; font-weight: bold; }',
        '.price-list-date { font-size: 8pt; color: #444; margin: 0 0 8pt; }',
        'h2 { font-size: 9pt; margin: 4pt 0 2pt; font-weight: bold; }',
        'h2:first-of-type { margin-top: 6pt; }',
        '.price-table-wrap { width: 88%; max-width: 15.5cm; margin: 0 auto 2pt; }',
        'table.price-table { border-collapse: collapse; table-layout: fixed; width: 100%; font-size: 8pt; }',
        'table.price-table col.col-num { width: 28pt; }',
        'table.price-table col.col-name { width: auto; }',
        'table.price-table col.col-price { width: 38pt; }',
        'table.price-table th, table.price-table td { border: 0.5pt solid #666; padding: 2pt 4pt; vertical-align: top; }',
        'table.price-table th { background: #f2f2f2; font-weight: bold; text-align: center; font-size: 7.5pt; }',
        'table.price-table td.num { text-align: center; font-size: 8pt; }',
        'table.price-table td.name { word-wrap: break-word; font-size: 8.5pt; }',
        'table.price-table td.price { text-align: right; white-space: nowrap; font-size: 8pt; }',
        '</style>',
        '</head><body>',
        '<h1>Прайс-лист</h1>',
        f'<p class="price-list-date">от {price_list_date}</p>',
    ]

    if not sections:
        parts.append('<p>Нет товаров для выгрузки.</p>')
    else:
        global_index = 0
        for section in sections:
            parts.append(f'<h2>{escape(section["name"])}</h2>')
            parts.append('<div class="price-table-wrap">')
            parts.append(table_head)
            for product in section['products']:
                global_index += 1
                piece_price = _export_piece_price(product) or '—'
                pack_price = _export_pack_price(product) or '—'
                parts.append(
                    '<tr>'
                    f'<td class="num">{global_index}</td>'
                    f'<td class="name">{escape(product.get("name") or "")}</td>'
                    f'<td class="price">{piece_price}</td>'
                    f'<td class="price">{pack_price}</td>'
                    '</tr>'
                )
            parts.append('</table></div>')

    parts.append('</body></html>')
    return '\n'.join(parts)


@app.get('/api/admin/products/export')
@require_admin
def admin_export_products():
    category_id = request.args.get('category_id', 'all') or 'all'
    conn = get_db()
    sections = _get_price_list_sections(conn, category_id)

    if category_id == 'none':
        filename = 'price-list-bez-kategorii.doc'
    elif category_id and category_id != 'all':
        category = conn.execute(
            'SELECT name, COALESCE(is_featured_home, 0) AS is_featured_home FROM categories WHERE id = ?',
            (int(category_id),),
        ).fetchone()
        if category and category['is_featured_home']:
            filename = 'price-list.doc'
        else:
            slug = secure_filename(category['name'] if category else 'category') or 'category'
            filename = f'price-list-{slug}.doc'
    else:
        filename = 'price-list-all.doc'
    conn.close()

    doc_data = _build_price_list_doc(sections)
    disposition = (
        f"attachment; filename=price-list.doc; filename*=UTF-8''{quote(filename)}"
    )
    return Response(
        doc_data,
        mimetype='application/msword; charset=utf-8',
        headers={'Content-Disposition': disposition},
    )


@app.post('/api/admin/products')
@require_admin
def admin_create_product():
    name = request.form.get('name')
    price_pack = request.form.get('price_pack') or request.form.get('cost')
    if not name or price_pack is None:
        return jsonify({'error': 'Название и цена за упаковку обязательны'}), 400

    category_ids = parse_category_ids_from_form()
    if not category_ids:
        return jsonify({'error': 'Выберите хотя бы одну категорию'}), 400

    allow_piece = 1 if request.form.get('allow_piece_sale') in ('1', 'true', 'on') else 0
    is_on_sale = 1 if request.form.get('is_on_sale') in ('1', 'true', 'on') else 0
    is_bestseller = 1 if request.form.get('is_bestseller') in ('1', 'true', 'on') else 0
    in_stock = 0 if request.form.get('out_of_stock') in ('1', 'true', 'on') else 1

    conn = get_db()
    next_sort = conn.execute(
        'SELECT COALESCE(MAX(sort_order), 0) FROM products WHERE deleted_at IS NULL'
    ).fetchone()[0] + 1
    cur = conn.execute('''
        INSERT INTO products (
            name, cost, pieces_per_box, weight, description, created_at,
            category_id, price_piece, price_pack, allow_piece_sale,
            is_on_sale, sale_price_pack, sale_price_piece, is_bestseller, sort_order, in_stock
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ''', (
        name,
        float(price_pack),
        int(request.form.get('pieces_per_box') or request.form.get('pieces_per_pack') or 1),
        float(request.form.get('weight_grams') or request.form.get('weight') or 0),
        request.form.get('description') or '',
        now_iso(),
        primary_category_id_from_list(conn, category_ids),
        float(request.form.get('price_piece') or 0),
        float(price_pack),
        allow_piece,
        is_on_sale,
        float(request.form.get('sale_price_pack') or 0) if is_on_sale else None,
        float(request.form.get('sale_price_piece') or 0) if is_on_sale else None,
        is_bestseller,
        next_sort,
        in_stock,
    ))
    product_id = cur.lastrowid
    set_product_categories(conn, product_id, category_ids)
    save_product_images(conn, product_id, request.files.getlist('images'))
    conn.commit()

    row = conn.execute('SELECT * FROM products WHERE id = ?', (product_id,)).fetchone()
    result = map_product(conn, row)
    conn.close()
    return jsonify(result), 201


def normalize_product_reorder(conn, order):
    normalized = []
    seen = set()
    for raw_id in order:
        product_id = int(raw_id)
        if product_id in seen:
            continue
        seen.add(product_id)
        normalized.append(product_id)

    rows = conn.execute(
        'SELECT id FROM products WHERE deleted_at IS NULL ORDER BY sort_order ASC, id ASC'
    ).fetchall()
    for row in rows:
        if row['id'] not in seen:
            normalized.append(row['id'])
    return normalized


def normalize_category_product_reorder(conn, category_id, order):
    normalized = []
    seen = set()
    for raw_id in order:
        product_id = int(raw_id)
        if product_id in seen:
            continue
        in_cat = conn.execute('''
            SELECT 1
            FROM product_categories pc
            JOIN products p ON p.id = pc.product_id
            WHERE pc.category_id = ? AND pc.product_id = ? AND p.deleted_at IS NULL
        ''', (category_id, product_id)).fetchone()
        if not in_cat:
            continue
        seen.add(product_id)
        normalized.append(product_id)

    rows = conn.execute('''
        SELECT pc.product_id AS id
        FROM product_categories pc
        JOIN products p ON p.id = pc.product_id
        WHERE pc.category_id = ? AND p.deleted_at IS NULL
        ORDER BY pc.sort_order ASC, pc.product_id ASC
    ''', (category_id,)).fetchall()
    for row in rows:
        if row['id'] not in seen:
            normalized.append(row['id'])
    return normalized


@app.put('/api/admin/products/reorder')
@require_admin
def admin_reorder_products():
    data = request.get_json(silent=True) or {}
    order = data.get('order')
    if not isinstance(order, list) or not order:
        return jsonify({'error': 'Укажите порядок товаров'}), 400

    category_id = data.get('category_id')
    conn = get_db()
    try:
        if category_id is not None and category_id != '':
            category_id = int(category_id)
            category = conn.execute(
                'SELECT id FROM categories WHERE id = ? AND deleted_at IS NULL',
                (category_id,),
            ).fetchone()
            if not category:
                raise ValueError('Категория не найдена')
            normalized = normalize_category_product_reorder(conn, category_id, order)
            for idx, product_id in enumerate(normalized):
                updated = conn.execute(
                    '''UPDATE product_categories SET sort_order = ?
                       WHERE product_id = ? AND category_id = ?''',
                    (idx + 1, product_id, category_id),
                ).rowcount
                if not updated:
                    raise ValueError(f'Товар #{product_id} не найден в категории')
        else:
            normalized = normalize_product_reorder(conn, order)
            for idx, product_id in enumerate(normalized):
                updated = conn.execute(
                    'UPDATE products SET sort_order = ? WHERE id = ? AND deleted_at IS NULL',
                    (idx + 1, product_id),
                ).rowcount
                if not updated:
                    raise ValueError(f'Товар #{product_id} не найден')
        conn.commit()
    except ValueError as exc:
        conn.rollback()
        conn.close()
        return jsonify({'error': str(exc)}), 400
    conn.close()
    return jsonify({'ok': True})


@app.put('/api/admin/products/<int:product_id>')
@require_admin
def admin_update_product(product_id):
    data = request.get_json(silent=True) or {}
    name = (data.get('name') or '').strip()
    price_pack = data.get('price_pack')
    if not name or price_pack is None:
        return jsonify({'error': 'Название и цена за упаковку обязательны'}), 400

    conn = get_db()
    existing = conn.execute('SELECT id FROM products WHERE id = ?', (product_id,)).fetchone()
    if not existing:
        conn.close()
        return jsonify({'error': 'Товар не найден'}), 404

    category_ids = parse_category_ids_from_data(data)
    if not category_ids:
        conn.close()
        return jsonify({'error': 'Выберите хотя бы одну категорию'}), 400

    is_on_sale = 1 if data.get('is_on_sale') else 0
    is_bestseller = 1 if data.get('is_bestseller') else 0
    in_stock = 1 if data.get('in_stock', True) else 0
    conn.execute('''
        UPDATE products SET
            name = ?, cost = ?, pieces_per_box = ?, weight = ?, description = ?,
            category_id = ?, price_piece = ?, price_pack = ?, allow_piece_sale = ?,
            is_on_sale = ?, sale_price_pack = ?, sale_price_piece = ?, is_bestseller = ?,
            in_stock = ?
        WHERE id = ?
    ''', (
        name,
        float(price_pack),
        int(data.get('pieces_per_pack') or data.get('pieces_per_box') or 1),
        float(data.get('weight_grams') or data.get('weight') or 0),
        data.get('description') or '',
        primary_category_id_from_list(conn, category_ids),
        float(data.get('price_piece') or 0),
        float(price_pack),
        1 if data.get('allow_piece_sale') else 0,
        is_on_sale,
        float(data.get('sale_price_pack') or 0) if is_on_sale else None,
        float(data.get('sale_price_piece') or 0) if is_on_sale else None,
        is_bestseller,
        in_stock,
        product_id,
    ))
    set_product_categories(conn, product_id, category_ids)
    conn.commit()

    row = conn.execute('SELECT * FROM products WHERE id = ?', (product_id,)).fetchone()
    result = map_product(conn, row)
    conn.close()
    return jsonify(result)


@app.post('/api/admin/products/<int:product_id>/images')
@require_admin
def admin_add_product_images(product_id):
    conn = get_db()
    existing = conn.execute('SELECT id FROM products WHERE id = ?', (product_id,)).fetchone()
    if not existing:
        conn.close()
        return jsonify({'error': 'Товар не найден'}), 404

    save_product_images(conn, product_id, request.files.getlist('images'))
    conn.commit()
    conn.close()
    return jsonify({'ok': True})


@app.delete('/api/admin/products/<int:product_id>')
@require_admin
def admin_delete_product(product_id):
    conn = get_db()
    soft_delete(conn, 'products', product_id)
    conn.execute(
        'UPDATE product_images SET deleted_at = ? WHERE product_id = ? AND deleted_at IS NULL',
        (now_iso(), product_id)
    )
    conn.commit()
    conn.close()
    return jsonify({'ok': True})


@app.post('/api/admin/products/<int:product_id>/restore')
@require_admin
def admin_restore_product(product_id):
    conn = get_db()
    conn.execute('UPDATE products SET deleted_at = NULL WHERE id = ?', (product_id,))
    conn.commit()
    conn.close()
    return jsonify({'ok': True})


@app.delete('/api/admin/images/<int:image_id>')
@require_admin
def admin_delete_image(image_id):
    conn = get_db()
    soft_delete(conn, 'product_images', image_id)
    conn.commit()
    conn.close()
    return jsonify({'ok': True})


# --- Admin users ---

@app.get('/api/admin/users')
@require_admin
def admin_list_users():
    user_filter = request.args.get('filter', 'all')
    conn = get_db()
    purge_deleted_users(conn)
    conn.commit()
    sql = '''
        SELECT id, name, address, login, is_admin, deleted_at
        FROM users
        WHERE is_admin = 0
    '''
    if user_filter == 'deleted':
        sql += ' AND deleted_at IS NOT NULL'
    else:
        sql += ' AND deleted_at IS NULL'
    sql += ' ORDER BY id DESC'
    rows = conn.execute(sql).fetchall()
    conn.close()
    return jsonify([
        {**row_to_dict(r), 'deleted': bool(r['deleted_at'])}
        for r in rows
    ])


@app.post('/api/admin/users')
@require_admin
def admin_create_user():
    data = request.get_json(silent=True) or {}
    name = (data.get('name') or '').strip()
    login = (data.get('login') or '').strip()
    password = data.get('password') or ''
    if not name or not login or not password:
        return jsonify({'error': 'Имя, логин и пароль обязательны'}), 400

    conn = get_db()
    existing = conn.execute(
        'SELECT id, deleted_at FROM users WHERE login = ?', (login,)
    ).fetchone()

    if existing and not existing['deleted_at']:
        conn.close()
        return jsonify({'error': 'Логин уже занят'}), 400

    try:
        password_hash = hash_password(password)
        address = data.get('address') or ''

        if existing and existing['deleted_at']:
            conn.execute('''
                UPDATE users SET
                    name = ?, address = ?, password_hash = ?,
                    is_admin = 0, deleted_at = NULL
                WHERE id = ?
            ''', (name, address, password_hash, existing['id']))
            user_id = existing['id']
        else:
            cur = conn.execute('''
                INSERT INTO users (name, address, login, password_hash, wallet_balance, is_admin)
                VALUES (?, ?, ?, ?, 0, 0)
            ''', (name, address, login, password_hash))
            user_id = cur.lastrowid

        conn.commit()
        conn.close()
        return jsonify({'id': user_id}), 201
    except sqlite3.IntegrityError:
        conn.close()
        return jsonify({'error': 'Логин уже занят'}), 400


@app.delete('/api/admin/users/<int:user_id>')
@require_admin
def admin_delete_user(user_id):
    conn = get_db()
    user = conn.execute('SELECT is_admin FROM users WHERE id = ?', (user_id,)).fetchone()
    if user and user['is_admin']:
        conn.close()
        return jsonify({'error': 'Нельзя удалить администратора'}), 400
    soft_delete(conn, 'users', user_id)
    conn.commit()
    conn.close()
    return jsonify({'ok': True})


@app.put('/api/admin/users/<int:user_id>')
@require_admin
def admin_update_user(user_id):
    data = request.get_json(silent=True) or {}
    name = (data.get('name') or '').strip()
    login = (data.get('login') or '').strip()
    address = (data.get('address') or '').strip()
    password = data.get('password') or ''

    if not name or not login:
        return jsonify({'error': 'Имя и логин обязательны'}), 400

    conn = get_db()
    user = conn.execute(
        'SELECT id, is_admin, deleted_at FROM users WHERE id = ?', (user_id,)
    ).fetchone()
    if not user or user['is_admin']:
        conn.close()
        return jsonify({'error': 'Клиент не найден'}), 404

    duplicate = conn.execute(
        'SELECT id FROM users WHERE login = ? AND id != ? AND deleted_at IS NULL',
        (login, user_id),
    ).fetchone()
    if duplicate:
        conn.close()
        return jsonify({'error': 'Логин уже занят'}), 400

    try:
        if password:
            conn.execute('''
                UPDATE users SET name = ?, login = ?, address = ?, password_hash = ?
                WHERE id = ?
            ''', (name, login, address, hash_password(password), user_id))
        else:
            conn.execute('''
                UPDATE users SET name = ?, login = ?, address = ?
                WHERE id = ?
            ''', (name, login, address, user_id))
        conn.commit()
        conn.close()
        return jsonify({'ok': True})
    except sqlite3.IntegrityError:
        conn.close()
        return jsonify({'error': 'Логин уже занят'}), 400


@app.post('/api/admin/users/<int:user_id>/restore')
@require_admin
def admin_restore_user(user_id):
    conn = get_db()
    user = conn.execute(
        'SELECT id, is_admin, deleted_at FROM users WHERE id = ?', (user_id,)
    ).fetchone()
    if not user or user['is_admin'] or not user['deleted_at']:
        conn.close()
        return jsonify({'error': 'Клиент не найден'}), 404

    duplicate = conn.execute('''
        SELECT id FROM users
        WHERE login = (SELECT login FROM users WHERE id = ?)
          AND id != ?
          AND deleted_at IS NULL
    ''', (user_id, user_id)).fetchone()
    if duplicate:
        conn.close()
        return jsonify({'error': 'Логин уже занят другим клиентом'}), 400

    conn.execute('UPDATE users SET deleted_at = NULL WHERE id = ?', (user_id,))
    conn.commit()
    conn.close()
    return jsonify({'ok': True})


# --- Admin orders ---

@app.get('/api/admin/orders/pending-summary')
@require_admin
def admin_pending_orders_summary():
    conn = get_db()
    rows = conn.execute('''
        SELECT o.id, o.client_number, o.total, o.created_at, u.name AS user_name
        FROM orders o
        JOIN users u ON u.id = o.user_id
        WHERE o.deleted_at IS NULL
          AND o.archived_at IS NULL
          AND o.status = 'pending'
        ORDER BY o.created_at DESC
    ''').fetchall()
    conn.close()
    orders = [{
        'id': r['id'],
        'number': r['client_number'] if r['client_number'] is not None else r['id'],
        'user_name': r['user_name'],
        'total': r['total'],
        'created_at': r['created_at'],
    } for r in rows]
    return jsonify({'count': len(orders), 'orders': orders})


@app.get('/api/admin/orders')
@require_admin
def admin_list_orders():
    order_filter = request.args.get('filter', 'all')
    conn = get_db()
    archive_old_orders(conn)
    purge_archived_orders(conn)
    conn.commit()
    sql = '''
        SELECT o.id, o.client_number, o.total, o.status, o.created_at, o.deleted_at, o.archived_at,
               u.name as user_name, u.login as user_login
        FROM orders o
        JOIN users u ON u.id = o.user_id
        WHERE 1=1
    '''
    if order_filter == 'deleted':
        sql += ' AND o.deleted_at IS NOT NULL'
    elif order_filter == 'archived':
        sql += ' AND o.deleted_at IS NULL AND o.archived_at IS NOT NULL'
    elif order_filter == 'pending':
        sql += " AND o.deleted_at IS NULL AND o.archived_at IS NULL AND o.status = 'pending'"
    elif order_filter == 'accepted':
        sql += " AND o.deleted_at IS NULL AND o.archived_at IS NULL AND o.status = 'accepted'"
    elif order_filter == 'completed':
        sql += " AND o.deleted_at IS NULL AND o.archived_at IS NULL AND o.status = 'completed'"
    else:
        sql += ' AND o.deleted_at IS NULL AND o.archived_at IS NULL'
    sql += ' ORDER BY o.created_at DESC'
    rows = conn.execute(sql).fetchall()

    result = []
    for o in rows:
        items = conn.execute('''
            SELECT oi.id, oi.quantity, oi.price, oi.unit_type, oi.deleted_at, p.name as product_name
            FROM order_items oi
            JOIN products p ON p.id = oi.product_id
            WHERE oi.order_id = ?
        ''', (o['id'],)).fetchall()
        d = row_to_dict(o)
        d['number'] = o['client_number'] if o['client_number'] is not None else o['id']
        d['deleted'] = bool(o['deleted_at'])
        d['archived'] = bool(o['archived_at'])
        d['status_label'] = map_order_status(o['status'])
        d['items'] = [row_to_dict(i) for i in items]
        result.append(d)

    conn.close()
    return jsonify(result)


@app.put('/api/admin/orders/<int:order_id>/status')
@require_admin
def admin_update_order_status(order_id):
    data = request.get_json(silent=True) or {}
    status = data.get('status')
    if status not in ORDER_STATUSES:
        return jsonify({'error': 'Некорректный статус'}), 400

    conn = get_db()
    order = conn.execute(
        'SELECT id FROM orders WHERE id = ? AND deleted_at IS NULL', (order_id,)
    ).fetchone()
    if not order:
        conn.close()
        return jsonify({'error': 'Заказ не найден'}), 404

    conn.execute('UPDATE orders SET status = ? WHERE id = ?', (status, order_id))
    conn.commit()
    conn.close()
    return jsonify({'ok': True, 'status': status, 'status_label': map_order_status(status)})


@app.delete('/api/admin/orders/<int:order_id>')
@require_admin
def admin_delete_order(order_id):
    conn = get_db()
    soft_delete(conn, 'orders', order_id)
    conn.execute(
        'UPDATE order_items SET deleted_at = ? WHERE order_id = ? AND deleted_at IS NULL',
        (now_iso(), order_id)
    )
    conn.commit()
    conn.close()
    return jsonify({'ok': True})


@app.post('/api/admin/orders/<int:order_id>/restore')
@require_admin
def admin_restore_order(order_id):
    conn = get_db()
    order = conn.execute(
        'SELECT id FROM orders WHERE id = ? AND deleted_at IS NOT NULL', (order_id,)
    ).fetchone()
    if not order:
        conn.close()
        return jsonify({'error': 'Заказ не найден'}), 404

    conn.execute('UPDATE orders SET deleted_at = NULL WHERE id = ?', (order_id,))
    conn.execute(
        'UPDATE order_items SET deleted_at = NULL WHERE order_id = ?',
        (order_id,),
    )
    conn.commit()
    conn.close()
    return jsonify({'ok': True})


# --- Site content ---

def get_home_content(conn):
    return {
        'title': get_setting(conn, 'home_title', DEFAULT_HOME_TITLE),
        'subtitle': get_setting(conn, 'home_subtitle', DEFAULT_HOME_SUBTITLE),
    }


@app.get('/api/site/home')
def site_home():
    conn = get_db()
    content = get_home_content(conn)
    conn.close()
    return jsonify(content)


@app.get('/api/admin/site/home')
@require_admin
def admin_get_home():
    conn = get_db()
    content = get_home_content(conn)
    conn.close()
    return jsonify(content)


@app.put('/api/admin/site/home')
@require_admin
def admin_update_home():
    data = request.get_json(silent=True) or {}
    title = (data.get('title') or '').strip()
    subtitle = (data.get('subtitle') or '').strip()
    if not title:
        return jsonify({'error': 'Заголовок не может быть пустым'}), 400
    if not subtitle:
        return jsonify({'error': 'Подзаголовок не может быть пустым'}), 400
    conn = get_db()
    set_setting(conn, 'home_title', title)
    set_setting(conn, 'home_subtitle', subtitle)
    conn.commit()
    conn.close()
    return jsonify({'ok': True})


@app.get('/api/site/about')
def site_about():
    conn = get_db()
    content = get_setting(conn, 'about_content', DEFAULT_ABOUT)
    conn.close()
    return jsonify({'content': content})


@app.get('/api/admin/site/about')
@require_admin
def admin_get_about():
    conn = get_db()
    content = get_setting(conn, 'about_content', DEFAULT_ABOUT)
    conn.close()
    return jsonify({'content': content})


@app.put('/api/admin/site/about')
@require_admin
def admin_update_about():
    data = request.get_json(silent=True) or {}
    content = (data.get('content') or '').strip()
    if not content:
        return jsonify({'error': 'Текст не может быть пустым'}), 400
    conn = get_db()
    set_setting(conn, 'about_content', content)
    conn.commit()
    conn.close()
    return jsonify({'ok': True})


@app.get('/api/admin/users/<int:user_id>')
@require_admin
def admin_get_user(user_id):
    conn = get_db()
    user = conn.execute('''
        SELECT id, name, address, login, is_admin, deleted_at
        FROM users WHERE id = ?
    ''', (user_id,)).fetchone()
    conn.close()
    if not user:
        return jsonify({'error': 'Клиент не найден'}), 404
    if user['is_admin']:
        return jsonify({'error': 'Это администратор'}), 400
    return jsonify({**row_to_dict(user), 'deleted': bool(user['deleted_at'])})


@app.get('/api/admin/users/<int:user_id>/orders')
@require_admin
def admin_user_orders(user_id):
    conn = get_db()
    user = conn.execute(
        'SELECT id, name, login, is_admin FROM users WHERE id = ?', (user_id,)
    ).fetchone()
    if not user:
        conn.close()
        return jsonify({'error': 'Клиент не найден'}), 404
    if user['is_admin']:
        conn.close()
        return jsonify({'error': 'Это администратор'}), 400

    archive_old_orders(conn)
    conn.commit()
    rows = conn.execute('''
        SELECT id, client_number, total, status, created_at, archived_at, deleted_at
        FROM orders
        WHERE user_id = ?
        ORDER BY created_at DESC
    ''', (user_id,)).fetchall()
    orders = [map_user_order(conn, o) for o in rows]
    conn.close()
    return jsonify(orders)


if __name__ == '__main__':
    print('Мороженое Избербаш: http://localhost:3000')
    app.run(host='0.0.0.0', port=3000, debug=True)

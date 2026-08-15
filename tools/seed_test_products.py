"""Добавить тестовые товары без фото (для проверки длинного списка в админке)."""
import sqlite3
from datetime import datetime, timezone
from pathlib import Path

DB_PATH = Path(__file__).resolve().parents[1] / 'db' / 'shop.db'

TEST_PRODUCTS = [
    ('Пломбир «Классика» 15%', 'Классический сливочный пломбир в брикете. Хит для кафе и киосков.', 320, 12, 80, 28, 1),
    ('Эскимо «Шоколадное»', 'Молочное мороженое в хрустящей глазури. Удобно для витрины.', 95, 24, 70, 95, 2),
    ('Рожок «Ванильный»', 'Ванильное мороженое в вафельном рожке. Популярно у детей.', 85, 20, 75, 85, 3),
    ('Стаканчик «Фисташка»', 'Нежный вкус фисташки в бумажном стаканчике.', 110, 16, 90, 110, 4),
    ('Брикет «Сливочный»', 'Густое сливочное мороженое, 10 штук в упаковке.', 280, 10, 85, 280, 1),
    ('Мороженое «Крем-брюле»', 'С карамельной крошкой и ноткой ванили.', 125, 18, 80, 125, 6),
    ('Эскимо «Клубничное»', 'Ягодное мороженое в шоколадной глазури.', 98, 24, 70, 98, 2),
    ('Рожок «Лимонный»', 'Освежающий лимонный вкус, идеален летом.', 80, 20, 75, 80, 3),
    ('Стаканчик «Карамель»', 'Солёная карамель и сливки.', 115, 16, 90, 115, 7),
    ('Пломбир «Сгущёнка»', 'Со вкусом варёной сгущёнки — бestseller точки.', 340, 12, 80, 34, 1),
    ('Мороженое «Манго-маракуйя»', 'Тропический микс, яркий цвет и аромат.', 130, 18, 85, 130, 9),
    ('Эскимо «Фундук»', 'Ореховая начинка и молочная глазурь.', 102, 24, 70, 102, 10),
    ('Рожок «Шоколад-орех»', 'Шоколадное мороженое с дроблёным фундуком.', 90, 20, 75, 90, 11),
    ('Стаканчик «Вишня»', 'Натуральная вишня в сливочной основе.', 112, 16, 90, 112, 12),
    ('Брикет «Творожный»', 'Лёгкий творожный вкус, низкая жирность.', 260, 10, 85, 26, 13),
]


def now_iso():
    return datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')


def main():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row

    existing = {
        row['name'] for row in conn.execute(
            "SELECT name FROM products WHERE deleted_at IS NULL"
        ).fetchall()
    }

    next_sort = conn.execute(
        'SELECT COALESCE(MAX(sort_order), 0) FROM products WHERE deleted_at IS NULL'
    ).fetchone()[0]

    added = 0
    for name, description, price_pack, pieces, weight, price_piece, category_id in TEST_PRODUCTS:
        if name in existing:
            continue

        next_sort += 1
        cur = conn.execute(
            '''
            INSERT INTO products (
                name, cost, pieces_per_box, weight, description, created_at,
                category_id, price_piece, price_pack, allow_piece_sale,
                is_on_sale, sale_price_pack, sale_price_piece, is_bestseller,
                sort_order, in_stock
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, NULL, NULL, 0, ?, 1)
            ''',
            (
                name,
                float(price_pack),
                int(pieces),
                float(weight),
                description,
                now_iso(),
                category_id,
                float(price_piece),
                float(price_pack),
                1,
                next_sort,
            ),
        )
        product_id = cur.lastrowid
        conn.execute(
            'INSERT OR IGNORE INTO product_categories (product_id, category_id) VALUES (?, ?)',
            (product_id, category_id),
        )
        added += 1

    conn.commit()
    total = conn.execute(
        'SELECT COUNT(*) AS c FROM products WHERE deleted_at IS NULL'
    ).fetchone()['c']
    conn.close()
    print(f'Добавлено товаров: {added}')
    print(f'Всего активных товаров: {total}')


if __name__ == '__main__':
    main()

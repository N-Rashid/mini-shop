"""Fill product descriptions for local layout testing."""
import sqlite3
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DB_PATH = ROOT / 'db' / 'shop.db'

DESCRIPTIONS = {
    'default': (
        'Натуральное мороженое с насыщенным вкусом и нежной текстурой. '
        'Подходит для дома, кафе и детских мероприятий. Хранить при −18 °C.'
    ),
    'long': (
        'Классический рецепт с молоком и сливками высшего сорта. '
        'Без искусственных красителей — только натуральные ингредиенты и яркий вкус, '
        'который нравится и детям, и взрослым. Идеально для семейного ужина, '
        'праздничного стола или перекуса в жаркий день. '
        'Рекомендуем подавать в вафельном рожке или с фруктовым топпингом. '
        'Срок годности указан на упаковке. Хранить только в морозильной камере.'
    ),
    'short': 'Сливочное мороженое. Натуральный состав.',
    'medium': (
        'Пломбир высшей категории с бархатистой текстурой. '
        'Отлично держит форму при подаче и подходит для кафе.'
    ),
}


def pick_description(product_id: int, name: str, current: str) -> str:
    if current and len(current.strip()) >= 120:
        return current.strip()

    name_lower = name.lower()
    if product_id % 5 == 0:
        return DESCRIPTIONS['long']
    if 'акци' in name_lower or product_id % 3 == 0:
        return DESCRIPTIONS['medium']
    if product_id % 2 == 0:
        return DESCRIPTIONS['default']
    return DESCRIPTIONS['short']


def main():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    rows = conn.execute(
        'SELECT id, name, description FROM products WHERE deleted_at IS NULL ORDER BY id'
    ).fetchall()

    updated = 0
    for row in rows:
        desc = pick_description(row['id'], row['name'], row['description'] or '')
        conn.execute(
            'UPDATE products SET description = ? WHERE id = ?',
            (desc, row['id']),
        )
        updated += 1

    conn.commit()
    conn.close()
    print(f'Updated descriptions for {updated} products.')


if __name__ == '__main__':
    main()

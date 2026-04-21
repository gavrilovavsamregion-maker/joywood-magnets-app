"""Пакетный AI-анализ фото для всех опубликованных collection_items без ai_photo_analysis.
Запуск: /root/joywood-gallery/venv/bin/python3 -m app.jobs.batch_ai_focal
"""
import asyncio
import asyncpg
import json
import os
import sys
import time

sys.path.insert(0, '/root/joywood-gallery')
os.environ.setdefault('DATABASE_URL', open('/root/joywood-gallery/.env').read()
    .split('DATABASE_URL=')[1].split('\n')[0].strip())

from app.services.ai_moderator import ai_focal_for_item

CONCURRENCY = 5

async def run():
    db_url = os.environ['DATABASE_URL']
    conn = await asyncpg.connect(db_url)

    rows = await conn.fetch("""
        SELECT ci.id, ci.cover_url, r.product_name, r.review_text, r.photos
        FROM gallery.collection_items ci
        JOIN gallery.reviews r ON r.id = ci.review_id
        WHERE ci.is_published = true
          AND (ci.ai_photo_analysis IS NULL OR ci.ai_photo_analysis = '[]'::jsonb)
        ORDER BY ci.id
    """)

    print(f"\u041dайдено {len(rows)} карточек без AI-анализа")
    if not rows:
        await conn.close()
        return

    sem = asyncio.Semaphore(CONCURRENCY)
    ok = 0
    fail = 0

    async def process(row):
        nonlocal ok, fail
        async with sem:
            try:
                photos_raw = row['photos']
                if isinstance(photos_raw, str):
                    try: photos_raw = json.loads(photos_raw)
                    except: photos_raw = []
                item_data = {
                    'product_name': row['product_name'] or '',
                    'review_text': row['review_text'] or '',
                    'photos': photos_raw or [],
                }
                analysis = await ai_focal_for_item(item_data)
                await conn.execute(
                    "UPDATE gallery.collection_items SET ai_photo_analysis=$1 WHERE id=$2",
                    json.dumps(analysis), row['id']
                )
                ok += 1
                best = max(analysis, key=lambda a: a.get('quality_score', 0), default={})
                print(f"  [{ok+fail}/{len(rows)}] id={row['id']} ✓ "
                      f"photos={len(analysis)} best_score={best.get('quality_score','?')} "
                      f"type={best.get('photo_type','?')} conf={best.get('confidence','?')}")
            except Exception as e:
                fail += 1
                print(f"  [{ok+fail}/{len(rows)}] id={row['id']} ✗ {e}")
            await asyncio.sleep(0.2)  # чуть троттлинг

    await asyncio.gather(*[process(row) for row in rows])
    await conn.close()
    print(f"\nГотово: {ok} успешно, {fail} ошибок")

if __name__ == '__main__':
    asyncio.run(run())

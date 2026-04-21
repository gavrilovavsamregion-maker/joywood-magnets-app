import asyncio, asyncpg, httpx, json, os, sys
sys.path.insert(0, '/root/joywood-gallery')
from app.config import settings

AI_KEY = settings.openai_api_key
AI_URL = "https://openrouter.ai/api/v1/chat/completions"
MODEL  = "openai/gpt-4o-mini"

ASPECT_PROMPT = """
Look at this photo from a product review. Determine:
1. The best focal point of the main subject (x%, y% from top-left)
2. The best aspect ratio for a gallery card: one of "1/1", "4/5", "3/4", "16/9"
   - Use "16/9" for wide landscape items (long boards, panels, shelf interiors)
   - Use "1/1" for square compact objects
   - Use "4/5" or "3/4" for tall/portrait objects or people holding items

Respond ONLY with JSON, no markdown:
{"focal_x": 50, "focal_y": 40, "aspect_ratio": "4/5"}
"""

async def analyze_photo(client, url):
    try:
        resp = await client.post(AI_URL, json={
            "model": MODEL,
            "max_tokens": 60,
            "messages": [{
                "role": "user",
                "content": [
                    {"type": "text", "text": ASPECT_PROMPT},
                    {"type": "image_url", "image_url": {"url": url, "detail": "low"}}
                ]
            }]
        }, headers={"Authorization": f"Bearer {AI_KEY}"}, timeout=20)
        text = resp.json()["choices"][0]["message"]["content"].strip()
        # чистим JSON если markdown
        if '```' in text:
            text = text.split('```')[1].replace('json','').strip()
        data = json.loads(text)
        fx = max(0, min(100, float(data.get("focal_x", 50))))
        fy = max(0, min(100, float(data.get("focal_y", 50))))
        ar = data.get("aspect_ratio", "4/5")
        if ar not in ("1/1","4/5","3/4","16/9"): ar = "4/5"
        return fx, fy, ar
    except Exception as e:
        print(f"  AI error: {e}")
        return None, None, None

async def main():
    conn = await asyncpg.connect(settings.database_url)
    
    # Добавляем колонку
    await conn.execute("""
        ALTER TABLE gallery.collection_items 
        ADD COLUMN IF NOT EXISTS cover_aspect_ratio TEXT DEFAULT '4/5'
    """)
    print("Column cover_aspect_ratio ensured")
    
    # Берём все опубликованные с cover_url
    items = await conn.fetch("""
        SELECT id, cover_url, cover_focal_x, cover_focal_y, cover_aspect_ratio
        FROM gallery.collection_items 
        WHERE is_published = true AND cover_url != ''
        ORDER BY id
    """)
    print(f"Total items to process: {len(items)}")
    
    async with httpx.AsyncClient() as client:
        updated = 0
        for item in items:
            # Пропускаем уже обработанные
            if item['cover_aspect_ratio'] and item['cover_aspect_ratio'] != '4/5':
                print(f"  skip {item['id']} (already set: {item['cover_aspect_ratio']})")
                continue
            
            print(f"  [{updated+1}/{len(items)}] item {item['id']}: {item['cover_url'][:60]}")
            fx, fy, ar = await analyze_photo(client, item['cover_url'])
            
            if fx is not None:
                await conn.execute("""
                    UPDATE gallery.collection_items 
                    SET cover_focal_x=$1, cover_focal_y=$2, cover_aspect_ratio=$3
                    WHERE id=$4
                """, fx, fy, ar, item['id'])
                print(f"    -> focal({fx:.0f},{fy:.0f}) ar={ar}")
                updated += 1
            
            await asyncio.sleep(0.3)
    
    await conn.close()
    print(f"\nDone! Updated {updated} items")

asyncio.run(main())

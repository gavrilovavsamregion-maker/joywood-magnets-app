import asyncio, asyncpg, httpx, json, re, logging, time, sys

logging.basicConfig(level=logging.INFO, format='%(asctime)s %(message)s')
log = logging.getLogger(__name__)

DB_URL = 'postgresql://gen_user:%5E%3AZu-qm_%5ET1NXz@561e0e68c0b0b1b44e386968.twc1.net:5432/default_db?sslmode=verify-full&sslrootcert=/root/.cloud-certs/root.crt'
FOCAL_MODEL = 'google/gemini-2.5-flash'

with open('/root/joywood-gallery/.env') as f:
    env = dict(line.strip().split('=',1) for line in f if '=' in line and not line.startswith('#'))
API_KEY = env['OPENAI_API_KEY']

PROMPT = '''You are curating a gallery of handmade wooden crafts. Customer bought wood blanks and made this item. Photo is from their review.

Analyze the photo and return ONLY valid JSON (no markdown):
{
  "display_size": "small" | "normal" | "large",
  "suggested_focal_x": <0.0-1.0 horizontal center of main object>,
  "suggested_focal_y": <0.0-1.0 vertical center of main object>,
  "suggested_crop": "1/1" | "4/3" | "3/4" | "3/2" | "2/3",
  "quality_score": <0-100>
}

display_size by PHYSICAL SIZE of the craft:
  small  = jewelry, spoon, small toy, ring, small box (fits in palm)
  normal = plate, bowl, clock, frame, medium decoration
  large  = panel, icon, shelf, table, wall art, large sculpture

focal_x/y = normalized 0.0-1.0 center of the main object.
suggested_crop = best ratio to show whole object without cutting it; if unsure use "1/1".
quality_score: 90-100 clear full craft; 70-89 good; 50-69 partial/shadow; 0-49 packaging/blur.'''

async def analyze_photo(client, photo_url, product_name, review_text):
    try:
        r = await client.post(
            'https://openrouter.ai/api/v1/chat/completions',
            headers={'Authorization': f'Bearer {API_KEY}', 'Content-Type': 'application/json'},
            json={
                'model': FOCAL_MODEL,
                'messages': [{'role':'user','content':[
                    {'type':'text','text': PROMPT + f'\n\nProduct: "{product_name}". Review: "{(review_text or "")[:120]}"'},
                    {'type':'image_url','image_url':{'url': photo_url, 'detail':'high'}}
                ]}],
                'max_tokens': 120,
                'temperature': 0.1
            },
            timeout=40
        )
        if r.status_code != 200:
            log.warning(f'API {r.status_code}: {r.text[:200]}')
            return None
        content = r.json()['choices'][0]['message']['content'].strip()
        m = re.search(r'\{.*\}', content, re.DOTALL)
        if not m:
            return None
        d = json.loads(m.group())
        ds = d.get('display_size','normal')
        if ds not in ('small','normal','large'): ds = 'normal'
        return {
            'display_size': ds,
            'focal_x': max(0.0, min(1.0, float(d.get('suggested_focal_x', 0.5)))),
            'focal_y': max(0.0, min(1.0, float(d.get('suggested_focal_y', 0.5)))),
            'crop':    d.get('suggested_crop','1/1'),
            'quality_score': int(d.get('quality_score', 50))
        }
    except Exception as e:
        log.warning(f'analyze_photo error: {e}')
        return None

async def main():
    conn = await asyncpg.connect(DB_URL)
    rows = await conn.fetch('''
        SELECT ci.id, ci.cover_url, ci.display_size_manual,
               r.product_name, r.review_text, r.photos
        FROM gallery.collection_items ci
        JOIN gallery.reviews r ON r.id = ci.review_id
        WHERE ci.is_published = true
        ORDER BY ci.id
    ''')
    total = len(rows)
    log.info(f'Total items to process: {total}')

    ok = 0; skip = 0; err = 0
    async with httpx.AsyncClient(timeout=45) as client:
        for i, row in enumerate(rows):
            item_id = row['id']
            manual   = row['display_size_manual']
            cover    = row['cover_url'] or ''
            pname    = row['product_name'] or ''
            rtext    = row['review_text'] or ''

            # Используем cover_url как главное фото
            photo_url = cover
            if not photo_url:
                try:
                    photos = json.loads(row['photos'] or '[]')
                    photo_url = photos[0]['url'] if photos else ''
                except: pass
            if not photo_url:
                log.info(f'[{i+1}/{total}] id={item_id} SKIP (no photo)')
                skip += 1
                continue

            result = await analyze_photo(client, photo_url, pname, rtext)
            if not result:
                log.warning(f'[{i+1}/{total}] id={item_id} ERR (no result)')
                err += 1
                await asyncio.sleep(1)
                continue

            # Обновляем БД: display_size только если не зафиксирован вручную
            if manual:
                await conn.execute(
                    '''UPDATE gallery.collection_items
                       SET cover_focal_x=$1, cover_focal_y=$2, cover_aspect_ratio=$3
                       WHERE id=$4''',
                    result['focal_x']*100, result['focal_y']*100, result['crop'], item_id
                )
            else:
                await conn.execute(
                    '''UPDATE gallery.collection_items
                       SET cover_focal_x=$1, cover_focal_y=$2, cover_aspect_ratio=$3, display_size=$4
                       WHERE id=$5''',
                    result['focal_x']*100, result['focal_y']*100, result['crop'],
                    result['display_size'], item_id
                )
            ok += 1
            log.info(f'[{i+1}/{total}] id={item_id} OK: ds={result["display_size"]} fx={result["focal_x"]:.2f} fy={result["focal_y"]:.2f} crop={result["crop"]} q={result["quality_score"]}')

            # Пауза чтобы не перегрузить API (~ 1.5 req/s)
            await asyncio.sleep(0.7)

    await conn.close()
    log.info(f'DONE: ok={ok} skip={skip} err={err} / total={total}')

asyncio.run(main())

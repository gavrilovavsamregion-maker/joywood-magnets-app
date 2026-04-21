import json
import logging
from asyncpg import Pool

logger = logging.getLogger(__name__)


async def upsert_review(pool: Pool, review: dict, ai: dict) -> int | None:
    photos_json = json.dumps(review["photos"])
    videos_json = json.dumps(review["videos"])

    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            """
            INSERT INTO reviews
                (ozon_review_id, product_id, product_name, product_url, product_visible,
                 author_name, rating, review_text, photos, videos,
                 ai_title, ai_tags, ai_score, status)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10::jsonb,$11,$12,$13,'pending')
            ON CONFLICT (ozon_review_id) DO UPDATE
                SET product_visible = EXCLUDED.product_visible,
                    product_url = CASE WHEN reviews.product_url = '' THEN EXCLUDED.product_url
                                       ELSE reviews.product_url END
            RETURNING id, (xmax = 0) AS inserted
            """,
            review["ozon_review_id"],
            review["product_id"],
            review["product_name"],
            review["product_url"],
            review.get("product_visible", True),
            review["author_name"],
            review["rating"],
            review["review_text"],
            photos_json,
            videos_json,
            ai["ai_title"],
            ai["ai_tags"],
            ai["ai_score"],
        )
    if row and row["inserted"]:
        logger.info(f"Inserted review {review['ozon_review_id']} → id={row['id']}")
        return row["id"]
    return None


async def get_pending_count(pool: Pool) -> int:
    async with pool.acquire() as conn:
        return await conn.fetchval("SELECT COUNT(*) FROM reviews WHERE status='pending'")

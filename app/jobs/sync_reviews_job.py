import logging
from app.database import get_pool
from app.services.ozon_client import fetch_reviews_with_media, normalize_review
from app.repositories.review_repo import upsert_review

logger = logging.getLogger(__name__)

async def sync_reviews():
    logger.info("sync_reviews: start")
    try:
        pool = await get_pool()
        raw_list = await fetch_reviews_with_media(last_id=0, limit=100)
        inserted = 0
        for raw in raw_list:
            review = normalize_review(raw)
            ai = {"ai_title": review.get("product_name", "Работа мастера"), "ai_tags": [], "ai_score": 75}
            new_id = await upsert_review(pool, review, ai)
            if new_id:
                inserted += 1
        logger.info(f"sync_reviews: done, {inserted} new reviews inserted")
        return inserted
    except Exception as e:
        logger.error(f"sync_reviews failed: {e}", exc_info=True)
        raise

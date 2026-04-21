from fastapi import APIRouter
from fastapi.responses import JSONResponse
from app.database import get_pool

router = APIRouter(tags=["embed"])


@router.get("/embed/items")
async def embed_items():
    pool = await get_pool()
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            "SELECT ci.id, ci.title, ci.cover_url, r.rating, r.product_name, r.product_url,"
            " r.photos, r.videos, r.ai_tags"
            " FROM collection_items ci"
            " JOIN reviews r ON r.id = ci.review_id"
            " WHERE ci.is_published = true"
            " ORDER BY ci.sort_order, ci.created_at DESC"
            " LIMIT 8"
        )
        resp = JSONResponse([dict(r) for r in rows])
        resp.headers["Access-Control-Allow-Origin"] = "*"
        return resp

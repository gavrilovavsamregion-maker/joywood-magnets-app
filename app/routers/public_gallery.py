from fastapi import APIRouter, Query, HTTPException
from app.database import get_pool
import httpx
from fastapi.responses import StreamingResponse
import urllib.parse

router = APIRouter(tags=["gallery"])

PRODUCT_URL_EXPR = "COALESCE(NULLIF(ci.custom_product_url,''), NULLIF(r.product_url,''), '') AS product_url"


@router.get("/items")
async def get_items(
    tag: str | None = Query(None),
    category: str | None = Query(None),
    wood_type: str | None = Query(None),
    offset: int = Query(0, ge=0),
    limit: int = Query(20, ge=1, le=100)
):
    pool = await get_pool()
    async with pool.acquire() as conn:
        conditions = ["ci.is_published = true"]
        vals = []
        if tag:
            vals.append(tag); conditions.append(f"${len(vals)} = ANY(r.ai_tags)")
        if category:
            vals.append(category); conditions.append(f"ci.category = ${len(vals)}")
        if wood_type:
            vals.append(wood_type); conditions.append(f"ci.wood_type = ${len(vals)}")
        where = " AND ".join(conditions)
        count_vals = vals[:]
        vals += [limit, offset]
        rows = await conn.fetch(
            f"SELECT ci.id, ci.title, ci.category, ci.wood_type, ci.cover_url, ci.cover_focal_x, ci.cover_focal_y, COALESCE(ci.cover_aspect_ratio, '4/5') as cover_aspect_ratio, COALESCE(ci.cover_scale, 1.0) as cover_scale, ci.cover_video_url, COALESCE(ci.cover_video_start,0) as cover_video_start, COALESCE(ci.hidden_photo_indices,'[]') as hidden_photo_indices, ci.autoplay_mode, COALESCE(ci.display_size,'normal') as display_size,"
            f" {PRODUCT_URL_EXPR},"
            f" r.product_name, r.product_id, r.rating, r.review_text, r.author_name, r.photos, r.videos, r.ai_tags, r.created_at as review_published_at"
            f" FROM collection_items ci JOIN reviews r ON r.id = ci.review_id"
            f" WHERE {where}"
            f" ORDER BY ci.sort_order, ci.created_at DESC LIMIT ${len(vals)-1} OFFSET ${len(vals)}",
            *vals
        )
        total = await conn.fetchval(
            f"SELECT COUNT(*) FROM collection_items ci JOIN reviews r ON r.id = ci.review_id WHERE {where}",
            *count_vals
        )
        return {"total": total, "items": [dict(r) for r in rows]}


@router.get("/categories")
async def get_categories():
    pool = await get_pool()
    async with pool.acquire() as conn:
        rows = await conn.fetch("SELECT id, name, slug FROM categories ORDER BY name")
        return [dict(r) for r in rows]


@router.get("/wood-types")
async def get_wood_types():
    pool = await get_pool()
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            "SELECT DISTINCT wood_type FROM collection_items"
            " WHERE wood_type IS NOT NULL AND is_published = true ORDER BY wood_type"
        )
        return [r['wood_type'] for r in rows]


@router.get("/tags")
async def get_tags():
    pool = await get_pool()
    async with pool.acquire() as conn:
        try:
            rows = await conn.fetch("SELECT slug, name, color FROM tags ORDER BY name")
            return [dict(r) for r in rows]
        except Exception:
            return []



# Кэш product_id -> image_url
_product_image_cache: dict = {}

@router.get("/product-image/{product_id}")
async def get_product_image(product_id: int):
    """Return first product image from Ozon (cached in memory)."""
    import httpx
    from app.config import settings
    if product_id in _product_image_cache:
        return {"url": _product_image_cache[product_id]}
    try:
        headers = {
            "Client-Id": settings.ozon_client_id,
            "Api-Key": settings.ozon_api_key,
            "Content-Type": "application/json",
        }
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.post(
                "https://api-seller.ozon.ru/v3/product/info/list",
                json={"sku": [product_id]},
                headers=headers
            )
            if resp.status_code == 200:
                items = resp.json().get("items", [])
                if items:
                    images = items[0].get("images", [])
                    url = images[0] if images else ""
                    _product_image_cache[product_id] = url
                    return {"url": url}
    except Exception:
        pass
    _product_image_cache[product_id] = ""
    return {"url": ""}
@router.get("/items/{item_id}")
async def get_item(item_id: int):
    pool = await get_pool()
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            f"SELECT ci.id, ci.title, ci.category, ci.wood_type, ci.cover_url, ci.cover_focal_x, ci.cover_focal_y, COALESCE(ci.cover_aspect_ratio, '4/5') as cover_aspect_ratio, COALESCE(ci.cover_scale, 1.0) as cover_scale, ci.cover_video_url, COALESCE(ci.cover_video_start,0) as cover_video_start, COALESCE(ci.hidden_photo_indices,'[]') as hidden_photo_indices, ci.autoplay_mode, COALESCE(ci.display_size,'normal') as display_size,"
            f" {PRODUCT_URL_EXPR},"
            f" r.product_name, r.product_id, r.rating, r.review_text, r.author_name, r.photos, r.videos, r.ai_tags, r.created_at as review_published_at"
            f" FROM collection_items ci JOIN reviews r ON r.id = ci.review_id"
            f" WHERE ci.id = $1 AND ci.is_published = true", item_id
        )
        if not row:
            raise HTTPException(status_code=404, detail="Not found")
        return dict(row)


@router.get("/download")
async def download_photo(url: str):
    """Proxy-скачивание фото через сервер (для download атрибута)"""
    if not url.startswith("http"):
        raise HTTPException(status_code=400, detail="Invalid URL")
    try:
        async with httpx.AsyncClient(timeout=15, follow_redirects=True) as client:
            resp = await client.get(url, headers={"User-Agent": "Mozilla/5.0"})
            if resp.status_code != 200:
                raise HTTPException(status_code=502, detail="Failed to fetch image")
            content_type = resp.headers.get("content-type", "image/jpeg")
            filename = urllib.parse.urlparse(url).path.split("/")[-1] or "photo.jpg"
            if not filename.endswith((".jpg",".jpeg",".png",".webp")):
                filename = "joywood-photo.jpg"
            return StreamingResponse(
                iter([resp.content]),
                media_type=content_type,
                headers={"Content-Disposition": f'attachment; filename="{filename}"'}  
            )
    except httpx.RequestError as e:
        raise HTTPException(status_code=502, detail=str(e))

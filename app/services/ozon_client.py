import httpx
import asyncio
import logging
from app.config import settings

logger = logging.getLogger(__name__)
OZON_API_URL = "https://api-seller.ozon.ru"


def build_ozon_url(product_id: int, product_name: str = "") -> str:
    """Build Ozon product URL from SKU (product_id)."""
    if not product_id:
        return ""
    # Очищаем название для slug
    import re
    slug = re.sub(r'[^\w\s-]', '', product_name.lower()).strip()
    slug = re.sub(r'[\s_]+', '-', slug)[:60].strip('-')
    if slug:
        return f"https://www.ozon.ru/product/{slug}-{product_id}/"
    return f"https://www.ozon.ru/product/{product_id}/"


async def fetch_product_visibility(skus: list[int], headers: dict, client: httpx.AsyncClient) -> dict[int, bool]:
    """Возвращает {sku: is_visible} через /v3/product/info/list."""
    result = {}
    # Батчами по 100 SKU
    for i in range(0, len(skus), 100):
        batch = skus[i:i+100]
        try:
            resp = await client.post(
                f"{OZON_API_URL}/v3/product/info/list",
                json={"sku": batch},
                headers=headers
            )
            if resp.status_code == 200:
                items = resp.json().get("items", [])
                for item in items:
                    sku = item.get("sku") or item.get("id")
                    # visible_status: VISIBLE, HIDDEN, ARCHIVED, OUT_OF_STOCK, NOT_MODERATED
                    vs = item.get("visible_status", item.get("visibility", ""))
                    is_visible = str(vs).upper() in ("VISIBLE", "")
                    result[int(sku)] = is_visible
        except Exception as e:
            logger.warning(f"product/info/list batch error: {e}")
        await asyncio.sleep(0.1)
    return result


async def fetch_reviews_with_media(last_id: int = 0, limit: int = 100) -> list[dict]:
    headers = {
        "Client-Id": settings.ozon_client_id,
        "Api-Key": settings.ozon_api_key,
        "Content-Type": "application/json",
    }
    all_with_media = []
    current_last_id = last_id
    page = 0

    async with httpx.AsyncClient(timeout=30) as client:
        while True:
            payload = {"limit": limit, "sort_dir": "desc", "with_content": True}
            if current_last_id:
                payload["last_id"] = current_last_id

            resp = await client.post(f"{OZON_API_URL}/v1/review/list", json=payload, headers=headers)
            resp.raise_for_status()
            reviews = resp.json().get("reviews", [])
            if not reviews:
                break

            with_media = [r for r in reviews if r.get("photos_amount", 0) > 0 or r.get("videos_amount", 0) > 0]
            all_with_media.extend(with_media)
            page += 1
            logger.info(f"Page {page}: {len(reviews)} reviews, {len(with_media)} with media, total: {len(all_with_media)}")

            if len(reviews) < limit:
                break
            current_last_id = reviews[-1]["id"]
            await asyncio.sleep(0.1)

        logger.info(f"Collected {len(all_with_media)} reviews with media across {page} pages")

        # Шаг 2: детальное инфо по каждому отзыву
        detailed = []
        for r in all_with_media:
            try:
                resp = await client.post(
                    f"{OZON_API_URL}/v1/review/info",
                    json={"review_id": r["id"]},
                    headers=headers
                )
                if resp.status_code == 200:
                    detailed.append(resp.json())
                await asyncio.sleep(0.05)
            except Exception as e:
                logger.warning(f"review/info {r['id']}: {e}")

        # Шаг 3: проверяем видимость товаров
        skus = list({int(r.get("sku") or 0) for r in detailed if r.get("sku")})
        visibility = {}
        if skus:
            visibility = await fetch_product_visibility(skus, headers, client)
            logger.info(f"Visibility checked for {len(skus)} SKUs")

        # Добавляем visibility в каждый отзыв
        for r in detailed:
            sku = int(r.get("sku") or 0)
            r["_product_visible"] = visibility.get(sku, True)  # True by default если не проверяли

    logger.info(f"Total detailed reviews: {len(detailed)}")
    return detailed


def normalize_review(raw: dict) -> dict:
    photos = [{"url": p["url"]} for p in (raw.get("photos") or []) if p.get("url")]
    videos = [{"url": v["url"], "preview": v.get("preview_url", "")}
              for v in (raw.get("videos") or []) if v.get("url")]
    sku = int(raw.get("sku") or 0)
    product_name = raw.get("product_name", "") or f"SKU {sku}"
    # URL: если Ozon не дал — строим сами
    product_url = raw.get("product_url") or (build_ozon_url(sku, product_name) if sku else "")
    return {
        "ozon_review_id": str(raw.get("id") or raw.get("review_id", "")),
        "product_id": sku,
        "product_name": product_name,
        "product_url": product_url,
        "product_visible": raw.get("_product_visible", True),
        "author_name": raw.get("author_name") or "Покупатель",
        "rating": int(raw.get("rating") or 5),
        "review_text": raw.get("text") or "",
        "photos": photos,
        "videos": videos,
    }

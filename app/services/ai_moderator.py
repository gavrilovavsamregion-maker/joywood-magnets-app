import logging
import httpx
import json
import re
from app.config import settings

logger = logging.getLogger(__name__)


MODEL       = "openai/gpt-4o-mini"
FOCAL_MODEL = "google/gemini-2.5-flash"

CATEGORIES = ["Декор", "Мебель", "Кухня", "Полки", "Шкатулки", "Игрушки", "Светильники", "Рамки", "Арт/резьба", "Для улицы", "Другое"]

SHOP_CONTEXT = """КОНТЕКСТ: Магазин joywood.fun продаёт деревянный материал — шпон, доски, заготовки для творчества.
Покупатели делают из этого материала изделия своими руками и оставляют фото в отзывах.
Галерея показывает НЕ товар магазина, а РАБОТЫ МАСТЕРОВ, сделанные из купленного материала.

Критерий оценки: «Вдохновит ли это фото другого мастера купить материал и сделать то же самое?»"""

async def ai_analyze_review(review: dict) -> dict:
    """Анализирует отзыв: выбирает лучшее фото, определяет focal point для всех фото."""
    default = {
        "ai_title": review.get("product_name", "Работа мастера"),
        "ai_tags": [],
        "ai_score": 75,
        "ai_category": "Другое",
        "ai_photo_analysis": [],
    }
    if not settings.openai_api_key:
        return default

    photos = review.get("photos", [])
    if not photos:
        return default

    product_name = review.get("product_name", "")
    review_text = (review.get("review_text") or "")[:300]
    categories_list = ", ".join(CATEGORIES)

    # Анализируем первое фото для основного score/title/category
    # + все фото для slideshow analysis
    photo_analyses = []
    best_score = 0
    best_title = default["ai_title"]
    best_category = "Другое"

    # Анализируем каждое фото (максимум 5)
    for idx, photo in enumerate(photos[:5]):
        photo_url = photo.get("url", "") if isinstance(photo, dict) else photo
        if not photo_url:
            continue
        result = await _analyze_single_photo(photo_url, product_name, review_text, categories_list, idx)
        photo_analyses.append(result)
        if result.get("quality_score", 0) > best_score:
            best_score = result["quality_score"]
            best_title = result.get("suggested_title", best_title)
            best_category = result.get("category", best_category)

    return {
        "ai_title": best_title,
        "ai_tags": [],
        "ai_score": best_score,
        "ai_category": best_category,
        "ai_photo_analysis": photo_analyses,
    }


async def _analyze_single_photo(photo_url: str, product_name: str, review_text: str,
                                  categories_list: str, idx: int) -> dict:
    """Анализирует одно фото, возвращает dict с focal point и метаданными."""
    default = {
        "photo_index": idx,
        "quality_score": 40,
        "photo_type": "other",
        "object_size": "medium",
        "display_size": "normal",
        "include_in_slideshow": idx == 0,
        "suggested_focal_x": 0.5,
        "suggested_focal_y": 0.45,
        "suggested_crop": "4/3",
        "suggested_title": product_name or "Работа мастера",
        "category": "Другое",
        "confidence": "low",
        "skip_reason": None,
    }

    prompt = f"""You are curating a gallery of handmade wooden crafts. Customers buy wood blanks and make items. Photos are from their reviews.

Product context: "{product_name}". Review: "{review_text[:150]}"

Analyze the photo and return ONLY valid JSON (no markdown, no explanation):
{{
  "photo_type": "craft" | "texture" | "process" | "packaging" | "other",
  "quality_score": <0-100>,
  "display_size": "small" | "normal" | "large",
  "suggested_focal_x": <0.0-1.0>,
  "suggested_focal_y": <0.0-1.0>,
  "suggested_crop": "1/1" | "4/3" | "3/4" | "3/2" | "2/3",
  "suggested_scale": <1.0-2.5>,
  "suggested_title": "<3-6 word Russian title if craft, else null>",
  "category": "<one of: {categories_list}>",
  "confidence": "high" | "medium" | "low",
  "skip_reason": null | "packaging" | "blurry" | "object_too_small" | "unrelated"
}}

display_size — physical size of the CRAFT OBJECT (not photo size):
  small  = jewelry, spoon, small toy, small box, ring (fits in palm)
  normal = plate, bowl, clock, frame, medium box, vase
  large  = panel, icon, shelf, table, wall art, large sculpture

suggested_focal_x/y = normalized 0.0-1.0 position of geometric CENTER of the main object.
  If object is in the lower half of image → y > 0.5. Upper half → y < 0.5.
  If object is off-center horizontally → adjust x accordingly.

suggested_crop — MUST match how the object APPEARS IN THIS PHOTO (not its physical shape):
  Object appears TALLER than wide in this photo → use "2/3" or "3/4"
  Object appears WIDER than tall in this photo → use "4/3" or "3/2"
  Object appears roughly square in this photo → use "1/1"
  Multiple objects scattered across frame → always use "4/3", scale=1.0
  photo_type=process or photo_type=texture → always use "4/3", scale=1.0
  If unsure → use "1/1"
  NEVER choose a crop that cuts off the main object.
  Example: a knife lying horizontally in photo → "4/3", NOT "2/3"

suggested_scale — zoom to bring object closer. IMPORTANT rules:
  DEFAULT is 1.0. Only increase if there is clearly too much empty space around the object.
  1.0 = object fills >50% of frame area, OR object touches/near any edge of frame
  1.2-1.4 = object is clearly small in center with large empty background (20-50% of frame)
  1.5-2.0 = object is very small (<20% of frame area), lots of empty space all around
  NEVER use scale >1.0 if the object is close to any edge - it will be cropped out.
  NEVER use scale >1.4 unless the object has clear empty space on ALL sides.

quality_score: 90-100 full clear beautiful craft; 70-89 good full view; 50-69 partial/shadow; 0-49 packaging/blur/unrelated."""


    try:
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.post(
                "https://openrouter.ai/api/v1/chat/completions",
                headers={
                    "Authorization": f"Bearer {settings.openai_api_key}",
                    "Content-Type": "application/json",
                },
                json={
                    "model": FOCAL_MODEL,
                    "messages": [{
                        "role": "user",
                        "content": [
                            {"type": "text", "text": prompt},
                            {"type": "image_url", "image_url": {"url": photo_url, "detail": "high"}}
                        ]
                    }],
                    "max_tokens": 250,
                    "temperature": 0.2,
                }
            )
            resp.raise_for_status()
            raw_resp = resp.json()
            content = raw_resp["choices"][0]["message"]["content"].strip()
            logger.debug(f"AI photo idx={idx} raw: {content[:300]}")
            m = re.search(r'\{.*\}', content, re.DOTALL)
            if m:
                data = json.loads(m.group())
                raw_scale = float(data.get("suggested_scale") or 1.0)
                safe_scale = round(max(1.0, min(2.5, raw_scale)), 2)
                return {
                    "photo_index": idx,
                    "quality_score": int(data.get("quality_score", 40)),
                    "photo_type": data.get("photo_type", "other"),
                    "object_size": data.get("object_size", "medium"),
                    "display_size": data.get("display_size", "normal"),
                    "include_in_slideshow": bool(data.get("include_in_slideshow", idx == 0)),
                    "suggested_focal_x": float(data.get("suggested_focal_x", 0.5)),
                    "suggested_focal_y": float(data.get("suggested_focal_y", 0.45)),
                    "suggested_scale": safe_scale,
                    "suggested_crop": data.get("suggested_crop", "4/3"),
                    "suggested_title": data.get("suggested_title") or None,
                    "category": data.get("category", "Другое"),
                    "confidence": data.get("confidence", "low"),
                    "skip_reason": data.get("skip_reason") or None,
                }
    except Exception as e:
        logger.warning(f"AI photo analysis failed idx={idx}: {e}")
    return default


async def ai_focal_for_item(item: dict) -> list:
    """Пересчитать ai_photo_analysis для уже опубликованного collection_item."""
    review_data = {
        "product_name": item.get("product_name", ""),
        "review_text": item.get("review_text", ""),
        "photos": item.get("photos", []),
    }
    result = await ai_analyze_review(review_data)
    return result.get("ai_photo_analysis", [])

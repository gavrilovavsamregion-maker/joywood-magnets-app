import json
import logging
from app.config import settings

logger = logging.getLogger(__name__)

PRESET_TAGS = ["cutting-board","shelf","box","furniture","decor","toy","frame","tray","stand","other"]

def _ai_enabled():
    k = settings.openai_api_key or ""
    return bool(k) and not k.startswith("sk-...")

def _get_client():
    from openai import AsyncOpenAI
    return AsyncOpenAI(api_key=settings.openai_api_key, base_url="https://openrouter.ai/api/v1")

async def generate_title(review_text: str, product_name: str) -> str:
    if not _ai_enabled():
        return product_name or "Работа мастера"
    try:
        resp = await _get_client().chat.completions.create(
            model="openai/gpt-4o-mini",
            messages=[{"role":"user","content":f"Товар: {product_name}\nОтзыв: {review_text[:400]}\nПридумай короткое красивое название работы мастера (1 строка, до 8 слов, по-русски). Только название."}],
            max_tokens=50, temperature=0.7)
        return resp.choices[0].message.content.strip()
    except Exception as e:
        logger.warning(f"generate_title failed: {e}")
        return product_name or "Работа мастера"

async def analyze_photo(photo_url: str) -> tuple:
    if not _ai_enabled():
        return ["other"], 75
    tags_str = ",".join(PRESET_TAGS)
    try:
        resp = await _get_client().chat.completions.create(
            model="openai/gpt-4o-mini",
            messages=[{"role":"user","content":[
                {"type":"image_url","image_url":{"url":photo_url,"detail":"low"}},
                {"type":"text","text":f'Return JSON only: {{"tags":[from: {tags_str}],"score":0-100}} Score 100=beautiful handmade product, 0=packaging.'}
            ]}],
            max_tokens=80, temperature=0.2)
        data = json.loads(resp.choices[0].message.content.strip())
        tags = [t for t in data.get("tags",[]) if t in PRESET_TAGS]
        score = max(0, min(100, int(data.get("score",50))))
        return tags or ["other"], score
    except Exception as e:
        logger.warning(f"analyze_photo failed: {e}")
        return ["other"], 50

async def moderate_review(review: dict) -> dict:
    title = await generate_title(review.get("review_text",""), review.get("product_name",""))
    tags, score = ["other"], 75
    photos = review.get("photos") or []
    if photos and _ai_enabled():
        url = photos[0].get("url","")
        if url:
            tags, score = await analyze_photo(url)
    return {"ai_title": title, "ai_tags": tags, "ai_score": score}

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from pydantic import BaseModel
from typing import Optional
from app.database import get_pool
from app.deps import require_admin
from app.jobs.sync_reviews_job import sync_reviews

router = APIRouter(tags=["admin"], dependencies=[Depends(require_admin)])

WOOD_TYPES = [
    "Берёза","Дуб","Сосна","Ель","Аспен","Липа","Ольха",
    "Цедр","Орех","Грецкий орех","Акация","Тика","Бамбук","Другая"
]


class ApproveRequest(BaseModel):
    title: str
    category: str = "Другое"
    wood_type: Optional[str] = None
    product_url: Optional[str] = None
    cover_url: Optional[str] = None
    cover_video_url: Optional[str] = None
    cover_video_start: Optional[float] = None
    hidden_photo_indices: Optional[list] = None
    autoplay_mode: Optional[str] = None
    display_size: Optional[str] = None
    display_size_manual: Optional[bool] = None
    ai_tags: list[str] = []
    ai_photo_analysis: Optional[list] = None


class UpdateItemRequest(BaseModel):
    title: Optional[str] = None
    category: Optional[str] = None
    wood_type: Optional[str] = None
    product_url: Optional[str] = None
    cover_focal_x: Optional[float] = None
    cover_focal_y: Optional[float] = None
    cover_scale: Optional[float] = None
    cover_aspect_ratio: Optional[str] = None
    cover_url: Optional[str] = None
    cover_video_url: Optional[str] = None
    cover_video_start: Optional[float] = None
    hidden_photo_indices: Optional[list] = None
    autoplay_mode: Optional[str] = None
    display_size: Optional[str] = None
    display_size_manual: Optional[bool] = None


class CategoryCreateRequest(BaseModel):
    name: str


@router.get("/queue")
async def get_queue():
    pool = await get_pool()
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            "SELECT id, ozon_review_id, product_id, product_name, product_url, product_visible,"
            " rating, review_text, author_name, photos, videos, ai_title, ai_tags, ai_score, created_at"
            " FROM reviews WHERE status = 'pending' ORDER BY created_at ASC LIMIT 100"
        )
        count = await conn.fetchval("SELECT COUNT(*) FROM reviews WHERE status = 'pending'")
        approved = await conn.fetchval("SELECT COUNT(*) FROM reviews WHERE status = 'approved'")
        rejected = await conn.fetchval("SELECT COUNT(*) FROM reviews WHERE status = 'rejected'")
        return {"count": count, "approved": approved, "rejected": rejected, "items": [dict(r) for r in rows]}


# Глобальный статус синхронизации
_sync_status = {"running": False, "last_result": None}

async def _run_sync_bg():
    _sync_status["running"] = True
    try:
        inserted = await sync_reviews()
        _sync_status["last_result"] = {"ok": True, "inserted": inserted}
    except Exception as e:
        _sync_status["last_result"] = {"ok": False, "error": str(e)}
    finally:
        _sync_status["running"] = False

@router.post("/sync")
async def run_sync(background_tasks: BackgroundTasks):
    if _sync_status["running"]:
        return {"ok": False, "message": "Синхронизация уже запущена"}
    background_tasks.add_task(_run_sync_bg)
    return {"ok": True, "message": "Синхронизация запущена в фоне"}

@router.get("/sync/status")
async def sync_status():
    pool = await get_pool()
    async with pool.acquire() as conn:
        pending = await conn.fetchval("SELECT COUNT(*) FROM reviews WHERE status='pending'")
        total = await conn.fetchval("SELECT COUNT(*) FROM reviews")
    return {"running": _sync_status["running"], "last_result": _sync_status["last_result"], "pending": pending, "total": total}


@router.post("/queue/{review_id}/approve")
async def approve(review_id: int, body: ApproveRequest):
    pool = await get_pool()
    async with pool.acquire() as conn:
        rev = await conn.fetchrow(
            "SELECT id FROM reviews WHERE id = $1 AND status = 'pending'",
            review_id
        )
        if not rev:
            raise HTTPException(status_code=404, detail="Not found")

        await conn.execute(
            "UPDATE reviews SET status='approved', ai_title=$1, ai_tags=$2 WHERE id=$3",
            body.title, body.ai_tags, review_id
        )
        # custom_product_url если админ задал свою ссылку
        custom_url = body.product_url.strip() if body.product_url and body.product_url.strip() else None
        cover = body.cover_url or None
        ds = body.display_size if body.display_size in ('small','normal','large','full') else 'normal'

        # Автоприменение AI-анализа: выбрать лучшее фото и применить focal/scale/crop
        import json as _json
        ai_analyses = body.ai_photo_analysis if hasattr(body, 'ai_photo_analysis') and body.ai_photo_analysis else []
        # Если есть ai_photo_analysis в отзыве - достаём его
        if not ai_analyses:
            rev_ai = await conn.fetchrow(
                "SELECT ai_photo_analysis FROM reviews WHERE id=$1", review_id
            )
            if rev_ai and rev_ai['ai_photo_analysis']:
                raw = rev_ai['ai_photo_analysis']
                try:
                    ai_analyses = _json.loads(raw) if isinstance(raw, str) else raw
                except Exception:
                    ai_analyses = []

        # Находим лучший AI-результат (фильтр: confidence != low, сорт по quality_score)
        best_ai = None
        if ai_analyses:
            good = [a for a in ai_analyses if a.get('confidence') != 'low' and a.get('photo_type') not in ('packaging', 'other')]
            pool = good or ai_analyses
            best_ai = max(pool, key=lambda a: a.get('quality_score', 0))

        # Фокальная точка и scale из AI
        focal_x = float(best_ai['suggested_focal_x'] * 100) if best_ai and 'suggested_focal_x' in best_ai else None
        focal_y = float(best_ai['suggested_focal_y'] * 100) if best_ai and 'suggested_focal_y' in best_ai else None
        ai_scale = float(best_ai.get('suggested_scale', 1.0)) if best_ai else 1.0
        ai_crop = best_ai.get('suggested_crop') if best_ai else None
        valid_crops = ('1/1', '4/3', '3/4', '3/2', '2/3', '16/9')
        ai_crop = ai_crop if ai_crop in valid_crops else '4/3'
        # display_size: берём из AI если не был задан вручную
        if not body.display_size and best_ai and best_ai.get('display_size') in ('small','normal','large'):
            ds = best_ai['display_size']

        item_id = await conn.fetchval(
            "INSERT INTO collection_items"
            " (review_id, title, category, wood_type, custom_product_url, cover_url, is_published,"
            " display_size, cover_focal_x, cover_focal_y, cover_scale, cover_aspect_ratio)"
            " VALUES ($1, $2, $3, $4, $5,"
            " COALESCE($6, (SELECT COALESCE(photos->0->>'url','') FROM reviews WHERE id=$1)),"
            " true, $7, $8, $9, $10, $11)"
            " RETURNING id",
            review_id, body.title, body.category, body.wood_type, custom_url, cover,
            ds, focal_x, focal_y, ai_scale, ai_crop
        )
        return {"ok": True, "item_id": item_id}


@router.post("/queue/{review_id}/reject")
async def reject(review_id: int):
    pool = await get_pool()
    async with pool.acquire() as conn:
        await conn.execute(
            "UPDATE reviews SET status='rejected' WHERE id=$1 AND status='pending'",
            review_id
        )
        return {"ok": True}


@router.post("/queue/{review_id}/reset")
async def reset_to_pending(review_id: int):
    """Return rejected review back to pending queue."""
    pool = await get_pool()
    async with pool.acquire() as conn:
        await conn.execute(
            "UPDATE reviews SET status='pending' WHERE id=$1 AND status='rejected'",
            review_id
        )
        return {"ok": True}


@router.patch("/items/{item_id}")
async def update_item(item_id: int, body: UpdateItemRequest):
    pool = await get_pool()
    async with pool.acquire() as conn:
        updates, vals = [], []
        if body.title is not None:
            vals.append(body.title); updates.append("title=$" + str(len(vals)))
        if body.category is not None:
            vals.append(body.category); updates.append("category=$" + str(len(vals)))
        if body.wood_type is not None:
            vals.append(body.wood_type); updates.append("wood_type=$" + str(len(vals)))
        if body.product_url is not None:
            url = body.product_url.strip() or None
            vals.append(url); updates.append("custom_product_url=$" + str(len(vals)))
        if body.cover_focal_x is not None:
            vals.append(max(0.0, min(100.0, body.cover_focal_x))); updates.append("cover_focal_x=$" + str(len(vals)))
        if body.cover_focal_y is not None:
            vals.append(max(0.0, min(100.0, body.cover_focal_y))); updates.append("cover_focal_y=$" + str(len(vals)))
        if body.cover_scale is not None:
            vals.append(max(0.5, min(5.0, body.cover_scale))); updates.append("cover_scale=$" + str(len(vals)))
        if body.cover_aspect_ratio is not None:
            ar = body.cover_aspect_ratio if body.cover_aspect_ratio in ('free','1/1','4/3','3/4','16/9','3/2','2/3') else '4/5'
            vals.append(ar); updates.append("cover_aspect_ratio=$" + str(len(vals)))
        if body.cover_url is not None:
            vals.append(body.cover_url.strip() or None); updates.append("cover_url=$" + str(len(vals)))
        if body.cover_video_url is not None:
            vals.append(body.cover_video_url.strip() or None); updates.append("cover_video_url=$" + str(len(vals)))
        if body.cover_video_start is not None:
            vals.append(max(0.0, body.cover_video_start)); updates.append("cover_video_start=$" + str(len(vals)))
        if body.hidden_photo_indices is not None:
            import json
            vals.append(json.dumps(body.hidden_photo_indices)); updates.append("hidden_photo_indices=$" + str(len(vals)))
        if body.autoplay_mode is not None:
            am = body.autoplay_mode if body.autoplay_mode in ('slideshow','video','off') else None
            vals.append(am); updates.append("autoplay_mode=$" + str(len(vals)))
        if body.display_size is not None:
            ds = body.display_size if body.display_size in ('small','normal','large','full') else 'normal'
            vals.append(ds); updates.append("display_size=$" + str(len(vals)))
        if body.display_size_manual is not None:
            vals.append(bool(body.display_size_manual)); updates.append("display_size_manual=$" + str(len(vals)))
        if not updates:
            return {"ok": True}
        vals.append(item_id)
        await conn.execute(
            f"UPDATE collection_items SET {', '.join(updates)} WHERE id=${len(vals)}",
            *vals
        )
        return {"ok": True}


@router.get("/categories")
async def get_categories():
    pool = await get_pool()
    async with pool.acquire() as conn:
        rows = await conn.fetch("SELECT id, name, slug FROM categories ORDER BY name")
        return {"categories": [dict(r) for r in rows]}


@router.post("/categories")
async def create_category(body: CategoryCreateRequest):
    import re
    name = body.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="Name required")
    slug = re.sub(r'[^a-z0-9]+', '-', name.lower()).strip('-') or f"cat-{abs(hash(name)) % 9999}"
    pool = await get_pool()
    async with pool.acquire() as conn:
        try:
            row = await conn.fetchrow(
                "INSERT INTO categories(name,slug) VALUES($1,$2) RETURNING id,name,slug",
                name, slug
            )
            return {"ok": True, "category": dict(row)}
        except Exception:
            raise HTTPException(status_code=409, detail="Category already exists")


@router.delete("/categories/{cat_id}")
async def delete_category(cat_id: int):
    pool = await get_pool()
    async with pool.acquire() as conn:
        await conn.execute("DELETE FROM categories WHERE id=$1", cat_id)
        return {"ok": True}


@router.get("/wood-types")
async def get_wood_types():
    return {"wood_types": WOOD_TYPES}


@router.get("/items")
async def get_published_items(
    category: str = "",
    wood_type: str = "",
    search: str = "",
    offset: int = 0,
    limit: int = 500
):
    pool = await get_pool()
    async with pool.acquire() as conn:
        conditions = ["ci.is_published = true"]
        vals = []
        if category:
            vals.append(category); conditions.append(f"ci.category = ${len(vals)}")
        if wood_type:
            vals.append(wood_type); conditions.append(f"ci.wood_type = ${len(vals)}")
        if search:
            vals.append(f"%{search}%"); conditions.append(f"(ci.title ILIKE ${len(vals)} OR r.product_name ILIKE ${len(vals)})")
        where = " AND ".join(conditions)
        count_vals = vals[:]
        vals += [limit, offset]
        rows = await conn.fetch(
            f"SELECT ci.id, ci.title, ci.category, ci.wood_type, ci.cover_url, COALESCE(ci.display_size,'normal') as display_size, ci.display_size_manual,"
            f" ci.cover_focal_x, ci.cover_focal_y, COALESCE(ci.cover_scale,1.0) as cover_scale, COALESCE(ci.cover_aspect_ratio,'4/5') as cover_aspect_ratio, ci.cover_video_url, COALESCE(ci.cover_video_start,0) as cover_video_start, COALESCE(ci.hidden_photo_indices,'[]') as hidden_photo_indices, ci.autoplay_mode, ci.custom_product_url, ci.created_at, COALESCE(ci.ai_photo_analysis,'[]') as ai_photo_analysis,"
            f" r.product_name, r.product_id, r.product_url, r.product_visible, r.photos, r.videos, r.rating, r.review_text, r.author_name, r.created_at as review_published_at"
            f" FROM collection_items ci JOIN reviews r ON r.id = ci.review_id"
            f" WHERE {where}"
            f" ORDER BY ci.created_at DESC LIMIT ${len(vals)-1} OFFSET ${len(vals)}",
            *vals
        )
        total = await conn.fetchval(
            f"SELECT COUNT(*) FROM collection_items ci JOIN reviews r ON r.id = ci.review_id WHERE {where}",
            *count_vals
        )
        items = []
        for r in rows:
            d = dict(r)
            d["effective_url"] = d["custom_product_url"] or d["product_url"] or ""
            items.append(d)
        return {"total": total, "items": items}


@router.delete("/items/{item_id}")
async def delete_item(item_id: int):
    """Unpublish item (set is_published=false) and reset review to pending."""
    pool = await get_pool()
    async with pool.acquire() as conn:
        row = await conn.fetchrow("SELECT review_id FROM collection_items WHERE id=$1", item_id)
        if not row:
            raise HTTPException(status_code=404, detail="Not found")
        await conn.execute("UPDATE collection_items SET is_published=false WHERE id=$1", item_id)
        await conn.execute("UPDATE reviews SET status='pending' WHERE id=$1", row["review_id"])
        return {"ok": True}


@router.post("/items/{item_id}/ai-focal")
async def ai_focal_analysis(item_id: int):
    """Запускает AI-анализ фото для конкретного collection_item.
    Возвращает массив ai_photo_analysis и сохраняет в БД."""
    from app.services.ai_moderator import ai_focal_for_item
    pool = await get_pool()
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            """SELECT ci.id, ci.cover_url, r.product_name, r.review_text, r.photos
               FROM collection_items ci
               JOIN reviews r ON r.id = ci.review_id
               WHERE ci.id = $1""",
            item_id
        )
        if not row:
            raise HTTPException(status_code=404, detail="Not found")
        item_data = dict(row)
        import json as _json
        photos_raw = item_data.get("photos", [])
        if isinstance(photos_raw, str):
            try:
                photos_raw = _json.loads(photos_raw)
            except Exception:
                photos_raw = []
        item_data["photos"] = photos_raw

        analysis = await ai_focal_for_item(item_data)

        # Сохраняем в БД
        await conn.execute(
            "UPDATE gallery.collection_items SET ai_photo_analysis=$1 WHERE id=$2",
            _json.dumps(analysis), item_id
        )
        return {"ok": True, "analysis": analysis}


@router.get("/items/{item_id}/ai-focal")
async def get_ai_focal(item_id: int):
    """Получить сохранённый ai_photo_analysis для item."""
    pool = await get_pool()
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            "SELECT ai_photo_analysis FROM gallery.collection_items WHERE id=$1",
            item_id
        )
        if not row:
            raise HTTPException(status_code=404, detail="Not found")
        import json as _json
        analysis = row["ai_photo_analysis"]
        if isinstance(analysis, str):
            analysis = _json.loads(analysis)
        return {"analysis": analysis or []}


@router.post("/items/{item_id}/duplicate")
async def duplicate_item(item_id: int):
    """Дублировать карточку галереи"""
    pool = await get_pool()
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            "SELECT * FROM gallery.collection_items WHERE id=$1", item_id
        )
        if not row:
            raise HTTPException(status_code=404, detail="Not found")
        new_id = await conn.fetchval("""
            INSERT INTO gallery.collection_items
              (review_id, title, cover_url, cover_focal_x, cover_focal_y,
               cover_scale, cover_aspect_ratio, cover_video_url, cover_video_start,
               hidden_photo_indices, autoplay_mode, category, wood_type,
               custom_product_url, is_published, display_size, display_size_manual)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
            RETURNING id
        """,
            row["review_id"],
            (row["title"] or "") + " (копия)",
            row["cover_url"],
            row["cover_focal_x"], row["cover_focal_y"],
            row["cover_scale"], row["cover_aspect_ratio"],
            row["cover_video_url"], row["cover_video_start"] or 0,
            row["hidden_photo_indices"] or "[]",
            row["autoplay_mode"],
            row["category"], row["wood_type"],
            row["custom_product_url"],
            row["is_published"],
            row["display_size"] or "normal",
            row["display_size_manual"] or False
        )
        return {"ok": True, "new_id": new_id}

from contextlib import asynccontextmanager
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from fastapi import FastAPI
from app.database import get_pool, close_pool
import logging

logger = logging.getLogger(__name__)
scheduler = AsyncIOScheduler()

@asynccontextmanager
async def lifespan(app: FastAPI):
    await get_pool()
    logger.info("DB pool ready")

    from app.jobs.sync_reviews_job import sync_reviews
    scheduler.add_job(sync_reviews, "interval", hours=2, id="sync_reviews", replace_existing=True)
    scheduler.start()
    logger.info("Scheduler started")

    yield

    scheduler.shutdown(wait=False)
    await close_pool()
    logger.info("Shutdown complete")

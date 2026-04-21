"""Manual trigger wrapper — used from admin API if needed."""
from app.jobs.sync_reviews_job import sync_reviews

__all__ = ["sync_reviews"]

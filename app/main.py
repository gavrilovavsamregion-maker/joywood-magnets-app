import logging
from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from app.lifespan import lifespan
from app.routers import health, public_gallery, admin_queue, widget, embed

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")

app = FastAPI(title="Joywood Gallery", version="1.0.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.mount("/static", StaticFiles(directory="/root/joywood-gallery/app/static"), name="static")

app.include_router(health.router)
app.include_router(public_gallery.router, prefix="/api/gallery")
app.include_router(admin_queue.router, prefix="/api/admin")
app.include_router(widget.router)
app.include_router(embed.router)

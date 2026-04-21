from fastapi import APIRouter, Request
from fastapi.responses import HTMLResponse
from fastapi.templating import Jinja2Templates

router = APIRouter()
templates = Jinja2Templates(directory="/root/joywood-gallery/app/templates")

@router.get("/", response_class=HTMLResponse)
async def gallery_page(request: Request):
    return templates.TemplateResponse("widget.html", {"request": request})

@router.get("/admin/", response_class=HTMLResponse)
async def admin_page(request: Request):
    return templates.TemplateResponse("admin.html", {"request": request})

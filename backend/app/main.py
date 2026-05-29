import logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

import aiohttp
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response
from contextlib import asynccontextmanager
from app.core.config import settings
from app.api.health import router as health_router
from app.api.routes.printer import router as printer_router
from app.api.routes.analytics import router as analytics_router
from app.api.routes.jobs import router as jobs_router
from app.api.routes.spools import router as spools_router
from app.api.routes.cfs import router as cfs_router
from app.api.routes.cfs_overrides import router as cfs_overrides_router
from app.api.routes.system import router as system_router
from app.api.routes.history import router as history_router
from app.api.routes.power import router as power_router
from app.api.routes.settings import router as settings_router
from app.api.routes.filament import router as filament_router
from app.api.routes.files import router as files_router
from app.websocket.handlers import handle_websocket
from app.services.print_tracker import print_tracker
from app.core.database import Base, engine
from app.models import *  # noqa: ensure all models are loaded


@asynccontextmanager
async def lifespan(app: FastAPI):
    Base.metadata.create_all(bind=engine)
    app.state.http_session = aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=15))
    print_tracker.start()
    yield
    print_tracker.stop()
    session = getattr(app.state, 'http_session', None)
    if session and not session.closed:
        await session.close()


class DynamicCORSMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        if request.method == "OPTIONS":
            origin = request.headers.get("origin", "*")
            return Response(
                status_code=200,
                headers={
                    "Access-Control-Allow-Origin": origin,
                    "Access-Control-Allow-Credentials": "true",
                    "Access-Control-Allow-Methods": "*",
                    "Access-Control-Allow-Headers": "*",
                    "Access-Control-Max-Age": "600",
                },
            )
        response = await call_next(request)
        origin = request.headers.get("origin", "")
        if origin:
            response.headers["Access-Control-Allow-Origin"] = origin
            response.headers["Access-Control-Allow-Credentials"] = "true"
            response.headers["Access-Control-Allow-Methods"] = "*"
            response.headers["Access-Control-Allow-Headers"] = "*"
        return response


def create_app() -> FastAPI:
    app = FastAPI(
        title=settings.app_name,
        debug=settings.debug,
        version="0.1.0",
        lifespan=lifespan,
    )

    app.add_middleware(DynamicCORSMiddleware)
    
    # Include routers
    app.include_router(health_router, prefix="/api/v1")
    app.include_router(printer_router, prefix="/api/v1")
    app.include_router(analytics_router, prefix="/api/v1")
    app.include_router(jobs_router, prefix="/api/v1")
    app.include_router(spools_router, prefix="/api/v1")
    app.include_router(cfs_router, prefix="/api/v1")
    app.include_router(cfs_overrides_router, prefix="/api/v1")
    app.include_router(system_router, prefix="/api/v1")
    app.include_router(history_router, prefix="/api/v1")
    app.include_router(power_router, prefix="/api/v1")
    app.include_router(settings_router, prefix="/api/v1")
    app.include_router(filament_router, prefix="/api/v1")
    app.include_router(files_router, prefix="/api/v1")
    
    return app


app = create_app()


@app.get("/")
async def root():
    return {"message": "K2 Analytics API", "version": "0.1.0"}


@app.websocket("/api/v1/ws")
async def websocket_endpoint(websocket: WebSocket):
    await handle_websocket(websocket, "frontend")
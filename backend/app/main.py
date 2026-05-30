import logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

import aiohttp
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Depends, Request
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request as StarletteRequest
from starlette.responses import Response, JSONResponse
from contextlib import asynccontextmanager
from app.core.config import settings
from app.core.auth import get_optional_user
from app.models.user import User
from app.api.health import router as health_router
from app.api.routes.auth import router as auth_router
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
    async def dispatch(self, request: StarletteRequest, call_next):
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


async def auth_middleware_func(request: Request, call_next):
    path = request.url.path
    public_paths = ["/", "/api/v1/health", "/api/v1/auth/login", "/api/v1/auth/register", "/api/v1/auth/status", "/api/v1/settings/setup/status"]
    if path in public_paths or path.startswith("/docs") or path.startswith("/openapi") or path.startswith("/api/v1/auth/"):
        return await call_next(request)
    if path.startswith("/api/v1/"):
        from app.core.auth import verify_token
        auth_header = request.headers.get("authorization", "")
        if auth_header.startswith("Bearer "):
            token = auth_header[7:]
            payload = verify_token(token)
            if payload:
                return await call_next(request)
        return JSONResponse(status_code=401, content={"detail": "Not authenticated"})
    return await call_next(request)


def create_app() -> FastAPI:
    app = FastAPI(
        title=settings.app_name,
        debug=settings.debug,
        version="0.1.0",
        lifespan=lifespan,
    )

    app.add_middleware(DynamicCORSMiddleware)
    app.middleware("http")(auth_middleware_func)
    
    # Include routers
    app.include_router(health_router, prefix="/api/v1")
    app.include_router(auth_router, prefix="/api/v1")
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
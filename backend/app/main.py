import logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

import asyncio
import aiohttp
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Depends, Request
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request as StarletteRequest
from starlette.responses import Response, JSONResponse
from contextlib import asynccontextmanager
from prometheus_fastapi_instrumentator import Instrumentator
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
from app.api.routes.spoolmandb import router as spoolmandb_router
from app.api.routes.debug import router as debug_router
from app.api.routes.match_vote import router as match_vote_router
from app.websocket.handlers import handle_websocket
from app.services.print_tracker import print_tracker
from app.core.database import Base, engine
from app.models import *  # noqa: ensure all models are loaded


@asynccontextmanager
async def lifespan(app: FastAPI):
    Base.metadata.create_all(bind=engine)
    _migrate_add_columns(engine)
    app.state.http_session = aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=15))
    print_tracker.start()

    async def _background_thumbnail_backfill():
        try:
            await asyncio.sleep(5)
            from app.core.database import SessionLocal
            from app.api.routes.files import _run_thumbnail_backfill
            db = SessionLocal()
            await asyncio.wait_for(_run_thumbnail_backfill(app.state.http_session, db, limit=50), timeout=120)
            db.close()
        except asyncio.TimeoutError:
            logger.warning("Startup thumbnail backfill timed out after 120s")
        except Exception as e:
            logger.warning(f"Startup thumbnail backfill failed: {e}")

    asyncio.create_task(_background_thumbnail_backfill())

    yield
    print_tracker.stop()
    session = getattr(app.state, 'http_session', None)
    if session and not session.closed:
        await session.close()


def _migrate_add_columns(engine):
    from sqlalchemy import inspect, text
    migrates = [
        ("filament_library", "rfid_vendor", "ALTER TABLE filament_library ADD COLUMN IF NOT EXISTS rfid_vendor VARCHAR(100)"),
        ("filament_library", "runout_detected", "ALTER TABLE filament_library ADD COLUMN IF NOT EXISTS runout_detected BOOLEAN DEFAULT FALSE"),
        ("cfs_slot_usage", "checkpoint_g", "ALTER TABLE cfs_slot_usage ADD COLUMN IF NOT EXISTS checkpoint_g DOUBLE PRECISION"),
        ("cfs_slot_overrides", "calibrated", "ALTER TABLE cfs_slot_overrides ADD COLUMN IF NOT EXISTS calibrated BOOLEAN DEFAULT FALSE"),
        ("cfs_slot_overrides", "match_confidence", "ALTER TABLE cfs_slot_overrides ADD COLUMN IF NOT EXISTS match_confidence FLOAT DEFAULT 0.0"),
        ("cfs_slot_overrides", "auto_approve", "ALTER TABLE cfs_slot_overrides ADD COLUMN IF NOT EXISTS auto_approve BOOLEAN DEFAULT FALSE"),
        ("cfs_slot_overrides", "match_attempts", "ALTER TABLE cfs_slot_overrides ADD COLUMN IF NOT EXISTS match_attempts INTEGER DEFAULT 0"),
        ("cfs_slot_overrides", "match_hits", "ALTER TABLE cfs_slot_overrides ADD COLUMN IF NOT EXISTS match_hits INTEGER DEFAULT 0"),
    ]
    with engine.connect() as conn:
        insp = inspect(engine)
        for table, column, sql in migrates:
            cols = [c["name"] for c in insp.get_columns(table)]
            if column not in cols:
                conn.execute(text(sql))
                conn.commit()
                logger.info(f"Migration: added {table}.{column}")
    # Create cfs_match_votes table if it doesn't exist
    with engine.connect() as conn:
        insp = inspect(engine)
        if "cfs_match_votes" not in insp.get_table_names():
            conn.execute(text("""
                CREATE TABLE IF NOT EXISTS cfs_match_votes (
                    id SERIAL PRIMARY KEY,
                    slot_id VARCHAR(3) NOT NULL,
                    material_code VARCHAR(10),
                    color_hex VARCHAR(10),
                    rfid_vendor VARCHAR(100),
                    suggested_roll_id INTEGER REFERENCES filament_library(id),
                    confirmed_roll_id INTEGER REFERENCES filament_library(id),
                    auto_accepted BOOLEAN DEFAULT FALSE,
                    correct BOOLEAN,
                    created_at TIMESTAMP DEFAULT NOW(),
                    updated_at TIMESTAMP DEFAULT NOW(),
                    responded_at TIMESTAMP
                )
            """))
            conn.commit()
            logger.info("Migration: created cfs_match_votes table")
    # Create match vote indices
    with engine.connect() as conn:
        indices = [
            "CREATE INDEX IF NOT EXISTS idx_cfs_match_votes_slot_id ON cfs_match_votes(slot_id)",
            "CREATE INDEX IF NOT EXISTS idx_cfs_match_votes_pending ON cfs_match_votes(correct) WHERE correct IS NULL",
        ]
        for stmt in indices:
            try:
                conn.execute(text(stmt))
                conn.commit()
            except Exception as e:
                logger.warning(f"Failed to create index: {e}")
    # --- Data quality migrations ---
    # Fix brand for RFID-tagged spools: set to 'Creality' (Creality is the only RFID vendor)
    with engine.connect() as conn:
        try:
            result = conn.execute(text("""
                UPDATE filament_library SET brand = 'Creality'
                WHERE rfid_vendor IS NOT NULL AND rfid_vendor != '' AND rfid_vendor != 'unknown'
                AND (brand IS NULL OR brand = '' OR brand = 'CFS')
            """))
            conn.commit()
            if result.rowcount > 0:
                logger.info(f"Migration: set brand='Creality' for {result.rowcount} RFID-tagged rolls")
        except Exception as e:
            logger.warning(f"Failed to fix RFID brand: {e}")
    # Fix brand = 'CFS' on non-RFID rolls — clear to empty
    with engine.connect() as conn:
        try:
            result = conn.execute(text("""
                UPDATE filament_library SET brand = '' WHERE brand = 'CFS'
            """))
            conn.commit()
            if result.rowcount > 0:
                logger.info(f"Migration: cleared {result.rowcount} rolls with brand='CFS'")
        except Exception as e:
            logger.warning(f"Failed to fix brand='CFS': {e}")
    # Fix color_name = material (old bug) — clear so it can be re-derived
    with engine.connect() as conn:
        try:
            result = conn.execute(text("""
                UPDATE filament_library SET color_name = '' WHERE color_name = material AND color_name != ''
            """))
            conn.commit()
            if result.rowcount > 0:
                logger.info(f"Migration: cleared {result.rowcount} rolls where color_name matched material")
        except Exception as e:
            logger.warning(f"Failed to fix color_name=material: {e}")
    # Fix empty color_name: derive from color_hex using Python (complex color matching can't be done in SQL)
    with engine.connect() as conn:
        try:
            from app.core.cfs_constants import color_name_from_hex
            rolls = conn.execute(text("""
                SELECT id, color_hex FROM filament_library
                WHERE (color_name IS NULL OR color_name = '') AND color_hex IS NOT NULL AND color_hex != ''
            """)).fetchall()
            updated = 0
            for row in rolls:
                name = color_name_from_hex(row[1])
                if name:
                    conn.execute(text("UPDATE filament_library SET color_name = :name WHERE id = :id"), {"name": name, "id": row[0]})
                    updated += 1
            if updated > 0:
                conn.commit()
                logger.info(f"Migration: derived color_name from hex for {updated} rolls")
        except Exception as e:
            logger.warning(f"Failed to derive color_name from hex: {e}")
    # Fix location for CFS rolls: should be 'CFS {slot_id}' (e.g. 'CFS T1A'), not 'CFS T1' or 'CFS 1'
    with engine.connect() as conn:
        try:
            result = conn.execute(text("""
                UPDATE filament_library SET location = CONCAT('CFS ', spool_id)
                WHERE spool_id IS NOT NULL AND spool_id != ''
                AND spool_id ~ '^T[1-4][A-D]$'
                AND location != CONCAT('CFS ', spool_id)
            """))
            conn.commit()
            if result.rowcount > 0:
                logger.info(f"Migration: fixed {result.rowcount} CFS locations to include slot ID")
        except Exception as e:
            logger.warning(f"Failed to fix CFS slot locations: {e}")
    # Fix 'Removed from CFS' → 'Storage box' for partial rolls, 'Shelf A' for full/empty
    with engine.connect() as conn:
        try:
            result = conn.execute(text("""
                UPDATE filament_library SET location = 'Storage box'
                WHERE location = 'Removed from CFS' AND remaining_weight_g > 0
            """))
            conn.commit()
            if result.rowcount > 0:
                logger.info(f"Migration: set 'Storage box' for {result.rowcount} partial rolls with 'Removed from CFS'")
        except Exception as e:
            logger.warning(f"Failed to fix 'Removed from CFS' partial: {e}")
    with engine.connect() as conn:
        try:
            result = conn.execute(text("""
                UPDATE filament_library SET location = 'Shelf A'
                WHERE location = 'Removed from CFS'
            """))
            conn.commit()
            if result.rowcount > 0:
                logger.info(f"Migration: set 'Shelf A' for {result.rowcount} full/empty rolls with 'Removed from CFS'")
        except Exception as e:
            logger.warning(f"Failed to fix 'Removed from CFS' empty: {e}")
    # Fix empty location for unlinked rolls with remaining filament → 'Storage box'
    with engine.connect() as conn:
        try:
            result = conn.execute(text("""
                UPDATE filament_library SET location = 'Storage box'
                WHERE (location IS NULL OR location = '')
                AND (spool_id IS NULL OR spool_id = '')
                AND remaining_weight_g > 0
            """))
            conn.commit()
            if result.rowcount > 0:
                logger.info(f"Migration: set 'Storage box' for {result.rowcount} unlinked rolls with remaining filament")
        except Exception as e:
            logger.warning(f"Failed to fix empty location for partial rolls: {e}")
    # Fix CFS rolls with wrong location format (e.g. 'CFS T1' → 'CFS T1A')
    with engine.connect() as conn:
        try:
            result = conn.execute(text("""
                UPDATE filament_library SET location = CONCAT('CFS ', spool_id)
                WHERE spool_id IS NOT NULL AND spool_id != ''
                AND spool_id ~ '^T[1-4][A-D]$'
                AND (location IS NULL OR location = '' OR location NOT LIKE 'CFS T%A%')
            """))
            conn.commit()
            if result.rowcount > 0:
                logger.info(f"Migration: set full CFS slot location for {result.rowcount} rolls")
        except Exception as e:
            logger.warning(f"Failed to fix CFS locations: {e}")
    # Remove duplicate rolls sharing the same spool_id — keep the newest one
    with engine.connect() as conn:
        try:
            result = conn.execute(text("""
                DELETE FROM filament_library WHERE id IN (
                    SELECT f.id FROM filament_library f
                    JOIN (
                        SELECT spool_id, MAX(id) as max_id FROM filament_library
                        WHERE spool_id IS NOT NULL AND spool_id != ''
                        GROUP BY spool_id HAVING COUNT(*) > 1
                    ) dup ON f.spool_id = dup.spool_id AND f.id != dup.max_id
                )
            """))
            conn.commit()
            if result.rowcount > 0:
                logger.info(f"Migration: removed {result.rowcount} duplicate rolls with same spool_id (kept newest)")
        except Exception as e:
            logger.warning(f"Failed to remove duplicate spool_id rolls: {e}")


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
    if request.method == "OPTIONS":
        return await call_next(request)
    path = request.url.path
    public_paths = ["/", "/api/v1/health", "/api/v1/auth/login", "/api/v1/auth/register", "/api/v1/auth/status", "/api/v1/settings/setup/status", "/api/v1/settings/setup/test-connection", "/api/v1/debug/export-logs", "/api/v1/files/thumbnail-image", "/metrics"]
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

    app.middleware("http")(auth_middleware_func)
    app.add_middleware(DynamicCORSMiddleware)
    
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
    app.include_router(spoolmandb_router, prefix="/api/v1")
    app.include_router(debug_router, prefix="/api/v1")
    app.include_router(match_vote_router, prefix="/api/v1")
    
    Instrumentator().instrument(app).expose(app)
    
    return app


app = create_app()


@app.get("/")
async def root():
    return {"message": "K2 Analytics API", "version": "0.1.0"}


@app.websocket("/api/v1/ws")
async def websocket_endpoint(websocket: WebSocket):
    await handle_websocket(websocket, "frontend")
from fastapi import WebSocket, WebSocketDisconnect
from sqlalchemy.orm import Session
from app.core.database import SessionLocal
from app.websocket import ConnectionManager
from app.services.print_job_service import PrintJobService
from app.services.spool_service import SpoolService
from app.services.analytics_service import AnalyticsService
import asyncio
import json

# Initialize connection manager
manager = ConnectionManager()

async def handle_websocket(websocket: WebSocket, client_id: str):
    # Using SessionLocal instead of get_db() as required by the plan
    db = SessionLocal()
    try:
        await manager.connect(websocket, client_id)
        
        # Send initial data to client
        analytics_service = AnalyticsService(db)
        stats = analytics_service.get_print_statistics()
        await manager.send_personal_message(json.dumps({
            "type": "initial_data",
            "data": stats
        }), client_id)
        
        while True:
            data = await websocket.receive_text()
            # Handle incoming messages
            message = json.loads(data)
            # Process message here as needed
            await manager.send_personal_message(json.dumps({
                "type": "echo",
                "data": message
            }), client_id)
            
    except WebSocketDisconnect:
        manager.disconnect(client_id)
    except Exception as e:
        print(f"WebSocket error: {e}")
        manager.disconnect(client_id)
    finally:
        db.close()
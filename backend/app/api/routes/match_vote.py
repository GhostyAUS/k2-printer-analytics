from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from app.core.database import get_db
from app.models.cfs_match_vote import CfsMatchVote
from app.models.filament_roll import FilamentRoll
from app.services.print_tracker import MoonrakerPrintTracker

router = APIRouter(prefix="/cfs/match-vote", tags=["cfs"])


@router.patch("/{vote_id}/confirm")
async def confirm_match_vote(vote_id: int, db: Session = Depends(get_db)):
    vote = db.query(CfsMatchVote).filter(CfsMatchVote.id == vote_id).first()
    if not vote:
        raise HTTPException(status_code=404, detail="Vote not found")
    if vote.responded_at:
        raise HTTPException(status_code=400, detail="Vote already responded to")
    if not vote.suggested_roll_id:
        raise HTTPException(status_code=400, detail="No suggested roll to confirm")

    roll = db.query(FilamentRoll).filter(FilamentRoll.id == vote.suggested_roll_id).first()
    if not roll:
        raise HTTPException(status_code=404, detail="Suggested roll not found")

    from datetime import datetime, timezone
    roll.spool_id = vote.slot_id
    roll.location = f"CFS {vote.slot_id}"
    vote.confirmed_roll_id = vote.suggested_roll_id
    vote.correct = True
    vote.responded_at = datetime.now(timezone.utc)
    db.commit()

    MoonrakerPrintTracker._update_confidence(db, vote.slot_id)

    return {"status": "confirmed", "slot_id": vote.slot_id, "roll_id": roll.id, "roll_name": f"{roll.brand} {roll.material}"}


@router.patch("/{vote_id}/correct")
async def correct_match_vote(vote_id: int, roll_id: int = Query(...), db: Session = Depends(get_db)):
    vote = db.query(CfsMatchVote).filter(CfsMatchVote.id == vote_id).first()
    if not vote:
        raise HTTPException(status_code=404, detail="Vote not found")
    if vote.responded_at:
        raise HTTPException(status_code=400, detail="Vote already responded to")

    roll = db.query(FilamentRoll).filter(FilamentRoll.id == roll_id).first()
    if not roll:
        raise HTTPException(status_code=404, detail="Roll not found")

    from datetime import datetime, timezone
    roll.spool_id = vote.slot_id
    roll.location = f"CFS {vote.slot_id}"
    vote.confirmed_roll_id = roll_id
    vote.correct = False
    vote.responded_at = datetime.now(timezone.utc)
    db.commit()

    MoonrakerPrintTracker._update_confidence(db, vote.slot_id)

    return {"status": "corrected", "slot_id": vote.slot_id, "roll_id": roll.id, "roll_name": f"{roll.brand} {roll.material}"}


@router.patch("/{vote_id}/deny")
async def deny_match_vote(vote_id: int, db: Session = Depends(get_db)):
    vote = db.query(CfsMatchVote).filter(CfsMatchVote.id == vote_id).first()
    if not vote:
        raise HTTPException(status_code=404, detail="Vote not found")
    if vote.responded_at:
        raise HTTPException(status_code=400, detail="Vote already responded to")

    from datetime import datetime, timezone
    vote.correct = False
    vote.responded_at = datetime.now(timezone.utc)
    db.commit()

    MoonrakerPrintTracker._update_confidence(db, vote.slot_id)

    return {"status": "denied", "slot_id": vote.slot_id, "message": "No roll linked — link manually in Filament Library"}


@router.get("/pending")
async def list_pending_votes(db: Session = Depends(get_db)):
    votes = db.query(CfsMatchVote).filter(
        CfsMatchVote.correct.is_(None),
        CfsMatchVote.auto_accepted == False,
    ).order_by(CfsMatchVote.created_at.desc()).all()
    return [{
        "id": v.id,
        "slot_id": v.slot_id,
        "material_code": v.material_code,
        "color_hex": v.color_hex,
        "rfid_vendor": v.rfid_vendor,
        "suggested_roll_id": v.suggested_roll_id,
        "created_at": v.created_at.isoformat() if v.created_at else None,
    } for v in votes]

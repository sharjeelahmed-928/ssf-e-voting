"""
SSF E-Voting System - Backend API
Flask + SQLAlchemy + JWT + bcrypt
"""
import os
import io
import csv
import functools
from datetime import datetime, timedelta, timezone

import bcrypt
import jwt
from flask import Flask, request, jsonify, g
from flask_cors import CORS
from flask_limiter import Limiter
from flask_limiter.util import get_remote_address
from dotenv import load_dotenv

from database import db, Member, Election, Position, Candidate, VoteRecord, BallotEntry, AuditLog, log_action, now_utc

load_dotenv()

app = Flask(__name__)
app.config["SQLALCHEMY_DATABASE_URI"] = os.environ.get("DATABASE_URL", "sqlite:///ssf_evoting.db")
app.config["SQLALCHEMY_TRACK_MODIFICATIONS"] = False
app.config["SECRET_KEY"] = os.environ.get("SECRET_KEY", "dev-secret")

JWT_SECRET = os.environ.get("JWT_SECRET_KEY", "dev-jwt-secret")
JWT_EXPIRY_HOURS = int(os.environ.get("JWT_EXPIRY_HOURS", "24"))

allowed_origins = os.environ.get("ALLOWED_ORIGINS", "*").split(",")
CORS(app, origins=allowed_origins, supports_credentials=True)

limiter = Limiter(get_remote_address, app=app, default_limits=["100 per minute"])

db.init_app(app)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def check_password(password: str, password_hash: str) -> bool:
    try:
        return bcrypt.checkpw(password.encode("utf-8"), password_hash.encode("utf-8"))
    except (ValueError, TypeError):
        return False


def create_token(member: Member) -> str:
    payload = {
        "sub": member.id,
        "ssf_id": member.ssf_id,
        "role": member.role,
        "iat": datetime.now(timezone.utc),
        "exp": datetime.now(timezone.utc) + timedelta(hours=JWT_EXPIRY_HOURS),
    }
    return jwt.encode(payload, JWT_SECRET, algorithm="HS256")


def decode_token(token: str):
    return jwt.decode(token, JWT_SECRET, algorithms=["HS256"])


def get_client_ip():
    return request.headers.get("X-Forwarded-For", request.remote_addr)


def login_required(f):
    @functools.wraps(f)
    def wrapper(*args, **kwargs):
        auth_header = request.headers.get("Authorization", "")
        if not auth_header.startswith("Bearer "):
            return jsonify({"error": "Authentication required."}), 401
        token = auth_header.split(" ", 1)[1]
        try:
            payload = decode_token(token)
        except jwt.ExpiredSignatureError:
            return jsonify({"error": "Session expired. Please log in again."}), 401
        except jwt.InvalidTokenError:
            return jsonify({"error": "Invalid session token."}), 401
        member = Member.query.get(payload["sub"])
        if not member or member.status != "active":
            return jsonify({"error": "Account unavailable."}), 401
        g.current_member = member
        return f(*args, **kwargs)
    return wrapper


def admin_required(f):
    @functools.wraps(f)
    @login_required
    def wrapper(*args, **kwargs):
        if g.current_member.role not in ("admin", "super_admin"):
            return jsonify({"error": "Administrator access required."}), 403
        return f(*args, **kwargs)
    return wrapper


def validate_password(password: str):
    if not password or len(password) < 8 or len(password) > 64:
        return "Password must be between 8 and 64 characters."
    if not any(c.isupper() for c in password):
        return "Password must contain an uppercase letter."
    if not any(c.islower() for c in password):
        return "Password must contain a lowercase letter."
    if not any(c.isdigit() for c in password):
        return "Password must contain a number."
    if not any(not c.isalnum() for c in password):
        return "Password must contain a special character."
    return None


# ---------------------------------------------------------------------------
# Health check
# ---------------------------------------------------------------------------

@app.get("/api/health")
def health():
    return jsonify({"status": "ok", "time": now_utc().isoformat()})


# ---------------------------------------------------------------------------
# Authentication & Activation
# ---------------------------------------------------------------------------

@app.post("/api/auth/activate/verify")
@limiter.limit("5 per hour")
def activate_verify():
    data = request.get_json(force=True, silent=True) or {}
    ssf_id = (data.get("ssf_id") or "").strip().upper()
    cnic = (data.get("cnic") or "").strip()

    member = Member.query.filter_by(ssf_id=ssf_id).first()
    if not member:
        return jsonify({"error": "SSF ID not found."}), 404
    if member.cnic != cnic:
        return jsonify({"error": "The provided CNIC does not match our records."}), 400
    if member.account_activated:
        return jsonify({"error": "This account has already been activated.", "already_activated": True}), 400

    log_action(ssf_id, "activation_verify", ip_address=get_client_ip())
    return jsonify({
        "message": f"Hi, {member.full_name}! Your identity has been verified successfully.",
        "full_name": member.full_name,
    })


@app.post("/api/auth/activate/complete")
@limiter.limit("5 per hour")
def activate_complete():
    data = request.get_json(force=True, silent=True) or {}
    ssf_id = (data.get("ssf_id") or "").strip().upper()
    cnic = (data.get("cnic") or "").strip()
    password = data.get("password") or ""
    confirm_password = data.get("confirm_password") or ""

    member = Member.query.filter_by(ssf_id=ssf_id).first()
    if not member or member.cnic != cnic:
        return jsonify({"error": "Verification failed. Please restart activation."}), 400
    if member.account_activated:
        return jsonify({"error": "This account has already been activated."}), 400
    if password != confirm_password:
        return jsonify({"error": "Passwords do not match."}), 400
    pw_error = validate_password(password)
    if pw_error:
        return jsonify({"error": pw_error}), 400

    member.password_hash = hash_password(password)
    member.account_activated = True
    db.session.commit()

    log_action(ssf_id, "account_activated", ip_address=get_client_ip())
    return jsonify({"message": "Your account has been activated successfully. You can now log in."})


@app.post("/api/auth/login")
@limiter.limit("5 per minute")
def login():
    data = request.get_json(force=True, silent=True) or {}
    ssf_id = (data.get("ssf_id") or "").strip().upper()
    password = data.get("password") or ""

    member = Member.query.filter_by(ssf_id=ssf_id).first()
    if not member:
        return jsonify({"error": "Invalid SSF ID or password."}), 401

    if member.locked_until and member.locked_until > now_utc():
        return jsonify({"error": "Too many failed attempts. Please try again later."}), 423

    if not member.account_activated or not member.password_hash:
        return jsonify({"error": "Account not activated. Please activate your account first."}), 403

    if not check_password(password, member.password_hash):
        member.failed_login_attempts = (member.failed_login_attempts or 0) + 1
        if member.failed_login_attempts >= 5:
            member.locked_until = now_utc() + timedelta(minutes=15)
        db.session.commit()
        log_action(ssf_id, "login_failed", ip_address=get_client_ip(), status="failure")
        return jsonify({"error": "Invalid SSF ID or password."}), 401

    member.failed_login_attempts = 0
    member.locked_until = None
    db.session.commit()

    token = create_token(member)
    log_action(ssf_id, "login_success", ip_address=get_client_ip())
    return jsonify({"token": token, "member": member.to_dict()})


@app.post("/api/auth/logout")
@login_required
def logout():
    log_action(g.current_member.ssf_id, "logout", ip_address=get_client_ip())
    return jsonify({"message": "Logged out."})


@app.get("/api/auth/me")
@login_required
def me():
    return jsonify(g.current_member.to_dict())


# ---------------------------------------------------------------------------
# Public / Homepage
# ---------------------------------------------------------------------------

@app.get("/api/elections/public")
def public_election():
    election = (
        Election.query.filter(Election.status.in_(["active", "upcoming"]))
        .order_by(Election.created_at.desc())
        .first()
    )
    if not election:
        return jsonify({"election": None, "message": "No active election is available."})
    return jsonify({"election": {
        "id": election.id,
        "title": election.title,
        "description": election.description,
        "status": election.status,
        "start_time": election.start_time.isoformat() if election.start_time else None,
        "end_time": election.end_time.isoformat() if election.end_time else None,
    }})


# ---------------------------------------------------------------------------
# Voting (member-facing)
# ---------------------------------------------------------------------------

@app.get("/api/elections/<int:election_id>/ballot")
@login_required
def get_ballot(election_id):
    election = Election.query.get_or_404(election_id)
    if election.status != "active":
        return jsonify({"error": "This election is not currently open for voting."}), 403

    already_voted = VoteRecord.query.filter_by(
        member_id=g.current_member.id, election_id=election_id
    ).first()
    if already_voted:
        return jsonify({"error": "You have already voted in this election."}), 409

    return jsonify(election.as_dict())


@app.post("/api/elections/<int:election_id>/vote")
@limiter.limit("3 per minute")
@login_required
def cast_vote(election_id):
    election = Election.query.get_or_404(election_id)
    if election.status != "active":
        return jsonify({"error": "This election is not currently open for voting."}), 403

    existing = VoteRecord.query.filter_by(
        member_id=g.current_member.id, election_id=election_id
    ).first()
    if existing:
        return jsonify({"error": "You have already voted in this election."}), 409

    data = request.get_json(force=True, silent=True) or {}
    selections = data.get("selections") or {}  # { position_id: candidate_id }

    positions = {p.id: p for p in election.positions}
    if set(str(pid) for pid in positions.keys()) != set(str(k) for k in selections.keys()):
        return jsonify({"error": "You must select a candidate for every position."}), 400

    valid_candidate_ids = {c.id for p in election.positions for c in p.candidates}
    for candidate_id in selections.values():
        if int(candidate_id) not in valid_candidate_ids:
            return jsonify({"error": "Invalid candidate selection."}), 400

    try:
        for position_id, candidate_id in selections.items():
            db.session.add(BallotEntry(
                election_id=election_id,
                position_id=int(position_id),
                candidate_id=int(candidate_id),
            ))
        db.session.add(VoteRecord(member_id=g.current_member.id, election_id=election_id))
        db.session.commit()
    except Exception:
        db.session.rollback()
        return jsonify({"error": "Vote submission failed. Please try again."}), 500

    log_action(g.current_member.ssf_id, "vote_submitted", details=f"election_id={election_id}",
               ip_address=get_client_ip())
    return jsonify({"message": "Your vote has been submitted successfully. Thank you for participating."})


@app.get("/api/elections/<int:election_id>/results")
@login_required
def get_results(election_id):
    election = Election.query.get_or_404(election_id)
    if election.status not in ("closed", "archived") and g.current_member.role not in ("admin", "super_admin"):
        return jsonify({"error": "Results are hidden until the election closes."}), 403
    return jsonify(election.as_dict(include_results=True) if hasattr(election, "as_dict") else {})


# override as_dict to support include_results by monkey-friendly wrapper
def _election_results_dict(self, include_results=False):
    return {
        "id": self.id,
        "title": self.title,
        "status": self.status,
        "positions": [p.as_dict(include_results=include_results) for p in self.positions],
    }


Election.as_dict = lambda self, include_results=False: _election_results_dict(self, include_results)


# ---------------------------------------------------------------------------
# Admin - Elections
# ---------------------------------------------------------------------------

@app.get("/api/admin/elections")
@admin_required
def admin_list_elections():
    elections = Election.query.order_by(Election.created_at.desc()).all()
    return jsonify([e.as_dict() for e in elections])


@app.post("/api/admin/elections")
@admin_required
def admin_create_election():
    data = request.get_json(force=True, silent=True) or {}
    title = (data.get("title") or "").strip()
    if not title:
        return jsonify({"error": "Election title is required."}), 400
    election = Election(
        title=title,
        description=data.get("description"),
        created_by=g.current_member.id,
        status="draft",
    )
    db.session.add(election)
    db.session.commit()
    log_action(g.current_member.ssf_id, "election_created", details=title, ip_address=get_client_ip())
    return jsonify(election.as_dict()), 201


@app.put("/api/admin/elections/<int:election_id>")
@admin_required
def admin_update_election(election_id):
    election = Election.query.get_or_404(election_id)
    data = request.get_json(force=True, silent=True) or {}
    for field in ("title", "description"):
        if field in data:
            setattr(election, field, data[field])
    for field in ("start_time", "end_time"):
        if data.get(field):
            setattr(election, field, datetime.fromisoformat(data[field]))
    db.session.commit()
    log_action(g.current_member.ssf_id, "election_updated", details=str(election_id), ip_address=get_client_ip())
    return jsonify(election.as_dict())


@app.post("/api/admin/elections/<int:election_id>/status")
@admin_required
def admin_change_election_status(election_id):
    election = Election.query.get_or_404(election_id)
    data = request.get_json(force=True, silent=True) or {}
    new_status = data.get("status")
    valid = {"draft", "upcoming", "active", "closed", "archived"}
    if new_status not in valid:
        return jsonify({"error": "Invalid status."}), 400
    election.status = new_status
    db.session.commit()
    log_action(g.current_member.ssf_id, "election_status_changed",
               details=f"{election_id} -> {new_status}", ip_address=get_client_ip())
    return jsonify(election.as_dict())


@app.delete("/api/admin/elections/<int:election_id>")
@admin_required
def admin_delete_election(election_id):
    election = Election.query.get_or_404(election_id)
    db.session.delete(election)
    db.session.commit()
    log_action(g.current_member.ssf_id, "election_deleted", details=str(election_id), ip_address=get_client_ip())
    return jsonify({"message": "Election deleted."})


# ---------------------------------------------------------------------------
# Admin - Positions & Candidates
# ---------------------------------------------------------------------------

@app.post("/api/admin/elections/<int:election_id>/positions")
@admin_required
def admin_create_position(election_id):
    Election.query.get_or_404(election_id)
    data = request.get_json(force=True, silent=True) or {}
    title = (data.get("title") or "").strip()
    if not title:
        return jsonify({"error": "Position title is required."}), 400
    position = Position(election_id=election_id, title=title,
                         max_selections=data.get("max_selections", 1))
    db.session.add(position)
    db.session.commit()
    log_action(g.current_member.ssf_id, "position_created", details=title, ip_address=get_client_ip())
    return jsonify(position.as_dict()), 201


@app.delete("/api/admin/positions/<int:position_id>")
@admin_required
def admin_delete_position(position_id):
    position = Position.query.get_or_404(position_id)
    db.session.delete(position)
    db.session.commit()
    log_action(g.current_member.ssf_id, "position_deleted", details=str(position_id), ip_address=get_client_ip())
    return jsonify({"message": "Position deleted."})


@app.post("/api/admin/positions/<int:position_id>/candidates")
@admin_required
def admin_create_candidate(position_id):
    Position.query.get_or_404(position_id)
    data = request.get_json(force=True, silent=True) or {}
    full_name = (data.get("full_name") or "").strip()
    if not full_name:
        return jsonify({"error": "Candidate name is required."}), 400
    candidate = Candidate(
        position_id=position_id,
        full_name=full_name,
        photo_url=data.get("photo_url"),
        bio=data.get("bio"),
        manifesto=data.get("manifesto"),
    )
    db.session.add(candidate)
    db.session.commit()
    log_action(g.current_member.ssf_id, "candidate_created", details=full_name, ip_address=get_client_ip())
    return jsonify(candidate.as_dict()), 201


@app.delete("/api/admin/candidates/<int:candidate_id>")
@admin_required
def admin_delete_candidate(candidate_id):
    candidate = Candidate.query.get_or_404(candidate_id)
    db.session.delete(candidate)
    db.session.commit()
    log_action(g.current_member.ssf_id, "candidate_deleted", details=str(candidate_id), ip_address=get_client_ip())
    return jsonify({"message": "Candidate deleted."})


# ---------------------------------------------------------------------------
# Admin - Members / Voters
# ---------------------------------------------------------------------------

@app.get("/api/admin/members")
@admin_required
def admin_list_members():
    members = Member.query.order_by(Member.created_at.desc()).all()
    return jsonify([m.to_dict() for m in members])


@app.post("/api/admin/members")
@admin_required
def admin_create_member():
    data = request.get_json(force=True, silent=True) or {}
    ssf_id = (data.get("ssf_id") or "").strip().upper()
    cnic = (data.get("cnic") or "").strip()
    full_name = (data.get("full_name") or "").strip()

    if not ssf_id or not cnic or not full_name:
        return jsonify({"error": "SSF ID, full name, and CNIC are required."}), 400
    if Member.query.filter_by(ssf_id=ssf_id).first():
        return jsonify({"error": "This SSF ID is already registered."}), 409

    member = Member(
        ssf_id=ssf_id,
        full_name=full_name,
        cnic=cnic,
        phone_number=data.get("phone_number"),
        email=data.get("email"),
        department=data.get("department"),
        batch=data.get("batch"),
        role=data.get("role", "voter"),
    )
    db.session.add(member)
    db.session.commit()
    log_action(g.current_member.ssf_id, "member_registered", details=ssf_id, ip_address=get_client_ip())
    return jsonify(member.to_dict()), 201


@app.post("/api/admin/members/import-csv")
@admin_required
def admin_import_members_csv():
    if "file" not in request.files:
        return jsonify({"error": "No CSV file uploaded."}), 400
    file = request.files["file"]
    stream = io.StringIO(file.stream.read().decode("utf-8"))
    reader = csv.DictReader(stream)

    created, skipped, errors = 0, 0, []
    for row in reader:
        ssf_id = (row.get("ssf_id") or "").strip().upper()
        cnic = (row.get("cnic") or "").strip()
        full_name = (row.get("full_name") or "").strip()
        if not ssf_id or not cnic or not full_name:
            errors.append(f"Row skipped due to missing required fields: {row}")
            continue
        if Member.query.filter_by(ssf_id=ssf_id).first():
            skipped += 1
            continue
        db.session.add(Member(
            ssf_id=ssf_id, full_name=full_name, cnic=cnic,
            phone_number=row.get("phone_number"), email=row.get("email"),
            department=row.get("department"), batch=row.get("batch"),
        ))
        created += 1
    db.session.commit()
    log_action(g.current_member.ssf_id, "csv_import", details=f"created={created} skipped={skipped}",
               ip_address=get_client_ip())
    return jsonify({"created": created, "skipped": skipped, "errors": errors})


@app.get("/api/admin/members/export-csv")
@admin_required
def admin_export_members_csv():
    members = Member.query.all()
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(["ssf_id", "full_name", "department", "batch", "status", "account_activated"])
    for m in members:
        writer.writerow([m.ssf_id, m.full_name, m.department, m.batch, m.status, m.account_activated])
    log_action(g.current_member.ssf_id, "csv_export", ip_address=get_client_ip())
    return jsonify({"csv": output.getvalue()})


# ---------------------------------------------------------------------------
# Admin - Audit logs
# ---------------------------------------------------------------------------

@app.get("/api/admin/audit-logs")
@admin_required
def admin_audit_logs():
    logs = AuditLog.query.order_by(AuditLog.created_at.desc()).limit(500).all()
    return jsonify([l.as_dict() for l in logs])


# ---------------------------------------------------------------------------
# Bootstrap
# ---------------------------------------------------------------------------

def ensure_super_admin():
    if Member.query.filter_by(role="super_admin").first():
        return
    ssf_id = os.environ.get("SUPERADMIN_SSF_ID", "SSF000001")
    cnic = os.environ.get("SUPERADMIN_CNIC", "0000000000000")
    name = os.environ.get("SUPERADMIN_NAME", "Super Admin")
    password = os.environ.get("SUPERADMIN_PASSWORD", "ChangeMe@123")
    admin = Member(
        ssf_id=ssf_id, full_name=name, cnic=cnic, role="super_admin",
        account_activated=True, password_hash=hash_password(password),
    )
    db.session.add(admin)
    db.session.commit()


with app.app_context():
    db.create_all()
    ensure_super_admin()


if __name__ == "__main__":
    app.run(debug=os.environ.get("FLASK_ENV") != "production", port=5000)

"""
SSF E-Voting System - Database Models
SQLAlchemy ORM models matching the SRS data structures.
"""
from datetime import datetime, timezone
from flask_sqlalchemy import SQLAlchemy

db = SQLAlchemy()


def now_utc():
    return datetime.now(timezone.utc)


class Member(db.Model):
    """A registered SSF member. Role determines voter vs administrator access."""
    __tablename__ = "members"

    id = db.Column(db.Integer, primary_key=True)
    ssf_id = db.Column(db.String(20), unique=True, nullable=False, index=True)
    full_name = db.Column(db.String(120), nullable=False)
    cnic = db.Column(db.String(20), nullable=False)
    phone_number = db.Column(db.String(20))
    email = db.Column(db.String(120))
    department = db.Column(db.String(120))
    batch = db.Column(db.String(50))
    role = db.Column(db.String(20), default="voter", nullable=False)  # voter | admin | super_admin
    status = db.Column(db.String(20), default="active")  # active | suspended
    password_hash = db.Column(db.String(255))
    account_activated = db.Column(db.Boolean, default=False)
    failed_login_attempts = db.Column(db.Integer, default=0)
    locked_until = db.Column(db.DateTime)
    created_at = db.Column(db.DateTime, default=now_utc)
    updated_at = db.Column(db.DateTime, default=now_utc, onupdate=now_utc)

    votes = db.relationship("VoteRecord", backref="member", lazy=True)

    def to_dict(self, include_sensitive=False):
        data = {
            "id": self.id,
            "ssf_id": self.ssf_id,
            "full_name": self.full_name,
            "phone_number": self.phone_number,
            "email": self.email,
            "department": self.department,
            "batch": self.batch,
            "role": self.role,
            "status": self.status,
            "account_activated": self.account_activated,
            "created_at": self.created_at.isoformat() if self.created_at else None,
        }
        if include_sensitive:
            data["cnic"] = self.cnic
        return data


class Election(db.Model):
    __tablename__ = "elections"

    id = db.Column(db.Integer, primary_key=True)
    title = db.Column(db.String(200), nullable=False)
    description = db.Column(db.Text)
    status = db.Column(db.String(20), default="draft")  # draft | upcoming | active | closed | archived
    start_time = db.Column(db.DateTime)
    end_time = db.Column(db.DateTime)
    created_by = db.Column(db.Integer, db.ForeignKey("members.id"))
    created_at = db.Column(db.DateTime, default=now_utc)
    updated_at = db.Column(db.DateTime, default=now_utc, onupdate=now_utc)

    positions = db.relationship("Position", backref="election", cascade="all, delete-orphan", lazy=True)

    def to_dict():
        pass

    def as_dict(self):
        return {
            "id": self.id,
            "title": self.title,
            "description": self.description,
            "status": self.status,
            "start_time": self.start_time.isoformat() if self.start_time else None,
            "end_time": self.end_time.isoformat() if self.end_time else None,
            "positions": [p.as_dict() for p in self.positions],
        }


class Position(db.Model):
    __tablename__ = "positions"

    id = db.Column(db.Integer, primary_key=True)
    election_id = db.Column(db.Integer, db.ForeignKey("elections.id"), nullable=False)
    title = db.Column(db.String(120), nullable=False)
    max_selections = db.Column(db.Integer, default=1)
    display_order = db.Column(db.Integer, default=0)

    candidates = db.relationship("Candidate", backref="position", cascade="all, delete-orphan", lazy=True)

    def as_dict(self, include_results=False):
        data = {
            "id": self.id,
            "election_id": self.election_id,
            "title": self.title,
            "max_selections": self.max_selections,
            "candidates": [c.as_dict(include_results=include_results) for c in self.candidates],
        }
        return data


class Candidate(db.Model):
    __tablename__ = "candidates"

    id = db.Column(db.Integer, primary_key=True)
    position_id = db.Column(db.Integer, db.ForeignKey("positions.id"), nullable=False)
    full_name = db.Column(db.String(120), nullable=False)
    photo_url = db.Column(db.String(255))
    bio = db.Column(db.Text)
    manifesto = db.Column(db.Text)
    display_order = db.Column(db.Integer, default=0)

    def as_dict(self, include_results=False):
        data = {
            "id": self.id,
            "position_id": self.position_id,
            "full_name": self.full_name,
            "photo_url": self.photo_url,
            "bio": self.bio,
            "manifesto": self.manifesto,
        }
        if include_results:
            data["vote_count"] = BallotEntry.query.filter_by(candidate_id=self.id).count()
        return data


class VoteRecord(db.Model):
    """Records THAT a member voted in an election (no candidate link) - preserves ballot secrecy."""
    __tablename__ = "vote_records"

    id = db.Column(db.Integer, primary_key=True)
    member_id = db.Column(db.Integer, db.ForeignKey("members.id"), nullable=False)
    election_id = db.Column(db.Integer, db.ForeignKey("elections.id"), nullable=False)
    submitted_at = db.Column(db.DateTime, default=now_utc)

    __table_args__ = (db.UniqueConstraint("member_id", "election_id", name="uq_member_election_vote"),)


class BallotEntry(db.Model):
    """The anonymous ballot itself - deliberately has NO link back to the member who cast it."""
    __tablename__ = "ballot_entries"

    id = db.Column(db.Integer, primary_key=True)
    election_id = db.Column(db.Integer, db.ForeignKey("elections.id"), nullable=False)
    position_id = db.Column(db.Integer, db.ForeignKey("positions.id"), nullable=False)
    candidate_id = db.Column(db.Integer, db.ForeignKey("candidates.id"), nullable=False)
    cast_at = db.Column(db.DateTime, default=now_utc)


class AuditLog(db.Model):
    __tablename__ = "audit_logs"

    id = db.Column(db.Integer, primary_key=True)
    actor_ssf_id = db.Column(db.String(20))
    action = db.Column(db.String(120), nullable=False)
    details = db.Column(db.Text)
    ip_address = db.Column(db.String(64))
    user_agent = db.Column(db.String(255))
    status = db.Column(db.String(20), default="success")
    created_at = db.Column(db.DateTime, default=now_utc)

    def as_dict(self):
        return {
            "id": self.id,
            "actor_ssf_id": self.actor_ssf_id,
            "action": self.action,
            "details": self.details,
            "ip_address": self.ip_address,
            "status": self.status,
            "created_at": self.created_at.isoformat() if self.created_at else None,
        }


def log_action(actor_ssf_id, action, details=None, ip_address=None, user_agent=None, status="success"):
    entry = AuditLog(
        actor_ssf_id=actor_ssf_id,
        action=action,
        details=details,
        ip_address=ip_address,
        user_agent=user_agent,
        status=status,
    )
    db.session.add(entry)
    db.session.commit()

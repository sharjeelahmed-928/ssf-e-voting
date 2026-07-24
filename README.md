# SSF E-Voting System

A secure, modern online election platform for **Shikarpur Shagird Forum (SSF)**, built from the project's Software Requirements Specification.

- **Frontend:** HTML5, Tailwind CSS (CDN), vanilla JavaScript SPA, Chart.js, Font Awesome
- **Backend:** Python Flask REST API, JWT authentication, bcrypt password hashing, SQLAlchemy ORM
- **Database:** PostgreSQL (Neon or Supabase) — SQLite fallback for local development
- **Hosting:** Frontend → Vercel, Backend → Render, Database → Neon/Supabase

---

## What's included

This build implements the core system described in the SRS: member account activation (SSF ID + CNIC), secure login, election/position/candidate management, one-vote-per-member ballot casting with ballot-secrecy separation, automatic result tallying, CSV voter import/export, and an audit log. It is a solid working foundation you can extend — the SRS also lists a large set of optional future enhancements (2FA, SMS/WhatsApp notifications, multi-language support, etc.) that are not built here.

## Project structure

```
SSF-E-Voting/
├── frontend/
│   ├── index.html      # SPA shell
│   ├── style.css        # SSF branding, glassmorphism, animations
│   └── script.js         # Routing, API calls, all views
├── backend/
│   ├── app.py           # Flask app & all API routes
│   ├── database.py      # SQLAlchemy models
│   ├── requirements.txt
│   └── .env.example
├── sample_voters.csv    # Sample CSV for the voter import feature
└── README.md
```

## Local setup

### Backend

```bash
cd backend
python -m venv venv
source venv/bin/activate      # Windows: venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env          # then edit values as needed
python app.py                 # runs on http://localhost:5000
```

By default, if `DATABASE_URL` isn't set, the app uses a local SQLite file (`ssf_evoting.db`) so you can try it immediately. Swap in a PostgreSQL connection string from Neon or Supabase for anything beyond local testing.

On first run, a Super Admin account is created automatically using the `SUPERADMIN_*` values in `.env` (defaults: SSF ID `SSF000001`, password `ChangeMe@123` — **change this immediately**).

### Frontend

The frontend is static — no build step. Open `frontend/index.html` with a local server (e.g. the VS Code "Live Server" extension, or `python -m http.server` from the `frontend/` folder) so the browser's `fetch` calls work correctly.

In `frontend/script.js`, `API_BASE` auto-detects `localhost` and points at `http://localhost:5000/api`. Update the production fallback URL to your deployed Render backend before deploying.

## Deployment

1. **Database:** Create a free PostgreSQL instance on [Neon](https://neon.tech) or [Supabase](https://supabase.com). Copy the connection string into `DATABASE_URL`.
2. **Backend (Render):** Create a new Web Service from the `backend/` folder. Build command: `pip install -r requirements.txt`. Start command: `gunicorn app:app`. Add all variables from `.env.example` under Render's Environment settings.
3. **Frontend (Vercel):** Deploy the `frontend/` folder as a static site. Update `API_BASE` in `script.js` to your live Render URL before deploying.
4. Update `ALLOWED_ORIGINS` in the backend environment to include your live Vercel URL so CORS allows requests from it.

## Administrator guide (quick start)

1. Log in with the Super Admin SSF ID/password from your `.env`.
2. Go to **Elections → New Election**, set a title, then add **Positions** and **Candidates** under it.
3. Register voters individually or via **Import CSV** (see `sample_voters.csv` for the expected columns).
4. Change the election's status dropdown to `active` to open voting, then `closed` when finished — results become visible automatically once closed.
5. Review **Audit Logs** at any time for a record of key actions.

## Member guide (quick start)

1. From the homepage, click **Activate your account**, enter your SSF ID and CNIC, then set a password.
2. Log in with your SSF ID and password.
3. When an election is active, click **Cast Your Vote**, select one candidate per position, review, and submit — each member can vote exactly once per election.
4. Once an election closes, **Results** shows the tallied vote counts per position.

## Security notes

- Passwords are hashed with bcrypt and never stored or logged in plain text.
- JWTs expire after 24 hours by default (`JWT_EXPIRY_HOURS`).
- Ballots are stored separately from the record of *who* voted, preserving ballot secrecy.
- Sensitive endpoints (login, activation, voting) are rate-limited.
- Always serve both frontend and backend over HTTPS in production.

---

**Developed for:** Shikarpur Shagird Forum (SSF)
**Version:** 1.0

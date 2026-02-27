# PCOD Care — Prototype

Minimal full-stack prototype for a PCOD tracking web app. Includes a small Express API (auth + period logs + symptoms) and a static React frontend (served by the backend).

Quick start (Windows):

1. Install dependencies

```powershell
cd "c:/Users/DM WDS/Desktop/new pcod file/pcod-prototype"
npm install
```

2. Run server

```powershell
npm start
# or for live reload during development:
npm run dev
```

3. Open http://localhost:4000 in your browser.

Notes:
- This prototype uses SQLite by default (`data.sqlite` file in the project). To use MySQL, replace the DB layer and connection (future step).
- JWT secret can be set via `JWT_SECRET` env var.

Docker deployment (local):

```powershell
cd "c:/Users/DM WDS/Desktop/new pcod file/pcod-prototype"
docker-compose up --build
```

The app will be available on `http://localhost:4000`. The SQLite file `data.sqlite` is persisted in the project root.

MySQL (optional):

1. Set environment variables:

```powershell
set MYSQL_HOST=your_mysql_host
set MYSQL_USER=your_user
set MYSQL_PASSWORD=your_password
set MYSQL_DATABASE=pcod_db
```

2. Run the initializer to create tables:

```powershell
node create-mysql.js
```

Email reminders:
- Configure `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, and `SMTP_FROM` in environment to enable email sending.

PDF export:
- Use `GET /api/export/report` with Authorization header to download a PDF report.

Next steps:
- Add diet/workout endpoints and UI
- Add charts (Chart.js / Recharts)
- Replace SQLite with MySQL and add migrations
- Add reminders and email notifications

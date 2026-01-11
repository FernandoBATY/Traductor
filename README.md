# Traductor – Quick Start

This project includes a Node.js backend (Express) and a Python (Flask/Waitress) service for camera-based gesture recognition. The Node server proxies to the Python service and serves the UI.

## Prerequisites
- Windows with PowerShell
- Node.js 18+ and npm
- Python 3.10+ with the `py` launcher (or `python` in PATH)
- MySQL Server (optional, for auth/user storage). Defaults: host `localhost`, user `root`, password `21617`, db `usuarios`. You can change these via environment variables.

## One-Time Setup
After cloning, run:

```powershell
# From the project root
npm install
```

The `postinstall` step will:
- Install Python dependencies from `requirements.txt` (tries `py` then `python`)
- Optionally import `base.sql` into MySQL if the `mysql` CLI is available

If Python or MySQL are not in PATH, install them and rerun `npm install` or install manually:

```powershell
py -m pip install -r requirements.txt
# or
python -m pip install -r requirements.txt

# Optional: initialize DB
mysql -h localhost -u root -p21617 < base.sql
```

## Run
Start everything with:

```powershell
npm start
```

- Node server listens on http://localhost:3000
- Python service (started by Node) listens on http://localhost:5000

Open http://localhost:3000 to use the app. The Node server proxies video feed endpoints to the Python service.

### One-command setup
You can automate install, DB init, and startup with:

```powershell
./setup.ps1
```

## Configuration
Create a `.env` file (optional) to override defaults:

```
DB_HOST=localhost
DB_USER=root
DB_PASS=21617
DB_NAME=usuarios
PORT=3000
```

## Troubleshooting
- If the camera cannot be accessed, close other apps using it and retry.
- If Python deps are missing, rerun the pip install commands above.
- If MySQL is not installed, skip DB init or install MySQL and run `base.sql`.

## Development Notes
- Node entry: `server.js` → `backend/server.js`
- Python entry: `scrips/reconocimiento.py` (served via Waitress)
- UI templates: `templates/`
- Static assets: `static/`, `js/`

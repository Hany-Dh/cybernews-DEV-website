# CyberNews — Threat Intelligence Platform
### Cybersecurity Class Exercise

A full-stack cybersecurity dashboard with real data feeds and AI analysis.

---

## Tech Stack
- **Backend**: Python 3 + Flask
- **Frontend**: HTML5, CSS3, Vanilla JavaScript
- **Data Sources**:
  - 🛡️ NVD/NIST CVE API v2 (live vulnerabilities)
  - 🦠 abuse.ch URLhaus (live malicious URL IOCs)
  - 📰 HackerNews Algolia API (cybersecurity news)
  - 🤖 Google Gemini 2.5. Flash (threat analysis)
  - 🦠 attack.mitre.org

---

## Setup

```bash
# 1. Navigate to project
cd cybernews

# 2. Install dependencies
pip install -r requirements.txt

# 3. Run the server
python app.py
```

Then open: **http://localhost:5000**

---

## Features

| Module | Description |
|--------|-------------|
| **CTI Platform** | Search CVEs from NVD database by keyword & severity |
| **SOC Dashboard** | Live threat level meter, attack vectors, geo map, alerts |
| **Aggregation** | Cybersecurity news via HackerNews (searchable) |
| **IOC Tracking** | Live malicious URLs from abuse.ch URLhaus |
| **AI Analysis** | Claude AI threat analysis with typewriter output |
| **Real-Time** | Simulated live threat event stream |

---

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/cves` | GET | Fetch CVEs from NVD (`?keyword=&severity=`) |
| `/api/news` | GET | Fetch cybersecurity news (`?q=`) |
| `/api/ioc` | GET | Fetch live malicious URLs from abuse.ch |
| `/api/stats` | GET | Platform statistics |
| `/api/ai-analyze` | POST | AI threat analysis (`{"topic":"...","context":"..."}`) |

---

## Keyboard Shortcuts
- **Enter** in any search field → triggers search
- All sections are accessible via the top navigation bar


.env file
--------------------
# ─────────────────────────────────────────────────────────────────
#  CyberNews v3.0 — Environment Configuration
# ─────────────────────────────────────────────────────────────────
#  Copy this file to .env and fill in your real key.
#  NEVER commit .env to version control.
#
#  Get your Gemini API key at:
#  https://aistudio.google.com/app/apikey
#
# abuse.ch Auth-Key — used for URLhaus & ThreatFox IOC feeds
# Get yours FREE at: https://auth.abuse.ch/
# (Sign in with GitHub / Google / LinkedIn, then generate an Auth-Key)
#
# AbuseIPDB API Key — used for LIVE SOC Dashboard alerts, threat level & attack>
# Register FREE at: https://www.abuseipdb.com/register  (1000 requests/day free)
#
#  Optional: override the default model of Google Gemini 2.5 Flash
# ─────────────────────────────────────────────────────────────────


.gitignore
-------------------------
# Environment variables
.env

# Python cache
__pycache__/
*.pyc

# Virtual environments
venv/
.env/

# IDE files
.vscode/
.idea/

# OS files
.DS_Store
Thumbs.db


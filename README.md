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

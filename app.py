"""
app.py
──────
CyberNews v3.0 — Flask Application
AI Backend: Google Gemini 2.0 Flash

All AI routes delegate to:
  ai_analysis_engine.py  — threat analysis, IR playbooks, MITRE, CVE, IOC
  rule_generator.py      — detection rule generation, validation, explanation

Environment (.env in project root):
  GOOGLE_API_KEY  — required for all AI routes
  GEMINI_MODEL    — optional (default: gemini-2.5-flash-preview-04-17)
  FLASK_PORT      — optional (default: 5000)
  FLASK_DEBUG     — optional (default: true)
"""

import os
import json
import ssl
import random
import urllib.request
import urllib.parse
from datetime import datetime
from flask import Flask, render_template, jsonify, request, Response

# ── AI engine modules (both use Gemini via .env) ──────────────────────────────
from ai_analysis_engine import (
    analyse_threat,
    generate_ir_playbook,
    explain_mitre_technique,
    summarise_cve,
    classify_ioc,
    stream_analysis,
)
from rule_generator import (
    generate_rule,
    validate_rule,
    explain_rule,
    suggest_improvements,
    flask_generate_rule_handler,
    flask_validate_rule_handler,
    flask_explain_rule_handler,
)

# ─── APP SETUP ────────────────────────────────────────────────────────────────

app = Flask(__name__)

# ─── UTILITY ──────────────────────────────────────────────────────────────────

def fetch_json(url: str, headers: dict = None) -> dict:
    """Fetch and parse JSON from a public URL (SSL verification relaxed for feeds)."""
    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode    = ssl.CERT_NONE
    req = urllib.request.Request(url, headers=headers or {
        "User-Agent": "CyberNews-Dashboard/3.0"
    })
    with urllib.request.urlopen(req, context=ctx, timeout=10) as r:
        return json.loads(r.read().decode())


# ─── MAIN ROUTE ───────────────────────────────────────────────────────────────

@app.route("/")
def index():
    return render_template("index.html")


# ══════════════════════════════════════════════════════════════════════════════
#  REAL-DATA ROUTES
# ══════════════════════════════════════════════════════════════════════════════

@app.route("/api/cves")
def get_cves():
    """Live CVE feed from NVD API v2. Params: ?keyword=&severity="""
    severity = request.args.get("severity", "")
    keyword  = request.args.get("keyword", "")
    try:
        params = {"resultsPerPage": 10, "startIndex": 0}
        if keyword:
            params["keywordSearch"] = keyword
        if severity:
            params["cvssV3Severity"] = severity.upper()

        url  = "https://services.nvd.nist.gov/rest/json/cves/2.0?" + urllib.parse.urlencode(params)
        data = fetch_json(url)
        cves = []

        for item in data.get("vulnerabilities", []):
            cve     = item["cve"]
            metrics = cve.get("metrics", {})
            score, sev = None, "N/A"

            if "cvssMetricV31" in metrics:
                score = metrics["cvssMetricV31"][0]["cvssData"]["baseScore"]
                sev   = metrics["cvssMetricV31"][0]["cvssData"]["baseSeverity"]
            elif "cvssMetricV30" in metrics:
                score = metrics["cvssMetricV30"][0]["cvssData"]["baseScore"]
                sev   = metrics["cvssMetricV30"][0]["cvssData"]["baseSeverity"]
            elif "cvssMetricV2" in metrics:
                score = metrics["cvssMetricV2"][0]["cvssData"]["baseScore"]
                sev   = metrics["cvssMetricV2"][0].get("baseSeverity", "N/A")

            desc = next(
                (d["value"] for d in cve.get("descriptions", []) if d["lang"] == "en"), ""
            )
            cves.append({
                "id":          cve["id"],
                "description": desc[:300] + ("…" if len(desc) > 300 else ""),
                "score":       score,
                "severity":    sev,
                "published":   cve.get("published", "")[:10],
                "url":         f"https://nvd.nist.gov/vuln/detail/{cve['id']}",
            })
        return jsonify({"success": True, "data": cves})
    except Exception as exc:
        return jsonify({"success": False, "error": str(exc)})


@app.route("/api/news")
def get_news():
    """Cybersecurity news from HackerNews Algolia API. Params: ?q="""
    query = request.args.get("q", "cybersecurity")
    try:
        url  = (f"https://hn.algolia.com/api/v1/search"
                f"?query={urllib.parse.quote(query)}&tags=story&hitsPerPage=12")
        data = fetch_json(url)
        news = [
            {
                "title":  hit.get("title", "No title"),
                "url":    hit.get("url") or
                          f"https://news.ycombinator.com/item?id={hit.get('objectID')}",
                "author": hit.get("author", "unknown"),
                "points": hit.get("points", 0),
                "date":   hit.get("created_at", "")[:10],
                "source": "Hacker News",
            }
            for hit in data.get("hits", [])
        ]
        return jsonify({"success": True, "data": news})
    except Exception as exc:
        return jsonify({"success": False, "error": str(exc)})


@app.route("/api/ioc")
def get_ioc():
    """
    Live IOC feed.  Strategy (automatic fallback):
      1. URLhaus  /v1/urls/recent/  — requires Auth-Key header (abuse.ch auth)
      2. ThreatFox /api/v1/         — same Auth-Key, richer IOC types (C2, botnet, etc.)
      3. URLhaus plain-text list    — no auth required, returns raw URL lines

    Get a free Auth-Key at https://auth.abuse.ch/
    Add it to .env as:  URLHAUS_AUTH_KEY=<your_key>
    """
    auth_key = os.environ.get("URLHAUS_AUTH_KEY", "")
    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode    = ssl.CERT_NONE

    # ── 1. URLhaus (authenticated) ────────────────────────────────────────────
    if auth_key:
        try:
            req = urllib.request.Request(
                "https://urlhaus-api.abuse.ch/v1/urls/recent/",
                method  = "GET",
                headers = {
                    "Auth-Key":   auth_key,
                    "User-Agent": "CyberNews/3.0",
                },
            )
            with urllib.request.urlopen(req, context=ctx, timeout=10) as r:
                data = json.loads(r.read().decode())

            if data.get("query_status") == "ok" or data.get("urls"):
                iocs = [
                    {
                        "url":        e.get("url", ""),
                        "ref_url":    e.get("urlhaus_reference", ""),          # ← clickable URLhaus page
                        "status":     e.get("url_status", "unknown"),
                        "tags":       [t for t in (e.get("tags") or []) if t],  # ← filter None entries
                        "date_added": (e.get("date_added") or "")[:10],
                        "threat":     e.get("threat", "malware_download"),
                        "host":       e.get("host", ""),
                        "source":     "URLhaus",
                    }
                    for e in (data.get("urls") or [])[:20]
                ]
                return jsonify({"success": True, "data": iocs, "source": "URLhaus"})
        except Exception:
            pass  # fall through to ThreatFox

    # ── 2. ThreatFox (authenticated, richer IOC types) ────────────────────────
    if auth_key:
        try:
            body = json.dumps({"query": "get_iocs", "days": 3}).encode()
            req  = urllib.request.Request(
                "https://threatfox-api.abuse.ch/api/v1/",
                data    = body,
                method  = "POST",
                headers = {
                    "Auth-Key":     auth_key,
                    "Content-Type": "application/json",
                    "User-Agent":   "CyberNews/3.0",
                },
            )
            with urllib.request.urlopen(req, context=ctx, timeout=10) as r:
                data = json.loads(r.read().decode())

            iocs = []
            for e in (data.get("data") or [])[:20]:
                ioc_val = e.get("ioc", "")
                iocs.append({
                    "url":        ioc_val,
                    "ref_url":    f"https://threatfox.abuse.ch/ioc/{e.get('id', '')}/",  # ← clickable ThreatFox page
                    "status":     "online",
                    "tags":       [t for t in (e.get("tags") or []) if t],               # ← filter None entries
                    "date_added": (e.get("first_seen") or "")[:10],
                    "threat":     e.get("threat_type", ""),
                    "host":       e.get("malware_printable", ""),
                    "source":     "ThreatFox",
                    "confidence": e.get("confidence_level", ""),
                    "ioc_type":   e.get("ioc_type", ""),
                })
            if iocs:
                return jsonify({"success": True, "data": iocs, "source": "ThreatFox"})
        except Exception:
            pass  # fall through to plain-text list

    # ── 3. URLhaus CSV (no auth, includes id/url/date/threat/tags columns) ──────
    try:
        req = urllib.request.Request(
            "https://urlhaus.abuse.ch/downloads/csv_recent/",
            headers = {"User-Agent": "CyberNews/3.0"},
        )
        with urllib.request.urlopen(req, context=ctx, timeout=10) as r:
            raw = r.read().decode("utf-8", errors="replace")

        # CSV format: # id,dateadded,url,url_status,last_online,threat,tags,urlhaus_link,reporter
        iocs = []
        for line in raw.splitlines():
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            parts = line.split('","')
            if len(parts) < 8:
                continue
            # Strip leading/trailing quotes from first/last fields
            parts[0] = parts[0].lstrip('"')
            parts[-1] = parts[-1].rstrip('"')
            try:
                url_id     = parts[0].strip()        # numeric URLhaus id
                date_val   = parts[1][:10]
                url_val    = parts[2]
                status_val = parts[3]
                threat_val = parts[5]
                tags_raw   = parts[6]
                # parts[7] = urlhaus_link — sometimes empty or a redirect, so build canonical
                ref_val    = f"https://urlhaus.abuse.ch/url/{url_id}/" if url_id.isdigit() \
                             else parts[7].strip()
                host_val   = url_val.split("/")[2] if "//" in url_val else url_val[:40]
                tags_list  = [t.strip() for t in tags_raw.split(",")
                              if t.strip() and t.strip() not in ("None", "")]
                iocs.append({
                    "url":        url_val,
                    "ref_url":    ref_val,      # ← canonical https://urlhaus.abuse.ch/url/<id>/
                    "status":     status_val,
                    "tags":       tags_list,
                    "date_added": date_val,
                    "threat":     threat_val,
                    "host":       host_val,
                    "source":     "URLhaus",
                })
                if len(iocs) >= 20:
                    break
            except (IndexError, ValueError):
                continue

        if iocs:
            note = ("No URLHAUS_AUTH_KEY set in .env — showing CSV feed (limited metadata). "
                    "Get a free key at https://auth.abuse.ch/ for full live data.")
            return jsonify({"success": True, "data": iocs, "source": "URLhaus", "note": note})

    except Exception as exc:
        return jsonify({
            "success": False,
            "error":   (
                f"All IOC sources failed: {exc}. "
                "Add URLHAUS_AUTH_KEY=<key> to your .env file. "
                "Get a free key at https://auth.abuse.ch/"
            )
        })


@app.route("/api/stats")
def get_stats():
    """Dashboard threat statistics (seed changes every minute for a live feel)."""
    random.seed(int(datetime.now().timestamp() / 60))
    return jsonify({
        "success": True,
        "ai_model": os.environ.get("GEMINI_MODEL", "gemini-2.5-flash-preview-04-17"),
        "data": {
            "active_threats":   random.randint(1200, 2400),
            "cves_today":       random.randint(18, 60),
            "blocked_attacks":  random.randint(40000, 95000),
            "malware_samples":  random.randint(300, 800),
            "phishing_urls":    random.randint(500, 1500),
            "threat_countries": random.randint(45, 80),
        },
    })


# ══════════════════════════════════════════════════════════════════════════════
#  AI ANALYSIS ROUTES  →  ai_analysis_engine.py  →  Gemini 2.5 Flash
# ══════════════════════════════════════════════════════════════════════════════

@app.route("/api/ai-analyze", methods=["POST"])
def ai_analyze():
    """
    General threat / topic analysis.
    Body: { "topic": "Log4Shell", "context": "<optional extra text>" }
    """
    payload = request.get_json(force=True)
    topic   = payload.get("topic", "").strip()
    context = payload.get("context", "").strip()
    if not topic:
        return jsonify({"success": False, "error": "topic is required"})
    return jsonify(analyse_threat(topic, context).to_dict())


@app.route("/api/ai-cve", methods=["POST"])
def ai_cve():
    """
    CVE-specific analyst briefing.
    Body: { "cve_id": "CVE-2024-3094", "description": "...", "score": 10.0, "severity": "CRITICAL" }
    """
    p = request.get_json(force=True)
    return jsonify(summarise_cve(
        cve_id      = p.get("cve_id", ""),
        description = p.get("description", ""),
        score       = p.get("score"),
        severity    = p.get("severity", ""),
    ).to_dict())


@app.route("/api/ai-ioc", methods=["POST"])
def ai_ioc():
    """
    IOC classification and attribution.
    Body: { "url": "http://...", "tags": ["emotet"], "threat_type": "malware_download" }
    """
    p = request.get_json(force=True)
    return jsonify(classify_ioc(
        url         = p.get("url", ""),
        tags        = p.get("tags"),
        threat_type = p.get("threat_type", ""),
    ).to_dict())


@app.route("/api/ai-mitre", methods=["POST"])
def ai_mitre():
    """
    MITRE ATT&CK technique deep-dive.
    Body: { "technique_id": "T1059", "technique_name": "...", "tactic": "Execution" }
    """
    p = request.get_json(force=True)
    return jsonify(explain_mitre_technique(
        technique_id   = p.get("technique_id", ""),
        technique_name = p.get("technique_name", ""),
        tactic         = p.get("tactic", ""),
    ).to_dict())


@app.route("/api/ai-playbook", methods=["POST"])
def ai_playbook():
    """
    Incident response playbook generator.
    Body: { "title": "...", "category": "ransomware", "severity": "critical", "description": "..." }
    """
    p = request.get_json(force=True)
    return jsonify(generate_ir_playbook(
        title       = p.get("title", ""),
        category    = p.get("category", "other"),
        severity    = p.get("severity", "medium"),
        description = p.get("description", ""),
    ).to_dict())


@app.route("/api/stream-analysis")
def stream_analysis_route():
    """
    SSE streaming threat analysis.
    Query: ?topic=Log4Shell&context=<optional>
    Yields: data: {"delta":"..."}\n\n  →  data: {"done":true}\n\n
    """
    topic   = request.args.get("topic", "")
    context = request.args.get("context", "")
    return Response(stream_analysis(topic, context), mimetype="text/event-stream")


# ══════════════════════════════════════════════════════════════════════════════
#  DETECTION RULE ROUTES  →  rule_generator.py  →  Gemini 2.0 Flash
# ══════════════════════════════════════════════════════════════════════════════

@app.route("/api/generate-rule", methods=["POST"])
def gen_rule():
    """
    Generate a detection rule in Sigma / YARA / Suricata / Splunk SPL / KQL.
    Body: { "threat": "PowerShell encoded exec", "format": "sigma", "log_source": "sysmon" }
    """
    return jsonify(flask_generate_rule_handler(request.get_json(force=True)))


@app.route("/api/validate-rule", methods=["POST"])
def val_rule():
    """
    Validate an existing detection rule.
    Body: { "rule": "<rule text>", "format": "sigma" }
    Returns: { "validation": { "rating": "GOOD", "issues": [...], "fixes": [...] } }
    """
    return jsonify(flask_validate_rule_handler(request.get_json(force=True)))


@app.route("/api/explain-rule", methods=["POST"])
def exp_rule():
    """
    Explain a rule in plain English for junior analysts.
    Body: { "rule": "<rule text>", "format": "sigma" }
    """
    return jsonify(flask_explain_rule_handler(request.get_json(force=True)))


@app.route("/api/improve-rule", methods=["POST"])
def improve_rule_route():
    """
    Suggest hardening improvements for a detection rule.
    Body: { "rule": "<rule text>", "format": "sigma" }
    """
    p      = request.get_json(force=True)
    result = suggest_improvements(p.get("rule", ""), p.get("format", "sigma"))
    return jsonify(result.to_dict())


# ══════════════════════════════════════════════════════════════════════════════
#  ENTRY POINT
# ══════════════════════════════════════════════════════════════════════════════

if __name__ == "__main__":
    host  = os.environ.get("FLASK_HOST", "0.0.0.0")
    port  = int(os.environ.get("FLASK_PORT",  5000))
    debug = os.environ.get("FLASK_DEBUG", "true").lower() == "true"

    print(f"""
╔══════════════════════════════════════════════════════╗
║      CyberNews v3.0  —  Threat Intel Platform        ║
║      AI Backend: Google Gemini 2.5 Flash             ║
║      abuse.ch URLhaus                                ║
╠══════════════════════════════════════════════════════╣
║  http://localhost:{port:<5}                              ║
║                                                      ║
║  Real-data  GET  /api/cves                           ║
║             GET  /api/news                           ║
║             GET  /api/ioc                            ║
║             GET  /api/stats                          ║
║                                                      ║
║  AI (POST)  /api/ai-analyze   General analysis       ║
║             /api/ai-cve       CVE briefing           ║
║             /api/ai-ioc       IOC classification     ║
║             /api/ai-mitre     MITRE deep-dive        ║
║             /api/ai-playbook  IR playbook            ║
║  AI (GET)   /api/stream-analysis  SSE stream         ║
║                                                      ║
║  Rules(POST)/api/generate-rule                       ║
║             /api/validate-rule                       ║
║             /api/explain-rule                        ║
║             /api/improve-rule                        ║
╚══════════════════════════════════════════════════════╝
""")
    app.run(debug=debug, host=host, port=port)

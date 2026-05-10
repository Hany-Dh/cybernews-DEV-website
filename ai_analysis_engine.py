"""
ai_analysis_engine.py
─────────────────────
CyberNews v3.0 — AI Analysis Engine
Powered by Google Gemini 2.0 Flash

Provides specialised threat-analysis functions used by app.py:
  - analyse_threat(topic, context)                               → general threat intel
  - generate_ir_playbook(title, category, severity, description) → NIST IR playbook
  - explain_mitre_technique(technique_id, name, tactic)          → ATT&CK deep-dive
  - summarise_cve(cve_id, description, score, severity)          → CVE analyst briefing
  - classify_ioc(url, tags, threat_type)                         → IOC attribution
  - stream_analysis(topic, context)                              → SSE generator

Configuration (loaded from .env in project root):
  GOOGLE_API_KEY  — required
  GEMINI_MODEL    — optional, default: gemini-2.5-flash-preview-04-17

API reference: https://ai.google.dev/api/generate-content
"""

import json
import os
import ssl
import urllib.request
import urllib.error
from datetime import datetime
from typing import Generator

# ─── LOAD .env ────────────────────────────────────────────────────────────────

def _load_env(path: str = ".env") -> None:
    """Minimal .env loader — no third-party dependency required."""
    if not os.path.exists(path):
        return
    with open(path, encoding="utf-8") as fh:
        for raw in fh:
            line = raw.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, _, val = line.partition("=")
            key = key.strip()
            val = val.strip().strip('"').strip("'")
            if key not in os.environ:          # shell exports take priority
                os.environ[key] = val

_load_env()

# ─── CONSTANTS ────────────────────────────────────────────────────────────────

GEMINI_MODEL    = os.environ.get("GEMINI_MODEL", "gemini-2.5-flash-preview-04-17")
_GEMINI_BASE    = "https://generativelanguage.googleapis.com/v1beta/models"
DEFAULT_MAX_TOK = 900
STREAM_MAX_TOK  = 1200

_SSL_CTX = ssl.create_default_context()


def _api_key() -> str:
    """Return the Gemini API key or raise a descriptive error."""
    key = os.environ.get("GOOGLE_API_KEY", "")
    if not key or key == "your_gemini_api_key_here":
        raise RuntimeError(
            "GOOGLE_API_KEY not configured. "
            "Open .env and set: GOOGLE_API_KEY=<your_key>  "
            "(get one at https://aistudio.google.com/app/apikey)"
        )
    return key


# ─── LOW-LEVEL HTTP HELPER ────────────────────────────────────────────────────

def _post_gemini(prompt: str, system_instruction: str,
                 max_tokens: int = DEFAULT_MAX_TOK) -> dict:
    """
    POST a prompt to the Gemini generateContent REST endpoint.

    Gemini uses a 'system_instruction' top-level field (v1beta) to set the
    persona, so we use that directly rather than the multi-turn workaround.

    Response shape (success):
    {
      "candidates": [
        { "content": { "parts": [{"text": "..."}], "role": "model" } }
      ],
      "usageMetadata": { "promptTokenCount": N, "candidatesTokenCount": M }
    }

    Raises RuntimeError on non-2xx responses or network failures.
    """
    url = f"{_GEMINI_BASE}/{GEMINI_MODEL}:generateContent?key={_api_key()}"

    payload = {
        "system_instruction": {
            "parts": [{"text": system_instruction}]
        },
        "contents": [
            {"role": "user", "parts": [{"text": prompt}]}
        ],
        "generationConfig": {
            "maxOutputTokens": max_tokens,
            "temperature":     0.2,
            "topP":            0.85,
        },
    }

    body = json.dumps(payload).encode("utf-8")
    req  = urllib.request.Request(
        url,
        data    = body,
        method  = "POST",
        headers = {"Content-Type": "application/json"},
    )

    try:
        with urllib.request.urlopen(req, context=_SSL_CTX, timeout=60) as resp:
            raw = resp.read().decode("utf-8")
    except urllib.error.HTTPError as exc:
        err_body = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"Gemini API error {exc.code}: {err_body}") from exc
    except urllib.error.URLError as exc:
        raise RuntimeError(f"Network error: {exc.reason}") from exc

    return json.loads(raw)


def _extract_text(data: dict) -> str:
    """Pull concatenated text from a Gemini generateContent response."""
    try:
        parts = data["candidates"][0]["content"]["parts"]
        return "".join(p.get("text", "") for p in parts).strip()
    except (KeyError, IndexError):
        # Fallback — surface raw response so the caller can debug
        return json.dumps(data)[:1000]


# ─── SYSTEM PROMPTS ───────────────────────────────────────────────────────────

_SYS_ANALYST = (
    "You are a senior cybersecurity threat-intelligence analyst with 15+ years of experience "
    "in incident response, malware analysis, and threat hunting. "
    "You communicate in precise, technical language suitable for a SOC or CIRT audience. "
    "Always structure your output clearly with bold section headers. "
    "Do NOT include AI disclaimers — respond directly as the expert."
)

_SYS_IR = (
    "You are an expert Incident Response (IR) lead specialising in enterprise security incidents. "
    "You follow NIST SP 800-61r2 and SANS IR frameworks. "
    "Produce actionable, step-by-step playbooks a junior SOC analyst can follow. "
    "Use numbered lists for sequential steps and code blocks for commands or scripts."
)

_SYS_MITRE = (
    "You are a MITRE ATT&CK subject-matter expert and red-team researcher. "
    "Explain techniques with real-world threat-actor examples and provide "
    "specific, implementable detection and mitigation recommendations. "
    "Reference ATT&CK IDs, sub-techniques, and relevant threat groups where applicable."
)

_SYS_CVE = (
    "You are a vulnerability researcher and exploit analyst. "
    "Provide clear, technical CVE analysis including exploit conditions, affected versions, "
    "CVSS context, known exploitation in the wild, and prioritised remediation steps."
)

_SYS_IOC = (
    "You are a threat-intelligence analyst specialising in indicator-of-compromise (IOC) analysis. "
    "Analyse malicious URLs, domains, and network indicators. "
    "Provide threat-actor attribution hypotheses, malware family associations, "
    "and concrete blocking and hunting recommendations."
)


# ─── RESULT CLASS ─────────────────────────────────────────────────────────────

class AnalysisResult:
    """Lightweight wrapper returned by every engine function."""

    def __init__(self, success: bool, text: str = "", error: str = "",
                 metadata: dict | None = None):
        self.success   = success
        self.text      = text
        self.error     = error
        self.metadata  = metadata or {}
        self.timestamp = datetime.utcnow().isoformat() + "Z"

    def to_dict(self) -> dict:
        return {
            "success":   self.success,
            "analysis":  self.text,
            "error":     self.error,
            "metadata":  self.metadata,
            "timestamp": self.timestamp,
        }


# ─── 1. GENERAL THREAT ANALYSIS ───────────────────────────────────────────────

def analyse_threat(topic: str, context: str = "") -> AnalysisResult:
    """
    Perform a general threat-intelligence analysis on any topic.

    Parameters
    ----------
    topic   : threat, vulnerability, actor, or concept to analyse
    context : optional extra context (CVE text, log snippet, news excerpt, etc.)
    """
    if not topic.strip():
        return AnalysisResult(False, error="topic must not be empty")

    prompt = f"Analyse the following cybersecurity topic in depth:\n\nTOPIC: {topic}"
    if context.strip():
        prompt += f"\n\nADDITIONAL CONTEXT:\n{context}"
    prompt += (
        "\n\nStructure your response with these exact sections:\n"
        "**1. Threat Overview**\n"
        "**2. Attack Vectors / TTPs**\n"
        "**3. Recent Activity / Threat Landscape**\n"
        "**4. Detection Opportunities**\n"
        "**5. Defensive Recommendations**"
    )

    try:
        data  = _post_gemini(prompt, _SYS_ANALYST, max_tokens=DEFAULT_MAX_TOK)
        usage = data.get("usageMetadata", {})
        return AnalysisResult(
            success  = True,
            text     = _extract_text(data),
            metadata = {
                "topic":       topic,
                "model":       GEMINI_MODEL,
                "input_toks":  usage.get("promptTokenCount"),
                "output_toks": usage.get("candidatesTokenCount"),
            },
        )
    except RuntimeError as exc:
        return AnalysisResult(False, error=str(exc))


# ─── 2. INCIDENT RESPONSE PLAYBOOK ────────────────────────────────────────────

def generate_ir_playbook(title: str, category: str, severity: str,
                         description: str = "") -> AnalysisResult:
    """
    Generate a structured IR playbook following NIST SP 800-61r2.

    Parameters
    ----------
    title       : human-readable incident title
    category    : ransomware | phishing | data_breach | intrusion |
                  ddos | insider | supply_chain | other
    severity    : critical | high | medium | low
    description : optional free-text description from the analyst
    """
    category_label = category.replace("_", " ").title()
    prompt = (
        f"Generate a complete incident response playbook:\n\n"
        f"TITLE:    {title}\n"
        f"CATEGORY: {category_label}\n"
        f"SEVERITY: {severity.upper()}\n"
    )
    if description.strip():
        prompt += f"DESCRIPTION: {description}\n"

    prompt += (
        "\nUse NIST SP 800-61r2 phases:\n"
        "**1. PREPARATION** — Prerequisites, tools, team roles\n"
        "**2. IDENTIFICATION** — Detection indicators, log sources, triage steps\n"
        "**3. CONTAINMENT** — Short-term and long-term containment actions\n"
        "**4. ERADICATION** — Root-cause removal, IOC sweeping\n"
        "**5. RECOVERY** — System restoration, post-recovery monitoring\n"
        "**6. LESSONS LEARNED** — Post-mortem questions and metrics\n\n"
        "Include specific shell commands, log queries, or tool invocations. "
        f"Tailor every step to a {severity.upper()} {category_label} incident."
    )

    try:
        data = _post_gemini(prompt, _SYS_IR, max_tokens=STREAM_MAX_TOK)
        return AnalysisResult(
            success  = True,
            text     = _extract_text(data),
            metadata = {
                "incident_title": title,
                "category":       category,
                "severity":       severity,
                "model":          GEMINI_MODEL,
            },
        )
    except RuntimeError as exc:
        return AnalysisResult(False, error=str(exc))


# ─── 3. MITRE ATT&CK TECHNIQUE EXPLAINER ──────────────────────────────────────

def explain_mitre_technique(technique_id: str, technique_name: str,
                             tactic: str) -> AnalysisResult:
    """
    Deep-dive explanation of a MITRE ATT&CK technique.

    Parameters
    ----------
    technique_id   : e.g. "T1059"
    technique_name : e.g. "Command and Scripting Interpreter"
    tactic         : parent tactic, e.g. "Execution"
    """
    prompt = (
        f"Provide a deep technical analysis of MITRE ATT&CK technique:\n\n"
        f"ID:      {technique_id}\n"
        f"NAME:    {technique_name}\n"
        f"TACTIC:  {tactic}\n\n"
        "Cover these sections:\n"
        "**1. Technique Description** — what an adversary does and why\n"
        "**2. Real-World Threat Actor Examples** — named APTs or ransomware groups\n"
        "**3. Sub-techniques** — list common sub-techniques with IDs\n"
        "**4. Detection Signals** — specific log events, EDR telemetry, network indicators\n"
        "**5. Mitigation Controls** — MITRE-referenced mitigations + practical hardening\n"
        "**6. Hunt Query** — one example Sigma or KQL skeleton an analyst can adapt"
    )

    try:
        data = _post_gemini(prompt, _SYS_MITRE, max_tokens=STREAM_MAX_TOK)
        return AnalysisResult(
            success  = True,
            text     = _extract_text(data),
            metadata = {
                "technique_id":   technique_id,
                "technique_name": technique_name,
                "tactic":         tactic,
                "model":          GEMINI_MODEL,
            },
        )
    except RuntimeError as exc:
        return AnalysisResult(False, error=str(exc))


# ─── 4. CVE SUMMARISER ────────────────────────────────────────────────────────

def summarise_cve(cve_id: str, description: str,
                  score: float | None = None,
                  severity: str = "") -> AnalysisResult:
    """
    Produce an analyst-ready CVE summary with exploitation context.

    Parameters
    ----------
    cve_id      : e.g. "CVE-2024-3094"
    description : raw NVD description text
    score       : CVSS base score or None
    severity    : CRITICAL | HIGH | MEDIUM | LOW
    """
    score_str = str(score) if score is not None else "N/A"
    prompt = (
        f"Analyse this CVE and provide a structured analyst briefing:\n\n"
        f"CVE ID:      {cve_id}\n"
        f"CVSS SCORE:  {score_str}  ({severity.upper()})\n"
        f"DESCRIPTION: {description}\n\n"
        "Sections required:\n"
        "**1. Plain-English Summary** — what the vulnerability is\n"
        "**2. Affected Versions & Components**\n"
        "**3. Exploitation Conditions** — auth required? network? user interaction?\n"
        "**4. Exploitation in the Wild** — active campaigns, PoC code, CISA KEV status\n"
        "**5. Remediation Priority** — patch, workaround, or compensating control\n"
        "**6. Detection** — log events or signatures that indicate exploitation"
    )

    try:
        data = _post_gemini(prompt, _SYS_CVE, max_tokens=DEFAULT_MAX_TOK)
        return AnalysisResult(
            success  = True,
            text     = _extract_text(data),
            metadata = {
                "cve_id":     cve_id,
                "cvss_score": score,
                "severity":   severity,
                "model":      GEMINI_MODEL,
            },
        )
    except RuntimeError as exc:
        return AnalysisResult(False, error=str(exc))


# ─── 5. IOC CLASSIFIER ────────────────────────────────────────────────────────

def classify_ioc(url: str, tags: list[str] | None = None,
                 threat_type: str = "") -> AnalysisResult:
    """
    Analyse a malicious URL / IOC and provide threat-actor context.

    Parameters
    ----------
    url         : the malicious URL string
    tags        : list of tags from the feed (e.g. ["emotet", "malware"])
    threat_type : feed-reported threat type (e.g. "malware_download")
    """
    tags_str = ", ".join(tags) if tags else "none"
    prompt = (
        f"Analyse this malicious indicator of compromise (IOC):\n\n"
        f"URL:         {url}\n"
        f"TAGS:        {tags_str}\n"
        f"THREAT TYPE: {threat_type or 'unknown'}\n\n"
        "Provide:\n"
        "**1. IOC Classification** — malware family, campaign, or threat category\n"
        "**2. Threat-Actor Attribution** — likely group or opportunistic/criminal\n"
        "**3. Infrastructure Analysis** — hosting patterns, domain age clues, TLD risk\n"
        "**4. Malware Behaviour** — what a victim system would experience\n"
        "**5. Blocking Recommendations** — DNS, proxy, firewall, EDR rule suggestions\n"
        "**6. Related Indicators** — what other IOC types to hunt for"
    )

    try:
        data = _post_gemini(prompt, _SYS_IOC, max_tokens=DEFAULT_MAX_TOK)
        return AnalysisResult(
            success  = True,
            text     = _extract_text(data),
            metadata = {
                "url":         url,
                "tags":        tags,
                "threat_type": threat_type,
                "model":       GEMINI_MODEL,
            },
        )
    except RuntimeError as exc:
        return AnalysisResult(False, error=str(exc))


# ─── 6. STREAMING ANALYSIS (SSE) ──────────────────────────────────────────────

def stream_analysis(topic: str, context: str = "") -> Generator[str, None, None]:
    """
    Stream a threat analysis as Server-Sent Events (SSE) delta chunks.

    Yields SSE-formatted strings: 'data: <json>\\n\\n'
    JSON payload: {"delta": "..."} for content chunks, {"done": true} at end.

    Flask usage example:
        from ai_analysis_engine import stream_analysis
        from flask import Response, request

        @app.route("/api/stream-analysis")
        def stream_route():
            topic = request.args.get("topic", "")
            return Response(stream_analysis(topic), mimetype="text/event-stream")
    """
    if not topic.strip():
        yield 'data: {"error": "empty topic"}\n\n'
        return

    prompt = (
        f"Provide a comprehensive cybersecurity analysis of: {topic}"
        + (f"\n\nContext: {context}" if context.strip() else "")
        + "\n\nCover: threat overview, TTPs, detection opportunities, and defence recommendations."
    )

    try:
        data      = _post_gemini(prompt, _SYS_ANALYST, max_tokens=STREAM_MAX_TOK)
        full_text = _extract_text(data)

        # Emit in ~40-character chunks to drive the frontend typewriter effect
        chunk_size = 40
        for i in range(0, len(full_text), chunk_size):
            yield f'data: {json.dumps({"delta": full_text[i:i + chunk_size]})}\n\n'

        yield 'data: {"done": true}\n\n'

    except RuntimeError as exc:
        yield f'data: {json.dumps({"error": str(exc)})}\n\n'


# ─── SELF-TEST ─────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    import sys

    print("=" * 62)
    print("  CyberNews — AI Analysis Engine Self-Test")
    print(f"  Backend : Google {GEMINI_MODEL}")
    print("=" * 62)

    tests_passed = 0

    # 1. General analysis
    print("\n[1] General threat analysis: Log4Shell")
    r = analyse_threat("Log4Shell CVE-2021-44228", "JNDI injection in Apache Log4j 2.x")
    if r.success:
        print(f"    PASS — {len(r.text)} chars | "
              f"tokens in={r.metadata.get('input_toks')} out={r.metadata.get('output_toks')}")
        tests_passed += 1
    else:
        print(f"    FAIL — {r.error}"); sys.exit(1)

    # 2. CVE summary
    print("\n[2] CVE summariser: CVE-2024-3094 (XZ Utils backdoor)")
    r2 = summarise_cve("CVE-2024-3094",
                       "Malicious code in XZ Utils 5.6.0/5.6.1 allows unauthorized access via systemd.",
                       score=10.0, severity="CRITICAL")
    if r2.success:
        print(f"    PASS — {len(r2.text)} chars"); tests_passed += 1
    else:
        print(f"    FAIL — {r2.error}")

    # 3. MITRE technique
    print("\n[3] MITRE explainer: T1059 — Command & Scripting Interpreter")
    r3 = explain_mitre_technique("T1059", "Command and Scripting Interpreter", "Execution")
    if r3.success:
        print(f"    PASS — {len(r3.text)} chars"); tests_passed += 1
    else:
        print(f"    FAIL — {r3.error}")

    # 4. IOC classification
    print("\n[4] IOC classifier: malware download URL")
    r4 = classify_ioc("http://evil-example.ru/dropper.exe",
                      tags=["emotet", "malware"], threat_type="malware_download")
    if r4.success:
        print(f"    PASS — {len(r4.text)} chars"); tests_passed += 1
    else:
        print(f"    FAIL — {r4.error}")

    # 5. IR Playbook
    print("\n[5] IR Playbook: Critical ransomware incident")
    r5 = generate_ir_playbook("Ransomware on FS-01", "ransomware", "critical",
                              "File server encrypted, shadow copies deleted.")
    if r5.success:
        print(f"    PASS — {len(r5.text)} chars"); tests_passed += 1
    else:
        print(f"    FAIL — {r5.error}")

    print(f"\n{'='*62}")
    print(f"  Results: {tests_passed}/5 tests passed")
    print(f"{'='*62}")
    if tests_passed < 5:
        sys.exit(1)

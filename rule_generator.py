"""
rule_generator.py
─────────────────
CyberNews v3.0 — Detection Rule Generator
Powered by Google Gemini 2.0 Flash

Provides AI-driven detection rule generation in multiple formats:
  - generate_rule(threat, fmt, log_source)    → full rule string
  - validate_rule(rule_text, fmt)             → syntax check + quality rating
  - explain_rule(rule_text, fmt)              → analyst-friendly explanation
  - suggest_improvements(rule_text, fmt)      → hardening recommendations
  - batch_generate(threats, fmt, log_source)  → list of RuleResults

  Flask helpers (drop-in route handlers):
  - flask_generate_rule_handler(request_json)
  - flask_validate_rule_handler(request_json)
  - flask_explain_rule_handler(request_json)

Supported formats
-----------------
  sigma     — Universal SIEM/log detection (YAML)
  yara      — File and memory pattern matching
  suricata  — Network IDS/IPS rules
  splunk    — Splunk SPL search queries
  kql       — KQL for Microsoft Sentinel / Defender

Configuration (loaded from .env in project root):
  GOOGLE_API_KEY  — required
  GEMINI_MODEL    — optional, default: gemini-2.5-flash-preview-04-17
"""

import json
import os
import re
import ssl
import textwrap
import urllib.request
import urllib.error
from dataclasses import dataclass, field
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
            if key not in os.environ:
                os.environ[key] = val

_load_env()

# ─── CONSTANTS ────────────────────────────────────────────────────────────────

GEMINI_MODEL       = os.environ.get("GEMINI_MODEL", "gemini-2.5-flash-preview-04-17")
_GEMINI_BASE       = "https://generativelanguage.googleapis.com/v1beta/models"
DEFAULT_MAX_TOKENS = 1000
EXPLAIN_MAX_TOKENS = 700

_SSL_CTX = ssl.create_default_context()

SUPPORTED_FORMATS = {"sigma", "yara", "suricata", "splunk", "kql"}

FORMAT_META = {
    "sigma":    {"ext": ".yml",   "lang": "yaml",  "label": "Sigma (YAML)"},
    "yara":     {"ext": ".yar",   "lang": "yara",  "label": "YARA Rule"},
    "suricata": {"ext": ".rules", "lang": "snort", "label": "Suricata IDS"},
    "splunk":   {"ext": ".spl",   "lang": "spl",   "label": "Splunk SPL"},
    "kql":      {"ext": ".kql",   "lang": "kql",   "label": "KQL (Sentinel)"},
}

LOGSOURCE_DESCRIPTIONS = {
    "windows":  "Windows Security Event Logs (Event IDs 4624/4625/4688/4697/7045 etc.)",
    "sysmon":   "Sysmon operational logs (Event IDs 1/3/7/10/11/13/17/18/22)",
    "network":  "Network packet capture / NetFlow / firewall session logs",
    "firewall": "Firewall/proxy deny-allow logs (Palo Alto, Fortinet, pfSense)",
    "endpoint": "EDR telemetry (CrowdStrike, SentinelOne, Defender for Endpoint)",
}


# ─── DATA CLASS ───────────────────────────────────────────────────────────────

@dataclass
class RuleResult:
    """Result returned by every generator function."""
    success:    bool
    rule:       str  = ""
    format:     str  = ""
    threat:     str  = ""
    error:      str  = ""
    validation: dict = field(default_factory=dict)
    metadata:   dict = field(default_factory=dict)
    timestamp:  str  = field(default_factory=lambda: datetime.utcnow().isoformat() + "Z")

    def to_dict(self) -> dict:
        return {
            "success":    self.success,
            "rule":       self.rule,
            "format":     self.format,
            "threat":     self.threat,
            "error":      self.error,
            "validation": self.validation,
            "metadata":   self.metadata,
            "timestamp":  self.timestamp,
        }


# ─── API KEY HELPER ───────────────────────────────────────────────────────────

def _api_key() -> str:
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
                 max_tokens: int = DEFAULT_MAX_TOKENS) -> dict:
    """
    POST to Gemini generateContent REST endpoint.

    Uses the v1beta system_instruction field for the persona/system prompt.
    Raises RuntimeError on non-2xx or network errors.
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
            "temperature":     0.15,   # very low for code/rule generation — deterministic
            "topP":            0.80,
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
        return json.dumps(data)[:1000]


def _strip_fences(text: str) -> str:
    """Remove ``` ... ``` code fences so we get the raw rule text."""
    text = re.sub(r"^```[a-zA-Z]*\n?", "", text.strip(), flags=re.MULTILINE)
    text = re.sub(r"\n?```$",           "", text.strip(), flags=re.MULTILINE)
    return text.strip()


# ─── SYSTEM PROMPTS ───────────────────────────────────────────────────────────

_SYS_RULE_GEN = (
    "You are an expert detection engineer and threat hunter with deep experience "
    "writing production-quality detection rules for SIEMs, IDS, and EDR platforms. "
    "Rules must be syntactically correct, richly commented, and tuned to minimise false positives. "
    "Always include rule metadata: title, description, author, date, severity, MITRE ATT&CK tags. "
    "After the rule body, append a section titled '# --- ANALYST NOTES ---' (max 150 words) covering: "
    "what the rule detects, false-positive scenarios, and tuning tips. "
    "IMPORTANT: Do NOT wrap the rule in markdown code fences."
)

_SYS_VALIDATOR = (
    "You are a detection rule syntax checker and quality reviewer. "
    "Identify syntax errors, logic flaws, and detection gaps. "
    "Be specific: quote the problematic line and explain the exact fix. "
    "Rate overall rule quality as one of: POOR / FAIR / GOOD / EXCELLENT."
)

_SYS_EXPLAINER = (
    "You are a senior SOC analyst explaining detection rules to junior analysts. "
    "Use plain, jargon-free English. Break down every field, condition, and filter. "
    "Explain exactly what real attacker behaviour would trigger the rule and what to do next."
)

_SYS_IMPROVER = (
    "You are a detection-engineering lead performing a rule quality review. "
    "Suggest concrete, implementable improvements to increase accuracy, reduce noise, "
    "and harden the rule against attacker evasion. Provide improved code snippets for each suggestion."
)


# ─── FORMAT-SPECIFIC PROMPT BUILDER ──────────────────────────────────────────

def _build_generation_prompt(threat: str, fmt: str, log_source: str) -> str:
    log_desc = LOGSOURCE_DESCRIPTIONS.get(log_source, log_source)
    label    = FORMAT_META.get(fmt, {}).get("label", fmt.upper())

    base = (
        f"Generate a complete, production-ready {label} detection rule "
        f"for the following threat behaviour:\n\n"
        f"THREAT: {threat}\n"
        f"LOG SOURCE: {log_desc}\n\n"
    )

    guidance = {
        "sigma": (
            "Requirements:\n"
            "- Valid Sigma YAML with all required fields: title, id (UUID v4), status "
            "(experimental), description, author, date, modified, tags (MITRE ATT&CK "
            "attack.tXXXX format), logsource (category/product/service), detection "
            "(selection + filter + condition), falsepositives, level\n"
            "- Field names must match the specified log source\n"
            "- Include at least one filter block to reduce false positives\n"
            "- Add YAML inline comments explaining non-obvious detection fields"
        ),
        "yara": (
            "Requirements:\n"
            "- Valid YARA rule with: meta section (author, date, description, "
            "reference, hash, severity), strings section (hex, text, and regex "
            "patterns covering both on-disk and in-memory artefacts), "
            "condition section using logical operators\n"
            "- Comment each string pattern explaining what it matches\n"
            "- Include a private helper rule for common library imports if relevant\n"
            "- Avoid overly broad string matches that cause performance issues"
        ),
        "suricata": (
            "Requirements:\n"
            "- Valid Suricata rule(s) with: action (alert), header (protocol src "
            "src_port -> dst dst_port), options (msg, flow, content, pcre, "
            "classtype, sid, rev, metadata with mitre_attack_tactic)\n"
            "- Use the correct protocol: tcp/udp/http/dns/tls/smtp\n"
            "- Include PCRE for complex payload pattern matching\n"
            "- Use flowbits for stateful multi-packet detection where needed\n"
            "- SID must be in the 9000000–9999999 range (local custom rules)"
        ),
        "splunk": (
            "Requirements:\n"
            "- Valid Splunk SPL starting with index/sourcetype scoping\n"
            "- Use eval, stats, where, rex, and lookup commands appropriately\n"
            "- Include a threshold or anomaly condition for alerting\n"
            "- End with a table command listing fields relevant to analyst triage\n"
            "- Comment each major pipeline stage with a leading comment line"
        ),
        "kql": (
            "Requirements:\n"
            "- Valid KQL for Microsoft Sentinel or Defender for Endpoint\n"
            "- Choose the correct table: SecurityEvent, DeviceProcessEvents, "
            "DeviceNetworkEvents, EmailEvents, IdentityLogonEvents, etc.\n"
            "- Use let statements for reusable logic or lookup lists\n"
            "- Include | where TimeGenerated > ago(1d) for time scoping\n"
            "- Use summarize, project, and extend appropriately\n"
            "- Comment complex query steps with // inline comments"
        ),
    }

    return base + guidance.get(fmt, f"Generate a syntactically correct {fmt.upper()} rule.")


# ─── PUBLIC API ───────────────────────────────────────────────────────────────

def generate_rule(threat: str, fmt: str = "sigma",
                  log_source: str = "windows") -> RuleResult:
    """
    Generate a detection rule for a given threat behaviour.

    Parameters
    ----------
    threat     : description of the malicious behaviour to detect
    fmt        : sigma | yara | suricata | splunk | kql
    log_source : windows | sysmon | network | firewall | endpoint
    """
    if not threat.strip():
        return RuleResult(False, error="threat description must not be empty")
    fmt = fmt.lower()
    if fmt not in SUPPORTED_FORMATS:
        return RuleResult(False,
            error=f"unsupported format '{fmt}'. Choose from: {', '.join(sorted(SUPPORTED_FORMATS))}")

    prompt = _build_generation_prompt(threat, fmt, log_source)
    try:
        data  = _post_gemini(prompt, _SYS_RULE_GEN, max_tokens=DEFAULT_MAX_TOKENS)
        raw   = _extract_text(data)
        usage = data.get("usageMetadata", {})
        return RuleResult(
            success  = True,
            rule     = _strip_fences(raw),
            format   = fmt,
            threat   = threat,
            metadata = {
                "log_source":  log_source,
                "model":       GEMINI_MODEL,
                "input_toks":  usage.get("promptTokenCount"),
                "output_toks": usage.get("candidatesTokenCount"),
                "format_meta": FORMAT_META.get(fmt, {}),
            },
        )
    except RuntimeError as exc:
        return RuleResult(False, error=str(exc), format=fmt, threat=threat)


def validate_rule(rule_text: str, fmt: str = "sigma") -> RuleResult:
    """
    Validate the syntax and logic quality of an existing detection rule.

    Parameters
    ----------
    rule_text : the full rule string
    fmt       : format of the rule

    Returns
    -------
    RuleResult with .validation dict:
      rating  — POOR | FAIR | GOOD | EXCELLENT
      issues  — list of identified problems
      fixes   — suggested corrections
      summary — overall assessment paragraph
    """
    if not rule_text.strip():
        return RuleResult(False, error="rule_text must not be empty")

    prompt = (
        f"Validate the following {fmt.upper()} detection rule for syntax errors, "
        f"logic issues, and detection quality:\n\n"
        f"{rule_text}\n\n"
        "Return ONLY a valid JSON object with this exact structure "
        "(no prose, no markdown fences):\n"
        '{\n'
        '  "rating": "POOR"|"FAIR"|"GOOD"|"EXCELLENT",\n'
        '  "issues": ["specific issue 1", "specific issue 2"],\n'
        '  "fixes":  ["concrete fix 1", "concrete fix 2"],\n'
        '  "summary": "one paragraph overall assessment"\n'
        '}'
    )

    try:
        data   = _post_gemini(prompt, _SYS_VALIDATOR, max_tokens=EXPLAIN_MAX_TOKENS)
        raw    = _extract_text(data)
        # Strip any stray fences the model might add despite instructions
        clean  = re.sub(r"```[a-z]*\n?|```", "", raw).strip()
        parsed = json.loads(clean)
        return RuleResult(success=True, rule=rule_text, format=fmt, validation=parsed)
    except json.JSONDecodeError:
        # Model returned prose instead of JSON — wrap it gracefully
        return RuleResult(success=True, rule=rule_text, format=fmt,
                          validation={"rating": "UNKNOWN", "summary": raw[:500]})
    except RuntimeError as exc:
        return RuleResult(False, error=str(exc), format=fmt)


def explain_rule(rule_text: str, fmt: str = "sigma") -> RuleResult:
    """
    Generate a plain-English explanation of a detection rule for junior analysts.

    Parameters
    ----------
    rule_text : the rule to explain
    fmt       : format of the rule
    """
    if not rule_text.strip():
        return RuleResult(False, error="rule_text must not be empty")

    label  = FORMAT_META.get(fmt, {}).get("label", fmt.upper())
    prompt = (
        f"Explain the following {label} detection rule to a junior SOC analyst "
        f"who is new to security engineering:\n\n"
        f"{rule_text}\n\n"
        "Structure the explanation with these sections:\n"
        "**1. PURPOSE** — what attacker behaviour this rule detects\n"
        "**2. LOGIC BREAKDOWN** — step-by-step through each field and condition\n"
        "**3. TRIGGER SCENARIO** — a realistic attack example that would fire this rule\n"
        "**4. FALSE POSITIVES** — common benign activities that might match\n"
        "**5. RESPONSE ACTIONS** — what the analyst should do when this alert fires"
    )

    try:
        data = _post_gemini(prompt, _SYS_EXPLAINER, max_tokens=EXPLAIN_MAX_TOKENS)
        return RuleResult(success=True, rule=_extract_text(data), format=fmt)
    except RuntimeError as exc:
        return RuleResult(False, error=str(exc), format=fmt)


def suggest_improvements(rule_text: str, fmt: str = "sigma") -> RuleResult:
    """
    Suggest concrete improvements to make a detection rule more effective.

    Parameters
    ----------
    rule_text : the rule to improve
    fmt       : format of the rule
    """
    if not rule_text.strip():
        return RuleResult(False, error="rule_text must not be empty")

    prompt = (
        f"Review this {fmt.upper()} detection rule and provide concrete improvement suggestions:\n\n"
        f"{rule_text}\n\n"
        "Focus on these areas and provide improved code snippets for each:\n"
        "**1. Evasion Resilience** — how an attacker could bypass the current rule\n"
        "**2. False-Positive Reduction** — noisy fields or conditions to tighten\n"
        "**3. Coverage Gaps** — related attacker behaviours not currently caught\n"
        "**4. Performance** — expensive operations that could be optimised\n"
        "**5. Improved Snippets** — revised rule sections implementing your suggestions"
    )

    try:
        data = _post_gemini(prompt, _SYS_IMPROVER, max_tokens=DEFAULT_MAX_TOKENS)
        return RuleResult(success=True, rule=_extract_text(data), format=fmt)
    except RuntimeError as exc:
        return RuleResult(False, error=str(exc), format=fmt)


def batch_generate(threats: list[str], fmt: str = "sigma",
                   log_source: str = "windows") -> list[RuleResult]:
    """
    Generate detection rules for multiple threat behaviours in one call.

    Parameters
    ----------
    threats    : list of threat behaviour strings
    fmt        : target rule format (same for all)
    log_source : log source context (same for all)

    Returns
    -------
    List of RuleResult objects in the same order as threats.
    Individual failures do not abort the batch.
    """
    return [generate_rule(t, fmt, log_source) for t in threats]


# ─── FLASK INTEGRATION HELPERS ────────────────────────────────────────────────

def flask_generate_rule_handler(request_json: dict) -> dict:
    """
    Drop-in handler for a Flask route.

    Example:
        from rule_generator import flask_generate_rule_handler
        from flask import jsonify, request

        @app.route("/api/generate-rule", methods=["POST"])
        def gen_rule():
            return jsonify(flask_generate_rule_handler(request.get_json(force=True)))
    """
    threat     = request_json.get("threat", "").strip()
    fmt        = request_json.get("format", "sigma").lower()
    log_source = request_json.get("log_source", "windows")
    return generate_rule(threat, fmt, log_source).to_dict()


def flask_validate_rule_handler(request_json: dict) -> dict:
    """Drop-in handler for the /api/validate-rule Flask route."""
    rule_text = request_json.get("rule", "").strip()
    fmt       = request_json.get("format", "sigma").lower()
    return validate_rule(rule_text, fmt).to_dict()


def flask_explain_rule_handler(request_json: dict) -> dict:
    """Drop-in handler for the /api/explain-rule Flask route."""
    rule_text = request_json.get("rule", "").strip()
    fmt       = request_json.get("format", "sigma").lower()
    return explain_rule(rule_text, fmt).to_dict()


# ─── SELF-TEST ─────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    import sys

    print("=" * 62)
    print("  CyberNews — Rule Generator Self-Test")
    print(f"  Backend : Google {GEMINI_MODEL}")
    print("=" * 62)

    passed = 0

    # 1. Sigma rule
    print("\n[1] Sigma — PowerShell encoded command execution")
    r1 = generate_rule(
        threat     = "PowerShell encoded command execution bypassing ExecutionPolicy",
        fmt        = "sigma",
        log_source = "sysmon",
    )
    if r1.success:
        lines = r1.rule.count("\n") + 1
        toks  = r1.metadata
        print(f"    PASS — {lines} lines | tokens in={toks.get('input_toks')} out={toks.get('output_toks')}")
        print(textwrap.indent(r1.rule[:250] + "\n    …", "    "))
        passed += 1
    else:
        print(f"    FAIL — {r1.error}"); sys.exit(1)

    # 2. YARA rule
    print("\n[2] YARA — Cobalt Strike reflective DLL loader")
    r2 = generate_rule(
        threat     = "Cobalt Strike reflective DLL loader in process memory",
        fmt        = "yara",
        log_source = "endpoint",
    )
    if r2.success:
        print(f"    PASS — {r2.rule.count(chr(10)) + 1} lines"); passed += 1
    else:
        print(f"    FAIL — {r2.error}")

    # 3. Suricata rule
    print("\n[3] Suricata — DNS tunnelling exfiltration")
    r3 = generate_rule(
        threat     = "DNS tunnelling data exfiltration via abnormally long subdomain queries",
        fmt        = "suricata",
        log_source = "network",
    )
    if r3.success:
        print(f"    PASS — {r3.rule.count(chr(10)) + 1} lines"); passed += 1
    else:
        print(f"    FAIL — {r3.error}")

    # 4. Rule validation
    print("\n[4] Rule validation")
    dummy = (
        "title: Mimikatz Credential Dump\n"
        "detection:\n"
        "  selection:\n"
        "    CommandLine|contains: 'sekurlsa'\n"
        "  condition: selection"
    )
    r4 = validate_rule(dummy, "sigma")
    if r4.success:
        print(f"    PASS — rating: {r4.validation.get('rating', '?')}"); passed += 1
    else:
        print(f"    FAIL — {r4.error}")

    # 5. Rule explanation
    print("\n[5] Rule explanation")
    r5 = explain_rule(dummy, "sigma")
    if r5.success:
        print(f"    PASS — {len(r5.rule)} chars"); passed += 1
    else:
        print(f"    FAIL — {r5.error}")

    # 6. KQL rule
    print("\n[6] KQL — Lateral movement via remote services")
    r6 = generate_rule(
        threat     = "Lateral movement via PsExec or remote service creation",
        fmt        = "kql",
        log_source = "windows",
    )
    if r6.success:
        print(f"    PASS — {r6.rule.count(chr(10)) + 1} lines"); passed += 1
    else:
        print(f"    FAIL — {r6.error}")

    # 7. Splunk rule
    print("\n[7] Splunk SPL — Brute-force login detection")
    r7 = generate_rule(
        threat     = "Brute-force login attempts against Active Directory accounts",
        fmt        = "splunk",
        log_source = "windows",
    )
    if r7.success:
        print(f"    PASS — {r7.rule.count(chr(10)) + 1} lines"); passed += 1
    else:
        print(f"    FAIL — {r7.error}")

    print(f"\n{'='*62}")
    print(f"  Results: {passed}/7 tests passed")
    print(f"{'='*62}")
    if passed < 7:
        sys.exit(1)

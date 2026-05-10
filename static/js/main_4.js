/* ── CLOCK ────────────────────────────────────── */
function updateClock() {
  const now = new Date();
  document.getElementById('clock').textContent =
    now.toTimeString().slice(0,8) + ' UTC' + (now.getTimezoneOffset() < 0 ? '+' : '-') +
    String(Math.abs(now.getTimezoneOffset()/60)).padStart(2,'0');
}
setInterval(updateClock, 1000);
updateClock();

/* ── TERMINAL BOOT ───────────────────────────── */
const bootLines = [
  { cls: 'info', text: '$ Initializing CyberNews v2.1.0...' },
  { cls: 'ok',   text: '✓ NVD/NIST CVE feed connected' },
  { cls: 'ok',   text: '✓ abuse.ch URLhaus IOC stream online' },
  { cls: 'ok',   text: '✓ HackerNews threat intelligence API ready' },
  { cls: 'ok',   text: '✓ Anthropic Claude AI engine initialized' },
  { cls: 'warn', text: '⚠ 47 new CVEs detected in last 24h' },
  { cls: 'err',  text: '! CRITICAL: CVE-2024-3094 (XZ backdoor) active' },
  { cls: 'info', text: '$ Monitoring 1,847 threat indicators...' },
  { cls: 'ok',   text: '✓ Real-time feed streaming' },
  { cls: 'dim',  text: '> All systems operational. Standing by.' },
];

let lineIdx = 0;
function addTermLine() {
  if (lineIdx >= bootLines.length) return;
  const { cls, text } = bootLines[lineIdx++];
  const term = document.getElementById('terminal-output');
  const div = document.createElement('div');
  div.className = 't-line';
  div.innerHTML = `<span class="t-${cls}">${text}</span>`;
  term.appendChild(div);
  term.scrollTop = term.scrollHeight;
  if (lineIdx < bootLines.length) setTimeout(addTermLine, 350 + Math.random()*200);
}
setTimeout(addTermLine, 600);

/* ── ACTIVE NAV ──────────────────────────────── */
const sections = document.querySelectorAll('.section, .stats-bar');
const navLinks = document.querySelectorAll('.nav-link');
const observer = new IntersectionObserver(entries => {
  entries.forEach(e => {
    if (e.isIntersecting) {
      const id = e.target.id;
      navLinks.forEach(l => {
        l.classList.toggle('active', l.dataset.section === id);
      });
    }
  });
}, { threshold: 0.3 });
document.querySelectorAll('section[id]').forEach(s => observer.observe(s));

function scrollToSection(id) {
  document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' });
}

/* ── STATS ───────────────────────────────────── */
async function fetchStats() {
  try {
    const r = await fetch('/api/stats');
    const d = await r.json();
    if (!d.success) return;
    const s = d.data;
    animateCounter('stat-threats',  s.active_threats);
    animateCounter('stat-cves',     s.cves_today);
    animateCounter('stat-blocked',  s.blocked_attacks);
    animateCounter('stat-malware',  s.malware_samples);
    animateCounter('stat-phishing', s.phishing_urls);
    animateCounter('stat-countries',s.threat_countries);
    // Update AI model badge with actual model from server .env
    if (d.ai_model) {
      const badge = document.getElementById('ai-model-badge');
      if (badge) badge.textContent = d.ai_model;
    }
  } catch(e) {}
}

function animateCounter(id, target) {
  const el = document.getElementById(id)?.querySelector('.stat-num');
  if (!el) return;
  const start = parseInt(el.textContent.replace(/,/g,'')) || 0;
  const dur = 800, fps = 60, steps = dur/(1000/fps);
  let cur = start, step = 0;
  const tick = setInterval(() => {
    step++;
    cur = Math.round(start + (target - start) * (step/steps));
    el.textContent = cur.toLocaleString();
    if (step >= steps) { clearInterval(tick); el.textContent = target.toLocaleString(); }
  }, 1000/fps);
}

fetchStats();
setInterval(fetchStats, 30000);

/* ── CVEs ────────────────────────────────────── */
async function fetchCVEs() {
  const keyword  = document.getElementById('cve-keyword').value.trim();
  const severity = document.getElementById('cve-severity').value;
  const container = document.getElementById('cve-results');
  container.innerHTML = '<div class="loading-spinner"><span class="ai-spinner"></span> Querying NVD/NIST database…</div>';

  try {
    const params = new URLSearchParams();
    if (keyword)  params.set('keyword', keyword);
    if (severity) params.set('severity', severity);
    const r = await fetch(`/api/cves?${params}`);
    const d = await r.json();
    if (!d.success) throw new Error(d.error);
    if (!d.data.length) { container.innerHTML = '<div class="loading-placeholder">No CVEs found matching your criteria.</div>'; return; }

    container.innerHTML = '';
    d.data.forEach((cve, i) => {
      const sev = cve.severity?.toUpperCase().replace(/\s/g,'') || 'NA';
      const card = document.createElement('div');
      card.className = `cve-card ${sev}`;
      card.style.animationDelay = `${i*0.05}s`;
      card.innerHTML = `
        <div class="cve-id">
          ${cve.id}
          <span class="cve-badge badge-${sev}">${sev}</span>
          ${cve.score ? `<span class="cve-score" style="font-size:0.8rem;margin-left:8px">${cve.score}</span>` : ''}
        </div>
        <div class="cve-desc">${escHtml(cve.description) || 'No description available.'}</div>
        <div class="cve-meta">
          Published: ${cve.published || '—'}
          &nbsp;|&nbsp;
          <a class="cve-link" href="${cve.url}" target="_blank" rel="noopener">View on NVD ↗</a>
        </div>`;
      container.appendChild(card);
    });
  } catch(e) {
    container.innerHTML = `<div class="loading-placeholder">Error: ${escHtml(e.message)}</div>`;
  }
}

/* ── NEWS ────────────────────────────────────── */
async function fetchNews() {
  const q = document.getElementById('news-query').value.trim() || 'cybersecurity';
  const container = document.getElementById('news-results');
  container.innerHTML = '<div class="loading-spinner"><span class="ai-spinner"></span> Fetching threat intelligence feed…</div>';

  try {
    const r = await fetch(`/api/news?q=${encodeURIComponent(q)}`);
    const d = await r.json();
    if (!d.success) throw new Error(d.error);
    if (!d.data.length) { container.innerHTML = '<div class="loading-placeholder">No results found.</div>'; return; }

    container.innerHTML = '';
    d.data.forEach((item, i) => {
      const card = document.createElement('div');
      card.className = 'news-card';
      card.style.animationDelay = `${i*0.04}s`;
      card.innerHTML = `
        <div class="news-title"><a href="${item.url}" target="_blank" rel="noopener">${escHtml(item.title)}</a></div>
        <div class="news-meta">
          <span class="news-source">${escHtml(item.source)}</span>
          <span class="news-points">▲ ${item.points}</span>
          <span>by ${escHtml(item.author)}</span>
          <span>${item.date}</span>
        </div>`;
      container.appendChild(card);
    });
  } catch(e) {
    container.innerHTML = `<div class="loading-placeholder">Error: ${escHtml(e.message)}</div>`;
  }
}

/* ── IOC ─────────────────────────────────────── */
async function fetchIOC() {
  const container = document.getElementById('ioc-results');
  container.innerHTML = '<div class="loading-spinner"><span class="ai-spinner"></span> Connecting to abuse.ch IOC feeds…</div>';

  try {
    const r = await fetch('/api/ioc');
    const d = await r.json();
    if (!d.success) {
      // Show auth-key setup instructions on 401 / failure
      container.innerHTML = `
        <div class="ioc-auth-banner">
          <div class="ioc-auth-icon">🔑</div>
          <div class="ioc-auth-title">Auth-Key Required</div>
          <div class="ioc-auth-msg">${escHtml(d.error || 'IOC feed requires authentication.')}</div>
          <div class="ioc-auth-steps">
            <strong>Quick setup (free, 2 minutes):</strong><br>
            1. Go to <a href="https://auth.abuse.ch/" target="_blank" rel="noopener" class="cve-link">auth.abuse.ch ↗</a>
               — sign in with GitHub, Google, or LinkedIn<br>
            2. Click <strong>Save profile</strong>, then generate an <strong>Auth-Key</strong><br>
            3. Add to your <code>.env</code> file: <code>URLHAUS_AUTH_KEY=&lt;your_key&gt;</code><br>
            4. Restart Flask and click Load again
          </div>
        </div>`;
      return;
    }
    if (!d.data.length) { container.innerHTML = '<div class="loading-placeholder">No IOC data returned.</div>'; return; }

    const wrap = document.createElement('div');

    // Source badge + note banner
    const isThreatFox   = d.source && d.source.includes('ThreatFox');
    const isPlainText   = d.source && d.source.includes('plain-text');
    const sourceBadge   = `<span class="ioc-source-badge ${isThreatFox ? 'tf' : isPlainText ? 'pt' : 'uh'}">${escHtml(d.source || 'URLhaus')}</span>`;

    if (d.note) {
      const banner = document.createElement('div');
      banner.className = 'ioc-note-banner';
      banner.innerHTML = `ℹ️  ${escHtml(d.note)}`;
      wrap.appendChild(banner);
    }

    // Table — columns vary by source
    const table = document.createElement('table');
    table.className = 'ioc-table';

    if (isThreatFox) {
      table.innerHTML = `<thead><tr>
        <th>SOURCE ${sourceBadge}</th><th>DATE</th><th>IOC TYPE</th><th>THREAT</th><th>MALWARE</th><th>CONFIDENCE</th><th>INDICATOR</th><th>TAGS</th>
      </tr></thead>`;
    } else {
      table.innerHTML = `<thead><tr>
        <th>SOURCE ${sourceBadge}</th><th>DATE</th><th>THREAT</th><th>STATUS</th><th>HOST</th><th>URL / INDICATOR</th><th>TAGS</th>
      </tr></thead>`;
    }

    const tbody = document.createElement('tbody');
    d.data.forEach(ioc => {
      const row = document.createElement('tr');

      // Tags — filter out nulls/empty, show "—" if genuinely none
      const tagList = (ioc.tags || []).filter(t => t && t !== 'null' && t !== 'None');
      const tags = tagList.length
        ? tagList.map(t => `<span class="ioc-tag">${escHtml(t)}</span>`).join('')
        : '<span style="color:var(--text-dim);font-size:0.65rem">—</span>';

      const statusCls = ioc.status === 'online' ? 'ioc-status-online' : 'ioc-status-offline';

      // URL cell — truncated display text, full URL in href
      // ref_url  = URLhaus/ThreatFox reference page (human-readable)
      // ioc.url  = raw malicious indicator
      const refLink = ioc.ref_url
        ? `<a href="${escHtml(ioc.ref_url)}" target="_blank" rel="noopener" class="ioc-ref-link" title="Open on URLhaus/ThreatFox">↗</a>`
        : '';
      const rawUrl = ioc.url || '';
      const urlDisplay = rawUrl.length > 52 ? escHtml(rawUrl.slice(0, 52)) + '…' : escHtml(rawUrl);
      const urlCell = rawUrl
        ? `<span class="ioc-url-text" title="${escHtml(rawUrl)}">${urlDisplay}</span>
           <button class="ioc-copy-btn" onclick="copyIOC(this,'${escHtml(rawUrl).replace(/'/g,"\\'")}')">⎘</button>
           ${refLink}`
        : '—';

      if (isThreatFox) {
        const conf = ioc.confidence != null ? `${ioc.confidence}%` : '—';
        const confCls = ioc.confidence >= 75 ? 'ioc-status-online' : ioc.confidence >= 50 ? '' : 'ioc-status-offline';
        row.innerHTML = `
          <td style="font-size:0.65rem;color:var(--accent2)">ThreatFox</td>
          <td>${escHtml(ioc.date_added||'—')}</td>
          <td><span class="ioc-tag">${escHtml(ioc.ioc_type||'—')}</span></td>
          <td>${escHtml(ioc.threat||'—')}</td>
          <td style="color:var(--warn)">${escHtml(ioc.host||'—')}</td>
          <td class="${confCls}">${conf}</td>
          <td class="ioc-url-cell">${urlCell}</td>
          <td>${tags}</td>`;
      } else {
        row.innerHTML = `
          <td style="font-size:0.65rem;color:var(--accent)">URLhaus</td>
          <td>${escHtml(ioc.date_added||'—')}</td>
          <td>${escHtml(ioc.threat||'—')}</td>
          <td class="${statusCls}">${(ioc.status||'—').toUpperCase()}</td>
          <td style="color:var(--text-dim);font-size:0.7rem">${escHtml((ioc.host||'').slice(0,30))}</td>
          <td class="ioc-url-cell">${urlCell}</td>
          <td>${tags}</td>`;
      }
      tbody.appendChild(row);
    });

    table.appendChild(tbody);
    wrap.appendChild(table);
    container.innerHTML = '';
    container.appendChild(wrap);

  } catch(e) {
    container.innerHTML = `
      <div class="loading-placeholder">
        Error fetching IOCs: ${escHtml(e.message)}<br><br>
        <span style="font-size:0.75rem">Add <code>URLHAUS_AUTH_KEY</code> to your <code>.env</code> file.
        Get a free key at <a href="https://auth.abuse.ch/" target="_blank" class="cve-link">auth.abuse.ch ↗</a></span>
      </div>`;
  }
}

/* ── IOC copy helper ─────────────────────────── */
function copyIOC(btn, url) {
  navigator.clipboard.writeText(url).then(() => {
    const orig = btn.textContent;
    btn.textContent = '✓';
    btn.style.color = 'var(--accent2)';
    setTimeout(() => { btn.textContent = orig; btn.style.color = ''; }, 1500);
  });
}

/* ── AI ANALYSIS ─────────────────────────────── */
function setAITopic(topic) {
  document.getElementById('ai-topic').value = topic;
}

async function runAIAnalysis() {
  const topic   = document.getElementById('ai-topic').value.trim();
  const context = document.getElementById('ai-context').value.trim();
  const output  = document.getElementById('ai-output');

  if (!topic) {
    document.getElementById('ai-topic').focus();
    return;
  }

  output.innerHTML = `<div style="color:var(--accent)"><span class="ai-spinner"></span> Analyzing: "${escHtml(topic)}"…</div>`;

  try {
    const r = await fetch('/api/ai-analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ topic, context })
    });
    const d = await r.json();
    if (!d.success) throw new Error(d.error);

    output.innerHTML = '';
    // Typewriter effect
    const text = d.analysis;
    let idx = 0;
    const cursor = document.createElement('span');
    cursor.style.cssText = 'color:var(--accent);animation:pulse 0.8s infinite';
    cursor.textContent = '▋';
    output.appendChild(cursor);

    const typeInterval = setInterval(() => {
      if (idx < text.length) {
        cursor.before(document.createTextNode(text[idx]));
        idx++;
        output.scrollTop = output.scrollHeight;
      } else {
        clearInterval(typeInterval);
        cursor.remove();
      }
    }, 12);
  } catch(e) {
    output.innerHTML = `<span style="color:var(--accent3)">Error: ${escHtml(e.message)}</span>`;
  }
}

/* ── SOC DASHBOARD ───────────────────────────── */
const alertTemplates = [
  { cls: 'critical', text: 'Ransomware C2 beacon detected — 192.168.{r}.{r}' },
  { cls: 'high',     text: 'Brute-force SSH attack — {c} attempts from {ip}' },
  { cls: 'critical', text: 'SQL injection attempt blocked — WAF rule #4412' },
  { cls: 'medium',   text: 'Suspicious PowerShell execution on WIN-{r}' },
  { cls: 'high',     text: 'Data exfiltration pattern detected — {mb}MB/s' },
  { cls: 'medium',   text: 'Port scan from {ip} — {c} ports probed' },
  { cls: 'critical', text: 'Zero-day exploit attempt — CVE-2024-{r}' },
  { cls: 'high',     text: 'Lateral movement detected — MITRE T1021' },
  { cls: 'medium',   text: 'Unusual login time anomaly — user@domain.corp' },
  { cls: 'critical', text: 'Fileless malware loader in memory — PID {r}' },
];

function rnd(n) { return Math.floor(Math.random()*n); }
function randIP() { return `${rnd(220)+10}.${rnd(255)}.${rnd(255)}.${rnd(254)+1}`; }
function randTime() {
  const d = new Date();
  return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}:${String(d.getSeconds()).padStart(2,'0')}`;
}

function fillAlert(tpl) {
  return tpl
    .replace(/{r}/g, () => rnd(9999)+1000)
    .replace(/{c}/g, () => rnd(900)+100)
    .replace(/{ip}/g, randIP)
    .replace(/{mb}/g, () => (Math.random()*5+0.5).toFixed(1));
}

function addAlert() {
  const list = document.getElementById('alert-list');
  if (!list) return;
  const tpl = alertTemplates[rnd(alertTemplates.length)];
  const el = document.createElement('div');
  el.className = `alert-item ${tpl.cls}`;
  el.innerHTML = `
    <div class="alert-dot"></div>
    <div class="alert-text">${fillAlert(tpl.text)}</div>
    <div class="alert-time">${randTime()}</div>`;
  list.insertBefore(el, list.firstChild);
  if (list.children.length > 8) list.lastChild.remove();
}

for(let i=0;i<5;i++) addAlert();
setInterval(addAlert, 2500);

/* ── GEO DISPLAY — Equirectangular World Map ──── */

// Convert real lat/lon to SVG coords in a 1000×500 equirectangular projection
// lon: -180→+180  lat: +90→-90
function lonLatToSVG(lon, lat) {
  return {
    x: ((lon + 180) / 360 * 1000),
    y: ((90 - lat)  / 180 * 500)
  };
}

function buildGeo() {
  const geo = document.getElementById('geo-display');
  if (!geo) return;

  // Accurate continent outline paths in equirectangular projection (1000×500)
  // Each path hand-matched to real geographic boundaries
  const continentPaths = [
    // ── North America ──────────────────────────────────────────────────────
    { d:`M 58,42 L 75,35 L 90,38 L 105,50 L 118,60 L 128,75 L 135,92
         L 138,108 L 132,125 L 120,138 L 108,148 L 98,162 L 88,172
         L 78,168 L 68,158 L 60,142 L 52,125 L 48,108 L 48,90
         L 50,72 L 55,55 Z` },
    // Alaska
    { d:`M 18,55 L 35,48 L 52,55 L 50,72 L 35,68 L 20,68 Z` },
    // Greenland
    { d:`M 128,12 L 148,8  L 165,18 L 162,35 L 148,42 L 130,38 L 122,25 Z` },
    // Central America
    { d:`M 108,172 L 118,175 L 115,192 L 105,195 L 100,182 Z` },
    // Caribbean (Cuba)
    { d:`M 118,162 L 132,160 L 134,168 L 120,170 Z` },

    // ── South America ───────────────────────────────────────────────────────
    { d:`M 118,200 L 148,192 L 170,198 L 182,215 L 185,238 L 182,265
         L 172,292 L 158,318 L 140,338 L 122,345 L 108,335 L 100,312
         L 98,285 L 102,258 L 108,232 L 112,210 Z` },

    // ── Europe ──────────────────────────────────────────────────────────────
    { d:`M 460,62 L 478,55 L 498,58 L 512,68 L 518,82 L 515,98
         L 502,108 L 485,115 L 468,118 L 452,112 L 445,98 L 448,80 Z` },
    // Iberian Peninsula
    { d:`M 442,98 L 458,95 L 462,112 L 448,118 L 438,110 Z` },
    // Italy
    { d:`M 485,98 L 495,95 L 498,112 L 490,122 L 482,115 Z` },
    // Scandinavia
    { d:`M 468,30 L 488,25 L 502,35 L 498,55 L 480,60 L 462,52 Z` },
    // UK / Ireland
    { d:`M 440,60 L 452,55 L 456,68 L 444,72 Z` },
    { d:`M 430,65 L 440,62 L 440,75 L 430,77 Z` },

    // ── Africa ──────────────────────────────────────────────────────────────
    { d:`M 455,128 L 488,118 L 518,122 L 535,140 L 545,168 L 548,202
         L 548,240 L 542,272 L 528,302 L 508,328 L 485,340 L 462,335
         L 442,315 L 432,285 L 428,252 L 432,218 L 440,188 L 448,158 Z` },
    // Madagascar
    { d:`M 558,268 L 566,258 L 572,275 L 568,295 L 558,290 Z` },

    // ── Russia / North Asia ─────────────────────────────────────────────────
    { d:`M 508,30 L 560,22 L 625,18 L 695,22 L 748,28 L 782,38 L 800,52
         L 795,68 L 770,80 L 735,88 L 695,92 L 655,90 L 615,88
         L 575,90 L 540,95 L 515,88 L 508,70 L 506,48 Z` },
    // Siberia eastern extension
    { d:`M 800,22 L 832,18 L 850,28 L 845,45 L 820,52 L 800,52 Z` },
    // Kamchatka
    { d:`M 845,45 L 858,42 L 862,58 L 852,68 L 842,62 Z` },

    // ── Middle East ─────────────────────────────────────────────────────────
    { d:`M 535,122 L 568,115 L 598,120 L 612,135 L 615,155 L 605,172
         L 578,180 L 550,175 L 535,158 L 532,138 Z` },
    // Arabian Peninsula
    { d:`M 550,155 L 575,148 L 600,152 L 608,172 L 602,200 L 578,208
         L 558,200 L 548,178 Z` },

    // ── Central / South Asia ────────────────────────────────────────────────
    { d:`M 598,88 L 652,80 L 700,85 L 725,98 L 722,118 L 705,130
         L 672,135 L 638,132 L 608,122 L 598,105 Z` },
    // India
    { d:`M 618,135 L 655,128 L 678,138 L 682,158 L 675,185 L 658,208
         L 638,218 L 618,205 L 608,180 L 610,158 Z` },
    // Sri Lanka
    { d:`M 655,215 L 662,210 L 665,220 L 658,225 Z` },

    // ── Southeast Asia ──────────────────────────────────────────────────────
    { d:`M 695,135 L 732,128 L 758,135 L 762,155 L 748,168 L 722,172
         L 698,162 L 692,148 Z` },
    // Malay Peninsula
    { d:`M 718,165 L 728,162 L 730,182 L 720,185 Z` },
    // Sumatra
    { d:`M 695,182 L 725,172 L 740,182 L 738,198 L 712,202 L 695,192 Z` },
    // Borneo
    { d:`M 730,172 L 758,165 L 772,175 L 768,198 L 748,205 L 730,195 Z` },
    // Java
    { d:`M 712,202 L 742,198 L 755,205 L 745,215 L 715,215 Z` },

    // ── East Asia ───────────────────────────────────────────────────────────
    { d:`M 700,88 L 752,80 L 792,85 L 815,100 L 818,122 L 805,140
         L 778,150 L 748,152 L 720,145 L 702,128 L 698,108 Z` },
    // Korean Peninsula
    { d:`M 800,105 L 815,100 L 820,115 L 808,125 L 798,118 Z` },
    // Japan (Honshu)
    { d:`M 825,88 L 845,82 L 855,92 L 850,108 L 835,115 L 822,108 Z` },
    // Japan (Hokkaido)
    { d:`M 835,72 L 852,68 L 858,80 L 845,85 L 832,80 Z` },
    // Taiwan
    { d:`M 800,138 L 808,135 L 810,148 L 802,152 Z` },
    // Philippines
    { d:`M 778,148 L 790,142 L 795,158 L 785,165 L 775,158 Z` },

    // ── Australia / Oceania ─────────────────────────────────────────────────
    { d:`M 730,298 L 778,285 L 832,288 L 862,305 L 872,335 L 865,368
         L 840,390 L 805,395 L 770,382 L 748,358 L 738,328 Z` },
    // Tasmania
    { d:`M 800,392 L 812,390 L 815,400 L 805,405 Z` },
    // New Zealand North
    { d:`M 895,355 L 908,348 L 912,362 L 902,370 L 892,365 Z` },
    // New Zealand South
    { d:`M 890,368 L 905,362 L 908,378 L 895,388 L 885,382 Z` },
    // Papua New Guinea
    { d:`M 800,242 L 835,238 L 852,248 L 848,262 L 825,268 L 802,258 Z` },
  ];

  // Build SVG string
  const paths = continentPaths.map(p =>
    `<path d="${p.d}" fill="#1c3d58" stroke="#2e6a9e" stroke-width="0.8" stroke-linejoin="round"/>`
  ).join('\n');

  const mapSVG = `<svg class="geo-map-svg" viewBox="0 0 1000 500" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMid meet">
    <defs>
      <linearGradient id="oceanGrad" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%"   stop-color="#071525"/>
        <stop offset="100%" stop-color="#040c18"/>
      </linearGradient>
    </defs>
    <rect width="1000" height="500" fill="url(#oceanGrad)"/>
    <!-- Longitude lines -->
    <g stroke="#0a1e35" stroke-width="0.5">
      <line x1="0"   y1="0" x2="0"   y2="500"/>
      <line x1="125" y1="0" x2="125" y2="500"/>
      <line x1="250" y1="0" x2="250" y2="500"/>
      <line x1="375" y1="0" x2="375" y2="500"/>
      <line x1="500" y1="0" x2="500" y2="500"/>
      <line x1="625" y1="0" x2="625" y2="500"/>
      <line x1="750" y1="0" x2="750" y2="500"/>
      <line x1="875" y1="0" x2="875" y2="500"/>
      <line x1="1000" y1="0" x2="1000" y2="500"/>
    </g>
    <!-- Latitude lines -->
    <g stroke="#0a1e35" stroke-width="0.5">
      <line x1="0" y1="0"   x2="1000" y2="0"/>
      <line x1="0" y1="83"  x2="1000" y2="83"/>
      <line x1="0" y1="167" x2="1000" y2="167"/>
      <line x1="0" y1="250" x2="1000" y2="250"/>
      <line x1="0" y1="333" x2="1000" y2="333"/>
      <line x1="0" y1="417" x2="1000" y2="417"/>
      <line x1="0" y1="500" x2="1000" y2="500"/>
    </g>
    <!-- Equator (highlighted) -->
    <line x1="0" y1="250" x2="1000" y2="250" stroke="#122840" stroke-width="1.5" stroke-dasharray="6,6"/>
    <!-- Tropic of Cancer / Capricorn -->
    <line x1="0" y1="203" x2="1000" y2="203" stroke="#0d2030" stroke-width="0.8" stroke-dasharray="3,8"/>
    <line x1="0" y1="297" x2="1000" y2="297" stroke="#0d2030" stroke-width="0.8" stroke-dasharray="3,8"/>
    ${paths}
  </svg>`;

  geo.innerHTML = mapSVG;

  // ── Threat origin dots — real lat/lon → SVG coords ──
  // lonLatToSVG maps geographic coordinates to the 1000×500 equirectangular viewBox
  // then we convert to % for CSS positioning on the container div
  const origins = [
    // Country        lon      lat    color (red=state actor, orange=criminal, yellow=moderate)
    { name:'CN', lon: 104,  lat: 36,  color:'#ff3366' },   // China (Beijing area)
    { name:'RU', lon:  37,  lat: 56,  color:'#ff3366' },   // Russia (Moscow area)
    { name:'KP', lon: 127,  lat: 39,  color:'#ff3366' },   // North Korea
    { name:'IR', lon:  51,  lat: 32,  color:'#ff3366' },   // Iran
    { name:'US', lon: -98,  lat: 38,  color:'#ff7043' },   // USA (central)
    { name:'BR', lon: -51,  lat:-14,  color:'#ff7043' },   // Brazil
    { name:'IN', lon:  78,  lat: 22,  color:'#ff7043' },   // India
    { name:'NG', lon:   8,  lat:  9,  color:'#ffb800' },   // Nigeria
    { name:'UA', lon:  31,  lat: 49,  color:'#ffb800' },   // Ukraine
    { name:'DE', lon:  10,  lat: 51,  color:'#ffb800' },   // Germany
  ];

  origins.forEach((o, i) => {
    const svgPos = lonLatToSVG(o.lon, o.lat);
    const left   = (svgPos.x / 1000 * 100).toFixed(3) + '%';
    const top    = (svgPos.y / 500  * 100).toFixed(3) + '%';

    const dot = document.createElement('div');
    dot.className = 'geo-dot';
    dot.style.cssText = `
      left:${left}; top:${top};
      background:${o.color};
      box-shadow: 0 0 10px ${o.color}, 0 0 3px ${o.color};
      color:${o.color};
      animation-delay:${(i * 0.31).toFixed(2)}s`;

    const lbl = document.createElement('div');
    lbl.className   = 'geo-label';
    lbl.style.left  = left;
    lbl.style.top   = top;
    lbl.textContent = o.name;

    geo.appendChild(dot);
    geo.appendChild(lbl);
  });
}
buildGeo();

// Animate bar fills — double rAF ensures width:0 is painted before target width is set
function animateBars() {
  document.querySelectorAll('.bar-fill').forEach(b => {
    b.style.width = '0';                          // reset to 0 first
    const val = b.dataset.val;
    if (!val) return;
    requestAnimationFrame(() => {                 // wait one frame for reset to paint
      requestAnimationFrame(() => {               // then set target on next frame → triggers transition
        b.style.width = val + '%';
      });
    });
  });
}
// Fire on load
setTimeout(animateBars, 400);
// Re-fire every time SOC section comes into view (scroll navigation)
const barObserver = new IntersectionObserver(entries => {
  entries.forEach(e => { if (e.isIntersecting) animateBars(); });
}, { threshold: 0.3 });
const socSection = document.getElementById('soc');
if (socSection) barObserver.observe(socSection);

/* ── REAL-TIME FEED ──────────────────────────── */
const rtTypes = ['malware','phishing','scan','intrusion','ddos'];
const rtMessages = {
  malware:   [ 'Trojan.GenericKD dropped via email attachment',
               'Emotet variant detected — quarantined', 'Cobalt Strike beacon on port 443' ],
  phishing:  [ 'Credential harvesting page cloned from paypal.com',
               'Spear phishing targeting finance dept', 'BEC attempt blocked by mail filter' ],
  scan:      [ 'Nmap syn-scan from {ip} — {c} open ports',
               'Shodan bot probing OT/ICS ports', 'Vulnerability scanner on /admin endpoints' ],
  intrusion: [ 'Unauthorized access attempt — honeypot triggered',
               'Pass-the-hash attack on domain controller', 'Privilege escalation via CVE-2024-{r}' ],
  ddos:      [ 'UDP flood {c}k pps — mitigation active',
               'HTTP/2 rapid reset attack pattern detected', 'Botnet DDoS — 42 countries' ],
};
const rtSev = { malware:'🔴 CRIT', phishing:'🟡 HIGH', scan:'🔵 INFO', intrusion:'🟠 HIGH', ddos:'🔴 CRIT' };

let rtPaused = false;
function toggleRTFeed() {
  rtPaused = !rtPaused;
  document.getElementById('rt-toggle').textContent = rtPaused ? '▶ RESUME' : '■ PAUSE';
}

function addRTEvent() {
  if (rtPaused) return;
  const feed = document.getElementById('rt-feed');
  const type = rtTypes[rnd(rtTypes.length)];
  const msgs = rtMessages[type];
  const msg  = fillAlert(msgs[rnd(msgs.length)]);
  const el   = document.createElement('div');
  el.className = 'rt-event';
  el.innerHTML = `
    <span class="rt-ts">${randTime()}</span>
    <span class="rt-type ${type}">${type.toUpperCase()}</span>
    <span class="rt-msg">${escHtml(msg)}</span>
    <span class="rt-severity">${rtSev[type]}</span>`;
  feed.insertBefore(el, feed.firstChild);
  if (feed.children.length > 60) feed.lastChild.remove();
}

for(let i=0;i<12;i++) addRTEvent();
setInterval(addRTEvent, 1500);

/* ── HELPERS ─────────────────────────────────── */
function escHtml(s) {
  if (!s) return '';
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

/* ── KEYBOARD SHORTCUTS ──────────────────────── */
document.addEventListener('keydown', e => {
  if (e.key === 'Enter') {
    const active = document.activeElement;
    if (active?.id === 'cve-keyword' || active?.id === 'cve-severity') fetchCVEs();
    if (active?.id === 'news-query') fetchNews();
    if (active?.id === 'ai-topic' || active?.id === 'ai-context') runAIAnalysis();
  }
});

/* ═══════════════════════════════════════════════
   NEW FEATURES v3.0
   ═══════════════════════════════════════════════ */

/* ── MITRE ATT&CK ─────────────────────────────── */
const MITRE_DATA = {
  "Reconnaissance":    { id:"TA0043", techniques:[{id:"T1595",name:"Active Scanning",sev:"med"},{id:"T1598",name:"Phishing for Info",sev:"med"},{id:"T1596",name:"Search Open Sources",sev:"low"},{id:"T1597",name:"Search Closed Sources",sev:"low"}] },
  "Initial Access":    { id:"TA0001", techniques:[{id:"T1566",name:"Phishing",sev:"high"},{id:"T1190",name:"Exploit Public App",sev:"high"},{id:"T1133",name:"External Remote Svcs",sev:"med"},{id:"T1200",name:"Hardware Additions",sev:"low"},{id:"T1091",name:"Removable Media",sev:"med"}] },
  "Execution":         { id:"TA0002", techniques:[{id:"T1059",name:"Command & Script",sev:"high"},{id:"T1204",name:"User Execution",sev:"med"},{id:"T1047",name:"WMI",sev:"high"},{id:"T1053",name:"Scheduled Task",sev:"med"},{id:"T1569",name:"System Services",sev:"med"}] },
  "Persistence":       { id:"TA0003", techniques:[{id:"T1547",name:"Boot Autostart",sev:"high"},{id:"T1543",name:"Create/Mod Svc",sev:"high"},{id:"T1136",name:"Create Account",sev:"med"},{id:"T1098",name:"Account Manipulation",sev:"high"},{id:"T1505",name:"Server Software Comp",sev:"high"}] },
  "Priv. Escalation":  { id:"TA0004", techniques:[{id:"T1548",name:"Abuse Elevation Ctrl",sev:"high"},{id:"T1134",name:"Access Token Manip",sev:"high"},{id:"T1611",name:"Escape to Host",sev:"high"},{id:"T1068",name:"Exploit for Priv Esc",sev:"high"}] },
  "Defense Evasion":   { id:"TA0005", techniques:[{id:"T1070",name:"Indicator Removal",sev:"high"},{id:"T1036",name:"Masquerading",sev:"med"},{id:"T1027",name:"Obfuscated Files",sev:"high"},{id:"T1562",name:"Impair Defenses",sev:"high"},{id:"T1055",name:"Process Injection",sev:"high"}] },
  "Credential Access": { id:"TA0006", techniques:[{id:"T1110",name:"Brute Force",sev:"med"},{id:"T1003",name:"OS Credential Dump",sev:"high"},{id:"T1558",name:"Steal/Forge Tickets",sev:"high"},{id:"T1552",name:"Unsecured Creds",sev:"high"}] },
  "Lateral Movement":  { id:"TA0008", techniques:[{id:"T1021",name:"Remote Services",sev:"high"},{id:"T1550",name:"Use Alt Auth Matl",sev:"high"},{id:"T1080",name:"Taint Shared Content",sev:"med"},{id:"T1534",name:"Internal Spearphish",sev:"high"}] },
  "Exfiltration":      { id:"TA0010", techniques:[{id:"T1041",name:"Exfil Over C2",sev:"high"},{id:"T1048",name:"Exfil Alt Protocol",sev:"high"},{id:"T1567",name:"Exfil Web Service",sev:"med"},{id:"T1029",name:"Scheduled Transfer",sev:"med"}] },
  "Impact":            { id:"TA0040", techniques:[{id:"T1486",name:"Data Encrypted (Ransom)",sev:"high"},{id:"T1485",name:"Data Destruction",sev:"high"},{id:"T1489",name:"Service Stop",sev:"high"},{id:"T1498",name:"Network DoS",sev:"high"}] },
};

const MITRE_DETAILS = {
  "T1566": { desc:"Adversaries send phishing messages to gain access to victim systems. All forms of phishing are electronically delivered.", mitigations:"User training, email filtering, MFA, DMARC/SPF/DKIM", detection:"Monitor for suspicious email attachments, links, and network traffic to known phishing domains.", platforms:"Windows, macOS, Linux" },
  "T1059": { desc:"Adversaries abuse command and script interpreters to execute commands, scripts, or binaries. Often used for post-exploitation.", mitigations:"Disable or restrict command-line tools, application whitelisting, PowerShell constrained language mode.", detection:"Monitor process creation for cmd.exe, powershell.exe with encoded/obfuscated arguments.", platforms:"Windows, macOS, Linux" },
  "T1190": { desc:"Use of vulnerability or exploit code to take advantage of a weakness in an internet-facing computer or program.", mitigations:"Patch management, WAF, network segmentation, reduce attack surface.", detection:"Monitor network traffic for exploit attempts, web application logs for anomalous requests.", platforms:"Windows, Linux, Containers" },
  "T1486": { desc:"Adversaries encrypt data on target systems to interrupt availability and hold ransom for decryption key.", mitigations:"Offline backups, endpoint protection, network segmentation, user least privilege.", detection:"Monitor for mass file modifications, shadow copy deletion, unusual encryption processes.", platforms:"Windows, macOS, Linux" },
  "T1003": { desc:"Adversaries attempt to dump credentials to obtain account login and credential material. Tools like Mimikatz are commonly used.", mitigations:"Credential Guard, LSASS protection, privileged access workstations, MFA.", detection:"Monitor for LSASS memory access, use of known credential dumping tools, SAM database access.", platforms:"Windows, Linux, macOS" },
  "T1055": { desc:"Adversaries inject code into processes to evade process-based defenses and elevate privileges.", mitigations:"Behavior monitoring, privilege separation, endpoint protection platform.", detection:"Monitor for unusual CreateRemoteThread, WriteProcessMemory, VirtualAllocEx API calls.", platforms:"Windows, macOS, Linux" },
};

let mitreSelectedTech = null;
let mitreAIOutEl = null;

function buildMITREMatrix(filterTactic = null) {
  const matrix = document.getElementById('mitre-matrix');
  matrix.innerHTML = '';
  const tactics = filterTactic ? { [filterTactic]: MITRE_DATA[filterTactic] } : MITRE_DATA;
  Object.entries(tactics).forEach(([tactic, data]) => {
    const col = document.createElement('div');
    col.className = 'mitre-col';
    col.innerHTML = `<div class="mitre-col-header" title="${data.id}">${tactic}</div>`;
    data.techniques.forEach(t => {
      const el = document.createElement('div');
      el.className = `mitre-technique ${t.sev}-sev`;
      el.dataset.id = t.id; el.dataset.name = t.name; el.dataset.tactic = tactic;
      el.innerHTML = `${escHtml(t.name)}<span class="t-id">${t.id}</span>`;
      el.onclick = () => selectMITRETechnique(t, tactic, el);
      col.appendChild(el);
    });
    matrix.appendChild(col);
  });
}

function buildMITRETacticBar() {
  const bar = document.getElementById('mitre-tactic-bar');
  bar.innerHTML = '';
  const allBtn = document.createElement('button');
  allBtn.className = 'mitre-tactic-btn active';
  allBtn.textContent = 'ALL TACTICS';
  allBtn.onclick = () => { setActiveTacticBtn(allBtn); buildMITREMatrix(null); };
  bar.appendChild(allBtn);
  Object.keys(MITRE_DATA).forEach(tactic => {
    const btn = document.createElement('button');
    btn.className = 'mitre-tactic-btn';
    btn.textContent = tactic.toUpperCase();
    btn.onclick = () => { setActiveTacticBtn(btn); buildMITREMatrix(tactic); };
    bar.appendChild(btn);
  });
}
function setActiveTacticBtn(btn) {
  document.querySelectorAll('.mitre-tactic-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
}

function selectMITRETechnique(t, tactic, el) {
  document.querySelectorAll('.mitre-technique').forEach(e => e.classList.remove('selected'));
  el.classList.add('selected');
  mitreSelectedTech = { ...t, tactic };
  const detail = document.getElementById('mitre-detail');
  const info = MITRE_DETAILS[t.id] || { desc: 'Detailed information available on MITRE ATT&CK website.', mitigations: 'See MITRE ATT&CK for full mitigation guidance.', detection: 'Monitor for anomalous activity related to this technique.', platforms: 'Multiple' };
  detail.innerHTML = `
    <div class="mitre-detail-title">${escHtml(t.name)}</div>
    <div class="mitre-detail-id">${t.id} · Tactic: ${escHtml(tactic)}</div>
    <div class="mitre-detail-section"><div class="mitre-detail-label">DESCRIPTION</div><div class="mitre-detail-text">${escHtml(info.desc)}</div></div>
    <div class="mitre-detail-section"><div class="mitre-detail-label">PLATFORMS</div><div class="mitre-detail-text">${escHtml(info.platforms)}</div></div>
    <div class="mitre-detail-section"><div class="mitre-detail-label">MITIGATIONS</div><div class="mitre-detail-text">${escHtml(info.mitigations)}</div></div>
    <div class="mitre-detail-section"><div class="mitre-detail-label">DETECTION</div><div class="mitre-detail-text">${escHtml(info.detection)}</div></div>
    <div class="mitre-detail-section"><div class="mitre-detail-label">REFERENCE</div><div class="mitre-detail-text"><a href="https://attack.mitre.org/techniques/${t.id}/" target="_blank" class="cve-link">attack.mitre.org/${t.id} ↗</a></div></div>
  `;
  document.getElementById('mitre-actions').style.display = 'flex';
  document.getElementById('mitre-selected-label').textContent = `Selected: ${t.id} — ${t.name}`;
}

async function mitreAIExplain() {
  if (!mitreSelectedTech) return;
  const detail = document.getElementById('mitre-detail');
  // Add AI output section
  let aiOut = document.getElementById('mitre-ai-result');
  if (!aiOut) {
    aiOut = document.createElement('div');
    aiOut.id = 'mitre-ai-result';
    aiOut.className = 'mitre-ai-out';
    detail.appendChild(aiOut);
  }
  aiOut.innerHTML = '<span class="ai-spinner"></span> Generating AI analysis…';
  try {
    const r = await fetch('/api/ai-analyze', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ topic: `MITRE ATT&CK technique ${mitreSelectedTech.id}: ${mitreSelectedTech.name} under tactic ${mitreSelectedTech.tactic}`, context: 'Provide: 1) Real-world example attack, 2) Key detection signals, 3) Top 3 defensive controls. Be concise and technical.' })
    });
    const d = await r.json();
    if (!d.success) throw new Error(d.error);
    aiOut.textContent = '';
    let i = 0;
    const iv = setInterval(() => { if (i < d.analysis.length) { aiOut.textContent += d.analysis[i++]; } else clearInterval(iv); }, 10);
  } catch(e) { aiOut.textContent = 'Error: ' + e.message; }
}

async function mitreLoadRelated() {
  if (!mitreSelectedTech) return;
  document.getElementById('cve-keyword').value = mitreSelectedTech.name.split(' ')[0];
  document.querySelector('[href="#cti"]').click();
  setTimeout(() => { scrollToSection('cti'); fetchCVEs(); }, 300);
}

buildMITRETacticBar();
buildMITREMatrix();

/* ── INCIDENT RESPONSE ────────────────────────── */

// ── Persistence helpers (localStorage) ──────────
const IR_STORAGE_KEY = 'cybernews_incidents_v1';

function irSave() {
  try {
    localStorage.setItem(IR_STORAGE_KEY, JSON.stringify({ incidents, counter: irCounter }));
  } catch(e) { console.warn('IR save failed:', e); }
}

function irLoad() {
  try {
    const raw = localStorage.getItem(IR_STORAGE_KEY);
    if (!raw) return false;
    const data = JSON.parse(raw);
    if (data.incidents && Array.isArray(data.incidents)) {
      incidents  = data.incidents;
      irCounter  = data.counter || (incidents.length + 1);
      return true;
    }
  } catch(e) { console.warn('IR load failed:', e); }
  return false;
}

function irClearStorage() {
  if (!confirm('Delete ALL saved incidents? This cannot be undone.')) return;
  localStorage.removeItem(IR_STORAGE_KEY);
  incidents = [];
  irCounter = 1;
  ['new','investigating','contained','resolved'].forEach(s => {
    document.getElementById('col-'+s).innerHTML = '';
  });
  updateColCounts();
  showIRToast('All incidents cleared.', 'warn');
}

// ── Toast notification ───────────────────────────
function showIRToast(msg, type = 'ok') {
  let toast = document.getElementById('ir-toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'ir-toast';
    toast.style.cssText = `
      position:fixed; bottom:24px; right:24px; z-index:9999;
      font-family:var(--font-mono); font-size:0.75rem;
      padding:10px 18px; border-radius:3px;
      border:1px solid; opacity:0;
      transition:opacity 0.3s; pointer-events:none;`;
    document.body.appendChild(toast);
  }
  const styles = {
    ok:   { bg:'rgba(0,255,157,0.1)',  border:'rgba(0,255,157,0.4)',  color:'var(--accent2)' },
    warn: { bg:'rgba(255,184,0,0.1)',  border:'rgba(255,184,0,0.4)',  color:'var(--warn)' },
    err:  { bg:'rgba(255,51,102,0.1)', border:'rgba(255,51,102,0.4)', color:'var(--accent3)' },
  };
  const s = styles[type] || styles.ok;
  toast.style.background  = s.bg;
  toast.style.borderColor = s.border;
  toast.style.color       = s.color;
  toast.textContent       = msg;
  toast.style.opacity     = '1';
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { toast.style.opacity = '0'; }, 3000);
}

// ── State ────────────────────────────────────────
let incidents    = [];
let irCounter    = 1;
let draggedCard  = null;
let selectedIncId = null;   // which card is currently selected for AI Playbook

// ── Create incident ──────────────────────────────
function createIncident() {
  const title = document.getElementById('ir-title').value.trim();
  const sev   = document.getElementById('ir-severity').value;
  const cat   = document.getElementById('ir-category').value;
  const desc  = document.getElementById('ir-description').value.trim();
  if (!title) { document.getElementById('ir-title').focus(); return; }

  const id  = `INC-${String(irCounter++).padStart(4,'0')}`;
  const ts  = new Date().toLocaleString();
  const incident = { id, title, sev, cat, desc, ts, status: 'new' };
  incidents.push(incident);
  renderIncidentCard(incident);
  document.getElementById('ir-title').value       = '';
  document.getElementById('ir-description').value = '';
  updateColCounts();
  irSave();
  showIRToast(`✓ ${id} saved to browser storage`, 'ok');
}

// ── Render card ──────────────────────────────────
function renderIncidentCard(inc) {
  const col  = document.getElementById('col-' + inc.status);
  if (!col) return;

  // Remove existing card with same id if re-rendering after load
  const existing = document.querySelector(`.ir-card[data-id="${inc.id}"]`);
  if (existing) existing.remove();

  const card = document.createElement('div');
  card.className   = 'ir-card';
  card.draggable   = true;
  card.dataset.id  = inc.id;
  if (selectedIncId === inc.id) card.classList.add('ir-card-selected');

  card.innerHTML = `
    <div class="ir-card-title">${escHtml(inc.title)}</div>
    <div class="ir-card-meta">
      <span class="ir-card-sev ${inc.sev}">${inc.sev.toUpperCase()}</span>
      <span>${escHtml((inc.cat||'').replace(/_/g,' '))}</span>
      <span class="ir-card-id">${inc.id}</span>
    </div>
    ${inc.desc ? `<div class="ir-card-desc">${escHtml(inc.desc.slice(0,80))}${inc.desc.length>80?'…':''}</div>` : ''}
    <div class="ir-card-ts">${inc.ts}</div>
    <div class="ir-card-actions">
      <button class="ir-card-btn" onclick="selectAndPlaybook('${inc.id}',event)" title="Generate AI Playbook for this incident">◈ AI Playbook</button>
      <button class="ir-card-btn ir-card-btn-del" onclick="deleteIncident('${inc.id}',event)" title="Delete incident">✕</button>
    </div>`;

  card.addEventListener('dragstart', e => {
    draggedCard = card;
    e.dataTransfer.effectAllowed = 'move';
    setTimeout(() => card.style.opacity = '0.4', 0);
  });
  card.addEventListener('dragend', () => {
    card.style.opacity = '1';
    draggedCard = null;
  });
  // Click card to select for playbook
  card.addEventListener('click', () => selectForPlaybook(inc.id));

  col.appendChild(card);
  updateColCounts();
}

// ── Select card for AI Playbook ──────────────────
function selectForPlaybook(id, evt) {
  if (evt) evt.stopPropagation();
  selectedIncId = id;
  document.querySelectorAll('.ir-card').forEach(c => c.classList.remove('ir-card-selected'));
  const card = document.querySelector(`.ir-card[data-id="${id}"]`);
  if (card) card.classList.add('ir-card-selected');
  const inc = incidents.find(i => i.id === id);
  if (inc) {
    const label = document.getElementById('ir-playbook-incident-label');
    if (label) label.textContent = `${inc.id} — ${inc.title}`;
    const out = document.getElementById('ir-playbook-out');
    if (out) out.style.display = 'block';
  }
}

// ── Select card AND immediately run AI playbook ──
function selectAndPlaybook(id, evt) {
  if (evt) evt.stopPropagation();
  selectForPlaybook(id);          // highlight card + show panel
  irAIPlaybook();                 // immediately generate the playbook
}

// ── Delete incident ──────────────────────────────
function deleteIncident(id, evt) {
  if (evt) evt.stopPropagation();
  if (!confirm(`Delete incident ${id}?`)) return;
  incidents = incidents.filter(i => i.id !== id);
  const card = document.querySelector(`.ir-card[data-id="${id}"]`);
  if (card) card.remove();
  if (selectedIncId === id) {
    selectedIncId = null;
    document.getElementById('ir-playbook-out').style.display = 'none';
  }
  updateColCounts();
  irSave();
  showIRToast(`${id} deleted`, 'warn');
}

// ── Drag and drop ────────────────────────────────
function dropIncident(e, status) {
  e.preventDefault();
  const col = document.getElementById('col-' + status);
  col.classList.remove('drag-over');
  if (!draggedCard) return;
  col.appendChild(draggedCard);
  const inc = incidents.find(i => i.id === draggedCard.dataset.id);
  if (inc) {
    inc.status = status;
    irSave();
    showIRToast(`${inc.id} → ${status.toUpperCase()}`, 'ok');
  }
  updateColCounts();
}

document.querySelectorAll('.ir-col-body').forEach(col => {
  col.addEventListener('dragover',  e => { e.preventDefault(); col.classList.add('drag-over'); });
  col.addEventListener('dragleave', () => col.classList.remove('drag-over'));
});

function updateColCounts() {
  ['new','investigating','contained','resolved'].forEach(s => {
    const el  = document.getElementById('cnt-'+s);
    const col = document.getElementById('col-'+s);
    if (el && col) el.textContent = col.children.length;
  });
}

// ── AI Playbook — uses SELECTED card, falls back to form ─────
async function irAIPlaybook() {
  const out  = document.getElementById('ir-playbook-out');
  const text = document.getElementById('ir-playbook-text');
  out.style.display = 'block';

  // Determine source: selected card > form fields
  let title, cat, sev, desc;
  if (selectedIncId) {
    const inc = incidents.find(i => i.id === selectedIncId);
    if (inc) { title = inc.title; cat = inc.cat; sev = inc.sev; desc = inc.desc; }
  }
  // Fallback to form if nothing selected
  if (!title) {
    title = document.getElementById('ir-title').value.trim() || 'Generic security incident';
    cat   = document.getElementById('ir-category').value;
    sev   = document.getElementById('ir-severity').value;
    desc  = document.getElementById('ir-description').value.trim();
  }

  const label = document.getElementById('ir-playbook-incident-label');
  if (label) label.textContent = selectedIncId
    ? `${selectedIncId} — ${title}`
    : `Form input — ${title}`;

  text.innerHTML = `<span class="ai-spinner"></span> Generating NIST IR playbook for: <em>${escHtml(title)}</em>…`;

  try {
    const r = await fetch('/api/ai-playbook', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, category: cat, severity: sev, description: desc || '' })
    });
    const d = await r.json();
    if (!d.success) throw new Error(d.error);
    text.textContent = '';
    let i = 0;
    const iv = setInterval(() => {
      if (i < d.analysis.length) { text.textContent += d.analysis[i++]; text.scrollTop = text.scrollHeight; }
      else clearInterval(iv);
    }, 6);
  } catch(e) {
    text.textContent = 'Error: ' + e.message;
  }
}

// ── Load persisted incidents on startup ──────────
const loaded = irLoad();
if (loaded && incidents.length > 0) {
  incidents.forEach(inc => renderIncidentCard(inc));
  showIRToast(`✓ ${incidents.length} incident(s) restored from storage`, 'ok');
} else {
  // First run — seed with sample incidents
  const sampleIncidents = [
    { title:'Ransomware detected on workstation WS-042', sev:'critical', cat:'ransomware', status:'investigating' },
    { title:'Phishing campaign targeting HR department',  sev:'high',     cat:'phishing',  status:'new' },
    { title:'Unusual outbound DNS queries — possible C2', sev:'medium',   cat:'intrusion', status:'contained' },
  ];
  sampleIncidents.forEach(s => {
    const id = `INC-${String(irCounter++).padStart(4,'0')}`;
    const inc = { ...s, id, desc:'', ts: new Date().toLocaleString() };
    incidents.push(inc);
    renderIncidentCard(inc);
  });
  irSave();   // persist the samples immediately
}

/* ── DETECTION RULE GENERATION ────────────────── */
function setDetectThreat(threat) {
  document.getElementById('detect-threat').value = threat;
}

document.getElementById('detect-format')?.addEventListener('change', function() {
  const badge = document.getElementById('detect-format-badge');
  if (badge) badge.textContent = this.value;
});

async function generateDetectionRule() {
  const threat  = document.getElementById('detect-threat').value.trim();
  const format  = document.getElementById('detect-format').value;
  const logsrc  = document.getElementById('detect-logsrc').value;
  const output  = document.getElementById('detect-output');
  const actions = document.getElementById('detect-actions');
  if (!threat) { document.getElementById('detect-threat').focus(); return; }
  output.innerHTML = `<span class="ai-spinner"></span> Generating ${format.toUpperCase()} detection rule…`;
  actions.style.display = 'none';
  try {
    const r = await fetch('/api/ai-analyze', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({
        topic: `Generate a complete ${format.toUpperCase()} detection rule for: ${threat}`,
        context: `Log source: ${logsrc}. Requirements: 1) Write ONLY the complete detection rule in proper ${format} syntax, 2) Add inline comments explaining each detection field, 3) Include rule metadata (title, description, severity, tags), 4) After the rule, add a brief "Detection Logic" section explaining what the rule catches and any false positive considerations. Format the rule properly for ${format}.`
      })
    });
    const d = await r.json();
    if (!d.success) throw new Error(d.error);
    // Render with basic syntax highlighting
    output.innerHTML = '';
    const pre = document.createElement('pre');
    pre.style.margin = '0';
    const text = d.analysis;
    pre.innerHTML = syntaxHighlight(text, format);
    output.appendChild(pre);
    actions.style.display = 'flex';
    window._lastDetectRule = text;
  } catch(e) {
    output.innerHTML = `<span style="color:var(--accent3)">Error: ${escHtml(e.message)}</span>`;
  }
}

function syntaxHighlight(text, format) {
  let h = escHtml(text);
  // Comments
  h = h.replace(/(#[^\n]*)/g, '<span class="rule-comment">$1</span>');
  // Strings
  h = h.replace(/'([^']*)'/g, '<span class="rule-string">\'$1\'</span>');
  h = h.replace(/"([^"]*)"/g, '<span class="rule-string">"$1"</span>');
  // Keywords
  const kw = ['title','description','status','logsource','detection','condition','filter','import','rule','strings','meta','category','product','service','selection','keywords','false_positives','level','tags','author','date','modified'];
  kw.forEach(k => {
    h = h.replace(new RegExp(`\\b(${k})\\b`, 'g'), '<span class="rule-keyword">$1</span>');
  });
  return h;
}

function copyDetectRule() {
  if (window._lastDetectRule) {
    navigator.clipboard.writeText(window._lastDetectRule).then(() => {
      const btn = event.target;
      btn.textContent = '✓ COPIED'; setTimeout(() => btn.textContent = '⎘ COPY RULE', 2000);
    });
  }
}

async function explainDetectRule() {
  if (!window._lastDetectRule) return;
  document.getElementById('ai-topic').value = 'Explain this detection rule and its effectiveness';
  document.getElementById('ai-context').value = window._lastDetectRule;
  scrollToSection('ai');
  setTimeout(runAIAnalysis, 400);
}

/* ── RT MONITORING ENHANCEMENTS ───────────────── */
let rtEventsTotal = 0, rtCritical = 0, rtBlocked = 0;
let rtFilterValue = 'all';
let allRTEvents = [];

function applyRTFilter() {
  rtFilterValue = document.getElementById('rt-filter').value;
  const feed = document.getElementById('rt-feed');
  feed.innerHTML = '';
  const filtered = rtFilterValue === 'all' ? allRTEvents : allRTEvents.filter(e => e.type === rtFilterValue);
  filtered.slice(0, 40).forEach(e => feed.appendChild(e.el.cloneNode(true)));
}

function clearRTFeed() {
  document.getElementById('rt-feed').innerHTML = '';
  allRTEvents = [];
  rtEventsTotal = 0; rtCritical = 0; rtBlocked = 0;
  updateRTStats();
}

function updateRTStats() {
  const evEl = document.getElementById('rt-events-total');
  const crEl = document.getElementById('rt-critical-count');
  const blEl = document.getElementById('rt-blocked-count');
  if (evEl) evEl.textContent = rtEventsTotal;
  if (crEl) crEl.textContent = rtCritical;
  if (blEl) blEl.textContent = rtBlocked;
}

// Override addRTEvent to track stats and filtering
const _origAddRTEvent = addRTEvent;
window.addRTEvent = function() {
  if (rtPaused) return;
  const feed = document.getElementById('rt-feed');
  const type = rtTypes[rnd(rtTypes.length)];
  const msgs = rtMessages[type];
  const msg  = fillAlert(msgs[rnd(msgs.length)]);
  const isCrit = (type === 'malware' || type === 'intrusion') && rnd(3) === 0;
  const isBlocked = rnd(2) === 0;

  rtEventsTotal++;
  if (isCrit) rtCritical++;
  if (isBlocked) rtBlocked++;
  updateRTStats();

  const el = document.createElement('div');
  el.className = 'rt-event';
  el.innerHTML = `
    <span class="rt-ts">${randTime()}</span>
    <span class="rt-type ${type}">${type.toUpperCase()}</span>
    <span class="rt-msg">${escHtml(msg)}</span>
    <span class="rt-severity">${isBlocked ? '<span style="color:var(--accent2)">✓ BLOCKED</span>' : rtSev[type]}</span>`;

  allRTEvents.unshift({ type, el });
  if (allRTEvents.length > 200) allRTEvents.pop();

  if (rtFilterValue === 'all' || rtFilterValue === type) {
    feed.insertBefore(el, feed.firstChild);
    if (feed.children.length > 60) feed.lastChild.remove();
  }
};

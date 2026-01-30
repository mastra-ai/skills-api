import type { RegistrySkill } from '../registry/types.js';

interface IndexPageOptions {
  prefix: string;
  metadata: { scrapedAt: string; totalSkills: number; totalSources: number; totalOwners: number };
  topSkills: RegistrySkill[];
  totalInstalls: number;
}

function formatNumber(n: number): string {
  return n.toLocaleString('en-US');
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function renderIndexPage({ prefix, metadata, topSkills, totalInstalls }: IndexPageOptions): string {
  const scrapedDate = new Date(metadata.scrapedAt);
  const formattedDate = scrapedDate.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZoneName: 'short',
  });

  const topSkillsRows = topSkills
    .slice(0, 10)
    .map(
      (skill, i) => `
      <tr>
        <td class="rank">${i + 1}</td>
        <td><a href="${escapeHtml(skill.githubUrl)}" target="_blank" rel="noopener">${escapeHtml(skill.displayName)}</a></td>
        <td class="mono source"><a href="${prefix}/skills/by-source/${escapeHtml(skill.owner)}/${escapeHtml(skill.repo)}" target="_blank">${escapeHtml(skill.source)}</a></td>
        <td class="installs">${formatNumber(skill.installs)}</td>
      </tr>`,
    )
    .join('');

  const endpoints = [
    { method: 'GET', path: `${prefix}/skills`, desc: 'List and search skills with pagination' },
    { method: 'GET', path: `${prefix}/skills/top`, desc: 'Top skills by install count' },
    { method: 'GET', path: `${prefix}/skills/sources`, desc: 'All source repositories' },
    { method: 'GET', path: `${prefix}/skills/sources/top`, desc: 'Top sources by installs' },
    { method: 'GET', path: `${prefix}/skills/owners`, desc: 'All skill owners' },
    { method: 'GET', path: `${prefix}/skills/agents`, desc: 'Supported AI agents' },
    { method: 'GET', path: `${prefix}/skills/stats`, desc: 'Registry statistics' },
    { method: 'GET', path: `${prefix}/skills/by-source/:owner/:repo`, desc: 'Skills from a specific repo' },
    { method: 'GET', path: `${prefix}/skills/:skillId`, desc: 'Individual skill by ID' },
    { method: 'GET', path: `${prefix}/skills/:owner/:repo/:skillId`, desc: 'Skill by source and ID' },
    { method: 'GET', path: `${prefix}/skills/:owner/:repo/:skillId/files`, desc: 'Skill file contents' },
    { method: 'GET', path: `${prefix}/skills/:owner/:repo/:skillId/content`, desc: 'Full SKILL.md content' },
  ];

  const endpointRows = endpoints
    .map(
      ep => `
      <div class="endpoint">
        <span class="method">${ep.method}</span>
        <code class="path">${escapeHtml(ep.path)}</code>
        <span class="desc">${escapeHtml(ep.desc)}</span>
      </div>`,
    )
    .join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>skills-api</title>
<style>
*, *::before, *::after { margin: 0; padding: 0; box-sizing: border-box; }

:root {
  --bg: #09090b;
  --surface: #131316;
  --surface-2: #1c1c21;
  --border: #27272a;
  --border-light: #3f3f46;
  --text: #fafafa;
  --text-2: #a1a1aa;
  --text-3: #71717a;
  --accent: #e8a634;
  --accent-dim: #b47d1e;
  --accent-bg: rgba(232, 166, 52, 0.08);
  --mono: 'SF Mono', 'Cascadia Code', 'Fira Code', 'JetBrains Mono', 'Consolas', 'Liberation Mono', monospace;
  --sans: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, sans-serif;
  --radius: 6px;
}

html { scroll-behavior: smooth; }

body {
  font-family: var(--sans);
  background: var(--bg);
  color: var(--text);
  line-height: 1.6;
  -webkit-font-smoothing: antialiased;
}

.container {
  max-width: 1080px;
  margin: 0 auto;
  padding: 0 24px;
}

/* ---- HERO ---- */
.hero {
  padding: 80px 0 48px;
  position: relative;
  overflow: hidden;
}

.hero::before {
  content: '';
  position: absolute;
  inset: 0;
  background-image: radial-gradient(circle, var(--border) 1px, transparent 1px);
  background-size: 24px 24px;
  opacity: 0.4;
  pointer-events: none;
}

.hero-content { position: relative; }

.brand {
  font-family: var(--mono);
  font-size: 48px;
  font-weight: 700;
  letter-spacing: -1.5px;
  line-height: 1.1;
}

.brand .dot { color: var(--accent); }

.tagline {
  margin-top: 12px;
  font-size: 18px;
  color: var(--text-2);
  font-weight: 400;
}

.hero-links {
  margin-top: 24px;
  display: flex;
  gap: 16px;
  align-items: center;
}

.hero-links a {
  font-family: var(--mono);
  font-size: 13px;
  color: var(--accent);
  text-decoration: none;
  padding: 8px 16px;
  border: 1px solid var(--accent-dim);
  border-radius: var(--radius);
  transition: background 0.15s, border-color 0.15s;
}

.hero-links a:hover {
  background: var(--accent-bg);
  border-color: var(--accent);
}

/* ---- STATS ---- */
.stats {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 1px;
  background: var(--border);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  overflow: hidden;
  margin-bottom: 64px;
}

.stat {
  background: var(--surface);
  padding: 24px;
}

.stat-value {
  font-family: var(--mono);
  font-size: 28px;
  font-weight: 700;
  color: var(--text);
  letter-spacing: -0.5px;
}

.stat-label {
  font-size: 12px;
  text-transform: uppercase;
  letter-spacing: 1.5px;
  color: var(--text-3);
  margin-top: 4px;
}

/* ---- SECTIONS ---- */
section { margin-bottom: 64px; }

.section-title {
  font-family: var(--mono);
  font-size: 14px;
  text-transform: uppercase;
  letter-spacing: 2px;
  color: var(--accent);
  margin-bottom: 20px;
  padding-bottom: 12px;
  border-bottom: 1px solid var(--border);
}

/* ---- TABLES ---- */
table {
  width: 100%;
  border-collapse: collapse;
  font-size: 14px;
}

thead th {
  text-align: left;
  font-family: var(--mono);
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 1.5px;
  color: var(--text-3);
  padding: 10px 16px;
  border-bottom: 1px solid var(--border);
  font-weight: 500;
}

tbody td {
  padding: 12px 16px;
  border-bottom: 1px solid var(--border);
  vertical-align: middle;
}

tbody tr:hover { background: var(--surface); }
tbody tr:last-child td { border-bottom: none; }

td a {
  color: var(--text);
  text-decoration: none;
  transition: color 0.15s;
}

td a:hover { color: var(--accent); }

.rank {
  font-family: var(--mono);
  color: var(--text-3);
  width: 40px;
  font-size: 13px;
}

.source {
  color: var(--text-2);
  font-size: 13px;
}

.source a { color: var(--text-2); }
.source a:hover { color: var(--accent); }

.installs {
  font-family: var(--mono);
  text-align: right;
  color: var(--text-2);
  font-size: 13px;
}

.mono { font-family: var(--mono); }

/* ---- TABLE WRAPPER ---- */
.table-wrap {
  border: 1px solid var(--border);
  border-radius: var(--radius);
  overflow: hidden;
}

/* ---- DIRECTORY ---- */
.search-bar {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 16px;
}

.search-input-wrap {
  flex: 1;
  position: relative;
}

.search-input-wrap input {
  width: 100%;
  padding: 12px 16px 12px 40px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  color: var(--text);
  font-family: var(--mono);
  font-size: 14px;
  outline: none;
  transition: border-color 0.15s;
}

.search-input-wrap input:focus { border-color: var(--accent-dim); }

.search-input-wrap input::placeholder { color: var(--text-3); }

.search-icon {
  position: absolute;
  left: 14px;
  top: 50%;
  transform: translateY(-50%);
  color: var(--text-3);
  pointer-events: none;
}

.search-kbd {
  position: absolute;
  right: 12px;
  top: 50%;
  transform: translateY(-50%);
  font-family: var(--mono);
  font-size: 11px;
  color: var(--text-3);
  border: 1px solid var(--border);
  border-radius: 3px;
  padding: 2px 6px;
  pointer-events: none;
}

.dir-meta {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 16px;
  background: var(--surface);
  border-bottom: 1px solid var(--border);
  font-size: 13px;
  color: var(--text-3);
}

.dir-meta .count span { color: var(--text-2); }

.pagination {
  display: flex;
  gap: 4px;
  align-items: center;
}

.pagination button {
  font-family: var(--mono);
  font-size: 12px;
  padding: 4px 12px;
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  color: var(--text-2);
  cursor: pointer;
  transition: border-color 0.15s, color 0.15s;
}

.pagination button:hover:not(:disabled) {
  border-color: var(--accent-dim);
  color: var(--text);
}

.pagination button:disabled {
  opacity: 0.3;
  cursor: default;
}

.pagination .page-info {
  font-family: var(--mono);
  font-size: 12px;
  color: var(--text-3);
  padding: 0 8px;
}

.dir-empty {
  padding: 48px 16px;
  text-align: center;
  color: var(--text-3);
  font-size: 14px;
}

.dir-loading {
  padding: 48px 16px;
  text-align: center;
  color: var(--text-3);
  font-size: 14px;
}

/* ---- ENDPOINTS ---- */
.endpoint {
  display: grid;
  grid-template-columns: 40px 1fr 1fr;
  gap: 12px;
  align-items: baseline;
  padding: 12px 16px;
  border-bottom: 1px solid var(--border);
  font-size: 14px;
  transition: background 0.1s;
}

.endpoint:last-child { border-bottom: none; }
.endpoint:hover { background: var(--surface); }

.method {
  font-family: var(--mono);
  font-size: 11px;
  font-weight: 600;
  color: #22c55e;
  letter-spacing: 0.5px;
}

.path {
  font-family: var(--mono);
  font-size: 13px;
  color: var(--text);
  word-break: break-all;
}

.desc {
  color: var(--text-3);
  font-size: 13px;
}

/* ---- FOOTER ---- */
.footer {
  padding: 32px 0;
  border-top: 1px solid var(--border);
  margin-top: 32px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 13px;
  color: var(--text-3);
}

.footer a {
  color: var(--text-2);
  text-decoration: none;
}

.footer a:hover { color: var(--accent); }

/* ---- RESPONSIVE ---- */
@media (max-width: 768px) {
  .stats { grid-template-columns: repeat(2, 1fr); }
  .brand { font-size: 32px; }
  .stat-value { font-size: 22px; }
  .endpoint {
    grid-template-columns: 1fr;
    gap: 4px;
  }
  .endpoint .desc { padding-left: 0; }
  .hero { padding: 48px 0 32px; }
}

@media (max-width: 480px) {
  .stats { grid-template-columns: 1fr; }
}
</style>
</head>
<body>

<div class="container">

  <!-- Hero -->
  <header class="hero">
    <div class="hero-content">
      <h1 class="brand">skills<span class="dot">-</span>api</h1>
      <p class="tagline">API for skills.sh</p>
      <div class="hero-links">
        <a href="https://github.com/mastra-ai/skills-api">GitHub</a>
        <a href="https://skills.sh">skills.sh</a>
        <a href="https://agentskills.io">Specification</a>
        <a href="#api-reference">API Reference</a>
      </div>
    </div>
  </header>

  <!-- Stats -->
  <div class="stats">
    <div class="stat">
      <div class="stat-value">${formatNumber(metadata.totalSkills)}</div>
      <div class="stat-label">Skills</div>
    </div>
    <div class="stat">
      <div class="stat-value">${formatNumber(metadata.totalSources)}</div>
      <div class="stat-label">Sources</div>
    </div>
    <div class="stat">
      <div class="stat-value">${formatNumber(metadata.totalOwners)}</div>
      <div class="stat-label">Owners</div>
    </div>
    <div class="stat">
      <div class="stat-value">${formatNumber(totalInstalls)}</div>
      <div class="stat-label">Total Installs</div>
    </div>
  </div>

  <!-- Top Skills -->
  <section>
    <h2 class="section-title">Top Skills</h2>
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>#</th>
            <th>Skill</th>
            <th>Source</th>
            <th style="text-align:right">Installs</th>
          </tr>
        </thead>
        <tbody>${topSkillsRows}</tbody>
      </table>
    </div>
  </section>

  <!-- Browsable Directory -->
  <section>
    <h2 class="section-title">Directory</h2>
    <div class="search-bar">
      <div class="search-input-wrap">
        <svg class="search-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
        <input type="text" id="dir-search" placeholder="Search skills..." autocomplete="off" spellcheck="false">
        <span class="search-kbd">/</span>
      </div>
    </div>
    <div class="table-wrap">
      <div class="dir-meta">
        <span class="count" id="dir-count"></span>
        <div class="pagination">
          <button id="dir-prev" disabled>&larr; Prev</button>
          <span class="page-info" id="dir-page-info"></span>
          <button id="dir-next" disabled>Next &rarr;</button>
        </div>
      </div>
      <table>
        <thead>
          <tr>
            <th>Skill</th>
            <th>Source</th>
            <th style="text-align:right">Installs</th>
          </tr>
        </thead>
        <tbody id="dir-body">
          <tr><td colspan="3" class="dir-loading">Loading...</td></tr>
        </tbody>
      </table>
    </div>
  </section>

  <!-- API Reference -->
  <section id="api-reference">
    <h2 class="section-title">API Reference</h2>
    <div class="table-wrap">
      ${endpointRows}
    </div>
  </section>

</div>

<footer>
  <div class="container footer">
    <span>Last updated ${escapeHtml(formattedDate)}</span>
    <span><a href="https://github.com/mastra-ai/skills-api">GitHub</a> &middot; <a href="https://skills.sh">skills.sh</a> &middot; Apache-2.0</span>
  </div>
</footer>

<script>
(function() {
  var API = '${prefix}/skills';
  var PAGE_SIZE = 25;
  var state = { query: '', page: 1, total: 0, totalPages: 0, loading: false };

  var searchInput = document.getElementById('dir-search');
  var tbody = document.getElementById('dir-body');
  var countEl = document.getElementById('dir-count');
  var pageInfo = document.getElementById('dir-page-info');
  var prevBtn = document.getElementById('dir-prev');
  var nextBtn = document.getElementById('dir-next');
  var debounceTimer;

  function fmt(n) {
    return n.toLocaleString('en-US');
  }

  function esc(s) {
    var d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
  }

  function render(skills) {
    if (!skills.length) {
      tbody.innerHTML = '<tr><td colspan="3" class="dir-empty">No skills found</td></tr>';
      return;
    }
    tbody.innerHTML = skills.map(function(s) {
      return '<tr>'
        + '<td><a href="' + esc(s.githubUrl) + '" target="_blank" rel="noopener">' + esc(s.displayName) + '</a></td>'
        + '<td class="mono source"><a href="' + API + '/by-source/' + esc(s.owner) + '/' + esc(s.repo) + '" target="_blank">' + esc(s.source) + '</a></td>'
        + '<td class="installs">' + fmt(s.installs) + '</td>'
        + '</tr>';
    }).join('');
  }

  function updateControls() {
    countEl.innerHTML = '<span>' + fmt(state.total) + '</span> skills';
    pageInfo.textContent = state.totalPages ? state.page + ' / ' + state.totalPages : '';
    prevBtn.disabled = state.page <= 1;
    nextBtn.disabled = state.page >= state.totalPages;
  }

  function load() {
    state.loading = true;
    var url = API + '?page=' + state.page + '&pageSize=' + PAGE_SIZE;
    if (state.query) url += '&query=' + encodeURIComponent(state.query);

    fetch(url)
      .then(function(r) { return r.json(); })
      .then(function(data) {
        state.total = data.total;
        state.totalPages = data.totalPages;
        state.loading = false;
        render(data.skills);
        updateControls();
      })
      .catch(function() {
        state.loading = false;
        tbody.innerHTML = '<tr><td colspan="3" class="dir-empty">Failed to load</td></tr>';
      });
  }

  searchInput.addEventListener('input', function() {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(function() {
      state.query = searchInput.value.trim();
      state.page = 1;
      load();
    }, 250);
  });

  prevBtn.addEventListener('click', function() {
    if (state.page > 1) { state.page--; load(); }
  });

  nextBtn.addEventListener('click', function() {
    if (state.page < state.totalPages) { state.page++; load(); }
  });

  document.addEventListener('keydown', function(e) {
    if (e.key === '/' && document.activeElement !== searchInput) {
      e.preventDefault();
      searchInput.focus();
    }
  });

  load();
})();
</script>

</body>
</html>`;
}

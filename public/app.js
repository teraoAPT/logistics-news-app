const CATEGORY_LABEL = {
  logistics: '物流',
  manufacturing: '製造業',
  topic: '注目トピック',
  thailand: 'タイ市場',
};

const COMPETITORS = ['ダイフク', '村田機械', 'IHI', 'トヨタL&F', '豊田自動織機', '西部電機', '住友重機械工業'];
const LOAD_DAYS = 90;
const DAY_MS = 24 * 60 * 60 * 1000;

let allItems = [];
let tagOrder = [];
let activeCategory = 'all';
let activeTag = null;
let searchQuery = '';
let periodDays = 7;
let unreadOnly = false;

const listEl = document.getElementById('list');
const emptyEl = document.getElementById('emptyState');
const statusBar = document.getElementById('statusBar');
const tabsEl = document.getElementById('tabs');
const tagbarEl = document.getElementById('tagbar');
const refreshBtn = document.getElementById('refreshBtn');
const clockEl = document.getElementById('clock');
const searchInput = document.getElementById('searchInput');
const periodSelect = document.getElementById('periodSelect');
const unreadOnlyEl = document.getElementById('unreadOnly');
const tooltipEl = document.getElementById('tooltip');

function tickClock() {
  const now = new Date();
  clockEl.textContent = now.toLocaleTimeString('ja-JP', { hour12: false });
}
setInterval(tickClock, 1000);
tickClock();

// ---------------------------------------------------------------------------
// お気に入り・既読・メモ(このブラウザの中だけに保存)
// ---------------------------------------------------------------------------
function loadLocal(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function saveLocal(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // 保存できない環境(プライベートモードなど)では、その場限りで動かす
  }
}

const favorites = loadLocal('lmw.favorites', {});
const readMarks = loadLocal('lmw.read', {});
const notes = loadLocal('lmw.notes', {});

// 既読の記録は半年分だけ残す
const readCutoff = Date.now() - 180 * DAY_MS;
for (const [link, at] of Object.entries(readMarks)) {
  if (at < readCutoff) delete readMarks[link];
}
saveLocal('lmw.read', readMarks);

function markRead(link) {
  if (readMarks[link]) return;
  readMarks[link] = Date.now();
  saveLocal('lmw.read', readMarks);
}

function toggleFavorite(it) {
  if (favorites[it.link]) delete favorites[it.link];
  else favorites[it.link] = { title: it.title, source: it.source, publishedAt: it.publishedAt, savedAt: Date.now() };
  saveLocal('lmw.favorites', favorites);
}

// ---------------------------------------------------------------------------
// 表示の部品
// ---------------------------------------------------------------------------
function trackingId(link) {
  let hash = 0;
  for (let i = 0; i < link.length; i++) {
    hash = (hash * 31 + link.charCodeAt(i)) >>> 0;
  }
  return hash.toString(36).slice(0, 6).toUpperCase().padStart(6, '0');
}

function relativeTime(iso) {
  const d = new Date(iso);
  const diffMs = Date.now() - d.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return 'たった今';
  if (diffMin < 60) return `${diffMin}分前`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}時間前`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 7) return `${diffDay}日前`;
  return d.toLocaleDateString('ja-JP', { month: 'numeric', day: 'numeric' });
}

function shortDate(iso) {
  return new Date(iso).toLocaleDateString('ja-JP', { month: 'numeric', day: 'numeric' });
}

function parseSearchTerms(query) {
  return query
    .toLowerCase()
    .split(/[\s　]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str || '';
  return div.innerHTML;
}

function hubspotBadges(it) {
  const matches = it.hubspotMatches || [];
  if (matches.length === 0) {
    return '<span class="hs-badge hs-badge--none">HubSpot情報なし</span>';
  }
  return matches
    .map((m) => {
      const cls = m.hasDeal ? 'hs-badge--deal' : 'hs-badge--lead';
      const label = m.hasDeal ? '取引データあり' : 'リード情報あり';
      const owner = m.ownerName ? ` ・ 担当:${escapeHtml(m.ownerName)}` : '';
      return `<span class="hs-badge ${cls}">${escapeHtml(m.name)}: ${label}${owner}</span>`;
    })
    .join('');
}

// Googleニュースの要約欄は「タイトル＋媒体名」の繰り返しなので出さない
function hasRealSummary(it) {
  if (!it.summary) return false;
  const squash = (s) => s.replace(/[\s　]/g, '');
  return !squash(it.summary).startsWith(squash(it.title).slice(0, 20));
}

function relatedBlock(it) {
  if (!it.related || it.related.length === 0) return '';
  const rows = it.related
    .map((r) => `<li><a href="${escapeHtml(r.link)}" target="_blank" rel="noopener noreferrer" data-read-link="${escapeHtml(r.link)}">${escapeHtml(r.source || '不明ソース')}${r.isPaid ? ' 🔒' : ''}</a> ${escapeHtml(r.title)}</li>`)
    .join('');
  return `<details class="card__related"><summary>同じニュースを ほか${it.related.length}媒体 でも報道</summary><ul>${rows}</ul></details>`;
}

// ---------------------------------------------------------------------------
// ニュース一覧
// ---------------------------------------------------------------------------
function render() {
  const terms = parseSearchTerms(searchQuery);
  const since = Date.now() - periodDays * DAY_MS;

  // 90日より古いお気に入りも、保存しておいたタイトルで表示する
  const source = activeCategory === 'favorites'
    ? [
      ...allItems,
      ...Object.entries(favorites)
        .filter(([link]) => !allItems.some((it) => it.link === link))
        .map(([link, f]) => ({ ...f, link, category: '', summary: '', tags: [], hubspotMatches: [] })),
    ]
    : allItems;

  const filtered = source.filter((it) => {
    if (activeCategory === 'favorites') {
      if (!favorites[it.link]) return false;
    } else {
      if (activeCategory !== 'all' && it.category !== activeCategory) return false;
      if (new Date(it.publishedAt).getTime() < since) return false;
    }
    if (activeTag && !it.tags.includes(activeTag)) return false;
    if (unreadOnly && readMarks[it.link]) return false;
    if (terms.length > 0) {
      const haystack = `${it.title} ${it.summary} ${it.source} ${it.tags.join(' ')} ${notes[it.link] || ''}`.toLowerCase();
      const matchesAll = terms.every((term) => haystack.includes(term));
      if (!matchesAll) return false;
    }
    return true;
  });

  listEl.innerHTML = '';
  emptyEl.hidden = filtered.length > 0;

  for (const it of filtered) {
    listEl.appendChild(renderCard(it));
  }
}

function renderCard(it) {
  const card = document.createElement('article');
  card.className = 'card' + (readMarks[it.link] ? ' is-read' : '');
  const isFav = Boolean(favorites[it.link]);
  const note = notes[it.link] || '';

  card.innerHTML = `
    <div class="card__stripe ${it.category}"></div>
    <div class="card__body">
      <div class="card__meta">
        <span class="card__id">#${trackingId(it.link || it.title)}</span>
        <span class="card__category-label ${it.category}">${CATEGORY_LABEL[it.category] || escapeHtml(it.category)}</span>
        <span>${escapeHtml(it.source || '不明ソース')}${it.isPaid ? ' <span class="paid-badge" title="会員登録が必要な場合があります">🔒有料</span>' : ''}</span>
        <span>・</span>
        <span>${relativeTime(it.publishedAt)}</span>
        ${readMarks[it.link] ? '<span class="read-label">既読</span>' : ''}
        ${it.project ? `<span class="project-label">${escapeHtml(it.project.kind)}</span>` : ''}
      </div>
      <a class="card__title" href="${escapeHtml(it.link)}" data-preview="${escapeHtml(it.link)}" target="_blank" rel="noopener noreferrer">${escapeHtml(it.title)}</a>
      ${hasRealSummary(it) ? `<p class="card__summary">${escapeHtml(it.summary)}</p>` : ''}
      <div class="card__tags">${it.tags.map((t) => `<span>${escapeHtml(t)}</span>`).join('')}</div>
      <div class="hs-badge-row">${hubspotBadges(it)}</div>
      ${relatedBlock(it)}
      ${note ? `<p class="card__note-preview">メモ: ${escapeHtml(note)}</p>` : ''}
      <div class="card__actions">
        <button type="button" class="action-btn${isFav ? ' is-on' : ''}" data-action="fav" aria-pressed="${isFav}">${isFav ? '★ お気に入り' : '☆ お気に入り'}</button>
        <button type="button" class="action-btn${note ? ' is-on' : ''}" data-action="note">✎ メモ</button>
      </div>
      <div class="card__note" hidden>
        <textarea rows="3" placeholder="この記事についてのメモ(このブラウザだけに保存されます)">${escapeHtml(note)}</textarea>
      </div>
    </div>
  `;

  // カードのどこを押しても記事が開くようにする(ボタン・メモ欄・別媒体のリンクは除く)
  card.addEventListener('click', (e) => {
    if (e.target.closest('.card__actions, .card__note, .card__related')) return;
    if (window.getSelection().toString()) return;
    if (!e.target.closest('a')) window.open(it.link, '_blank', 'noopener');
    markRead(it.link);
    card.classList.add('is-read');
  });

  card.querySelectorAll('[data-read-link]').forEach((a) => {
    a.addEventListener('click', () => markRead(a.dataset.readLink));
  });

  card.querySelector('[data-action="fav"]').addEventListener('click', () => {
    toggleFavorite(it);
    render();
  });

  const noteBox = card.querySelector('.card__note');
  const textarea = noteBox.querySelector('textarea');
  card.querySelector('[data-action="note"]').addEventListener('click', () => {
    noteBox.hidden = !noteBox.hidden;
    if (!noteBox.hidden) textarea.focus();
  });
  textarea.addEventListener('change', () => {
    const value = textarea.value.trim();
    if (value) notes[it.link] = value;
    else delete notes[it.link];
    saveLocal('lmw.notes', notes);
    render();
  });

  return card;
}

function renderTagbar() {
  const presentTags = new Set(allItems.flatMap((it) => it.tags));
  const ordered = [
    ...tagOrder.filter((t) => presentTags.has(t)),
    ...[...presentTags].filter((t) => !tagOrder.includes(t)),
  ];

  tagbarEl.innerHTML = '';
  if (ordered.length === 0) return;
  ordered.forEach((tag) => {
    const chip = document.createElement('button');
    chip.className = 'chip' + (activeTag === tag ? ' is-active' : '');
    chip.textContent = tag;
    chip.addEventListener('click', () => {
      activeTag = activeTag === tag ? null : tag;
      renderTagbar();
      render();
    });
    tagbarEl.appendChild(chip);
  });
}

// ---------------------------------------------------------------------------
// 新設・増設案件
// ---------------------------------------------------------------------------
const projectKindEl = document.getElementById('projectKind');
const projectSearchEl = document.getElementById('projectSearch');
const projectRowsEl = document.getElementById('projectRows');
const projectEmptyEl = document.getElementById('projectEmpty');

function renderProjects() {
  const kind = projectKindEl.value;
  const terms = parseSearchTerms(projectSearchEl.value);
  const rows = allItems.filter((it) => {
    if (!it.project) return false;
    if (kind && it.project.kind !== kind) return false;
    if (terms.length > 0) {
      const p = it.project;
      const haystack = `${it.title} ${p.company || ''} ${p.location || ''} ${p.purpose || ''}`.toLowerCase();
      if (!terms.every((t) => haystack.includes(t))) return false;
    }
    return true;
  });

  const cell = (v) => (v ? escapeHtml(v) : '<span class="muted">—</span>');
  projectRowsEl.innerHTML = rows
    .map((it) => {
      const p = it.project;
      return `<tr>
        <td class="nowrap">${shortDate(it.publishedAt)}</td>
        <td><span class="project-label">${escapeHtml(p.kind)}</span></td>
        <td>${cell(p.company)}</td>
        <td>${cell(p.location)}</td>
        <td>${cell(p.purpose)}</td>
        <td>${cell(p.timing)}</td>
        <td><a href="${escapeHtml(it.link)}" data-preview="${escapeHtml(it.link)}" target="_blank" rel="noopener noreferrer">${escapeHtml(it.title)}</a> <span class="muted">(${escapeHtml(it.source || '')})</span></td>
      </tr>`;
    })
    .join('');
  projectEmptyEl.hidden = rows.length > 0;
}

projectKindEl.addEventListener('change', renderProjects);
projectSearchEl.addEventListener('input', renderProjects);

// ---------------------------------------------------------------------------
// 競合の動き(週ごとの記事数)
// ---------------------------------------------------------------------------
const WEEKS = 12;

function weekStart(date) {
  // 月曜はじまりの週(日本時間)
  const jst = new Date(date.getTime() + 9 * 60 * 60 * 1000);
  const day = (jst.getUTCDay() + 6) % 7;
  jst.setUTCHours(0, 0, 0, 0);
  return jst.getTime() - day * DAY_MS - 9 * 60 * 60 * 1000;
}

function renderCompetitors() {
  const grid = document.getElementById('competitorGrid');
  const thisWeek = weekStart(new Date());
  const weekStarts = Array.from({ length: WEEKS }, (_, i) => thisWeek - (WEEKS - 1 - i) * 7 * DAY_MS);

  const stats = COMPETITORS.map((name) => {
    const items = allItems.filter((it) => it.tags.includes(name));
    const counts = weekStarts.map((ws) => items.filter((it) => {
      const t = new Date(it.publishedAt).getTime();
      return t >= ws && t < ws + 7 * DAY_MS;
    }).length);
    return { name, items, counts, total: counts.reduce((a, b) => a + b, 0) };
  });
  const max = Math.max(1, ...stats.flatMap((s) => s.counts));

  const W = 264;
  const H = 72;
  const gap = 2;
  const barW = (W - gap * (WEEKS - 1)) / WEEKS;

  grid.innerHTML = stats
    .map((s) => {
      const bars = s.counts
        .map((c, i) => {
          const h = c === 0 ? 0 : Math.max(3, (c / max) * (H - 4));
          const x = i * (barW + gap);
          const label = `${shortDate(new Date(weekStarts[i]).toISOString())}の週: ${c}件`;
          return `<g class="bar" data-tip="${escapeHtml(label)}">
            <rect class="bar__hit" x="${x}" y="0" width="${barW + gap}" height="${H}" />
            ${h > 0 ? `<path class="bar__mark" d="${roundedTopBar(x, H - h, barW, h, Math.min(4, barW / 2, h))}" />` : ''}
          </g>`;
        })
        .join('');
      const latest = s.items
        .slice(0, 3)
        .map((it) => `<li><span class="muted">${shortDate(it.publishedAt)}</span> <a href="${escapeHtml(it.link)}" data-preview="${escapeHtml(it.link)}" target="_blank" rel="noopener noreferrer">${escapeHtml(it.title)}</a></li>`)
        .join('');
      return `<div class="competitor">
        <div class="competitor__head">
          <h3>${escapeHtml(s.name)}</h3>
          <span class="competitor__total">直近${WEEKS}週 <strong>${s.total}</strong>件</span>
        </div>
        <svg class="spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="${escapeHtml(s.name)}の週ごとの記事数: ${s.counts.join('、')}">
          <line class="spark__base" x1="0" y1="${H - 0.5}" x2="${W}" y2="${H - 0.5}" />
          ${bars}
        </svg>
        <div class="spark__axis"><span>${shortDate(new Date(weekStarts[0]).toISOString())}</span><span>今週</span></div>
        <ul class="competitor__latest">${latest || '<li class="muted">記事はまだありません</li>'}</ul>
      </div>`;
    })
    .join('');
}

function roundedTopBar(x, y, w, h, r) {
  return `M${x},${y + h} V${y + r} Q${x},${y} ${x + r},${y} H${x + w - r} Q${x + w},${y} ${x + w},${y + r} V${y + h} Z`;
}

document.getElementById('competitorGrid').addEventListener('mousemove', (e) => {
  const bar = e.target.closest('.bar');
  if (!bar) {
    tooltipEl.hidden = true;
    return;
  }
  tooltipEl.textContent = bar.dataset.tip;
  tooltipEl.hidden = false;
  tooltipEl.style.left = `${e.clientX + 12}px`;
  tooltipEl.style.top = `${e.clientY + 12}px`;
});
document.getElementById('competitorGrid').addEventListener('mouseleave', () => {
  tooltipEl.hidden = true;
});

// ---------------------------------------------------------------------------
// 記事のプレビュー(リンクにマウスを合わせると、写真と紹介文を出す)
// ---------------------------------------------------------------------------
const PREVIEW_DELAY_MS = 400;
const previewCache = new Map();
const previewEl = document.createElement('div');
previewEl.className = 'preview';
previewEl.hidden = true;
document.body.appendChild(previewEl);

let previewTimer = null;
let hideTimer = null;
let previewLink = null;

function placePreview(anchor) {
  const r = anchor.getBoundingClientRect();
  const width = Math.min(420, window.innerWidth - 32);
  const left = Math.max(16, Math.min(r.left, window.innerWidth - width - 16));
  const below = window.innerHeight - r.bottom;
  previewEl.style.width = `${width}px`;
  previewEl.style.left = `${left}px`;
  if (below >= 260 || below >= r.top) {
    previewEl.style.top = `${r.bottom + 6}px`;
    previewEl.style.bottom = '';
    previewEl.style.maxHeight = `${Math.min(420, below - 16)}px`;
  } else {
    previewEl.style.top = '';
    previewEl.style.bottom = `${window.innerHeight - r.top + 6}px`;
    previewEl.style.maxHeight = `${Math.min(420, r.top - 16)}px`;
  }
}

function previewHtml(link, p) {
  const open = `<a class="preview__open" href="${escapeHtml(p && p.url || link)}" target="_blank" rel="noopener noreferrer">記事を開く →</a>`;
  if (!p) return '<p class="preview__msg">読み込み中...</p>';
  if (p.failed || (!p.description && !p.image)) {
    return `<p class="preview__msg">この記事は紹介文を取得できませんでした。</p>${open}`;
  }
  return `
    ${p.image ? `<img class="preview__img" src="${escapeHtml(p.image)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()">` : ''}
    ${p.siteName ? `<p class="preview__site">${escapeHtml(p.siteName)}</p>` : ''}
    <p class="preview__desc">${escapeHtml(p.description || '(紹介文なし)')}</p>
    <p class="preview__note">媒体が公開している紹介文です。全文は元の記事で読めます。</p>
    ${open}`;
}

async function showPreview(anchor) {
  const link = anchor.dataset.preview;
  previewLink = link;
  previewEl.innerHTML = previewHtml(link, previewCache.get(link));
  previewEl.hidden = false;
  placePreview(anchor);
  if (previewCache.has(link)) return;
  try {
    const res = await fetch(`/api/preview?link=${encodeURIComponent(link)}`);
    previewCache.set(link, res.ok ? await res.json() : { failed: true });
  } catch {
    previewCache.set(link, { failed: true });
  }
  if (previewLink === link && !previewEl.hidden) {
    previewEl.innerHTML = previewHtml(link, previewCache.get(link));
    placePreview(anchor);
  }
}

function hidePreviewSoon() {
  clearTimeout(previewTimer);
  clearTimeout(hideTimer);
  hideTimer = setTimeout(() => {
    previewEl.hidden = true;
    previewLink = null;
  }, 250);
}

// タッチ操作の端末ではマウスを合わせられないので出さない
document.addEventListener('pointerover', (e) => {
  if (e.pointerType !== 'mouse') return;
  const anchor = e.target.closest('a[data-preview]');
  if (!anchor) return;
  clearTimeout(hideTimer);
  if (previewLink === anchor.dataset.preview && !previewEl.hidden) return;
  clearTimeout(previewTimer);
  previewTimer = setTimeout(() => showPreview(anchor), PREVIEW_DELAY_MS);
});

document.addEventListener('pointerout', (e) => {
  if (e.target.closest('a[data-preview]') && !previewEl.contains(e.relatedTarget)) hidePreviewSoon();
});

previewEl.addEventListener('pointerenter', () => clearTimeout(hideTimer));
previewEl.addEventListener('pointerleave', hidePreviewSoon);
previewEl.addEventListener('click', (e) => {
  if (e.target.closest('.preview__open') && previewLink) markRead(previewLink);
});
window.addEventListener('scroll', () => {
  if (!previewEl.hidden && !previewEl.matches(':hover')) hidePreviewSoon();
}, { passive: true });

// ---------------------------------------------------------------------------
// 画面の切り替え
// ---------------------------------------------------------------------------
const VIEWS = {
  news: { el: document.getElementById('newsView'), render },
  projects: { el: document.getElementById('projectsView'), render: renderProjects },
  competitors: { el: document.getElementById('competitorsView'), render: renderCompetitors },
};

function currentView() {
  const name = location.hash.replace('#', '');
  return VIEWS[name] ? name : 'news';
}

function showView() {
  const name = currentView();
  for (const [key, v] of Object.entries(VIEWS)) v.el.hidden = key !== name;
  document.querySelectorAll('.view-link').forEach((a) => a.classList.toggle('is-active', a.dataset.view === name));
  document.getElementById('newsToolbar').hidden = name !== 'news';
  tagbarEl.hidden = name !== 'news';
  VIEWS[name].render();
}

window.addEventListener('hashchange', showView);

tabsEl.addEventListener('click', (e) => {
  const btn = e.target.closest('.tab');
  if (!btn) return;
  activeCategory = btn.dataset.filter;
  [...tabsEl.children].forEach((c) => c.classList.toggle('is-active', c === btn));
  render();
});

searchInput.addEventListener('input', (e) => {
  searchQuery = e.target.value;
  render();
});

periodSelect.addEventListener('change', () => {
  periodDays = Number(periodSelect.value);
  render();
});

unreadOnlyEl.addEventListener('change', () => {
  unreadOnly = unreadOnlyEl.checked;
  render();
});

async function loadNews(force = false) {
  refreshBtn.classList.add('is-loading');
  statusBar.textContent = '読み込み中...';
  try {
    const res = await fetch(`/api/news?days=${LOAD_DAYS}${force ? '&refresh=1' : ''}`);
    const data = await res.json();
    allItems = data.items || [];
    tagOrder = data.tagOrder || [];
    const errCount = (data.errors || []).length;
    const fetchedAt = new Date(data.fetchedAt).toLocaleTimeString('ja-JP', { hour12: false });
    const unread = allItems.filter((it) => !readMarks[it.link] && Date.now() - new Date(it.publishedAt).getTime() < DAY_MS).length;
    statusBar.textContent = `記事 ${allItems.length}件(直近${LOAD_DAYS}日) ・ 今日の未読 ${unread}件 ・ 最終取得 ${fetchedAt}${errCount ? ` ・ ${errCount}件のフィードで取得エラー` : ''}`;
    renderTagbar();
    showView();
  } catch (err) {
    statusBar.textContent = '取得に失敗しました。再スキャンをお試しください。';
  } finally {
    refreshBtn.classList.remove('is-loading');
  }
}

refreshBtn.addEventListener('click', () => loadNews(true));

loadNews();

const CATEGORY_LABEL = {
  logistics: '物流',
  manufacturing: '製造業',
  topic: '注目トピック',
  thailand: 'タイ市場',
};

let allItems = [];
let tagOrder = [];
let activeCategory = 'all';
let activeTag = null;
let searchQuery = '';

const listEl = document.getElementById('list');
const emptyEl = document.getElementById('emptyState');
const statusBar = document.getElementById('statusBar');
const tabsEl = document.getElementById('tabs');
const tagbarEl = document.getElementById('tagbar');
const refreshBtn = document.getElementById('refreshBtn');
const clockEl = document.getElementById('clock');
const searchInput = document.getElementById('searchInput');

function tickClock() {
  const now = new Date();
  clockEl.textContent = now.toLocaleTimeString('ja-JP', { hour12: false });
}
setInterval(tickClock, 1000);
tickClock();

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

function parseSearchTerms(query) {
  return query
    .toLowerCase()
    .split(/[\s　]+/)
    .map((s) => s.trim())
    .filter(Boolean);
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

function render() {
  const terms = parseSearchTerms(searchQuery);

  const filtered = allItems.filter((it) => {
    if (activeCategory !== 'all' && it.category !== activeCategory) return false;
    if (activeTag && !it.tags.includes(activeTag)) return false;
    if (terms.length > 0) {
      const haystack = `${it.title} ${it.summary} ${it.source} ${it.tags.join(' ')}`.toLowerCase();
      const matchesAll = terms.every((term) => haystack.includes(term));
      if (!matchesAll) return false;
    }
    return true;
  });

  listEl.innerHTML = '';
  emptyEl.hidden = filtered.length > 0;

  for (const it of filtered) {
    const card = document.createElement('a');
    card.className = 'card';
    card.href = it.link;
    card.target = '_blank';
    card.rel = 'noopener noreferrer';

    card.innerHTML = `
      <div class="card__stripe ${it.category}"></div>
      <div class="card__body">
        <div class="card__meta">
          <span class="card__id">#${trackingId(it.link || it.title)}</span>
          <span class="card__category-label ${it.category}">${CATEGORY_LABEL[it.category] || it.category}</span>
          <span>${it.source || '不明ソース'}${it.isPaid ? ' <span class="paid-badge" title="会員登録が必要な場合があります">🔒有料</span>' : ''}</span>
          <span>・</span>
          <span>${relativeTime(it.publishedAt)}</span>
        </div>
        <p class="card__title">${escapeHtml(it.title)}</p>
        ${it.summary ? `<p class="card__summary">${escapeHtml(it.summary)}</p>` : ''}
        <div class="card__tags">${it.tags.map((t) => `<span>${t}</span>`).join('')}</div>
        <div class="hs-badge-row">${hubspotBadges(it)}</div>
      </div>
    `;
    listEl.appendChild(card);
  }
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str || '';
  return div.innerHTML;
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

async function loadNews(force = false) {
  refreshBtn.classList.add('is-loading');
  statusBar.textContent = '読み込み中...';
  try {
    const res = await fetch(`/api/news${force ? '?refresh=1' : ''}`);
    const data = await res.json();
    allItems = data.items || [];
    tagOrder = data.tagOrder || [];
    const errCount = (data.errors || []).length;
    const fetchedAt = new Date(data.fetchedAt).toLocaleTimeString('ja-JP', { hour12: false });
    statusBar.textContent = `記事 ${allItems.length}件 ・ 最終取得 ${fetchedAt}${errCount ? ` ・ ${errCount}件のフィードで取得エラー` : ''}`;
    renderTagbar();
    render();
  } catch (err) {
    statusBar.textContent = '取得に失敗しました。再スキャンをお試しください。';
  } finally {
    refreshBtn.classList.remove('is-loading');
  }
}

refreshBtn.addEventListener('click', () => loadNews(true));

loadNews();

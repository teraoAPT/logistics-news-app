const CATEGORY_LABEL = {
  logistics: '物流',
  manufacturing: '製造業',
  topic: '注目トピック',
};

let allItems = [];
let activeCategory = 'all';
let activeTag = null;

const listEl = document.getElementById('list');
const emptyEl = document.getElementById('emptyState');
const statusBar = document.getElementById('statusBar');
const tabsEl = document.getElementById('tabs');
const tagbarEl = document.getElementById('tagbar');
const refreshBtn = document.getElementById('refreshBtn');
const clockEl = document.getElementById('clock');

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

function render() {
  const filtered = allItems.filter((it) => {
    if (activeCategory !== 'all' && it.category !== activeCategory) return false;
    if (activeTag && !it.tags.includes(activeTag)) return false;
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
          <span>${it.source || '不明ソース'}</span>
          <span>・</span>
          <span>${relativeTime(it.publishedAt)}</span>
        </div>
        <p class="card__title">${escapeHtml(it.title)}</p>
        ${it.summary ? `<p class="card__summary">${escapeHtml(it.summary)}</p>` : ''}
        <div class="card__tags">${it.tags.map((t) => `<span>${t}</span>`).join('')}</div>
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
  const allTags = [...new Set(allItems.flatMap((it) => it.tags))];
  tagbarEl.innerHTML = '';
  if (allTags.length === 0) return;
  allTags.forEach((tag) => {
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

async function loadNews(force = false) {
  refreshBtn.classList.add('is-loading');
  statusBar.textContent = '読み込み中...';
  try {
    const res = await fetch(`/api/news${force ? '?refresh=1' : ''}`);
    const data = await res.json();
    allItems = data.items || [];
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

const CATEGORY_LABEL = {
  logistics: '物流',
  manufacturing: '製造業',
  topic: '注目トピック',
  thailand: 'タイ市場',
  subsidy: '補助金・公募',
  ai: 'AI',
};

const COMPETITORS = ['ダイフク', '村田機械', 'IHI', 'トヨタL&F', '豊田自動織機', '西部電機', '住友重機械工業'];
const LOAD_DAYS = 90;
const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * DAY_MS;

let allItems = [];
let tagOrder = [];
let activeCategory = 'all';
let activeTag = null;
let searchQuery = '';
let periodDays = 7;
let unreadOnly = false;
let newOnly = false;
let hubspotFilter = '';
let ownerFilter = '';
let commentsByLink = {};
let commentsEnabled = false;
let shownItems = [];
let focusIndex = -1;

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
const newOnlyEl = document.getElementById('newOnly');
const hubspotFilterEl = document.getElementById('hubspotFilter');
const ownerFilterEl = document.getElementById('ownerFilter');
const tooltipEl = document.getElementById('tooltip');

function tickClock() {
  const now = new Date();
  clockEl.textContent = now.toLocaleTimeString('ja-JP', { hour12: false });
}
setInterval(tickClock, 1000);
tickClock();

// ---------------------------------------------------------------------------
// お気に入り・既読・メモ・設定(このブラウザの中だけに保存)
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
const settings = { name: '', watch: [], muteWords: [], muteSources: [], ...loadLocal('lmw.settings', {}) };

// 既読の記録は半年分だけ残す
const readCutoff = Date.now() - 180 * DAY_MS;
for (const [link, at] of Object.entries(readMarks)) {
  if (at < readCutoff) delete readMarks[link];
}
saveLocal('lmw.read', readMarks);

// 「NEW」は前回サイトを開いたとき以降に入った記事。30分以上あいたら別の訪問とみなす
const VISIT_GAP_MS = 30 * 60 * 1000;
const previousVisit = (() => {
  const now = Date.now();
  const visit = loadLocal('lmw.visit', null);
  let previous;
  if (!visit) previous = now;
  else if (now - visit.current > VISIT_GAP_MS) previous = visit.current;
  else previous = visit.previous;
  saveLocal('lmw.visit', { current: now, previous });
  return previous;
})();

function isNew(it) {
  return Boolean(it.firstSeenAt) && Date.parse(it.firstSeenAt) > previousVisit;
}

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
// ウォッチワード・ミュート
// ---------------------------------------------------------------------------
function lower(s) {
  return (s || '').toLowerCase();
}

function watchHit(it) {
  const text = lower(`${it.title} ${it.summary || ''}`);
  return settings.watch.find((w) => text.includes(lower(w))) || null;
}

function isMuted(it) {
  const title = lower(it.title);
  const source = lower(it.source);
  return settings.muteWords.some((w) => title.includes(lower(w)))
    || settings.muteSources.some((s) => source.includes(lower(s)));
}

// ミュートした記事を除いたもの。ニュース以外のページもこれを使う
function liveItems() {
  return allItems.filter((it) => !isMuted(it));
}

// 案件・お客様・新規開拓は物流・製造業向けなので、AI の記事は入れない(「すべて」タブと同じ考え方)
function businessItems() {
  return liveItems().filter((it) => it.category !== 'ai');
}

// ---------------------------------------------------------------------------
// HubSpot
// ---------------------------------------------------------------------------
function isChance(it) {
  return Boolean(it.project) && (it.hubspotMatches || []).length > 0;
}

function matchesHubspotFilter(matches, filter) {
  switch (filter) {
    case '': return true;
    case 'any': return matches.length > 0;
    case 'deal': return matches.some((m) => m.hasDeal);
    case 'nodeal': return matches.some((m) => !m.hasDeal);
    default: return matches.some((m) => `stage:${m.stage}` === filter);
  }
}

function passesHubspot(it) {
  const matches = it.hubspotMatches || [];
  if (ownerFilter && !matches.some((m) => m.ownerName === ownerFilter)) return false;
  if (hubspotFilter === 'chance') return isChance(it);
  return matchesHubspotFilter(matches, hubspotFilter);
}

function hubspotCompanies(items) {
  const byName = new Map();
  for (const it of items) {
    for (const m of it.hubspotMatches || []) {
      if (!byName.has(m.name)) byName.set(m.name, { ...m, items: [] });
      byName.get(m.name).items.push(it);
    }
  }
  return [...byName.values()];
}

// 段階・担当者の選択肢は、記事に出てきた会社から作る
function fillHubspotSelect(select, firstLabel, { withChance }) {
  const current = select.value;
  const stages = new Map();
  for (const it of allItems) {
    for (const m of it.hubspotMatches || []) if (m.stage) stages.set(m.stage, m.stageLabel || m.stage);
  }
  const options = [
    ['', firstLabel],
    ['any', 'HubSpotの会社が出る記事'],
    ...(withChance ? [['chance', '商談チャンス(HubSpotの会社 × 新設・増設)']] : []),
    ['deal', '取引データあり'],
    ['nodeal', '取引データなし(リード情報あり)'],
    ...[...stages].map(([value, label]) => [`stage:${value}`, `段階: ${label}`]),
  ];
  select.innerHTML = options.map(([v, l]) => `<option value="${escapeHtml(v)}">${escapeHtml(l)}</option>`).join('');
  if (options.some(([v]) => v === current)) select.value = current;
}

function fillOwnerSelect(select) {
  const current = select.value;
  const owners = [...new Set(allItems.flatMap((it) => (it.hubspotMatches || []).map((m) => m.ownerName).filter(Boolean)))]
    .sort((a, b) => a.localeCompare(b, 'ja'));
  select.innerHTML = [['', '担当者: 全員'], ...owners.map((o) => [o, `担当: ${o}`])]
    .map(([v, l]) => `<option value="${escapeHtml(v)}">${escapeHtml(l)}</option>`).join('');
  if (owners.includes(current)) select.value = current;
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

function fullDate(iso) {
  return new Date(iso).toLocaleDateString('ja-JP', { year: 'numeric', month: '2-digit', day: '2-digit' });
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

function articleLink(it) {
  return `<a href="${escapeHtml(it.link)}" data-preview="${escapeHtml(it.link)}" target="_blank" rel="noopener noreferrer">${escapeHtml(it.title)}</a>`;
}

function hubspotLabel(m) {
  const parts = [m.stageLabel, m.hasDeal ? '取引データあり' : 'リード情報あり'].filter(Boolean);
  return parts.join(' ・ ');
}

function hubspotBadges(it) {
  const matches = it.hubspotMatches || [];
  if (matches.length === 0) {
    return '<span class="hs-badge hs-badge--none">HubSpot情報なし</span>';
  }
  return matches
    .map((m) => {
      const cls = m.hasDeal ? 'hs-badge--deal' : 'hs-badge--lead';
      const owner = m.ownerName ? ` ・ 担当:${escapeHtml(m.ownerName)}` : '';
      return `<span class="hs-badge ${cls}">${escapeHtml(m.name)}: ${escapeHtml(hubspotLabel(m))}${owner}</span>`;
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
// CSV(Excel で文字化けしないよう BOM を付ける)
// ---------------------------------------------------------------------------
function csvCell(value) {
  let s = value == null ? '' : String(value);
  // Excel が数式として実行しないように、先頭の = + - @ を無効にする
  if (/^[=+\-@]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function downloadCsv(filename, header, rows) {
  const text = [header, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n');
  const blob = new Blob(['﻿', text], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function today() {
  const d = new Date();
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
}

// ---------------------------------------------------------------------------
// ニュース一覧
// ---------------------------------------------------------------------------
function commentText(link) {
  return (commentsByLink[link] || []).map((c) => `${c.author} ${c.text}`).join(' ');
}

function filterNews() {
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
    if (isMuted(it)) return false;
    if (activeCategory === 'favorites') {
      if (!favorites[it.link]) return false;
    } else {
      if (activeCategory !== 'all' && it.category !== activeCategory) return false;
      // AIの記事は数が多く物流・製造業の記事が埋もれるので、「すべて」には混ぜず AI タブで見る
      if (activeCategory === 'all' && it.category === 'ai') return false;
      if (new Date(it.publishedAt).getTime() < since) return false;
    }
    if (activeTag && !it.tags.includes(activeTag)) return false;
    if (unreadOnly && readMarks[it.link]) return false;
    if (newOnly && !isNew(it)) return false;
    if (!passesHubspot(it)) return false;
    if (terms.length > 0) {
      const haystack = `${it.title} ${it.summary} ${it.source} ${it.tags.join(' ')} ${notes[it.link] || ''} ${commentText(it.link)}`.toLowerCase();
      const matchesAll = terms.every((term) => haystack.includes(term));
      if (!matchesAll) return false;
    }
    return true;
  });

  // ウォッチワードに当たった記事を先頭に(それぞれの中では新しい順のまま)
  return [...filtered.filter((it) => watchHit(it)), ...filtered.filter((it) => !watchHit(it))];
}

function render() {
  shownItems = filterNews();
  listEl.innerHTML = '';
  emptyEl.hidden = shownItems.length > 0;
  for (const it of shownItems) {
    listEl.appendChild(renderCard(it));
  }
  if (focusIndex >= shownItems.length) focusIndex = shownItems.length - 1;
  applyFocus(false);
}

function renderComments(link) {
  const list = commentsByLink[link] || [];
  if (list.length === 0) return '<p class="muted comment-empty">まだコメントはありません。</p>';
  return `<ul class="comments">${list.map((c) => `
    <li>
      <span class="comment__author">${escapeHtml(c.author)}</span>
      <span class="muted">${shortDate(c.at)}</span>
      ${commentsEnabled && c.author === settings.name ? `<button type="button" class="comment__del" data-comment-id="${escapeHtml(c.id)}" title="削除">×</button>` : ''}
      <div class="comment__text">${escapeHtml(c.text)}</div>
    </li>`).join('')}</ul>`;
}

function commentForm() {
  if (!commentsEnabled) {
    return '<p class="muted">チームのコメントは、サイトにパスワードをかけると使えるようになります。</p>';
  }
  return `
    ${settings.name ? '' : '<input type="text" class="comment__name" maxlength="40" placeholder="あなたの名前(最初の1回だけ)" />'}
    <textarea class="comment__input" rows="2" placeholder="チームに共有するコメント"></textarea>
    <button type="button" class="action-btn" data-action="post">コメントを投稿</button>
    <span class="comment__msg muted"></span>`;
}

function renderCard(it) {
  const card = document.createElement('article');
  const watch = watchHit(it);
  card.className = 'card' + (readMarks[it.link] ? ' is-read' : '') + (watch ? ' is-watch' : '');
  const isFav = Boolean(favorites[it.link]);
  const note = notes[it.link] || '';
  const commentCount = (commentsByLink[it.link] || []).length;

  card.innerHTML = `
    <div class="card__stripe ${it.category}"></div>
    <div class="card__body">
      <div class="card__meta">
        <span class="card__id">#${trackingId(it.link || it.title)}</span>
        ${isNew(it) ? '<span class="new-label">NEW</span>' : ''}
        <span class="card__category-label ${it.category}">${CATEGORY_LABEL[it.category] || escapeHtml(it.category)}</span>
        <span>${escapeHtml(it.source || '不明ソース')}${it.isPaid ? ' <span class="paid-badge" title="会員登録が必要な場合があります">🔒有料</span>' : ''}</span>
        <span>・</span>
        <span>${relativeTime(it.publishedAt)}</span>
        ${readMarks[it.link] ? '<span class="read-label">既読</span>' : ''}
        ${it.project ? `<span class="project-label">${escapeHtml(it.project.kind)}</span>` : ''}
        ${isChance(it) ? '<span class="chance-label">商談チャンス</span>' : ''}
        ${watch ? `<span class="watch-label">ウォッチ: ${escapeHtml(watch)}</span>` : ''}
      </div>
      <a class="card__title" href="${escapeHtml(it.link)}" data-preview="${escapeHtml(it.link)}" target="_blank" rel="noopener noreferrer">${escapeHtml(it.title)}</a>
      ${hasRealSummary(it) ? `<p class="card__summary">${escapeHtml(it.summary)}</p>` : ''}
      <div class="card__tags">${it.tags.map((t) => `<span>${escapeHtml(t)}</span>`).join('')}</div>
      <div class="hs-badge-row">${hubspotBadges(it)}</div>
      ${relatedBlock(it)}
      ${note ? `<p class="card__note-preview">メモ: ${escapeHtml(note)}</p>` : ''}
      ${commentCount ? `<p class="card__comment-preview">💬 ${escapeHtml(commentsByLink[it.link][commentCount - 1].author)}: ${escapeHtml(commentsByLink[it.link][commentCount - 1].text)}${commentCount > 1 ? ` <span class="muted">ほか${commentCount - 1}件</span>` : ''}</p>` : ''}
      <div class="card__actions">
        <button type="button" class="action-btn${isFav ? ' is-on' : ''}" data-action="fav" aria-pressed="${isFav}">${isFav ? '★ お気に入り' : '☆ お気に入り'}</button>
        <button type="button" class="action-btn${note || commentCount ? ' is-on' : ''}" data-action="note">✎ メモ・コメント${commentCount ? `(${commentCount})` : ''}</button>
        ${it.source ? '<button type="button" class="action-btn" data-action="mute">媒体をミュート</button>' : ''}
      </div>
      <div class="card__note" hidden>
        <p class="card__note-head">自分用メモ(このブラウザだけ)</p>
        <textarea class="note__input" rows="2" placeholder="この記事についての自分用メモ">${escapeHtml(note)}</textarea>
        <p class="card__note-head">チームのコメント</p>
        <div class="comment-list">${renderComments(it.link)}</div>
        ${commentForm()}
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

  const muteBtn = card.querySelector('[data-action="mute"]');
  if (muteBtn) {
    muteBtn.addEventListener('click', () => {
      if (!confirm(`「${it.source}」の記事を表示しないようにします。設定からいつでも戻せます。`)) return;
      settings.muteSources = [...new Set([...settings.muteSources, it.source])];
      saveLocal('lmw.settings', settings);
      render();
    });
  }

  const noteBox = card.querySelector('.card__note');
  const textarea = noteBox.querySelector('.note__input');
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

  const postBtn = noteBox.querySelector('[data-action="post"]');
  if (postBtn) {
    postBtn.addEventListener('click', async () => {
      const nameInput = noteBox.querySelector('.comment__name');
      if (nameInput) {
        settings.name = nameInput.value.trim();
        if (!settings.name) {
          noteBox.querySelector('.comment__msg').textContent = '名前を入れてください';
          return;
        }
        saveLocal('lmw.settings', settings);
      }
      const input = noteBox.querySelector('.comment__input');
      if (!input.value.trim()) return;
      postBtn.disabled = true;
      try {
        await sendComment('POST', { link: it.link, author: settings.name, text: input.value });
        render();
      } catch (err) {
        noteBox.querySelector('.comment__msg').textContent = err.message;
        postBtn.disabled = false;
      }
    });
  }
  noteBox.querySelectorAll('[data-comment-id]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (!confirm('このコメントを削除しますか？')) return;
      try {
        await sendComment('DELETE', { link: it.link, id: btn.dataset.commentId });
        render();
      } catch (err) {
        alert(err.message);
      }
    });
  });

  return card;
}

async function sendComment(method, body) {
  const res = await fetch('/api/comments', {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || '保存に失敗しました');
  if (data.comments.length > 0) commentsByLink[body.link] = data.comments;
  else delete commentsByLink[body.link];
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

document.getElementById('newsCsvBtn').addEventListener('click', () => {
  downloadCsv(`ニュース_${today()}.csv`,
    ['日付', '区分', '媒体', '見出し', 'タグ', 'HubSpot', '案件の種類', 'URL'],
    shownItems.map((it) => [
      fullDate(it.publishedAt),
      CATEGORY_LABEL[it.category] || it.category,
      it.source,
      it.title,
      it.tags.join(' / '),
      (it.hubspotMatches || []).map((m) => `${m.name}(${hubspotLabel(m)})`).join(' / '),
      it.project ? it.project.kind : '',
      it.link,
    ]));
});

// ---------------------------------------------------------------------------
// お客様の動き(HubSpot の会社ごと)
// ---------------------------------------------------------------------------
const accountStageEl = document.getElementById('accountStage');
const accountOwnerEl = document.getElementById('accountOwner');
const accountSortEl = document.getElementById('accountSort');
const accountSearchEl = document.getElementById('accountSearch');

function renderAccounts() {
  const terms = parseSearchTerms(accountSearchEl.value);
  const stage = accountStageEl.value;
  const owner = accountOwnerEl.value;
  const weekAgo = Date.now() - WEEK_MS;

  const companies = hubspotCompanies(businessItems())
    .filter((c) => matchesHubspotFilter([c], stage))
    .filter((c) => !owner || c.ownerName === owner)
    .filter((c) => terms.every((t) => lower(c.name).includes(t)))
    .map((c) => ({
      ...c,
      recent: c.items.filter((it) => Date.parse(it.publishedAt) >= weekAgo).length,
      chances: c.items.filter((it) => it.project),
    }));
  if (accountSortEl.value === 'count') companies.sort((a, b) => b.items.length - a.items.length);
  else companies.sort((a, b) => Date.parse(b.items[0].publishedAt) - Date.parse(a.items[0].publishedAt));

  document.getElementById('accountEmpty').hidden = companies.length > 0;
  document.getElementById('accountGrid').innerHTML = companies
    .map((c) => `<div class="competitor${c.chances.length ? ' has-chance' : ''}">
      <div class="competitor__head">
        <h3>${escapeHtml(c.name)}</h3>
        <span class="competitor__total">90日 <strong>${c.items.length}</strong>件${c.recent ? ` ・ 今週 ${c.recent}件` : ''}</span>
      </div>
      <div class="hs-badge-row">
        <span class="hs-badge ${c.hasDeal ? 'hs-badge--deal' : 'hs-badge--lead'}">${escapeHtml(hubspotLabel(c))}</span>
        ${c.ownerName ? `<span class="hs-badge hs-badge--none">担当: ${escapeHtml(c.ownerName)}</span>` : ''}
        ${c.chances.length ? `<span class="chance-label">商談チャンス ${c.chances.length}件</span>` : ''}
      </div>
      <ul class="competitor__latest">${c.items.slice(0, 4).map((it) => `<li><span class="muted">${shortDate(it.publishedAt)}</span> ${it.project ? `<span class="project-label">${escapeHtml(it.project.kind)}</span> ` : ''}${articleLink(it)}</li>`).join('')}</ul>
    </div>`)
    .join('');
}

[accountStageEl, accountOwnerEl, accountSortEl].forEach((el) => el.addEventListener('change', renderAccounts));
accountSearchEl.addEventListener('input', renderAccounts);

// ---------------------------------------------------------------------------
// 新規開拓候補(案件記事の会社のうち HubSpot に無いもの)
// ---------------------------------------------------------------------------
const prospectKindEl = document.getElementById('prospectKind');
const prospectSearchEl = document.getElementById('prospectSearch');
let shownProspects = [];

function prospectGroups() {
  const byCompany = new Map();
  for (const it of businessItems()) {
    if (!it.project || !it.project.company || (it.hubspotMatches || []).length > 0) continue;
    const key = it.project.company;
    if (!byCompany.has(key)) byCompany.set(key, []);
    byCompany.get(key).push(it);
  }
  return [...byCompany].map(([company, items]) => {
    const uniq = (f) => [...new Set(items.map(f).filter(Boolean))];
    return {
      company,
      items,
      kinds: uniq((it) => it.project.kind),
      locations: uniq((it) => it.project.location),
      purposes: uniq((it) => it.project.purpose),
    };
  });
}

function renderProspects() {
  const kind = prospectKindEl.value;
  const terms = parseSearchTerms(prospectSearchEl.value);
  shownProspects = prospectGroups().filter((g) => {
    if (kind && !g.kinds.includes(kind)) return false;
    const haystack = lower(`${g.company} ${g.locations.join(' ')} ${g.purposes.join(' ')} ${g.items.map((it) => it.title).join(' ')}`);
    return terms.every((t) => haystack.includes(t));
  });
  const cell = (v) => (v ? escapeHtml(v) : '<span class="muted">—</span>');
  document.getElementById('prospectRows').innerHTML = shownProspects
    .map((g) => `<tr>
      <td><strong>${escapeHtml(g.company)}</strong></td>
      <td class="nowrap">${g.items.length}</td>
      <td class="nowrap">${shortDate(g.items[0].publishedAt)}</td>
      <td>${g.kinds.map((k) => `<span class="project-label">${escapeHtml(k)}</span>`).join(' ')}</td>
      <td>${cell(g.locations.join('、'))}</td>
      <td>${cell(g.purposes.join('、'))}</td>
      <td>${articleLink(g.items[0])} <span class="muted">(${escapeHtml(g.items[0].source || '')})</span></td>
    </tr>`)
    .join('');
  document.getElementById('prospectEmpty').hidden = shownProspects.length > 0;
}

prospectKindEl.addEventListener('change', renderProspects);
prospectSearchEl.addEventListener('input', renderProspects);
document.getElementById('prospectCsvBtn').addEventListener('click', () => {
  downloadCsv(`新規開拓候補_${today()}.csv`,
    ['会社名', '記事数', '最新の日付', '種類', '場所', '用途', '最新の記事', 'URL'],
    shownProspects.map((g) => [
      g.company, g.items.length, fullDate(g.items[0].publishedAt), g.kinds.join(' / '),
      g.locations.join(' / '), g.purposes.join(' / '), g.items[0].title, g.items[0].link,
    ]));
});

// ---------------------------------------------------------------------------
// 新設・増設案件
// ---------------------------------------------------------------------------
const projectKindEl = document.getElementById('projectKind');
const projectSearchEl = document.getElementById('projectSearch');
const projectChanceEl = document.getElementById('projectChanceOnly');
const projectByCompanyEl = document.getElementById('projectByCompany');
let shownProjects = [];

function hubspotShort(it) {
  const m = (it.hubspotMatches || [])[0];
  if (!m) return '<span class="muted">未登録</span>';
  return `<span class="hs-badge ${m.hasDeal ? 'hs-badge--deal' : 'hs-badge--lead'}">${escapeHtml(m.stageLabel || (m.hasDeal ? '取引あり' : 'リード'))}</span>`;
}

function filterProjects() {
  const kind = projectKindEl.value;
  const terms = parseSearchTerms(projectSearchEl.value);
  return businessItems().filter((it) => {
    if (!it.project) return false;
    if (kind && it.project.kind !== kind) return false;
    if (projectChanceEl.checked && !isChance(it)) return false;
    if (terms.length > 0) {
      const p = it.project;
      const haystack = `${it.title} ${p.company || ''} ${p.location || ''} ${p.purpose || ''}`.toLowerCase();
      if (!terms.every((t) => haystack.includes(t))) return false;
    }
    return true;
  });
}

function renderProjects() {
  shownProjects = filterProjects();
  const byCompany = projectByCompanyEl.checked;
  document.getElementById('projectTableWrap').hidden = byCompany;
  document.getElementById('projectTimeline').hidden = !byCompany;
  document.getElementById('projectEmpty').hidden = shownProjects.length > 0;
  if (byCompany) renderProjectTimeline(shownProjects);
  else renderProjectTable(shownProjects);
}

function renderProjectTable(rows) {
  const cell = (v) => (v ? escapeHtml(v) : '<span class="muted">—</span>');
  document.getElementById('projectRows').innerHTML = rows
    .map((it) => {
      const p = it.project;
      return `<tr${isChance(it) ? ' class="is-chance"' : ''}>
        <td class="nowrap">${shortDate(it.publishedAt)}</td>
        <td><span class="project-label">${escapeHtml(p.kind)}</span></td>
        <td>${cell(p.company)}</td>
        <td>${cell(p.location)}</td>
        <td>${cell(p.purpose)}</td>
        <td>${cell(p.timing)}</td>
        <td class="nowrap">${hubspotShort(it)}</td>
        <td>${articleLink(it)} <span class="muted">(${escapeHtml(it.source || '')})</span></td>
      </tr>`;
    })
    .join('');
}

const UNKNOWN_COMPANY = '(会社名を読み取れなかった案件)';

// 同じ会社の着工 → 竣工 → 稼働 などを古い順に並べる。2件以上ある会社を先に、会社名の分からない案件は最後に出す

function renderProjectTimeline(rows) {
  const byCompany = new Map();
  for (const it of rows) {
    const key = it.project.company || UNKNOWN_COMPANY;
    if (!byCompany.has(key)) byCompany.set(key, []);
    byCompany.get(key).push(it);
  }
  const groups = [...byCompany]
    .sort((a, b) => (a[0] === UNKNOWN_COMPANY) - (b[0] === UNKNOWN_COMPANY)
      || (b[1].length > 1) - (a[1].length > 1)
      || Date.parse(b[1][0].publishedAt) - Date.parse(a[1][0].publishedAt));
  document.getElementById('projectTimeline').innerHTML = groups
    .map(([company, items]) => `<div class="timeline__company">
      <h3>${escapeHtml(company)} <span class="muted">${items.length}件</span> ${hubspotShort(items[0])}</h3>
      <ol class="timeline__list">${[...items].reverse().map((it) => `<li>
        <span class="timeline__date">${fullDate(it.publishedAt)}</span>
        <span class="project-label">${escapeHtml(it.project.kind)}</span>
        ${it.project.location ? `<span class="muted">${escapeHtml(it.project.location)}</span>` : ''}
        ${articleLink(it)}
      </li>`).join('')}</ol>
    </div>`)
    .join('');
}

projectKindEl.addEventListener('change', renderProjects);
projectSearchEl.addEventListener('input', renderProjects);
projectChanceEl.addEventListener('change', renderProjects);
projectByCompanyEl.addEventListener('change', renderProjects);
document.getElementById('projectCsvBtn').addEventListener('click', () => {
  downloadCsv(`新設増設案件_${today()}.csv`,
    ['日付', '種類', '会社', '場所', '用途', '時期', 'HubSpot', '商談チャンス', '見出し', '媒体', 'URL'],
    shownProjects.map((it) => {
      const p = it.project;
      return [
        fullDate(it.publishedAt), p.kind, p.company, p.location, p.purpose, p.timing,
        (it.hubspotMatches || []).map((m) => `${m.name}(${hubspotLabel(m)})`).join(' / ') || '未登録',
        isChance(it) ? '○' : '', it.title, it.source, it.link,
      ];
    }));
});

// ---------------------------------------------------------------------------
// 案件地図(都道府県ごと)
// ---------------------------------------------------------------------------
const PREF_POS = {
  北海道: [43.06, 141.35], 青森: [40.82, 140.74], 岩手: [39.7, 141.15], 宮城: [38.27, 140.87], 秋田: [39.72, 140.1],
  山形: [38.24, 140.36], 福島: [37.75, 140.47], 茨城: [36.34, 140.45], 栃木: [36.57, 139.88], 群馬: [36.39, 139.06],
  埼玉: [35.86, 139.65], 千葉: [35.61, 140.12], 東京: [35.69, 139.69], 神奈川: [35.45, 139.64], 新潟: [37.9, 139.02],
  富山: [36.7, 137.21], 石川: [36.59, 136.63], 福井: [36.07, 136.22], 山梨: [35.66, 138.57], 長野: [36.65, 138.18],
  岐阜: [35.39, 136.72], 静岡: [34.98, 138.38], 愛知: [35.18, 136.91], 三重: [34.73, 136.51], 滋賀: [35.0, 135.87],
  京都: [35.02, 135.76], 大阪: [34.69, 135.52], 兵庫: [34.69, 135.18], 奈良: [34.69, 135.83], 和歌山: [34.23, 135.17],
  鳥取: [35.5, 134.24], 島根: [35.47, 133.05], 岡山: [34.66, 133.93], 広島: [34.4, 132.46], 山口: [34.19, 131.47],
  徳島: [34.07, 134.56], 香川: [34.34, 134.04], 愛媛: [33.84, 132.77], 高知: [33.56, 133.53], 福岡: [33.61, 130.42],
  佐賀: [33.25, 130.3], 長崎: [32.74, 129.87], 熊本: [32.79, 130.74], 大分: [33.24, 131.61], 宮崎: [31.91, 131.42],
  鹿児島: [31.56, 130.56], 沖縄: [26.21, 127.68],
};

// 県名が付いていない見出しのため、物流施設・工場の多い市を県に当てる
const CITY_PREF = {
  札幌: '北海道', 苫小牧: '北海道', 仙台: '宮城', さいたま: '埼玉', 川越: '埼玉', 狭山: '埼玉', 入間: '埼玉', 久喜: '埼玉',
  加須: '埼玉', 春日部: '埼玉', 三郷: '埼玉', 八潮: '埼玉', 草加: '埼玉', 越谷: '埼玉', 戸田: '埼玉', 川口: '埼玉',
  所沢: '埼玉', 熊谷: '埼玉', 市川: '千葉', 船橋: '千葉', 習志野: '千葉', 柏: '千葉', 野田: '千葉', 流山: '千葉',
  印西: '千葉', 成田: '千葉', 市原: '千葉', 木更津: '千葉', 松戸: '千葉', つくば: '茨城', 古河: '茨城', 坂東: '茨城',
  日立: '茨城', 土浦: '茨城', 宇都宮: '栃木', 小山: '栃木', 太田: '群馬', 伊勢崎: '群馬', 高崎: '群馬', 前橋: '群馬',
  横浜: '神奈川', 川崎: '神奈川', 相模原: '神奈川', 厚木: '神奈川', 海老名: '神奈川', 座間: '神奈川', 綾瀬: '神奈川',
  平塚: '神奈川', 藤沢: '神奈川', 八王子: '東京', 町田: '東京', 府中: '東京', 江東: '東京', 大田: '東京', 品川: '東京',
  江戸川: '東京', 板橋: '東京', 足立: '東京', 昭島: '東京', 長岡: '新潟', 金沢: '石川', 甲府: '山梨', 松本: '長野',
  大垣: '岐阜', 各務原: '岐阜', 可児: '岐阜', 浜松: '静岡', 富士: '静岡', 沼津: '静岡', 磐田: '静岡', 掛川: '静岡',
  袋井: '静岡', 湖西: '静岡', 名古屋: '愛知', 小牧: '愛知', 春日井: '愛知', 豊田: '愛知', 岡崎: '愛知', 一宮: '愛知',
  安城: '愛知', 刈谷: '愛知', 豊橋: '愛知', 四日市: '三重', 鈴鹿: '三重', 津: '三重', 草津: '滋賀', 大津: '滋賀',
  堺: '大阪', 茨木: '大阪', 枚方: '大阪', 東大阪: '大阪', 摂津: '大阪', 神戸: '兵庫', 尼崎: '兵庫', 姫路: '兵庫',
  西宮: '兵庫', 加古川: '兵庫', 倉敷: '岡山', 福山: '広島', 下関: '山口', 周南: '山口', 高松: '香川', 松山: '愛媛',
  北九州: '福岡', 久留米: '福岡', 鳥栖: '佐賀', 菊陽: '熊本', 那覇: '沖縄',
};

const OVERSEAS = ['タイ', 'ベトナム', 'インドネシア', 'マレーシア', 'フィリピン', 'シンガポール', 'インド', '中国', '台湾', '韓国',
  '米国', 'アメリカ', 'メキシコ', 'ドイツ', 'ポーランド', '英国', '欧州', 'ブラジル', 'Thailand'];

function placeOf(location) {
  if (!location) return null;
  if (OVERSEAS.includes(location)) return { overseas: location === 'Thailand' ? 'タイ' : location === 'アメリカ' ? '米国' : location };
  const pref = Object.keys(PREF_POS).find((p) => location.startsWith(p));
  if (pref) return { pref };
  const city = Object.keys(CITY_PREF)
    .sort((a, b) => b.length - a.length)
    .find((c) => location.startsWith(c) && /^[市区町村]?$/.test(location.slice(c.length, c.length + 1)));
  return city ? { pref: CITY_PREF[city] } : null;
}

let leafletPromise = null;
let leafletMap = null;
let mapLayer = null;

function loadLeaflet() {
  if (window.L) return Promise.resolve();
  if (!leafletPromise) {
    leafletPromise = new Promise((resolve, reject) => {
      const css = document.createElement('link');
      css.rel = 'stylesheet';
      css.href = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css';
      document.head.appendChild(css);
      const script = document.createElement('script');
      script.src = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js';
      script.onload = resolve;
      script.onerror = () => {
        leafletPromise = null;
        reject(new Error('地図の部品を読み込めませんでした'));
      };
      document.head.appendChild(script);
    });
  }
  return leafletPromise;
}

function mapItemList(items) {
  return `<ul class="map-list">${items.map((it) => `<li><span class="muted">${shortDate(it.publishedAt)}</span> <span class="project-label">${escapeHtml(it.project.kind)}</span> ${articleLink(it)}</li>`).join('')}</ul>`;
}

async function renderMap() {
  const kind = document.getElementById('mapKind').value;
  const since = Date.now() - Number(document.getElementById('mapPeriod').value) * DAY_MS;
  const rows = businessItems().filter((it) => it.project && (!kind || it.project.kind === kind) && Date.parse(it.publishedAt) >= since);

  const byPref = new Map();
  const overseas = new Map();
  const unplaced = [];
  for (const it of rows) {
    const place = placeOf(it.project.location);
    if (place && place.pref) {
      if (!byPref.has(place.pref)) byPref.set(place.pref, []);
      byPref.get(place.pref).push(it);
    } else if (place && place.overseas) {
      if (!overseas.has(place.overseas)) overseas.set(place.overseas, []);
      overseas.get(place.overseas).push(it);
    } else {
      unplaced.push(it);
    }
  }

  document.getElementById('mapOverseas').innerHTML = overseas.size
    ? `<h3 class="section-title">海外の案件</h3>${[...overseas].sort((a, b) => b[1].length - a[1].length).map(([country, items]) => `<details class="map-group"><summary>${escapeHtml(country)} <strong>${items.length}</strong>件</summary>${mapItemList(items)}</details>`).join('')}`
    : '';
  document.getElementById('mapUnplaced').innerHTML = unplaced.length
    ? `<details class="map-group"><summary>地図に置けなかった案件 <strong>${unplaced.length}</strong>件(場所が空欄、または市の名前だけ)</summary>${mapItemList(unplaced)}</details>`
    : '';

  const canvas = document.getElementById('mapCanvas');
  try {
    await loadLeaflet();
  } catch (err) {
    canvas.innerHTML = `<p class="preview__msg">${escapeHtml(err.message)}</p>`;
    return;
  }
  if (!leafletMap) {
    leafletMap = L.map(canvas, { scrollWheelZoom: false, zoomSnap: 0.25 });
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 12,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }).addTo(leafletMap);
    mapLayer = L.layerGroup().addTo(leafletMap);
    leafletMap.on('zoomstart dragstart', () => { leafletMap.userMoved = true; });
  }
  leafletMap.invalidateSize();
  // 九州から北海道までが入るように合わせる(沖縄の案件は縮小すると見える)
  if (!leafletMap.userMoved) leafletMap.fitBounds([[31, 129.5], [45.5, 145.5]]);
  mapLayer.clearLayers();
  for (const [pref, items] of byPref) {
    L.circleMarker(PREF_POS[pref], {
      radius: 6 + Math.sqrt(items.length) * 5,
      color: '#1B1D1F',
      weight: 1.5,
      fillColor: '#E3A400',
      fillOpacity: 0.75,
    })
      .bindTooltip(`${pref} ${items.length}件`)
      .bindPopup(`<strong>${escapeHtml(pref)}</strong> ${items.length}件${mapItemList(items)}`, { maxWidth: 360, maxHeight: 300 })
      .addTo(mapLayer);
  }
}

document.getElementById('mapKind').addEventListener('change', renderMap);
document.getElementById('mapPeriod').addEventListener('change', renderMap);

// ---------------------------------------------------------------------------
// 週ごとの棒グラフ(競合・トレンドで共通)
// ---------------------------------------------------------------------------
const WEEKS = 12;

function weekStart(date) {
  // 月曜はじまりの週(日本時間)
  const jst = new Date(date.getTime() + 9 * 60 * 60 * 1000);
  const day = (jst.getUTCDay() + 6) % 7;
  jst.setUTCHours(0, 0, 0, 0);
  return jst.getTime() - day * DAY_MS - 9 * 60 * 60 * 1000;
}

function recentWeekStarts() {
  const thisWeek = weekStart(new Date());
  return Array.from({ length: WEEKS }, (_, i) => thisWeek - (WEEKS - 1 - i) * WEEK_MS);
}

function weeklyCounts(items, weekStarts) {
  return weekStarts.map((ws) => items.filter((it) => {
    const t = Date.parse(it.publishedAt);
    return t >= ws && t < ws + WEEK_MS;
  }).length);
}

function roundedTopBar(x, y, w, h, r) {
  return `M${x},${y + h} V${y + r} Q${x},${y} ${x + r},${y} H${x + w - r} Q${x + w},${y} ${x + w},${y + r} V${y + h} Z`;
}

function sparkBlock({ name, counts, weekStarts, max, latest }) {
  const W = 264;
  const H = 72;
  const gap = 2;
  const barW = (W - gap * (WEEKS - 1)) / WEEKS;
  const total = counts.reduce((a, b) => a + b, 0);
  const bars = counts
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
  const latestHtml = latest
    .map((it) => `<li><span class="muted">${shortDate(it.publishedAt)}</span> ${articleLink(it)}</li>`)
    .join('');
  return `<div class="competitor">
    <div class="competitor__head">
      <h3>${escapeHtml(name)}</h3>
      <span class="competitor__total">直近${WEEKS}週 <strong>${total}</strong>件</span>
    </div>
    <svg class="spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="${escapeHtml(name)}の週ごとの記事数: ${counts.join('、')}">
      <line class="spark__base" x1="0" y1="${H - 0.5}" x2="${W}" y2="${H - 0.5}" />
      ${bars}
    </svg>
    <div class="spark__axis"><span>${shortDate(new Date(weekStarts[0]).toISOString())}</span><span>今週</span></div>
    <ul class="competitor__latest">${latestHtml || '<li class="muted">記事はまだありません</li>'}</ul>
  </div>`;
}

function attachBarTooltip(container) {
  container.addEventListener('mousemove', (e) => {
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
  container.addEventListener('mouseleave', () => {
    tooltipEl.hidden = true;
  });
}

// ---------------------------------------------------------------------------
// 競合の動き(週ごとの記事数)
// ---------------------------------------------------------------------------
function renderCompetitors() {
  const weekStarts = recentWeekStarts();
  const items = liveItems();
  const stats = COMPETITORS.map((name) => {
    const own = items.filter((it) => it.tags.includes(name));
    return { name, items: own, counts: weeklyCounts(own, weekStarts) };
  });
  const max = Math.max(1, ...stats.flatMap((s) => s.counts));
  document.getElementById('competitorGrid').innerHTML = stats
    .map((s) => sparkBlock({ name: s.name, counts: s.counts, weekStarts, max, latest: s.items.slice(0, 3) }))
    .join('');
}

attachBarTooltip(document.getElementById('competitorGrid'));

// ---------------------------------------------------------------------------
// トレンド(タグごとの推移と急上昇ワード)
// ---------------------------------------------------------------------------
const trendCategoryEl = document.getElementById('trendCategory');

function trendItems() {
  const c = trendCategoryEl.value;
  return liveItems().filter((it) => (c === 'noai' ? it.category !== 'ai' : it.category === c));
}

const TOKEN_RE = /[ァ-ヶ][ァ-ヶー]{2,}|[A-Za-z][A-Za-z0-9&+.\-]{1,}|[一-龠々]{2,8}/g;
const STOP_WORDS = new Set([
  '物流', '製造業', '発表', '開始', '導入', '提供', '開発', '販売', '日本', '企業', '会社', '事業', '実証', '締結', '新設',
  '稼働', '決定', '予定', '実施', '本格', '展開', '拡大', '強化', '推進', '年度', '今年', '来年', '株式会社', '工場', '倉庫',
  '記事', '活用', '連携', '向上', '対応', '取得', '全国', '国内', '世界', '最大', '新た', '初', '公開', '受賞', '設立',
  '参加', '出展', '登場', '解説', '紹介', '方針', '計画', '発売', '検討', '加速', '可能', '目指', '構築', '見込', '業界',
  '支援', '検証', '下落', '上昇', '竣工', '完成', '稼働開始', '億円', '億円投資', '万円',
  'センター', 'サービス', 'システム', 'ニュース', 'ソリューション', 'プロジェクト', 'グループ', 'ジャパン',
]);

function tokensOf(title) {
  const tokens = (title.match(TOKEN_RE) || []).filter((t) => !STOP_WORDS.has(t) && !/^\d+$/.test(t));
  return new Set(tokens);
}

function risingWords(items) {
  const now = Date.now();
  const recentFrom = now - WEEK_MS;
  const baseFrom = now - 5 * WEEK_MS;
  const stats = new Map();
  for (const it of items) {
    const t = Date.parse(it.publishedAt);
    if (t < baseFrom) continue;
    const recent = t >= recentFrom;
    for (const token of tokensOf(it.title)) {
      if (!stats.has(token)) stats.set(token, { recent: 0, base: 0, example: null });
      const s = stats.get(token);
      if (recent) {
        s.recent++;
        if (!s.example) s.example = it;
      } else {
        s.base++;
      }
    }
  }
  return [...stats]
    .map(([word, s]) => ({ word, ...s, baseAvg: s.base / 4, ratio: s.recent / (s.base / 4 + 1) }))
    .filter((s) => s.recent >= 4 && s.ratio >= 2)
    .sort((a, b) => b.ratio - a.ratio || b.recent - a.recent)
    .slice(0, 20);
}

function renderTrends() {
  const items = trendItems();
  const weekStarts = recentWeekStarts();
  const competitorSet = new Set(COMPETITORS);
  const tags = [...new Set(items.flatMap((it) => it.tags))].filter((t) => !competitorSet.has(t));
  const stats = tags
    .map((tag) => {
      const own = items.filter((it) => it.tags.includes(tag));
      const counts = weeklyCounts(own, weekStarts);
      return { name: tag, items: own, counts, last4: counts.slice(-4).reduce((a, b) => a + b, 0) };
    })
    .sort((a, b) => b.last4 - a.last4);
  document.getElementById('trendGrid').innerHTML = stats
    .map((s) => sparkBlock({ name: s.name, counts: s.counts, weekStarts, max: Math.max(1, ...s.counts), latest: s.items.slice(0, 2) }))
    .join('');

  const rising = risingWords(items);
  document.getElementById('risingEmpty').hidden = rising.length > 0;
  // 記事をためはじめて間もないうちは、比べる元(前の4週)の記事が少なく「新しく登場」が多めに出る
  const now = Date.now();
  const recentCount = items.filter((it) => Date.parse(it.publishedAt) >= now - WEEK_MS).length;
  const baseCount = items.filter((it) => {
    const t = Date.parse(it.publishedAt);
    return t >= now - 5 * WEEK_MS && t < now - WEEK_MS;
  }).length;
  document.getElementById('risingNote').hidden = baseCount / 4 >= recentCount / 2;
  document.getElementById('risingRows').innerHTML = rising
    .map((r) => `<tr>
      <td><button type="button" class="link-btn" data-search="${escapeHtml(r.word)}">${escapeHtml(r.word)}</button></td>
      <td class="nowrap">${r.recent}件</td>
      <td class="nowrap">${r.baseAvg.toFixed(1)}件</td>
      <td class="nowrap">${r.base === 0 ? '新しく登場' : `${(r.recent / r.baseAvg).toFixed(1)}倍`}</td>
      <td>${articleLink(r.example)}</td>
    </tr>`)
    .join('');
}

trendCategoryEl.addEventListener('change', renderTrends);
attachBarTooltip(document.getElementById('trendGrid'));
document.getElementById('risingRows').addEventListener('click', (e) => {
  const btn = e.target.closest('[data-search]');
  if (!btn) return;
  searchQuery = btn.dataset.search;
  searchInput.value = searchQuery;
  const c = trendCategoryEl.value;
  activeCategory = c === 'noai' ? 'all' : c;
  [...tabsEl.children].forEach((t) => t.classList.toggle('is-active', t.dataset.filter === activeCategory));
  location.hash = '#news';
});

// ---------------------------------------------------------------------------
// 週報
// ---------------------------------------------------------------------------
const weeklyRangeEl = document.getElementById('weeklyRange');
let weeklyText = '';

function weeklyRange() {
  const thisWeek = weekStart(new Date());
  switch (weeklyRangeEl.value) {
    case 'last': return { from: thisWeek - WEEK_MS, to: thisWeek };
    case 'prev': return { from: thisWeek - 2 * WEEK_MS, to: thisWeek - WEEK_MS };
    default: return { from: Date.now() - WEEK_MS, to: Date.now() };
  }
}

function inRange(items, from, to) {
  return items.filter((it) => {
    const t = Date.parse(it.publishedAt);
    return t >= from && t < to;
  });
}

function renderWeekly() {
  const { from, to } = weeklyRange();
  const all = liveItems();
  const week = inRange(all, from, to);
  const prevWeek = inRange(all, from - WEEK_MS, from);
  const nonAi = week.filter((it) => it.category !== 'ai');
  const label = `${fullDate(new Date(from).toISOString())} 〜 ${fullDate(new Date(to - 1).toISOString())}`;

  const byCategory = Object.keys(CATEGORY_LABEL).map((c) => [CATEGORY_LABEL[c], week.filter((it) => it.category === c).length]);
  const big = [...nonAi].filter((it) => (it.related || []).length > 0)
    .sort((a, b) => b.related.length - a.related.length).slice(0, 10);
  const chances = nonAi.filter(isChance);
  const accounts = hubspotCompanies(nonAi).sort((a, b) => b.items.length - a.items.length).slice(0, 10);
  const projects = nonAi.filter((it) => it.project);
  const competitors = COMPETITORS.map((name) => ({
    name,
    now: week.filter((it) => it.tags.includes(name)),
    before: prevWeek.filter((it) => it.tags.includes(name)).length,
  }));
  const subsidies = week.filter((it) => it.category === 'subsidy').slice(0, 5);
  const ai = week.filter((it) => it.category === 'ai' && (it.related || []).length > 0)
    .sort((a, b) => b.related.length - a.related.length).slice(0, 5);

  const list = (items, extra = () => '') => (items.length
    ? `<ul class="weekly__list">${items.map((it) => `<li><span class="muted">${shortDate(it.publishedAt)}</span> ${extra(it)}${articleLink(it)} <span class="muted">(${escapeHtml(it.source || '')})</span></li>`).join('')}</ul>`
    : '<p class="muted">該当なし</p>');

  document.getElementById('weeklyBody').innerHTML = `
    <h3 class="weekly__title">LOGI/MONO WATCH 週報 <span class="muted">${label}</span></h3>
    <section class="weekly__section">
      <h4>記事の数</h4>
      <p>${byCategory.map(([l, n]) => `${l} <strong>${n}</strong>件`).join(' ・ ')}(前の週は合計 ${prevWeek.length}件、今週は合計 ${week.length}件)</p>
    </section>
    <section class="weekly__section">
      <h4>商談チャンス(HubSpot の会社 × 新設・増設)</h4>
      ${list(chances, (it) => `<span class="project-label">${escapeHtml(it.project.kind)}</span> `)}
    </section>
    <section class="weekly__section">
      <h4>HubSpot の会社が出た記事(多い順)</h4>
      ${accounts.length ? `<ul class="weekly__list">${accounts.map((c) => `<li><strong>${escapeHtml(c.name)}</strong> ${c.items.length}件 <span class="muted">${escapeHtml(hubspotLabel(c))}${c.ownerName ? ` ・ 担当 ${escapeHtml(c.ownerName)}` : ''}</span> — ${articleLink(c.items[0])}</li>`).join('')}</ul>` : '<p class="muted">該当なし</p>'}
    </section>
    <section class="weekly__section">
      <h4>大きく報じられたニュース(報じた媒体の多い順)</h4>
      ${list(big, (it) => `<span class="project-label">${it.related.length + 1}媒体</span> `)}
    </section>
    <section class="weekly__section">
      <h4>新設・増設案件 ${projects.length}件</h4>
      ${list(projects, (it) => `<span class="project-label">${escapeHtml(it.project.kind)}</span> `)}
    </section>
    <section class="weekly__section">
      <h4>競合7社(前の週との比較)</h4>
      <ul class="weekly__list">${competitors.map((c) => `<li><strong>${escapeHtml(c.name)}</strong> ${c.now.length}件 <span class="muted">(前の週 ${c.before}件)</span>${c.now[0] ? ` — ${articleLink(c.now[0])}` : ''}</li>`).join('')}</ul>
    </section>
    <section class="weekly__section">
      <h4>補助金・公募</h4>
      ${list(subsidies)}
    </section>
    <section class="weekly__section">
      <h4>AI の大きなニュース</h4>
      ${list(ai, (it) => `<span class="project-label">${it.related.length + 1}媒体</span> `)}
    </section>`;

  const lines = (items, fmt) => (items.length ? items.map(fmt) : ['・該当なし']);
  const plain = (it) => `・${shortDate(it.publishedAt)} ${it.title}(${it.source || ''})\n  ${it.link}`;
  weeklyText = [
    `■ LOGI/MONO WATCH 週報 ${label}`,
    '',
    `【記事の数】${byCategory.map(([l, n]) => `${l} ${n}件`).join(' / ')}(合計 ${week.length}件、前の週 ${prevWeek.length}件)`,
    '',
    '【商談チャンス(HubSpot の会社 × 新設・増設)】',
    ...lines(chances, (it) => `・${shortDate(it.publishedAt)} [${it.project.kind}] ${it.title}\n  ${it.link}`),
    '',
    '【HubSpot の会社が出た記事】',
    ...lines(accounts, (c) => `・${c.name} ${c.items.length}件(${hubspotLabel(c)}${c.ownerName ? ` / 担当 ${c.ownerName}` : ''})`),
    '',
    '【大きく報じられたニュース】',
    ...lines(big, (it) => `・${it.related.length + 1}媒体 ${it.title}\n  ${it.link}`),
    '',
    `【新設・増設案件 ${projects.length}件】`,
    ...lines(projects, (it) => `・${shortDate(it.publishedAt)} [${it.project.kind}] ${it.title}\n  ${it.link}`),
    '',
    '【競合7社】',
    ...competitors.map((c) => `・${c.name} ${c.now.length}件(前の週 ${c.before}件)`),
    '',
    '【補助金・公募】',
    ...lines(subsidies, plain),
    '',
    '【AI の大きなニュース】',
    ...lines(ai, plain),
  ].join('\n');
}

weeklyRangeEl.addEventListener('change', renderWeekly);
document.getElementById('weeklyPrintBtn').addEventListener('click', () => window.print());
document.getElementById('weeklyCopyBtn').addEventListener('click', async () => {
  const msg = document.getElementById('weeklyCopyMsg');
  try {
    await navigator.clipboard.writeText(weeklyText);
    msg.textContent = 'コピーしました';
  } catch {
    msg.textContent = 'コピーできませんでした';
  }
  setTimeout(() => { msg.textContent = ''; }, 3000);
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

// 案件・お客様などのページで記事を開いたときも既読にする
document.addEventListener('click', (e) => {
  const a = e.target.closest('.page a[data-preview], .leaflet-popup a[data-preview]');
  if (a) markRead(a.dataset.preview);
});

// ---------------------------------------------------------------------------
// 設定(ウォッチワード・ミュート・名前)
// ---------------------------------------------------------------------------
const settingsDialog = document.getElementById('settingsDialog');
const splitLines = (text) => [...new Set(text.split(/\r?\n/).map((s) => s.trim()).filter(Boolean))];

function openSettings(showHelp = false) {
  document.getElementById('settingName').value = settings.name;
  document.getElementById('settingWatch').value = settings.watch.join('\n');
  document.getElementById('settingMuteWords').value = settings.muteWords.join('\n');
  document.getElementById('settingMuteSources').value = settings.muteSources.join('\n');
  document.getElementById('keyHelp').open = showHelp;
  settingsDialog.showModal();
}

document.getElementById('settingsBtn').addEventListener('click', () => openSettings());
settingsDialog.addEventListener('close', () => {
  if (settingsDialog.returnValue !== 'save') return;
  settings.name = document.getElementById('settingName').value.trim();
  settings.watch = splitLines(document.getElementById('settingWatch').value);
  settings.muteWords = splitLines(document.getElementById('settingMuteWords').value);
  settings.muteSources = splitLines(document.getElementById('settingMuteSources').value);
  saveLocal('lmw.settings', settings);
  showView();
});

// ---------------------------------------------------------------------------
// キーボード操作(ニュース画面)
// ---------------------------------------------------------------------------
function applyFocus(scroll) {
  const cards = listEl.querySelectorAll('.card');
  cards.forEach((c, i) => c.classList.toggle('is-focused', i === focusIndex));
  if (scroll && cards[focusIndex]) cards[focusIndex].scrollIntoView({ block: 'center', behavior: 'smooth' });
}

document.addEventListener('keydown', (e) => {
  if (e.ctrlKey || e.metaKey || e.altKey || e.isComposing) return;
  if (e.target instanceof Element && e.target.closest('input, textarea, select, dialog')) return;
  if (e.key === '?') {
    openSettings(true);
    return;
  }
  if (currentView() !== 'news') return;
  // ボタンやリンクの上での Enter は、そのボタン・リンクの操作にまかせる
  if (e.key === 'Enter' && e.target instanceof Element && e.target.closest('button, a')) return;
  const cards = listEl.querySelectorAll('.card');
  const it = shownItems[focusIndex];
  switch (e.key.toLowerCase()) {
    case 'j':
      focusIndex = Math.min(focusIndex + 1, cards.length - 1);
      applyFocus(true);
      break;
    case 'k':
      focusIndex = Math.max(focusIndex - 1, 0);
      applyFocus(true);
      break;
    case 'enter':
    case 'o':
      if (!it) return;
      window.open(it.link, '_blank', 'noopener');
      markRead(it.link);
      cards[focusIndex].classList.add('is-read');
      break;
    case 'f':
      if (!it) return;
      toggleFavorite(it);
      render();
      break;
    case 'c':
      if (!it) return;
      cards[focusIndex].querySelector('[data-action="note"]').click();
      e.preventDefault();
      break;
    case '/':
      e.preventDefault();
      searchInput.focus();
      break;
    default:
  }
});

// ---------------------------------------------------------------------------
// 画面の切り替え
// ---------------------------------------------------------------------------
const VIEWS = {
  news: { el: document.getElementById('newsView'), render },
  accounts: { el: document.getElementById('accountsView'), render: renderAccounts },
  prospects: { el: document.getElementById('prospectsView'), render: renderProspects },
  projects: { el: document.getElementById('projectsView'), render: renderProjects },
  map: { el: document.getElementById('mapView'), render: renderMap },
  competitors: { el: document.getElementById('competitorsView'), render: renderCompetitors },
  trends: { el: document.getElementById('trendsView'), render: renderTrends },
  weekly: { el: document.getElementById('weeklyView'), render: renderWeekly },
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
  focusIndex = -1;
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

newOnlyEl.addEventListener('change', () => {
  newOnly = newOnlyEl.checked;
  render();
});

hubspotFilterEl.addEventListener('change', () => {
  hubspotFilter = hubspotFilterEl.value;
  render();
});

ownerFilterEl.addEventListener('change', () => {
  ownerFilter = ownerFilterEl.value;
  render();
});

async function loadComments() {
  try {
    const res = await fetch('/api/comments');
    const data = await res.json();
    commentsEnabled = Boolean(data.enabled);
    commentsByLink = data.comments || {};
  } catch {
    commentsEnabled = false;
  }
}

async function loadNews(force = false) {
  refreshBtn.classList.add('is-loading');
  statusBar.textContent = '読み込み中...';
  try {
    const [res] = await Promise.all([
      fetch(`/api/news?days=${LOAD_DAYS}${force ? '&refresh=1' : ''}`),
      loadComments(),
    ]);
    const data = await res.json();
    allItems = data.items || [];
    tagOrder = data.tagOrder || [];
    const errCount = (data.errors || []).length;
    const fetchedAt = new Date(data.fetchedAt).toLocaleTimeString('ja-JP', { hour12: false });
    const unread = allItems.filter((it) => !readMarks[it.link] && Date.now() - new Date(it.publishedAt).getTime() < DAY_MS).length;
    const fresh = liveItems().filter((it) => isNew(it) && it.category !== 'ai').length;
    statusBar.textContent = `記事 ${allItems.length}件(直近${LOAD_DAYS}日) ・ 前回から NEW ${fresh}件(AI除く) ・ 今日の未読 ${unread}件 ・ 最終取得 ${fetchedAt}${errCount ? ` ・ ${errCount}件のフィードで取得エラー` : ''}`;
    fillHubspotSelect(hubspotFilterEl, 'HubSpot: 指定なし', { withChance: true });
    fillOwnerSelect(ownerFilterEl);
    fillHubspotSelect(accountStageEl, 'すべての段階', { withChance: false });
    fillOwnerSelect(accountOwnerEl);
    hubspotFilter = hubspotFilterEl.value;
    ownerFilter = ownerFilterEl.value;
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

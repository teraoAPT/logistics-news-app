// ディスク(Render の /var/data)への保存。
// 記事は link をキーにためていき、再起動しても消えないようにする。
const fs = require('fs');
const path = require('path');

function resolveDataDir() {
  if (process.env.DATA_DIR) return process.env.DATA_DIR;
  if (fs.existsSync('/var/data')) return '/var/data';
  return path.join(__dirname, '..', 'data');
}

const DATA_DIR = resolveDataDir();
fs.mkdirSync(DATA_DIR, { recursive: true });

const ARTICLES_FILE = path.join(DATA_DIR, 'articles.json');
const HUBSPOT_FILE = path.join(DATA_DIR, 'hubspot.json');

// 公開日がこれより古い記事は保存しない(ファイルが際限なく大きくならないように)
const KEEP_MS = 2 * 365 * 24 * 60 * 60 * 1000;

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    if (err.code !== 'ENOENT') console.error(`[保存] ${file} の読み込みに失敗:`, err.message);
    return fallback;
  }
}

// 書き込み途中で落ちても壊れないよう、一時ファイルに書いてから置き換える
function writeJson(file, data) {
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data));
  fs.renameSync(tmp, file);
}

const articles = new Map(Object.entries(readJson(ARTICLES_FILE, { articles: {} }).articles || {}));
console.log(`[保存] 保存先 ${DATA_DIR} / 保存済み記事 ${articles.size}件`);

function articleKey(item) {
  return item.link || item.title;
}

function mergeArticles(items) {
  const now = new Date().toISOString();
  const cutoff = Date.now() - KEEP_MS;
  let added = 0;
  for (const it of items) {
    const key = articleKey(it);
    if (!key || Date.parse(it.publishedAt) < cutoff) continue;
    const prev = articles.get(key);
    if (prev) {
      articles.set(key, { ...it, firstSeenAt: prev.firstSeenAt });
    } else {
      articles.set(key, { ...it, firstSeenAt: now });
      added++;
    }
  }
  for (const [key, a] of articles) {
    if (Date.parse(a.publishedAt) < cutoff) articles.delete(key);
  }
  writeJson(ARTICLES_FILE, { version: 1, savedAt: now, articles: Object.fromEntries(articles) });
  return added;
}

function listArticles() {
  return [...articles.values()];
}

function hasArticle(link) {
  return articles.has(link);
}

// プレビュー(紹介文と写真)は一度取ったら覚えておく。書き込みは少しまとめて行う
const PREVIEWS_FILE = path.join(DATA_DIR, 'previews.json');
const previews = new Map(Object.entries(readJson(PREVIEWS_FILE, {})));
let previewSaveTimer = null;

function getPreview(link) {
  return previews.get(link);
}

function setPreview(link, preview) {
  previews.set(link, preview);
  if (previewSaveTimer) return;
  previewSaveTimer = setTimeout(() => {
    previewSaveTimer = null;
    for (const key of previews.keys()) {
      if (!articles.has(key)) previews.delete(key);
    }
    writeJson(PREVIEWS_FILE, Object.fromEntries(previews));
  }, 10 * 1000);
}

function loadHubspot() {
  return readJson(HUBSPOT_FILE, null);
}

function saveHubspot(data) {
  writeJson(HUBSPOT_FILE, data);
}

module.exports = {
  DATA_DIR, mergeArticles, listArticles, hasArticle, getPreview, setPreview, loadHubspot, saveHubspot,
};

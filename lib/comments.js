// チームのコメント。記事の link ごとに、名前・本文・時刻を残す
const crypto = require('crypto');
const path = require('path');
const { DATA_DIR, readJson, writeJson } = require('./store');

const COMMENTS_FILE = path.join(DATA_DIR, 'comments.json');
const MAX_PER_ARTICLE = 50;

const byLink = new Map(Object.entries(readJson(COMMENTS_FILE, {})));

function save() {
  writeJson(COMMENTS_FILE, Object.fromEntries(byLink));
}

function listAll() {
  return Object.fromEntries(byLink);
}

function add(link, author, text) {
  const list = byLink.get(link) || [];
  list.push({ id: crypto.randomUUID(), author, text, at: new Date().toISOString() });
  byLink.set(link, list.slice(-MAX_PER_ARTICLE));
  save();
  return byLink.get(link);
}

function remove(link, id) {
  const list = (byLink.get(link) || []).filter((c) => c.id !== id);
  if (list.length > 0) byLink.set(link, list);
  else byLink.delete(link);
  save();
  return list;
}

module.exports = { listAll, add, remove };

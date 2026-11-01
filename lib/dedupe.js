// 同じ出来事を別の媒体が報じた記事を1つにまとめる。
// タイトルの文字の並び(2文字ずつ)がどれだけ重なるかで似ているかを判定する。
const { toHalfWidth } = require('./text');

const WINDOW_MS = 3 * 24 * 60 * 60 * 1000;
const THRESHOLD = 0.5;

function normalizeForCompare(title) {
  return toHalfWidth(title)
    .replace(/【[^】]*】|\[[^\]]*\]|＜[^＞]*＞|<[^>]*>/g, '')
    .replace(/[\s　]/g, '')
    .replace(/[「」『』()（）\-—―!?！？,、。・:：;；'"“”‘’…〜~|｜]/g, '')
    .toLowerCase();
}

function bigrams(str) {
  const set = new Set();
  for (let i = 0; i < str.length - 1; i++) set.add(str.slice(i, i + 2));
  return set;
}

function similarity(a, b) {
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  for (const g of a) if (b.has(g)) shared++;
  return (2 * shared) / (a.size + b.size);
}

function isSameStory(norm, grams, member) {
  if (norm.slice(0, 24) === member.norm.slice(0, 24)) return true;
  return similarity(grams, member.grams) >= THRESHOLD;
}

function pickRepresentative(members) {
  // 無料で読める記事を優先し、その中で最初に出た記事を代表にする
  return [...members].sort((a, b) =>
    Number(a.item.isPaid) - Number(b.item.isPaid) || a.time - b.time
  )[0];
}

function groupSimilar(items) {
  const sorted = items
    .map((item) => {
      const norm = normalizeForCompare(item.title);
      return { item, norm, grams: bigrams(norm), time: Date.parse(item.publishedAt) || 0 };
    })
    .sort((a, b) => b.time - a.time);

  // groups は新しい順に並ぶ。末尾ほど今見ている記事の日時に近い
  const groups = [];
  for (const entry of sorted) {
    let target = null;
    for (let i = groups.length - 1; i >= 0; i--) {
      const g = groups[i];
      if (g.newest - entry.time > WINDOW_MS) break;
      if (g.members.some((m) => isSameStory(entry.norm, entry.grams, m))) {
        target = g;
        break;
      }
    }
    if (target) target.members.push(entry);
    else groups.push({ newest: entry.time, members: [entry] });
  }

  return groups.map((g) => {
    const rep = pickRepresentative(g.members);
    const others = g.members.filter((m) => m !== rep).map((m) => m.item);
    if (others.length === 0) return rep.item;

    const tags = [...new Set(g.members.flatMap((m) => m.item.tags || []))];
    const hubspotByName = new Map();
    for (const m of g.members) {
      for (const h of m.item.hubspotMatches || []) {
        if (!hubspotByName.has(h.name)) hubspotByName.set(h.name, h);
      }
    }
    return {
      ...rep.item,
      tags,
      hubspotMatches: [...hubspotByName.values()],
      related: others.map(({ title, link, source, isPaid, publishedAt }) => ({ title, link, source, isPaid, publishedAt })),
    };
  });
}

module.exports = { groupSimilar };

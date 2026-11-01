const express = require('express');
const Parser = require('rss-parser');
const path = require('path');
const store = require('./lib/store');
const { toHalfWidth } = require('./lib/text');
const { groupSimilar } = require('./lib/dedupe');
const { detectProject } = require('./lib/projects');
const { fetchPreview } = require('./lib/preview');

const app = express();
const parser = new Parser({
  timeout: 8000,
  headers: { 'User-Agent': 'Mozilla/5.0 (compatible; NewsAggregator/1.0)' },
});

const PORT = process.env.PORT || 3000;
const HUBSPOT_TOKEN = process.env.HUBSPOT_TOKEN;

// /api/news の返答を期間ごとに覚えておく。記事や HubSpot が更新されたら消す
const responseCache = new Map();

function googleNewsFeed(query) {
  return `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=ja&gl=JP&ceid=JP:ja`;
}

const NOISE_EXCLUDE = '-コンテスト -体験教室 -出前授業 -高校生 -部活動 -キャリア教育 -ワークショップ';

const FEEDS = [
  { url: googleNewsFeed('物流 OR ロジスティクス'), category: 'logistics', label: 'Googleニュース: 物流全般' },
  { url: googleNewsFeed('サプライチェーン'), category: 'logistics', label: 'Googleニュース: サプライチェーン' },
  { url: googleNewsFeed('倉庫 自動化 OR 自動倉庫'), category: 'logistics', label: 'Googleニュース: 自動倉庫' },
  { url: googleNewsFeed('物流 2024年問題 OR 物流 2025年問題 OR 物流 人手不足'), category: 'logistics', label: 'Googleニュース: 物流人手不足' },

  { url: googleNewsFeed(`(工場 OR 製造業) (物流 OR 搬送 OR マテハン OR 構内物流) ${NOISE_EXCLUDE}`), category: 'manufacturing', label: 'Googleニュース: 製造業×物流' },
  { url: googleNewsFeed(`(工場 OR 製造業) (設備投資 OR ファクトリーオートメーション OR FA化 OR 増産投資 OR 生産ライン新設) ${NOISE_EXCLUDE}`), category: 'manufacturing', label: 'Googleニュース: FA/設備投資' },
  { url: googleNewsFeed(`製造業 (M&A OR 買収 OR 資本業務提携 OR 経営統合) ${NOISE_EXCLUDE}`), category: 'manufacturing', label: 'Googleニュース: 製造業M&A' },
  { url: googleNewsFeed(`製造業 (決算 OR 増収増益 OR 上方修正 OR 業績予想) ${NOISE_EXCLUDE}`), category: 'manufacturing', label: 'Googleニュース: 製造業業績' },
  { url: 'https://rss.itmedia.co.jp/rss/2.0/monoist.xml', category: 'manufacturing', label: 'MONOist(ものづくり専門メディア)' },

  { url: googleNewsFeed('AMR OR AGV OR AGF 導入 工場'), category: 'topic', label: 'Googleニュース: AMR/AGV/AGF' },
  { url: googleNewsFeed('WMS OR WCS OR WES 倉庫管理システム'), category: 'topic', label: 'Googleニュース: WMS/WCS/WES' },
  { url: googleNewsFeed('物流 業務提携'), category: 'topic', label: 'Googleニュース: 業務提携' },

  { url: googleNewsFeed('ダイフク'), category: 'topic', label: 'Googleニュース: ダイフク' },
  { url: googleNewsFeed('村田機械'), category: 'topic', label: 'Googleニュース: 村田機械' },
  { url: googleNewsFeed('IHI 物流 OR IHI 搬送'), category: 'topic', label: 'Googleニュース: IHI' },
  { url: googleNewsFeed('西部電機 物流'), category: 'topic', label: 'Googleニュース: 西部電機' },
  { url: googleNewsFeed('トヨタL&F OR トヨタL＆F'), category: 'topic', label: 'Googleニュース: トヨタL&F' },
  { url: googleNewsFeed('豊田自動織機'), category: 'topic', label: 'Googleニュース: 豊田自動織機' },
  { url: googleNewsFeed('住友重機械工業 物流 OR 住友重機械工業 搬送'), category: 'topic', label: 'Googleニュース: 住友重機械工業' },

  // 半導体(業界を問わず)
  { url: googleNewsFeed(`半導体 (工場 OR 投資 OR 増産 OR 供給 OR 装置) ${NOISE_EXCLUDE}`), category: 'manufacturing', label: 'Googleニュース: 半導体' },
  { url: googleNewsFeed('TSMC OR ラピダス OR Rapidus OR 半導体メーカー'), category: 'manufacturing', label: 'Googleニュース: 半導体メーカー' },

  // AI(物流・製造業に限らず、AI全般の動き)
  { url: googleNewsFeed('生成AI'), category: 'ai', label: 'Googleニュース: 生成AI' },
  { url: googleNewsFeed('ChatGPT OR OpenAI'), category: 'ai', label: 'Googleニュース: ChatGPT/OpenAI' },
  { url: googleNewsFeed('Claude OR Anthropic'), category: 'ai', label: 'Googleニュース: Claude/Anthropic' },
  { url: googleNewsFeed('Gemini AI OR Google Gemini OR Google DeepMind'), category: 'ai', label: 'Googleニュース: Gemini/Google' },
  { url: googleNewsFeed('Copilot OR Meta AI OR Grok OR xAI OR Llama'), category: 'ai', label: 'Googleニュース: Microsoft/Meta/xAI' },
  { url: googleNewsFeed('AIエージェント OR 大規模言語モデル OR LLM'), category: 'ai', label: 'Googleニュース: AIエージェント/LLM' },
  { url: googleNewsFeed('人工知能 OR AI規制 OR AI投資 OR AIデータセンター'), category: 'ai', label: 'Googleニュース: AI全般' },

  // タイ市場(APTのタイ拠点拡大に伴う情報収集)
  { url: googleNewsFeed('タイ 物流 OR タイ ロジスティクス'), category: 'thailand', label: 'Googleニュース: タイ物流' },
  { url: googleNewsFeed('タイ 進出 OR タイ 工場 OR タイ 生産拠点'), category: 'thailand', label: 'Googleニュース: タイ進出' },
  { url: googleNewsFeed('タイ サプライチェーン OR タイ 製造業'), category: 'thailand', label: 'Googleニュース: タイ製造業' },
  { url: googleNewsFeed('Thailand logistics OR Thailand manufacturing investment'), category: 'thailand', label: 'Googleニュース: Thailand(英語)' },
];

const TAG_ORDER = [
  'AI',
  '半導体',
  '人手不足/2024年問題',
  '自動倉庫',
  'DX/スマート工場',
  '業務提携',
  '業績',
  'M&A/経営',
  'FA/設備投資',
  'AMR/AGV/AGF',
  'WMS/WCS/WES',
  'ダイフク',
  '村田機械',
  'IHI',
  'トヨタL&F',
  '豊田自動織機',
  '西部電機',
  '住友重機械工業',
];

// words は含まれていれば一致。re は英字の前後に別の英字が続く一致(「MAIL」の中の「AI」など)を避けたいときに使う
const TOPIC_TAGS = [
  { tag: 'AI', re: /(?<![A-Za-z])(?:AI|Ai|LLM|ChatGPT|OpenAI|Claude|Anthropic|Gemini|Copilot|DeepMind|DeepSeek|Grok|xAI|Perplexity|Mistral)(?![A-Za-z])|人工知能|大規模言語モデル|アントロピック|オープンAI|ディープシーク|エージェンティック/ },
  { tag: '半導体', re: /半導体|(?<![A-Za-z])(?:TSMC|Rapidus|DRAM|NAND|HBM|NVIDIA|Nvidia|ASML)(?![A-Za-z])|ラピダス|エヌビディア|ウエハー|ウェハー|ファウンドリ/ },
  { tag: '自動倉庫', words: ['自動倉庫', 'スタッカークレーン', '自動化倉庫'] },
  { tag: 'AMR/AGV/AGF', words: ['AMR', 'AGV', 'AGF', '自律走行搬送', '無人搬送'] },
  { tag: 'WMS/WCS/WES', words: ['WMS', 'WCS', 'WES', '倉庫管理システム'] },
  { tag: 'FA/設備投資', words: ['設備投資', 'ファクトリーオートメーション', 'FA化', '生産ライン新設', '増産投資'] },
  { tag: '業績', words: ['決算', '増収増益', '上方修正', '業績予想'] },
  { tag: '人手不足/2024年問題', words: ['人手不足', '2024年問題', '2025年問題', 'ドライバー不足'] },
  { tag: 'DX/スマート工場', words: ['DX', 'スマートファクトリー', 'IoT', 'デジタル化'] },
  { tag: 'M&A/経営', words: ['M&A', '買収', '資本提携', '経営統合'] },
  { tag: '業務提携', words: ['業務提携', '提携'] },
  { tag: 'ダイフク', words: ['ダイフク'] },
  { tag: '村田機械', words: ['村田機械'] },
  { tag: 'IHI', words: ['IHI'] },
  { tag: '西部電機', words: ['西部電機'] },
  { tag: 'トヨタL&F', words: ['トヨタL&F', 'トヨタL＆F', 'トヨタエルアンドエフ'] },
  { tag: '豊田自動織機', words: ['豊田自動織機'] },
  { tag: '住友重機械工業', words: ['住友重機械工業'] },
];

const PAID_SOURCE_PATTERNS = [
  /日経/, /nikkei/i,
  /東洋経済/,
  /ダイヤモンド.?オンライン/,
];

function detectPaid(source, link) {
  const text = `${source || ''} ${link || ''}`;
  return PAID_SOURCE_PATTERNS.some((re) => re.test(text));
}

function inferTags(title, summary) {
  const text = toHalfWidth(`${title} ${summary || ''}`);
  const tags = TOPIC_TAGS
    .filter((t) => (t.re ? t.re.test(text) : t.words.some((w) => text.includes(w))))
    .map((t) => t.tag);
  return [...new Set(tags)];
}

function normalizeDate(item) {
  const d = item.isoDate || item.pubDate;
  const parsed = d ? new Date(d) : null;
  return parsed && !isNaN(parsed) ? parsed : new Date(0);
}

// Googleニュースのタイトルは「見出し - 媒体名」の形。媒体名に「-」を含むもの(LOGI-BIZ online など)もある
function cleanSource(item, feedLabel) {
  const raw = item.title || '';
  const m = /\s-\s((?:(?!\s-\s).){1,40})$/.exec(raw);
  const source = m ? m[1].trim() : (item.source?.title || feedLabel);
  const title = m ? raw.slice(0, m.index).trim() : raw;
  return { title, source };
}

// ---------------------------------------------------------------------------
// HubSpot連携
// ---------------------------------------------------------------------------
function normalizeCompanyName(name) {
  return toHalfWidth(name || '')
    .replace(/株式会社|㈱|\(株\)|（株）/g, '')
    .replace(/[\s]/g, '')
    .toLowerCase();
}

const FALSE_POSITIVE_SUFFIXES = ['展', '展示会', '協会', '組合', '連盟', 'センター', '見本市', 'フェア'];

// 社名が普通の言葉と同じで、記事の中の言葉に一致してしまうもの
const GENERIC_NAMES = new Set([
  'デジタル', 'ライト', 'プラス', 'フロンティア', 'ネクスト', 'ポート', 'ジャパン', 'グローバル', 'システム',
  'サービス', 'ソリューション', 'テクノロジー', 'ロジスティクス', 'エンジニアリング', 'コンサルティング',
  'ホールディングス', 'トラスト', 'リンク', 'パートナーズ', 'クリエイト', 'ワークス', 'スマート',
]);

function escapeRegExp(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// 社名の端が英数字やカタカナなら、その前後に同じ種類の文字が続く一致は数えない
// (「ポート」が「サポート」に、「NEC」が「NECK」に一致しないように)
// 漢字2文字の社名(関通・東芝・山九など)は、前後に漢字が続かないときだけ数える
// ただし普通の言葉と同じものは使わない
const GENERIC_KANJI2 = new Set([
  '共同', '技研', '日本', '東洋', '中央', '総合', '物流', '産業', '工業', '電機', '電気', '化学', '興産', '商事',
  '建設', '運輸', '倉庫', '製作', '開発', '未来', '大和', '新生', '協和', '共栄', '第一', '三和',
]);

function edgeClass(ch, kanjiName) {
  if (/[a-z0-9]/.test(ch)) return '[a-z0-9]';
  if (/[ァ-ヶー]/.test(ch)) return '[ァ-ヶー]';
  if (kanjiName) return '[一-龥々ヶ]';
  return null;
}

function buildCompanyMatcher(displayName) {
  const core = toHalfWidth(displayName || '')
    .replace(/株式会社|㈱|\(株\)|（株）/g, '')
    .trim()
    .toLowerCase();
  const compact = core.replace(/\s/g, '');
  // 短すぎる名前(「NE」「セキ」など)・一般的な言葉・自治体は判定に使わない
  const kanjiName = /^[一-龥々ヶ]{2}$/.test(compact);
  if (compact.length < 3 && !kanjiName) return null;
  if (GENERIC_NAMES.has(compact) || GENERIC_KANJI2.has(compact)) return null;
  if (/(?:都|府|県|市|町|村)$/.test(compact)) return null;

  const body = core.split(/\s+/).map(escapeRegExp).join('\\s*');
  const before = edgeClass(compact[0], kanjiName);
  const after = edgeClass(compact[compact.length - 1], kanjiName);
  const re = new RegExp(`${before ? `(?<!${before})` : ''}${body}${after ? `(?!${after})` : ''}`, 'g');
  return { compact, re };
}

function matchCompanyInText(text, compactText, matcher) {
  // まず空白を除いた文字列で大まかに探し、見つかったときだけ詳しく調べる
  if (!compactText.includes(matcher.compact)) return false;
  matcher.re.lastIndex = 0;
  let m;
  while ((m = matcher.re.exec(text)) !== null) {
    const tail = text.slice(m.index + m[0].length, m.index + m[0].length + 4);
    if (!FALSE_POSITIVE_SUFFIXES.some((suf) => tail.startsWith(suf))) return true;
  }
  return false;
}

function withMatchers(companies) {
  return companies
    .map((c) => ({ ...c, matcher: buildCompanyMatcher(c.name) }))
    .filter((c) => c.matcher);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchWithRetry(url, options, retries = 5) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    const res = await fetch(url, options);
    if (res.status !== 429) return res;
    const waitMs = 1000 * Math.pow(2, attempt);
    console.log(`[HubSpot] 429受信, ${waitMs}ms待って再試行 (${attempt + 1}/${retries})`);
    await sleep(waitMs);
  }
  return fetch(url, options);
}

let hubspotCache = { companies: [], dealCompanySet: new Set(), ownerNameByCompany: new Map(), fetchedAt: 0, ready: false };
const HUBSPOT_REFRESH_MS = 60 * 60 * 1000;

// 前回保存した HubSpot のデータがあれば、起動直後から印を出せるように読み込む
const savedHubspot = store.loadHubspot();
if (savedHubspot) {
  hubspotCache = {
    companies: withMatchers(savedHubspot.companies || []),
    dealCompanySet: new Set(savedHubspot.dealCompanies || []),
    ownerNameByCompany: new Map(savedHubspot.ownerNameByCompany || []),
    fetchedAt: savedHubspot.fetchedAt || 0,
    ready: true,
    error: null,
  };
  console.log(`[HubSpot] 保存データを読み込み: 会社${hubspotCache.companies.length}件`);
}
let hubspotRefreshing = false;

async function fetchHubspotListAll(objectType, properties) {
  const results = [];
  let after = undefined;
  let page = 0;
  while (true) {
    const url = new URL(`https://api.hubapi.com/crm/v3/objects/${objectType}`);
    url.searchParams.set('limit', '100');
    url.searchParams.set('properties', properties.join(','));
    if (after) url.searchParams.set('after', after);

    const res = await fetchWithRetry(url, {
      headers: { Authorization: `Bearer ${HUBSPOT_TOKEN}` },
    });
    if (!res.ok) throw new Error(`HubSpot ${objectType} fetch failed: ${res.status} (page ${page})`);
    const data = await res.json();
    results.push(...(data.results || []));
    after = data.paging?.next?.after;
    page++;
    if (!after) break;
    if (results.length > 100000) break;
    await sleep(150);
  }
  return results;
}

async function fetchOwnersMap() {
  const ownerMap = new Map();
  try {
    let after = undefined;
    while (true) {
      const url = new URL('https://api.hubapi.com/crm/v3/owners/');
      url.searchParams.set('limit', '100');
      if (after) url.searchParams.set('after', after);
      const res = await fetchWithRetry(url, { headers: { Authorization: `Bearer ${HUBSPOT_TOKEN}` } });
      if (!res.ok) break;
      const data = await res.json();
      for (const o of data.results || []) {
        const name = `${o.firstName || ''} ${o.lastName || ''}`.trim() || o.email || '';
        if (name) ownerMap.set(String(o.id), name);
      }
      after = data.paging?.next?.after;
      if (!after) break;
      await sleep(150);
    }
  } catch (err) {
    console.error('[HubSpot] オーナー取得失敗(担当者表示なしで継続):', err.message || err);
  }
  return ownerMap;
}

async function refreshHubspotCache() {
  if (hubspotRefreshing) return;
  hubspotRefreshing = true;
  try {
    if (!HUBSPOT_TOKEN) {
      hubspotCache = { ...hubspotCache, error: 'HUBSPOT_TOKEN未設定', ready: true, fetchedAt: Date.now() };
      return;
    }
    const [companiesRaw, dealsRaw, ownersMap] = await Promise.all([
      fetchHubspotListAll('companies', ['name', 'hubspot_owner_id']),
      fetchHubspotListAll('deals', ['dealname']),
      fetchOwnersMap(),
    ]);

    const dealCompanySet = new Set();
    for (let i = 0; i < dealsRaw.length; i += 100) {
      const batch = dealsRaw.slice(i, i + 100);
      const res = await fetchWithRetry('https://api.hubapi.com/crm/v3/associations/deals/companies/batch/read', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${HUBSPOT_TOKEN}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ inputs: batch.map((d) => ({ id: d.id })) }),
      });
      await sleep(150);
      if (!res.ok) continue;
      const assocData = await res.json();
      const companyIds = new Set();
      for (const r of assocData.results || []) {
        for (const to of r.to || []) companyIds.add(to.id);
      }
      for (const c of companiesRaw) {
        if (companyIds.has(c.id)) {
          const norm = normalizeCompanyName(c.properties?.name);
          if (norm) dealCompanySet.add(norm);
        }
      }
    }

    const seen = new Map();
    const ownerNameByCompany = new Map();
    for (const c of companiesRaw) {
      const displayName = (c.properties?.name || '').trim();
      const norm = normalizeCompanyName(displayName);
      if (!norm || norm.length < 2) continue;
      if (!seen.has(norm)) seen.set(norm, displayName);

      const ownerId = c.properties?.hubspot_owner_id;
      if (ownerId && ownersMap.has(String(ownerId)) && !ownerNameByCompany.has(norm)) {
        ownerNameByCompany.set(norm, ownersMap.get(String(ownerId)));
      }
    }
    const companies = [...seen.entries()].map(([normalized, name]) => ({ normalized, name }));

    hubspotCache = {
      companies: withMatchers(companies),
      dealCompanySet,
      ownerNameByCompany,
      fetchedAt: Date.now(),
      totalRaw: companiesRaw.length,
      ready: true,
      error: null,
    };
    store.saveHubspot({
      companies,
      dealCompanies: [...dealCompanySet],
      ownerNameByCompany: [...ownerNameByCompany],
      fetchedAt: hubspotCache.fetchedAt,
    });
    responseCache.clear();
    console.log(`[HubSpot] 更新完了: 会社${companies.length}件 / 取引データのある会社${dealCompanySet.size}件`);
  } catch (err) {
    // 保存済みのデータがあればそのまま使い続ける
    hubspotCache = { ...hubspotCache, error: String(err.message || err), ready: true };
    console.error('[HubSpot] 更新失敗:', err.message || err);
  } finally {
    hubspotRefreshing = false;
  }
}

refreshHubspotCache();
setInterval(refreshHubspotCache, HUBSPOT_REFRESH_MS);

function checkHubspot(title) {
  const text = toHalfWidth(title || '').toLowerCase();
  const compactText = text.replace(/\s/g, '');
  const matches = [];
  for (const c of hubspotCache.companies) {
    if (matchCompanyInText(text, compactText, c.matcher)) {
      matches.push({
        name: c.name,
        hasDeal: hubspotCache.dealCompanySet.has(c.normalized),
        ownerName: hubspotCache.ownerNameByCompany.get(c.normalized) || null,
      });
    }
  }
  return matches;
}

// ---------------------------------------------------------------------------
// ニュースの取得と保存
// ---------------------------------------------------------------------------
const CACHE_MS = 5 * 60 * 1000;
// 誰も見ていなくても記事をためていくため、裏で定期的に取りに行く
const BACKGROUND_REFRESH_MS = 30 * 60 * 1000;
const DEFAULT_DAYS = 90;
const DAY_MS = 24 * 60 * 60 * 1000;

let lastFeedErrors = [];
let lastFetchedAt = 0;
let refreshing = null;

async function fetchAllFeeds() {
  const results = await Promise.allSettled(
    FEEDS.map(async (feed) => {
      const parsed = await parser.parseURL(feed.url);
      return (parsed.items || []).map((item) => {
        const { title, source } = cleanSource(item, feed.label);
        const summary = (item.contentSnippet || item.summary || '').slice(0, 400);
        return {
          title,
          link: item.link,
          source,
          isPaid: detectPaid(source, item.link),
          category: feed.category,
          publishedAt: normalizeDate(item).toISOString(),
          summary,
        };
      });
    })
  );

  const errors = [];
  const items = [];
  results.forEach((r, i) => {
    if (r.status === 'fulfilled') {
      items.push(...r.value);
    } else {
      errors.push({ feed: FEEDS[i].label, error: String(r.reason && r.reason.message || r.reason) });
    }
  });

  const seen = new Set();
  const deduped = items.filter((it) => {
    const key = it.link || it.title;
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return { items: deduped, errors };
}

function refreshNews() {
  if (refreshing) return refreshing;
  refreshing = (async () => {
    const { items, errors } = await fetchAllFeeds();
    const added = store.mergeArticles(items);
    lastFeedErrors = errors;
    lastFetchedAt = Date.now();
    responseCache.clear();
    console.log(`[ニュース] 取得${items.length}件 / 新規${added}件 / 保存済み${store.listArticles().length}件`);
  })()
    .catch((err) => console.error('[ニュース] 取得失敗:', err.message || err))
    .finally(() => { refreshing = null; });
  return refreshing;
}

refreshNews();
setInterval(refreshNews, BACKGROUND_REFRESH_MS);

// 期間の指定: ?days=7 / ?days=all / ?from=2026-10-01&to=2026-10-31(日本時間の日付)
function parseRange(query) {
  const datePattern = /^\d{4}-\d{2}-\d{2}$/;
  if (query.from || query.to) {
    if ((query.from && !datePattern.test(query.from)) || (query.to && !datePattern.test(query.to))) {
      return { error: 'from / to は YYYY-MM-DD の形で指定してください' };
    }
    return {
      from: query.from ? Date.parse(`${query.from}T00:00:00+09:00`) : 0,
      to: query.to ? Date.parse(`${query.to}T23:59:59.999+09:00`) : Infinity,
    };
  }
  if (query.days === 'all') return { from: 0, to: Infinity };
  const days = query.days === undefined ? DEFAULT_DAYS : Number(query.days);
  if (!Number.isFinite(days) || days <= 0) return { error: 'days は正の数か all で指定してください' };
  return { from: Date.now() - days * DAY_MS, to: Infinity };
}

function buildNewsResponse(range) {
  const inRange = store.listArticles().filter((a) => {
    const t = Date.parse(a.publishedAt);
    return t >= range.from && t <= range.to;
  });

  const enriched = inRange.map((a) => ({
    ...a,
    tags: inferTags(a.title, a.summary),
    hubspotMatches: checkHubspot(a.title),
  }));

  const items = groupSimilar(enriched)
    .map((it) => ({ ...it, project: detectProject(it) }))
    .sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));

  const errors = [...lastFeedErrors];
  if (!hubspotCache.ready) {
    errors.push({ feed: 'HubSpot連携', error: '初回データ読み込み中です(裏側で処理中、記事のHubSpot判定は次回反映されます)' });
  } else if (hubspotCache.error) {
    errors.push({ feed: 'HubSpot連携', error: hubspotCache.error });
  }

  return {
    items,
    tagOrder: TAG_ORDER,
    errors,
    fetchedAt: new Date(lastFetchedAt || Date.now()).toISOString(),
    range: {
      from: range.from > 0 ? new Date(range.from).toISOString() : null,
      to: Number.isFinite(range.to) ? new Date(range.to).toISOString() : null,
    },
  };
}

app.get('/api/news', async (req, res) => {
  try {
    const range = parseRange(req.query);
    if (range.error) return res.status(400).json({ error: range.error });

    const force = req.query.refresh === '1';
    const isStale = Date.now() - lastFetchedAt > CACHE_MS;
    // 保存済みの記事があれば待たせずに返し、取り直しは裏で行う
    if (force || store.listArticles().length === 0) await refreshNews();
    else if (isStale) refreshNews();

    // days 指定は時刻が毎回ずれるので、10分単位に丸めてキャッシュのキーにする
    const key = `${Math.floor(range.from / 600000)}-${range.to}`;
    if (!responseCache.has(key)) {
      if (responseCache.size >= 10) responseCache.delete(responseCache.keys().next().value);
      responseCache.set(key, buildNewsResponse(range));
    }
    res.json(responseCache.get(key));
  } catch (err) {
    res.status(500).json({ error: String(err.message || err) });
  }
});

// 記事のプレビュー。保存している記事のリンクだけを受け付ける(任意のアドレスを取りに行かないように)
const PREVIEW_RETRY_MS = 6 * 60 * 60 * 1000;
const previewInFlight = new Map();

app.get('/api/preview', async (req, res) => {
  const link = String(req.query.link || '');
  if (!store.hasArticle(link)) return res.status(404).json({ error: '記事が見つかりません' });

  const cached = store.getPreview(link);
  if (cached && (!cached.failed || Date.now() - cached.fetchedAt < PREVIEW_RETRY_MS)) {
    return res.json(cached);
  }

  if (!previewInFlight.has(link)) {
    previewInFlight.set(link, fetchPreview(link)
      .then((p) => ({ ...p, fetchedAt: Date.now() }))
      .catch((err) => {
        console.error('[プレビュー] 取得失敗:', err.message || err);
        return { failed: true, fetchedAt: Date.now() };
      })
      .then((p) => {
        store.setPreview(link, p);
        return p;
      })
      .finally(() => previewInFlight.delete(link)));
  }
  res.json(await previewInFlight.get(link));
});

app.use(express.static(path.join(__dirname, 'public')));

app.listen(PORT, () => {
  console.log(`Logistics News App listening on http://localhost:${PORT}`);
});

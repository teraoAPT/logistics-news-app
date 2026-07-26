const express = require('express');
const Parser = require('rss-parser');
const path = require('path');

const app = express();
const parser = new Parser({
  timeout: 8000,
  headers: { 'User-Agent': 'Mozilla/5.0 (compatible; NewsAggregator/1.0)' },
});

const PORT = process.env.PORT || 3000;
const HUBSPOT_TOKEN = process.env.HUBSPOT_TOKEN;

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
];

const TAG_ORDER = [
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

const TOPIC_TAGS = [
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
  const text = `${title} ${summary || ''}`;
  const tags = TOPIC_TAGS.filter((t) => t.words.some((w) => text.includes(w))).map((t) => t.tag);
  return [...new Set(tags)];
}

function normalizeDate(item) {
  const d = item.isoDate || item.pubDate;
  const parsed = d ? new Date(d) : null;
  return parsed && !isNaN(parsed) ? parsed : new Date(0);
}

function cleanSource(item, feedLabel) {
  const m = /\s-\s([^-]+)$/.exec(item.title || '');
  const source = m ? m[1].trim() : (item.source?.title || feedLabel);
  const title = m ? item.title.slice(0, item.title.length - m[0].length).trim() : item.title;
  return { title, source };
}

function normalizeTitleKey(title) {
  return (title || '')
    .replace(/[\s　]/g, '')
    .replace(/[【】「」『』()（）\-—―!?！？,、。・:：;；'"]/g, '')
    .toLowerCase()
    .slice(0, 24);
}

// ---------------------------------------------------------------------------
// HubSpot連携
// 「株式会社」「(株)」等を除去し、全角記号・英数字も半角に統一してから、
// 記事タイトルとの一致を確認します(要約は見ません。メディア名を誤検出するため)。
// 会社ごとに個別判定するため、1記事に複数社が出てくる場合も会社別にバッジを出します。
// 会社数が数千件規模のため、ページング上限は設けず全件取得します。
// データ更新は「裏側で自動的に」行い、ユーザーのアクセスを待たせません。
// ---------------------------------------------------------------------------
function toHalfWidth(str) {
  return (str || '')
    .replace(/[Ａ-Ｚａ-ｚ０-９]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xFEE0))
    .replace(/＆/g, '&')
    .replace(/－/g, '-')
    .replace(/　/g, ' ');
}

function normalizeCompanyName(name) {
  return toHalfWidth(name || '')
    .replace(/株式会社|㈱|\(株\)|（株）/g, '')
    .replace(/[\s]/g, '')
    .toLowerCase();
}

let hubspotCache = { companies: [], dealCompanySet: new Set(), fetchedAt: 0, ready: false };
const HUBSPOT_REFRESH_MS = 60 * 60 * 1000; // 1時間ごとに裏で自動更新
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

    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${HUBSPOT_TOKEN}` },
    });
    if (!res.ok) throw new Error(`HubSpot ${objectType} fetch failed: ${res.status} (page ${page})`);
    const data = await res.json();
    results.push(...(data.results || []));
    after = data.paging?.next?.after;
    page++;
    if (!after) break;
    if (results.length > 100000) break; // 安全弁
  }
  return results;
}

async function refreshHubspotCache() {
  if (hubspotRefreshing) return; // 二重実行防止
  hubspotRefreshing = true;
  try {
    if (!HUBSPOT_TOKEN) {
      hubspotCache = { ...hubspotCache, error: 'HUBSPOT_TOKEN未設定', ready: true, fetchedAt: Date.now() };
      return;
    }
    const [companiesRaw, dealsRaw] = await Promise.all([
      fetchHubspotListAll('companies', ['name']),
      fetchHubspotListAll('deals', ['dealname']),
    ]);

    const dealCompanySet = new Set();
    for (let i = 0; i < dealsRaw.length; i += 100) {
      const batch = dealsRaw.slice(i, i + 100);
      const res = await fetch('https://api.hubapi.com/crm/v3/associations/deals/companies/batch/read', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${HUBSPOT_TOKEN}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ inputs: batch.map((d) => ({ id: d.id })) }),
      });
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
    for (const c of companiesRaw) {
      const displayName = (c.properties?.name || '').trim();
      const norm = normalizeCompanyName(displayName);
      if (!norm || norm.length < 2) continue;
      if (!seen.has(norm)) seen.set(norm, displayName);
    }
    const companies = [...seen.entries()].map(([normalized, name]) => ({ normalized, name }));

    hubspotCache = {
      companies,
      dealCompanySet,
      fetchedAt: Date.now(),
      totalRaw: companiesRaw.length,
      ready: true,
      error: null,
    };
    console.log(`[HubSpot] 更新完了: 会社${companies.length}件 / 取引データのある会社${dealCompanySet.size}件`);
  } catch (err) {
    hubspotCache = { ...hubspotCache, error: String(err.message || err), fetchedAt: Date.now(), ready: true };
    console.error('[HubSpot] 更新失敗:', err.message || err);
  } finally {
    hubspotRefreshing = false;
  }
}

// サーバー起動時に1回実行し、以後は1時間ごとに裏で自動更新(リクエストを待たせない)
refreshHubspotCache();
setInterval(refreshHubspotCache, HUBSPOT_REFRESH_MS);

function checkHubspot(title) {
  const text = normalizeCompanyName(title);
  const matches = [];
  for (const c of hubspotCache.companies) {
    if (text.includes(c.normalized)) {
      matches.push({ name: c.name, hasDeal: hubspotCache.dealCompanySet.has(c.normalized) });
    }
  }
  return matches;
}

let cache = { data: null, fetchedAt: 0 };
const CACHE_MS = 5 * 60 * 1000;

async function fetchAllFeeds() {
  const results = await Promise.allSettled(
    FEEDS.map(async (feed) => {
      const parsed = await parser.parseURL(feed.url);
      return (parsed.items || []).map((item) => {
        const { title, source } = cleanSource(item, feed.label);
        const summary = (item.contentSnippet || item.summary || '').slice(0, 400);
        const hubspotMatches = checkHubspot(title);
        return {
          title,
          link: item.link,
          source,
          isPaid: detectPaid(source, item.link),
          category: feed.category,
          publishedAt: normalizeDate(item).toISOString(),
          summary,
          tags: inferTags(title, summary),
          hubspotMatches,
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

  const groups = new Map();
  for (const it of deduped) {
    const key = normalizeTitleKey(it.title);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(it);
  }
  const finalItems = [];
  for (const group of groups.values()) {
    if (group.length === 1) {
      finalItems.push(group[0]);
      continue;
    }
    group.sort((a, b) => Number(a.isPaid) - Number(b.isPaid));
    finalItems.push(group[0]);
  }

  finalItems.sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));

  if (!hubspotCache.ready) {
    errors.push({ feed: 'HubSpot連携', error: '初回データ読み込み中です(裏側で処理中、記事のHubSpot判定は次回反映されます)' });
  } else if (hubspotCache.error) {
    errors.push({ feed: 'HubSpot連携', error: hubspotCache.error });
  }

  return { items: finalItems, tagOrder: TAG_ORDER, errors, fetchedAt: new Date().toISOString() };
}

app.get('/api/news', async (req, res) => {
  try {
    const force = req.query.refresh === '1';
    const isStale = Date.now() - cache.fetchedAt > CACHE_MS;
    if (!cache.data || isStale || force) {
      cache.data = await fetchAllFeeds();
      cache.fetchedAt = Date.now();
    }
    res.json(cache.data);
  } catch (err) {
    res.status(500).json({ error: String(err.message || err) });
  }
});

app.use(express.static(path.join(__dirname, 'public')));

app.listen(PORT, () => {
  console.log(`Logistics News App listening on http://localhost:${PORT}`);
});

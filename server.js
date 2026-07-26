const express = require('express');
const Parser = require('rss-parser');
const path = require('path');

const app = express();
const parser = new Parser({
  timeout: 8000,
  headers: { 'User-Agent': 'Mozilla/5.0 (compatible; NewsAggregator/1.0)' },
});

const PORT = process.env.PORT || 3000;

// ---------------------------------------------------------------------------
// フィード設定
// 個別業界紙(LNEWS/物流ウィークリー等)は公開RSSが不安定なため、
// Googleニュースのキーワード検索RSS(常に安定して稼働)を主軸に、
// 確認済みの専門メディアRSSを組み合わせています。
// 新しいソースを足したい時は、この配列に { url, category, label } を追加するだけでOKです。
// ---------------------------------------------------------------------------

function googleNewsFeed(query) {
  return `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=ja&gl=JP&ceid=JP:ja`;
}

const FEEDS = [
  // 物流 - 広範
  { url: googleNewsFeed('物流 OR ロジスティクス'), category: 'logistics', label: 'Googleニュース: 物流全般' },
  { url: googleNewsFeed('サプライチェーン'), category: 'logistics', label: 'Googleニュース: サプライチェーン' },
  { url: googleNewsFeed('倉庫 自動化 OR 自動倉庫'), category: 'logistics', label: 'Googleニュース: 自動倉庫' },
  { url: googleNewsFeed('物流 2024年問題 OR 物流 2025年問題 OR 物流 人手不足'), category: 'logistics', label: 'Googleニュース: 物流人手不足' },

  // 製造業 - 広範
  { url: googleNewsFeed('製造業 OR ものづくり'), category: 'manufacturing', label: 'Googleニュース: 製造業全般' },
  { url: googleNewsFeed('スマートファクトリー OR DX 工場'), category: 'manufacturing', label: 'Googleニュース: スマートファクトリー' },
  { url: 'https://rss.itmedia.co.jp/rss/2.0/monoist.xml', category: 'manufacturing', label: 'MONOist(ものづくり専門メディア)' },

  // 寺尾さんの関心テーマ(WXS/AMR/AGV/WMS)に近いトピック
  { url: googleNewsFeed('AMR OR AGV 導入 工場'), category: 'topic', label: 'Googleニュース: AMR/AGV' },
  { url: googleNewsFeed('WMS OR WCS 倉庫管理システム'), category: 'topic', label: 'Googleニュース: WMS/WCS' },
];

const TOPIC_TAGS = [
  { tag: '自動倉庫', words: ['自動倉庫', 'スタッカークレーン', '自動化倉庫'] },
  { tag: 'AMR/AGV', words: ['AMR', 'AGV', '自律走行搬送', '無人搬送'] },
  { tag: 'WMS/WCS', words: ['WMS', 'WCS', 'WES', '倉庫管理システム'] },
  { tag: '人手不足/2024年問題', words: ['人手不足', '2024年問題', '2025年問題', 'ドライバー不足'] },
  { tag: 'DX/スマート工場', words: ['DX', 'スマートファクトリー', 'IoT', 'デジタル化'] },
  { tag: 'M&A/経営', words: ['M&A', '買収', '提携', '資本業務提携', '決算'] },
];

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
  // GoogleニュースRSSは title に " - 発行元名" が付くのでソース名を抽出
  const m = /\s-\s([^-]+)$/.exec(item.title || '');
  const source = m ? m[1].trim() : (item.source?.title || feedLabel);
  const title = m ? item.title.slice(0, item.title.length - m[0].length).trim() : item.title;
  return { title, source };
}

let cache = { data: null, fetchedAt: 0 };
const CACHE_MS = 5 * 60 * 1000; // 5分キャッシュ

async function fetchAllFeeds() {
  const results = await Promise.allSettled(
    FEEDS.map(async (feed) => {
      const parsed = await parser.parseURL(feed.url);
      return (parsed.items || []).map((item) => {
        const { title, source } = cleanSource(item, feed.label);
        const summary = (item.contentSnippet || item.summary || '').slice(0, 220);
        return {
          title,
          link: item.link,
          source,
          category: feed.category,
          publishedAt: normalizeDate(item).toISOString(),
          summary,
          tags: inferTags(title, summary),
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

  // 重複除去 (リンク基準)
  const seen = new Set();
  const deduped = items.filter((it) => {
    const key = it.link || it.title;
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  deduped.sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));

  return { items: deduped, errors, fetchedAt: new Date().toISOString() };
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

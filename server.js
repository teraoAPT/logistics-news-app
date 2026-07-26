const express = require('express');
const Parser = require('rss-parser');
const path = require('path');

const app = express();
const parser = new Parser({
  timeout: 8000,
  headers: { 'User-Agent': 'Mozilla/5.0 (compatible; NewsAggregator/1.0)' },
});

const PORT = process.env.PORT || 3000;

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
  const m = /\s-\s([^-]+)$/.exec(item.title || '');
  const source = m ? m[1].trim() : (item.source?.title || feedLabel);
  const title = m ? item.title.slice(0, item.title.length - m[0].length).trim() : item.title;
  return { title, source };
}

let cache = { data: null, fetchedAt: 0 };
const CACHE_MS = 5 * 60 * 1000;

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

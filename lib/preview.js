// 記事のプレビュー(写真と、媒体が公式に用意している紹介文)を取る。
// 本文は取らない。Googleニュースのリンクは、まず元の記事のアドレスに置き換える。
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';
const TIMEOUT_MS = 8000;
const MAX_HTML_BYTES = 1024 * 1024;

async function fetchText(url, options = {}) {
  const res = await fetch(url, {
    ...options,
    headers: { 'User-Agent': UA, 'Accept-Language': 'ja,en;q=0.8', ...(options.headers || {}) },
    signal: AbortSignal.timeout(TIMEOUT_MS),
    redirect: 'follow',
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer()).subarray(0, MAX_HTML_BYTES);
  return { text: decodeHtml(buf, res.headers.get('content-type')), url: res.url };
}

// Shift_JIS や EUC-JP のサイトもあるので、文字コードを見て読み分ける
function decodeHtml(buf, contentType) {
  const head = buf.subarray(0, 4096).toString('latin1');
  const charset = (/charset=["']?([\w-]+)/i.exec(contentType || '') || /<meta[^>]+charset=["']?([\w-]+)/i.exec(head))?.[1];
  try {
    return new TextDecoder(charset || 'utf-8').decode(buf);
  } catch {
    return new TextDecoder('utf-8').decode(buf);
  }
}

async function resolveGoogleNewsUrl(link) {
  const id = new URL(link).pathname.split('/').pop();
  const { text: page } = await fetchText(`https://news.google.com/rss/articles/${id}`);
  const sg = /data-n-a-sg="([^"]+)"/.exec(page)?.[1];
  const ts = /data-n-a-ts="([^"]+)"/.exec(page)?.[1];
  if (!sg || !ts) throw new Error('Googleニュースの記事情報が見つからない');

  const inner = JSON.stringify([
    'garturlreq',
    [['X', 'X', ['X', 'X'], null, null, 1, 1, 'US:en', null, 1, null, null, null, null, null, 0, 1], 'X', 'X', 1, [1, 1, 1], 1, 1, null, 0, 0, null, 0],
    id,
    Number(ts),
    sg,
  ]);
  const body = 'f.req=' + encodeURIComponent(JSON.stringify([[['Fbv4je', inner, null, 'generic']]]));
  const { text } = await fetchText('https://news.google.com/_/DotsSplashUi/data/batchexecute', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
    body,
  });
  const rows = JSON.parse(text.replace(/^\)\]\}'\s*/, ''));
  const row = rows.find((r) => r[0] === 'wrb.fr' && r[1] === 'Fbv4je');
  const url = row && JSON.parse(row[2])[1];
  if (!/^https?:\/\//.test(url || '')) throw new Error('元の記事のアドレスが取れない');
  return url;
}

const NAMED_ENTITIES = {
  amp: '&', quot: '"', apos: "'", lt: '<', gt: '>', nbsp: ' ', ldquo: '“', rdquo: '”', lsquo: '‘', rsquo: '’',
  hellip: '…', mdash: '—', ndash: '–', yen: '¥', copy: '©', reg: '®', middot: '・', times: '×',
};

// 「&amp;ldquo;」のように二重に書かれたものもあるので、2回ほどく
function decodeEntities(str) {
  let out = str;
  for (let i = 0; i < 2; i++) {
    out = out.replace(/&(#\d+|#x[0-9a-f]+|[a-z]+);/gi, (whole, code) => {
      if (code[0] === '#') {
        const n = code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : Number(code.slice(1));
        return Number.isFinite(n) && n > 0 && n <= 0x10FFFF ? String.fromCodePoint(n) : whole;
      }
      return NAMED_ENTITIES[code.toLowerCase()] ?? whole;
    });
  }
  return out;
}

function readMeta(html, names) {
  for (const name of names) {
    const tag = new RegExp(`<meta[^>]+(?:property|name)=["']${name}["'][^>]*>`, 'i').exec(html)?.[0];
    const content = tag && /content=["']([^"']*)["']/i.exec(tag)?.[1];
    if (content && content.trim()) {
      return decodeEntities(content)
        .replace(/\[caption[^\]]*\]?/g, '')
        .replace(/\[画像\d*:[^\]]*\]?/g, '')
        .replace(/\s+/g, ' ')
        .trim() || null;
    }
  }
  return null;
}

async function fetchPreview(link) {
  const articleUrl = link.includes('news.google.com/') ? await resolveGoogleNewsUrl(link) : link;
  const { text: html, url: finalUrl } = await fetchText(articleUrl);
  const description = readMeta(html, ['og:description', 'twitter:description', 'description']);
  let image = readMeta(html, ['og:image', 'twitter:image', 'twitter:image:src']);
  if (image) {
    try {
      image = new URL(image, finalUrl).href;
    } catch {
      image = null;
    }
  }
  if (image && !image.startsWith('https://')) image = null;
  return {
    url: finalUrl,
    siteName: readMeta(html, ['og:site_name']),
    description: description ? description.slice(0, 300) : null,
    image,
  };
}

module.exports = { fetchPreview };

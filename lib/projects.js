// 新設・増設などの案件記事を見つけ、会社・場所・用途・時期をタイトルから抜き出す。
// AIは使わず、決まった言葉の組み合わせで判定するため、取りこぼしや誤りはありうる。
const { toHalfWidth } = require('./text');

const KINDS = [
  { kind: '着工', re: /着工|起工|地鎮祭/ },
  { kind: '竣工・稼働', re: /竣工|完成|稼働開始|稼働を開始|本格稼働|稼働へ|開業|オープン|操業開始|操業を開始/ },
  { kind: '増設', re: /増設|拡張|増築|拡充|増強|新棟/ },
  { kind: '移転', re: /移転|集約/ },
  { kind: '新設', re: /新設|新工場|新拠点|新センター|新倉庫|開設|建設|進出|設立|用地取得|土地を取得|取得.{0,6}用地/ },
];

const FACILITY_RE = /工場|倉庫|物流センター|物流施設|物流拠点|配送センター|流通センター|センター|拠点|プラント|生産ライン|ライン|新棟|研究所|開発棟|施設|(?<![A-Za-z])[DT]C(?![A-Za-z])|ハブ/;
const EXCLUDE_RE = /閉鎖|撤退|売却|休止|求人|募集|セミナー|展示会|ウェビナー|決算|売上高|補助金|公募|人材|特定技能/;

const PURPOSES = [
  ['冷凍・冷蔵', /冷凍|冷蔵|低温|コールド/],
  ['医薬', /医薬|医療|製薬/],
  ['食品', /食品|飲料|食料/],
  ['EC・通販', /(?<![A-Za-z])EC(?![A-Za-z])|通販|eコマース/],
  ['半導体', /半導体/],
  ['電池', /電池|バッテリー/],
  ['自動車', /自動車|EV|車載/],
  ['物流センター', /物流センター|物流施設|物流拠点|配送センター|流通センター|(?<![A-Za-z])[DT]C(?![A-Za-z])/],
  ['倉庫', /倉庫/],
  ['研究開発', /研究所|開発棟|研究開発|R&D/],
  ['工場', /工場|プラント|生産ライン|生産拠点/],
];

const PREFECTURES = [
  '北海道', '青森', '岩手', '宮城', '秋田', '山形', '福島', '茨城', '栃木', '群馬', '埼玉', '千葉', '東京', '神奈川',
  '新潟', '富山', '石川', '福井', '山梨', '長野', '岐阜', '静岡', '愛知', '三重', '滋賀', '京都', '大阪', '兵庫',
  '奈良', '和歌山', '鳥取', '島根', '岡山', '広島', '山口', '徳島', '香川', '愛媛', '高知', '福岡', '佐賀', '長崎',
  '熊本', '大分', '宮崎', '鹿児島', '沖縄',
];
const COUNTRIES = [
  'タイ', 'ベトナム', 'インドネシア', 'マレーシア', 'フィリピン', 'シンガポール', 'インド', '中国', '台湾', '韓国',
  '米国', 'アメリカ', 'メキシコ', 'ドイツ', 'ポーランド', '英国', '欧州', 'ブラジル', 'Thailand',
];
const PLACE_RE = new RegExp(
  `(?:${PREFECTURES.join('|')})(?:都|道|府|県)?(?:[一-龥ぁ-んァ-ヶ]{1,5}?[市町村区郡])?` +
  `|[一-龥ァ-ヶ]{1,5}[市町村]` +
  `|(?:${COUNTRIES.join('|')})`,
  'g'
);

const TIMING_RE = /(?:20\d{2}|\d{2})年(?!越|間|ぶり|以上|連続|前|問題)度?(?:\d{1,2}月)?(?:上旬|中旬|下旬|中|内|頃|ごろ|めど|メド)?|\d{1,2}月(?:上旬|中旬|下旬|中|頃|ごろ)?(?=稼働|竣工|完成|開業|操業|オープン|に|ま)|来春|来夏|来秋|来冬|来年|今春|今夏|今秋|今冬|年内|年度内|上期|下期/;

// 先頭の「○○、」「○○が」「○○／」「○○ 」を会社名とみなす
const COMPANY_RE = /^([^、,，。\s　「」『』【】（）()／/]{2,20}?)(?:が|は|、|，|,|／|\/|\s|　)/;
const NOT_COMPANY_RE = /工場|センター|拠点|施設|新設|増設/;

// 「○○に」「○○で」と続く地名を優先する(「台湾系ALP、タイに〜」ならタイ)
function findPlace(text) {
  const matches = [...text.matchAll(PLACE_RE)];
  if (matches.length === 0) return null;
  const preferred = matches.find((m) => /^[にで]/.test(text.slice(m.index + m[0].length)));
  return (preferred || matches[0])[0];
}

function detectKind(text) {
  const hit = KINDS.find((k) => k.re.test(text));
  return hit ? hit.kind : null;
}

function guessCompany(title, hubspotMatches) {
  if (hubspotMatches && hubspotMatches.length > 0) return hubspotMatches[0].name;
  const m = COMPANY_RE.exec(title);
  if (!m || NOT_COMPANY_RE.test(m[1])) return null;
  return m[1];
}

function detectProject(item) {
  const title = toHalfWidth(item.title || '');
  if (EXCLUDE_RE.test(title)) return null;
  if (!FACILITY_RE.test(title)) return null;
  const kind = detectKind(title);
  if (!kind) return null;

  const body = title.replace(/^【[^】]*】\s*/, '');
  const timing = TIMING_RE.exec(body);
  const purposes = PURPOSES.filter(([, re]) => re.test(body)).map(([label]) => label);

  return {
    kind,
    company: guessCompany(body, item.hubspotMatches),
    location: findPlace(body),
    purpose: purposes.slice(0, 2).join(' / ') || null,
    timing: timing ? timing[0] : null,
  };
}

module.exports = { detectProject };

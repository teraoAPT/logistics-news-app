function toHalfWidth(str) {
  return (str || '')
    .replace(/[Ａ-Ｚａ-ｚ０-９]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xFEE0))
    .replace(/＆/g, '&')
    .replace(/－/g, '-')
    .replace(/　/g, ' ');
}

module.exports = { toHalfWidth };

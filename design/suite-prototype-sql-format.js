/* Prototype-only SQL keyword casing. This is not a SQL formatter or parser.
 * Preserves whitespace and protected PostgreSQL tokens byte-for-byte. Unknown
 * quote syntax or an unfinished protected token leaves the remaining text alone.
 */
(() => {
  'use strict';
  const keywords = new Set(['select', 'from', 'where', 'order', 'by', 'limit',
    'update', 'set', 'create', 'or', 'replace', 'procedure', 'begin', 'end']);
  const identifierStart = /[\p{L}\p{Nl}_]/u;
  const identifierPart = /[\p{L}\p{Nl}\p{N}\p{M}_$]/u;
  const tagPart = /[\p{L}\p{Nl}\p{N}\p{M}_]/u;
  const point = (text, at) => at < text.length ? String.fromCodePoint(text.codePointAt(at)) : '';

  function quotedEnd(sql, start, quote, escapes) {
    let at = start + 1;
    while (at < sql.length) {
      if (sql[at] === '\\' && escapes) { at += 2; continue; }
      // With unknown standard_conforming_strings, a backslash before a quote
      // is ambiguous. Do not risk interpreting the remainder as executable SQL.
      if (sql[at] === '\\' && !escapes && quote === "'" && sql[at + 1] === "'") return sql.length;
      if (sql[at] === quote) {
        if (sql[at + 1] === quote) { at += 2; continue; }
        return at + 1;
      }
      at++;
    }
    return sql.length;
  }

  function dollarDelimiter(sql, start) {
    if (sql[start + 1] === '$') return '$$';
    let at = start + 1;
    let ch = point(sql, at);
    if (!ch || !identifierStart.test(ch)) return null;
    at += ch.length;
    while ((ch = point(sql, at)) && tagPart.test(ch)) at += ch.length;
    return sql[at] === '$' ? sql.slice(start, at + 1) : null;
  }

  function uppercaseKeywords(sql) {
    if (typeof sql !== 'string') throw new TypeError('SQL must be a string');
    const pieces = [];
    let at = 0;
    while (at < sql.length) {
      const start = at, ch = point(sql, at);
      if (sql.startsWith('--', at)) {
        at += 2;
        while (at < sql.length && sql[at] !== '\n' && sql[at] !== '\r') at++;
      } else if (sql.startsWith('/*', at)) {
        at += 2;
        let depth = 1;
        while (at < sql.length && depth) {
          if (sql.startsWith('/*', at)) { depth++; at += 2; }
          else if (sql.startsWith('*/', at)) { depth--; at += 2; }
          else at++;
        }
      } else if ((ch === 'e' || ch === 'E') && sql[at + 1] === "'") {
        at = quotedEnd(sql, at + 1, "'", true);
      } else if ((ch === 'u' || ch === 'U') && sql[at + 1] === '&' && ['"', "'"].includes(sql[at + 2])) {
        at = quotedEnd(sql, at + 2, sql[at + 2], false);
      } else if (ch === "'" || ch === '"') {
        at = quotedEnd(sql, at, ch, false);
      } else if (ch === '`' || ch === '[') {
        // Unknown dialect quote/array grammar: intentionally leave the rest alone.
        at = sql.length;
      } else if (ch === '$' && dollarDelimiter(sql, at)) {
        const delimiter = dollarDelimiter(sql, at);
        const end = sql.indexOf(delimiter, at + delimiter.length);
        at = end < 0 ? sql.length : end + delimiter.length;
      } else if (identifierPart.test(ch)) {
        // Consume the whole identifier, including $ and non-Latin characters.
        // Digits are included to avoid altering parts of malformed/number tokens.
        at += ch.length;
        let next;
        while ((next = point(sql, at)) && identifierPart.test(next)) at += next.length;
        const word = sql.slice(start, at);
        const parameter = sql[start - 1] === ':' && sql[start - 2] !== ':';
        pieces.push(!parameter && keywords.has(word.toLowerCase()) ? word.toUpperCase() : word);
        continue;
      } else at += ch.length;
      pieces.push(sql.slice(start, at));
    }
    return pieces.join('');
  }

  window.SuiteSQLFormat = Object.freeze({ uppercaseKeywords });
})();

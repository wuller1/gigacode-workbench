/* Node VM regression checks of the actual prototype keyword-casing helper. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const file = 'design/suite-prototype-sql-format.js';
const source = fs.readFileSync(path.join(__dirname, '../..', file), 'utf8');
const context = {window:{}};
vm.createContext(context);
vm.runInContext(source, context);
const format = context.window.SuiteSQLFormat.uppercaseKeywords;
const tests = [];
function test(name, fn) {
  try { fn(); tests.push({name, pass:true}); }
  catch (error) { tests.push({name, pass:false, error:error.stack}); }
}
const cases = [
  ['Supported keywords only', 'select x from t where x = 1 order by x limit 5; update t set x = 2; create or replace procedure p() begin end;', 'SELECT x FROM t WHERE x = 1 ORDER BY x LIMIT 5; UPDATE t SET x = 2; CREATE OR REPLACE PROCEDURE p() BEGIN END;'],
  ['Whitespace is unchanged', '\tselect\r\n  x\tfrom\t\tt;\n', '\tSELECT\r\n  x\tFROM\t\tt;\n'],
  ['Unlisted keywords remain unchanged', 'select case when x is null then join end from t', 'SELECT case when x is null then join END FROM t'],
  ['String literals', "select 'select from where' from t", "SELECT 'select from where' FROM t"],
  ['Doubled single quotes', "select 'it''s select' from t", "SELECT 'it''s select' FROM t"],
  ['Escape string with escaped quote', String.raw`select E'it\'s select' from t`, String.raw`SELECT E'it\'s select' FROM t`],
  ['Lowercase escape prefix stays intact', String.raw`select e'from\\select\n' from t`, String.raw`SELECT e'from\\select\n' FROM t`],
  ['Ordinary path literal', String.raw`select 'C:\select\from' from t`, String.raw`SELECT 'C:\select\from' FROM t`],
  ['Ambiguous ordinary backslash quote preserves remainder', String.raw`select 'it\'s select' from t`, String.raw`SELECT 'it\'s select' from t`],
  ['Quoted identifiers and doubled quotes', 'select "select", "weird""from" from "where"', 'SELECT "select", "weird""from" FROM "where"'],
  ['Unicode quoted identifier', String.raw`select U&"select\0061" from t`, String.raw`SELECT U&"select\0061" FROM t`],
  ['Unicode string', String.raw`select u&'select\0061' from t`, String.raw`SELECT u&'select\0061' FROM t`],
  ['Dollar body', 'select $$ begin select from end $$ from t', 'SELECT $$ begin select from end $$ FROM t'],
  ['Named dollar body', 'select $body$begin select $inner$ from end$body$ from t', 'SELECT $body$begin select $inner$ from end$body$ FROM t'],
  ['Unicode dollar tag', 'select $тело_2$select from$тело_2$ from t', 'SELECT $тело_2$select from$тело_2$ FROM t'],
  ['Astral Unicode dollar tag', 'select $𐐀tag$select from$𐐀tag$ from t', 'SELECT $𐐀tag$select from$𐐀tag$ FROM t'],
  ['Dollar delimiters are case sensitive', 'select $Tag$from$tag$ where x', 'SELECT $Tag$from$tag$ where x'],
  ['Nested block comments', 'select /* from /* select */ where */ x from t', 'SELECT /* from /* select */ where */ x FROM t'],
  ['Line comments', 'select -- from select\n x from t -- where', 'SELECT -- from select\n x FROM t -- where'],
  ['CRLF line comments', 'select -- from\r\n x from t', 'SELECT -- from\r\n x FROM t'],
  ['Bare CR line comments', 'select -- from\r x from t', 'SELECT -- from\r x FROM t'],
  ['Comment-like text inside strings', "select '-- select /* from */' from t", "SELECT '-- select /* from */' FROM t"],
  ['Quote-like text inside comments', 'select /* \' select $$ " */ x from t', 'SELECT /* \' select $$ " */ x FROM t'],
  ['Dollar identifiers', 'select col$select, a$from$tag, $1 from t', 'SELECT col$select, a$from$tag, $1 FROM t'],
  ['Non-Latin identifiers', 'select αselect, selectЖ, from_名, 名from, selecté from t', 'SELECT αselect, selectЖ, from_名, 名from, selecté FROM t'],
  ['Combining and astral identifiers', 'select select\u0301, 𐐀select from t', 'SELECT select\u0301, 𐐀select FROM t'],
  ['Positional and named parameters', 'select :select, :from, $1, $22 from t', 'SELECT :select, :from, $1, $22 FROM t'],
  ['Numbers and malformed number tokens', 'select 1select, 1e3, 0xfrom from t', 'SELECT 1select, 1e3, 0xfrom FROM t'],
  ['Unknown backtick quoting preserves remainder', 'select `from` from t', 'SELECT `from` from t'],
  ['Unknown bracket grammar preserves remainder', 'select [from] from t', 'SELECT [from] from t'],
  ['Unterminated string', "select 'from where select", "SELECT 'from where select"],
  ['Unterminated quoted identifier', 'select "from where select', 'SELECT "from where select'],
  ['Unterminated escape string', String.raw`select E'from\' where select`, String.raw`SELECT E'from\' where select`],
  ['Unterminated dollar body', 'select $body$ from where select', 'SELECT $body$ from where select'],
  ['Unterminated nested comment', 'select /* from /* where */ select', 'SELECT /* from /* where */ select'],
  ['Empty input', '', '']
];
for (const [name, input, expected] of cases) {
  test(name, () => assert.equal(format(input), expected));
  test(name + ' — idempotent', () => assert.equal(format(format(input)), format(input)));
}
test('Non-string rejected before any conversion', () => assert.throws(() => format({toString(){throw Error('Must not coerce');}}), /SQL must be a string/));
test('Public API is immutable', () => assert.equal(Object.isFrozen(context.window.SuiteSQLFormat), true));
const result = {
  scope:'Actual helper in Node VM. Keyword casing only; no SQL formatting, parsing, execution, or live browser claim.',
  sourceHashes:{[file]:crypto.createHash('sha256').update(source).digest('hex')},
  passed:tests.filter(t=>t.pass).length, failed:tests.filter(t=>!t.pass).length, tests
};
const output = process.argv[2] || path.join(__dirname, 'sql-format-audit.json');
fs.writeFileSync(output, JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify({passed:result.passed, failed:result.failed, output}));
for (const failure of tests.filter(t=>!t.pass)) console.error(failure.name + '\n' + failure.error);
if (result.failed) process.exitCode = 1;

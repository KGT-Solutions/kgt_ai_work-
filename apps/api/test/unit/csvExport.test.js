const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const { csvCell, rowsToCsv, BOM } = require('../../src/services/shared/csvExport');

describe('csvExport: csvCell', () => {
  test('passes plain values through, empties null/undefined', () => {
    assert.equal(csvCell('hello'), 'hello');
    assert.equal(csvCell(42), '42');
    assert.equal(csvCell(null), '');
    assert.equal(csvCell(undefined), '');
  });
  test('quotes values with commas, quotes or newlines', () => {
    assert.equal(csvCell('a,b'), '"a,b"');
    assert.equal(csvCell('say "hi"'), '"say ""hi"""');
    assert.equal(csvCell('line1\nline2'), '"line1\nline2"');
  });
  test('neutralizes formula/CSV injection', () => {
    assert.equal(csvCell('=SUM(A1)'), "'=SUM(A1)");
    assert.equal(csvCell('+1'), "'+1");
    assert.equal(csvCell('-1'), "'-1");
    assert.equal(csvCell('@cmd'), "'@cmd");
    // A dangerous leading char AND a comma: prefixed then quoted.
    assert.equal(csvCell('=A,B'), '"\'=A,B"');
  });
});

describe('csvExport: rowsToCsv', () => {
  test('joins header + rows with CRLF', () => {
    const csv = rowsToCsv(['A', 'B'], [['1', '2'], ['x,y', '3']]);
    assert.equal(csv, 'A,B\r\n1,2\r\n"x,y",3');
  });
  test('BOM is the single UTF-8 byte-order mark code point (U+FEFF)', () => {
    assert.equal(BOM, String.fromCharCode(0xFEFF));
    assert.equal(BOM.charCodeAt(0), 0xFEFF);
    assert.equal(BOM.length, 1);
  });
});

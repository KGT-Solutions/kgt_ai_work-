// Minimal, safe CSV writer for dashboard exports (Feature 16). Two hazards it
// guards against:
//   1. CSV structure — a value with a comma, quote or newline is wrapped in
//      double quotes with embedded quotes doubled (RFC 4180).
//   2. Formula/CSV injection — a cell a spreadsheet would treat as a formula
//      (starts with = + - @, or a tab/CR that can shift it into one) is prefixed
//      with a single quote so Excel/Sheets render it as text, never execute it.
// Everything is coerced to a string; null/undefined become empty.

function csvCell(value) {
  let s = value === null || value === undefined ? '' : String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  if (/[",\n\r]/.test(s)) s = `"${s.replace(/"/g, '""')}"`;
  return s;
}

/**
 * @param {string[]} headers
 * @param {Array<Array<*>>} rows
 * @returns {string} CRLF-joined CSV (no trailing newline, no BOM)
 */
function rowsToCsv(headers, rows) {
  const out = [headers.map(csvCell).join(',')];
  for (const row of rows) out.push(row.map(csvCell).join(','));
  return out.join('\r\n');
}

// Excel on Windows needs a UTF-8 BOM (U+FEFF) to read non-ASCII (e.g. Hindi)
// correctly. Built from its code point rather than written as a raw byte-order
// mark, so this source stays plain ASCII and passes the Trojan-Source guard
// (test/unit/brandingHardening.test.js).
const BOM = String.fromCharCode(0xFEFF);

module.exports = { csvCell, rowsToCsv, BOM };

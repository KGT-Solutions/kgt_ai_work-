#!/usr/bin/env node
// Retrieval cost benchmark:  node scripts/bench-retrieval.js
//
// Not a *.test.js file, so it stays out of the release gate (scripts/run-tests.js
// only collects *.test.js). Retrieval runs synchronously on the event loop for
// every chat turn, so this is the number that decides how many concurrent
// conversations one API process can carry.
//
// Two query shapes are measured because they take different paths:
//   known    every word appears somewhere in the corpus — the common case
//   unknown  one word appears nowhere, so typo correction runs and needs the
//            corpus-wide vocabulary. Visitors do this constantly (they use
//            words the company's documents don't contain), so it is not an
//            edge case; it is the path that punishes any per-corpus work that
//            isn't cached across turns.
//
// The filter mirrors domains/tenantProfile.scopedTo, memoized the same way, so
// what is timed is what chatEngine actually does per turn.
const { rankItems } = require('../src/services/shared/lexicalSearch');

const WORDS = ('refund policy return window warranty replacement shipping delivery pricing plan tier seat month ' +
  'subscription enterprise support hours contact troubleshoot error reset password login account settings install ' +
  'configure manual guide instructions feature specification integration dashboard platform module invoice billing ' +
  'trial discount quote demo walkthrough comparison alternative benefit outcome customer success story proof').split(' ');

// Shaped like a real chunk from domains/tenantProfile.documentChunks().
function makeChunk(i, wordsPerChunk) {
  const body = [];
  for (let w = 0; w < wordsPerChunk; w++) body.push(WORDS[(i * 7 + w * 13) % WORDS.length]);
  return {
    title: `Section ${i} ${WORDS[i % WORDS.length]}`,
    content: body.join(' '),
    tags: [],
    scope: i % 3 === 0 ? 'support' : i % 3 === 1 ? 'sales' : 'both'
  };
}

// domains/tenantProfile.scopedTo, including its memoization.
const scopedCache = new WeakMap();
function scopedTo(chunks) {
  let scoped = scopedCache.get(chunks);
  if (!scoped) {
    scoped = chunks.filter((c) => c.scope === 'support' || c.scope === 'both');
    scopedCache.set(chunks, scoped);
  }
  return scoped;
}

const QUERIES = {
  known: 'what is the refund policy and the return window for a support plan',
  // "monthly" and "cancellation" appear nowhere in WORDS.
  unknown: 'what is the monthly cancellation refund policy'
};
const RUNS = 50;

function timed(fn) {
  const t0 = process.hrtime.bigint();
  for (let i = 0; i < RUNS; i++) fn(i);
  return Number(process.hrtime.bigint() - t0) / 1e6 / RUNS;
}

const CASES = [
  ['tiny (signup minimum)', 10, 120],
  ['small (website scan)', 40, 150],
  ['typical', 120, 200],
  ['content-heavy', 300, 250],
  ['at the 500-document cap', 1500, 250]
];

console.log(`node ${process.version}  ·  ${RUNS} queries per case\n`);
console.log('corpus                       sections    chars    known   unknown   turns/sec');
console.log('─'.repeat(78));

for (const [label, sections, wordsPerChunk] of CASES) {
  const all = Array.from({ length: sections }, (_, i) => makeChunk(i, wordsPerChunk));
  const chars = all.reduce((n, c) => n + c.content.length, 0);

  // Warm both the per-chunk indexes and the vocabulary, as a live process is.
  rankItems(QUERIES.unknown, scopedTo(all));
  const known = timed((i) => rankItems(`${QUERIES.known} ${i}`, scopedTo(all)));
  const unknown = timed((i) => rankItems(`${QUERIES.unknown} ${i}`, scopedTo(all)));

  console.log(
    label.padEnd(28) + String(sections).padStart(8) + String(chars).padStart(9) +
    `${known.toFixed(2)} ms`.padStart(9) + `${unknown.toFixed(2)} ms`.padStart(10) +
    String(Math.round(1000 / Math.max(known, unknown))).padStart(12)
  );
}
console.log("\nturns/sec = one core's ceiling on the retrieval step alone, worst of the two");
console.log('query shapes (LLM latency is async on top and does not consume the core).');

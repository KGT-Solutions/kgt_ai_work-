const app = require('./app');
const { assertProdSafety } = require('./utils/assertProdSafety');
const { describeLlmConfig } = require('./engine/llmClient');

assertProdSafety();

// Not fatal (the rest of the API works without an LLM), but loud: with no
// key for any provider, every chat answer is a degraded raw-excerpt dump.
const llm = describeLlmConfig();
if (!llm.configured.length) {
  console.warn(
    `[llm] WARNING: no API key set for any provider in the chain (${llm.chain.join(' -> ')}). ` +
    `Set ${llm.missingKeys.join(' / ')} — every chat reply will be a degraded fallback until then.`
  );
} else if (llm.missingKeys.length) {
  console.warn(`[llm] chain ${llm.chain.join(' -> ')}: no key for ${llm.missingKeys.join(', ')} (skipped at request time)`);
}

// Last-resort net: wrapRouterAsync (app.js) already forwards every route
// handler's rejections into Express's own error middleware, so this should
// only ever catch something outside the request/response cycle (e.g. a
// fire-and-forget promise). Without it, Node terminates the whole process on
// an uncaught rejection.
process.on('unhandledRejection', (err) => {
  console.error('[unhandledRejection]', err);
});

const port = process.env.PORT || 4000;
app.listen(port, () => {
  console.log(`KGT AI Hub API running at http://localhost:${port}`);
});

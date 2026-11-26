const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');

const {
  logger,
  runWithRequestContext,
  addContext,
  getContext,
  getRequestId,
} = require('../../src/lib/logger');

// Capture console output and the env the logger reads, restoring both after each
// test so cases can't leak into one another.
let out;
const realLog = console.log;
const realError = console.error;
const realWarn = console.warn;
const realDebug = console.debug;
const savedEnv = {};
const ENV_KEYS = ['LOG_LEVEL', 'LOG_FORMAT', 'NODE_ENV'];

beforeEach(() => {
  // Capture by STREAM, not by method: the logger routes warn->console.warn and
  // debug->console.debug (same streams as error/log), so fold warn into the
  // stderr bucket and debug into the stdout bucket. Every assertion here is about
  // which stream a line landed on, so it stays valid however the methods map.
  out = { log: [], error: [] };
  console.log = (...a) => out.log.push(a.join(' '));
  console.debug = (...a) => out.log.push(a.join(' '));
  console.warn = (...a) => out.error.push(a.join(' '));
  console.error = (...a) => out.error.push(a.join(' '));
  for (const k of ENV_KEYS) savedEnv[k] = process.env[k];
  // Deterministic baseline: readable lines, info threshold.
  process.env.LOG_FORMAT = 'pretty';
  process.env.LOG_LEVEL = 'info';
  delete process.env.NODE_ENV;
});

afterEach(() => {
  console.log = realLog;
  console.error = realError;
  console.warn = realWarn;
  console.debug = realDebug;
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
});

describe('logger — levels', () => {
  test('emits info/warn/error at the default threshold, drops debug', () => {
    logger.debug('nope');
    logger.info('yes-info');
    logger.warn('yes-warn');
    logger.error('yes-error');
    const all = [...out.log, ...out.error].join('\n');
    assert.ok(!all.includes('nope'), 'debug suppressed at info level');
    assert.ok(all.includes('yes-info'));
    assert.ok(all.includes('yes-warn'));
    assert.ok(all.includes('yes-error'));
  });

  test('LOG_LEVEL=warn drops info and debug', () => {
    process.env.LOG_LEVEL = 'warn';
    logger.info('hidden');
    logger.warn('shown');
    assert.equal(out.log.length, 0, 'info went nowhere');
    assert.equal(out.error.length, 1);
    assert.ok(out.error[0].includes('shown'));
  });

  test('LOG_LEVEL=debug lets debug through', () => {
    process.env.LOG_LEVEL = 'debug';
    logger.debug('debugging');
    assert.ok(out.log.join('\n').includes('debugging'));
  });

  test('an unknown LOG_LEVEL falls back to info', () => {
    process.env.LOG_LEVEL = 'chatty';
    logger.debug('nope');
    logger.info('yep');
    assert.ok(!out.log.join('\n').includes('nope'));
    assert.ok(out.log.join('\n').includes('yep'));
  });
});

describe('logger — routing', () => {
  test('info/debug go to stdout, warn/error to stderr', () => {
    process.env.LOG_LEVEL = 'debug';
    logger.debug('d');
    logger.info('i');
    logger.warn('w');
    logger.error('e');
    assert.equal(out.log.length, 2);
    assert.equal(out.error.length, 2);
  });

  test('exactly one console call per log event, even with an error+stack', () => {
    logger.error('boom', new Error('kaboom'));
    assert.equal(out.error.length, 1, 'line and stack share a single call');
    assert.ok(out.error[0].includes('kaboom'));
    assert.ok(out.error[0].includes('Error'), 'stack appended to the same line');
  });
});

describe('logger — JSON mode', () => {
  test('LOG_FORMAT=json emits a single parseable object per line', () => {
    process.env.LOG_FORMAT = 'json';
    logger.info('hello', { tenantId: 't1' });
    assert.equal(out.log.length, 1);
    const parsed = JSON.parse(out.log[0]);
    assert.equal(parsed.level, 'info');
    assert.equal(parsed.msg, 'hello');
    assert.equal(parsed.tenantId, 't1');
    assert.ok(typeof parsed.time === 'string');
  });

  test('defaults to JSON when NODE_ENV=production', () => {
    delete process.env.LOG_FORMAT;
    process.env.NODE_ENV = 'production';
    logger.info('prod-line');
    assert.doesNotThrow(() => JSON.parse(out.log[0]));
  });

  test('an Error serializes to a structured err field (message + stack)', () => {
    process.env.LOG_FORMAT = 'json';
    const err = new Error('db down');
    err.code = 'ECONN';
    logger.error('query failed', err);
    const parsed = JSON.parse(out.error[0]);
    assert.equal(parsed.err.message, 'db down');
    assert.equal(parsed.err.code, 'ECONN');
    assert.ok(parsed.err.stack.includes('db down'));
  });

  test('a lone Error uses its message as msg', () => {
    process.env.LOG_FORMAT = 'json';
    logger.error(new Error('just the error'));
    const parsed = JSON.parse(out.error[0]);
    assert.equal(parsed.msg, 'just the error');
    assert.equal(parsed.err.message, 'just the error');
  });
});

describe('logger — never throws, never corrupts the envelope', () => {
  test('a circular object is logged as [Circular], not thrown', () => {
    process.env.LOG_FORMAT = 'json';
    const a = {};
    a.self = a;
    assert.doesNotThrow(() => logger.info('circ', a));
    assert.equal(out.log.length, 1);
    const parsed = JSON.parse(out.log[0]);
    // a.self -> a, so the back-reference one level in is where the cycle closes.
    assert.equal(parsed.self.self, '[Circular]');
  });

  test('a BigInt field is coerced to a string, not thrown', () => {
    process.env.LOG_FORMAT = 'json';
    assert.doesNotThrow(() => logger.info('big', { n: 10n }));
    assert.equal(JSON.parse(out.log[0]).n, '10');
  });

  test('an array arg is preserved under `details`, not spread into index keys', () => {
    process.env.LOG_FORMAT = 'json';
    logger.info('listy', ['a', 'b']);
    const parsed = JSON.parse(out.log[0]);
    assert.deepEqual(parsed.details, ['a', 'b']);
    assert.equal(parsed['0'], undefined, 'not mangled into {0:..,1:..}');
  });

  test('a circular object is also safe in pretty mode', () => {
    process.env.LOG_FORMAT = 'pretty';
    const a = { tag: 'x' };
    a.self = a;
    assert.doesNotThrow(() => logger.info('circ-pretty', a));
    assert.ok(out.log[0].includes('[Circular]'));
  });

  test('caller fields cannot shadow level/time/msg', () => {
    process.env.LOG_FORMAT = 'json';
    logger.info('real message', { level: 'DEBUG', time: 'fake-time', msg: 'spoofed' });
    const parsed = JSON.parse(out.log[0]);
    assert.equal(parsed.level, 'info', 'real level preserved');
    assert.equal(parsed.msg, 'real message', 'real message preserved');
    assert.notEqual(parsed.time, 'fake-time', 'real timestamp preserved');
  });

  test('caller fields cannot shadow the request id', () => {
    process.env.LOG_FORMAT = 'json';
    runWithRequestContext({ reqId: 'authoritative' }, () => {
      logger.info('hi', { reqId: 'spoofed' });
    });
    assert.equal(JSON.parse(out.log[0]).reqId, 'authoritative');
  });
});

describe('logger — request context', () => {
  test('log lines inside runWithRequestContext carry the reqId', () => {
    process.env.LOG_FORMAT = 'json';
    runWithRequestContext({ reqId: 'req-123' }, () => {
      logger.info('inside');
    });
    assert.equal(JSON.parse(out.log[0]).reqId, 'req-123');
  });

  test('no reqId leaks outside the context', () => {
    process.env.LOG_FORMAT = 'json';
    runWithRequestContext({ reqId: 'req-abc' }, () => logger.info('in'));
    logger.info('out');
    assert.equal(JSON.parse(out.log[0]).reqId, 'req-abc');
    assert.equal(JSON.parse(out.log[1]).reqId, undefined);
  });

  test('context survives an await', async () => {
    process.env.LOG_FORMAT = 'json';
    await runWithRequestContext({ reqId: 'req-async' }, async () => {
      await new Promise((r) => setTimeout(r, 1));
      logger.info('after await');
    });
    assert.equal(JSON.parse(out.log[0]).reqId, 'req-async');
  });

  test('addContext merges fields into the current request', () => {
    process.env.LOG_FORMAT = 'json';
    runWithRequestContext({ reqId: 'req-xyz' }, () => {
      addContext({ tenantId: 'tenant-9' });
      logger.info('tagged');
    });
    const parsed = JSON.parse(out.log[0]);
    assert.equal(parsed.reqId, 'req-xyz');
    assert.equal(parsed.tenantId, 'tenant-9');
  });

  test('getRequestId / getContext reflect the active scope and are empty outside it', () => {
    assert.equal(getRequestId(), undefined);
    assert.equal(getContext(), undefined);
    runWithRequestContext({ reqId: 'r' }, () => {
      assert.equal(getRequestId(), 'r');
      assert.deepEqual(getContext(), { reqId: 'r' });
    });
  });

  test('addContext outside a request is a harmless no-op', () => {
    assert.doesNotThrow(() => addContext({ tenantId: 'x' }));
  });
});

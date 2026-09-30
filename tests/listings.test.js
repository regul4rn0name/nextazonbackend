const test = require('node:test');
const assert = require('node:assert/strict');
const { createApp, positiveInteger } = require('../app');

test('pagination rejects malformed and excessive values', () => {
  assert.equal(positiveInteger(undefined, 1, 100), 1);
  for (const input of ['0', '-1', '1.5', '1abc', '101', ['2']]) {
    assert.equal(positiveInteger(input, 1, 100), null);
  }
});

test('database failures produce a JSON response instead of hanging', async () => {
  const app = createApp({ collection() { throw new Error('private database details'); } });
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/listings`);
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { error: 'Listings are temporarily unavailable.' });
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});

require('dotenv').config({ quiet: true });
const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID, createHash } = require('node:crypto');
const { MongoClient } = require('mongodb');
const { createApp } = require('../app');
const { ensureAuthIndexes } = require('../auth-indexes');

test('registration, login, account-only access, guest migration, logout, and duplicate validation', { skip: !process.env.MONGO_URI }, async () => {
  const client = new MongoClient(process.env.MONGO_URI);
  await client.connect();
  const db = client.db(`nextazon_test_${randomUUID().replaceAll('-', '')}`);
  let server;
  try {
    await ensureAuthIndexes(db);
    const legacyToken = 'a'.repeat(64);
    await db.collection('sessions').insertOne({ _id: createHash('sha256').update(legacyToken).digest('hex'), userId: 'legacy-user', wishlist: ['legacy-listing'], expiresAt: new Date(Date.now() + 86400000) });
    await db.collection('listings').insertOne({ _id: 'legacy-listing', userId: 'legacy-user', name: 'Old listing', price: 100 });
    server = createApp(db).listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    async function request(path, method = 'GET', body, token) {
      const result = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
      return { status: result.status, data: await result.json() };
    }
    assert.equal((await request('/auth/me', 'GET', undefined, legacyToken)).status, 401);
    assert.equal((await request('/wishlist/legacy-listing', 'PUT', undefined, legacyToken)).status, 401);
    assert.equal((await request('/listings?scope=mine', 'GET', undefined, legacyToken)).status, 401);
    const credentials = { username: 'TestUser', email: 'USER@example.test', password: 'a-long-test-password' };
    const registered = await request('/auth/register', 'POST', credentials, legacyToken);
    assert.equal(registered.status, 201);
    assert.equal(registered.data.user.email, undefined);
    assert.equal(registered.data.user.passwordHash, undefined);
    const stored = await db.collection('users').findOne({ _id: registered.data.user.id });
    assert.notEqual(stored.passwordHash, credentials.password);
    assert.deepEqual(stored.wishlist, ['legacy-listing']);
    assert.equal((await request('/listings?scope=mine', 'GET', undefined, registered.data.token)).data.total, 1);
    assert.equal((await request('/auth/register', 'POST', credentials)).status, 409);
    assert.equal((await request('/auth/register', 'POST', { ...credentials, email: 'other@example.test', username: 'testuser' })).status, 409);
    assert.equal((await request('/auth/login', 'POST', { username: credentials.username, password: 'wrong-password' })).status, 401);
    assert.equal((await request('/auth/login', 'POST', { username: 'missinguser', password: 'wrong-password' })).status, 401);
    const login = await request('/auth/login', 'POST', { ...credentials, username: credentials.username.toUpperCase() });
    assert.equal(login.status, 200);
    assert.equal((await request('/listings?scope=wishlist', 'GET', undefined, login.data.token)).data.total, 1);
    assert.equal((await request('/auth/me', 'GET', undefined, login.data.token)).data.user.username, 'TestUser');
    assert.equal((await request('/auth/logout', 'POST', undefined, login.data.token)).status, 200);
    assert.equal((await request('/auth/me', 'GET', undefined, login.data.token)).status, 401);
    assert.equal((await request('/auth/register', 'POST', { ...credentials, password: 'short' })).status, 400);
    assert.equal((await request('/auth/login', 'POST', { username: { $ne: '' }, password: 'test' })).status, 400);
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
    await db.dropDatabase();await client.close();
  }
});

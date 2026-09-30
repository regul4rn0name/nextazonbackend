require('dotenv').config({ quiet: true });
const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { MongoClient } = require('mongodb');
const { createApp } = require('../app');
const { ensureAuthIndexes } = require('../auth-indexes');

test('MongoDB API filtering, pagination, private wishlists, creation, and ownership', { skip: !process.env.MONGO_URI }, async () => {
  const client = new MongoClient(process.env.MONGO_URI, { serverSelectionTimeoutMS: 5000 });
  await client.connect();
  // A unique, test-owned database; never clear the application's database.
  const db = client.db(`nextazon_test_${randomUUID().replaceAll('-', '')}`);
  let server;
  try {
    await ensureAuthIndexes(db);
    await db.collection('catalog').insertMany(require('../catalog').buildCatalog().slice(0,24));
    await db.collection('listings').insertMany([
      { _id: 'a', name: 'Froggy chair', category: 'Furniture', price: 100, online: true, userId: 'alice' },
      { _id: 'b', name: 'Moon chair', category: 'Furniture', price: 300, online: false, userId: 'bob' },
      { _id: 'c', name: 'Chair.*', category: 'Furniture', price: 200, online: true, userId: 'alice' },
      { _id: 'd', name: 'Molly', category: 'Villagers', price: 500, online: true, userId: 'bob' },
    ]);
    server = createApp(db,{onlineIds:()=>['alice']}).listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    const request = async (path, method = 'GET', body, token) => {
      const response = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
      return { status: response.status, data: await response.json() };
    };
    const combined = await request('/listings?q=chair&category=Furniture&online=true&minPrice=100&maxPrice=250&sort=priceAsc&limit=1&page=2');
    assert.equal(combined.status, 200);
    assert.equal(combined.data.total, 2);
    assert.equal(combined.data.items[0].id, 'c');
    assert.deepEqual(combined.data.categoryCounts, { Furniture: 2 });
    assert.equal((await request('/listings?q=chair.*')).data.total, 1);
    assert.equal((await request('/listings?seller=alice')).data.total, 2);
    assert.equal((await request('/listings?category=Furniture')).data.categoryCounts.Villagers, 1);
    assert.equal((await request('/listings?scope=mine')).status, 401);
    assert.equal((await request('/listings?minPrice=500&maxPrice=100')).status, 400);
    assert.equal((await request('/listings/missing')).status, 404);
    assert.equal((await request('/listings', 'POST', {})).status, 401);
    const first = (await request('/auth/register', 'POST', { username: 'first_user', email: 'first@example.test', password: 'test-password-123' })).data.token;
    const second = (await request('/auth/register', 'POST', { username: 'second_user', email: 'second@example.test', password: 'test-password-123' })).data.token;
    await request('/wishlist/a', 'PUT', undefined, first);
    assert.equal((await request('/listings?scope=wishlist', 'GET', undefined, first)).data.total, 1);
    assert.equal((await request('/listings?scope=wishlist', 'GET', undefined, second)).data.total, 0);
    assert.equal((await request('/listings/a', 'GET', undefined, first)).data.saved, true);
    await request('/wishlist/a', 'DELETE', undefined, first);
    assert.equal((await request('/listings?scope=wishlist', 'GET', undefined, first)).data.total, 0);
    const catalog = (await request('/catalog')).data.items;
    const created = await request('/listings', 'POST', { itemId: catalog[0].id, price: 123, seller: 'Test islander', description: 'Test listing', online: true, userId: 'alice' }, first);
    assert.equal(created.status, 201);
    assert.notEqual(created.data.userId, 'alice');
    assert.equal(created.data.canManage, true);
    assert.equal(created.data.seller, 'first_user');
    const localized = Object.values((await db.collection('catalog').findOne({_id:catalog[0].id})).translations).find(value => typeof value === 'string' && /[а-я]/i.test(value));
    assert.ok((await request('/catalog?q='+encodeURIComponent(localized))).data.total > 0);
    assert.ok((await request('/listings?q='+encodeURIComponent(localized))).data.total > 0);
    assert.equal((await request('/catalog?q=x&q=y')).status,400);
    const tickets = await request('/listings','POST',{itemId:catalog[0].id,price:5,currency:'Nook Miles Tickets'},first);
    assert.equal(tickets.status,201);
    assert.equal((await request('/listings?currency=Nook%20Miles%20Tickets')).data.total,1);
    const trade = await request('/listings','POST',{itemId:catalog[0].id,offerType:'trade',tradeItemId:catalog[1].id},first);
    assert.equal(trade.status,201);
    assert.equal(trade.data.price,null);
    assert.equal(trade.data.tradeItem.name,catalog[1].name);
    assert.equal((await request('/listings?currency=trade')).data.total,1);
    assert.equal((await request('/listings','POST',{itemId:catalog[0].id,price:5,currency:'USD'},first)).status,400);
    assert.equal((await request('/listings','POST',{itemId:catalog[0].id,offerType:'trade',tradeItemId:{$ne:null}},first)).status,400);
    await request(`/listings/${tickets.data.id}`,'DELETE',undefined,first);
    await request(`/listings/${trade.data.id}`,'DELETE',undefined,first);
    assert.equal((await request('/listings?scope=mine', 'GET', undefined, first)).data.total, 1);
    assert.equal((await request(`/listings/${created.data.id}`, 'DELETE', undefined, second)).status, 404);
    assert.equal((await request(`/listings/${created.data.id}`, 'DELETE', undefined, first)).status, 200);
    assert.equal((await request('/listings', 'POST', { itemId: catalog[0].id, price: -1, seller: 'test' }, first)).status, 400);
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
    await db.dropDatabase();
    await client.close();
  }
});

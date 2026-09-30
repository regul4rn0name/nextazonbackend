const express = require('express');
const { ObjectId } = require('mongodb');
const { randomUUID, createHash } = require('node:crypto');
const { searchFilter, snapshot } = require('./catalog');
const { parseFilters, positiveInteger } = require('./filters');
const { registerAuth } = require('./auth');
const idQuery = id => ObjectId.isValid(id) ? { $in: [id, new ObjectId(id)] } : id;
const hash = token => createHash('sha256').update(token).digest('hex');

function createApp(db, realtime = {onlineIds:()=>[]}) {
  const app = express();
  // Production traffic reaches Express through the trusted Next.js proxy.
  if(process.env.NODE_ENV === 'production') app.set('trust proxy', 1);
  app.use(express.json({ limit: '16kb' }));
  app.use((_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
  async function rawSession(req) {
    const token = req.get('authorization')?.replace(/^Bearer /, '');
    if (!token || !/^[a-f0-9]{64}$/.test(token)) return null;
    return db.collection('sessions').findOne({ _id: hash(token), expiresAt: { $gt: new Date() } });
  }
  async function session(req) {
    const value = await rawSession(req);
    if (!value?.accountId) return null;
    const account = await db.collection('users').findOne({ _id: value.accountId });
    return account ? { ...value, wishlist: account.wishlist || [], username: account.username } : null;
  }
  registerAuth(app, db, rawSession);
  app.post('/realtime-ticket', async (req,res)=>{
    const user=await session(req);
    if(!user) return res.status(401).json({error:'Please sign in.'});
    res.json({ticket:realtime.issue(user)});
  });
  const serialize = (item, user) => {
    const { _id, ...listing } = item;
    return { ...listing, online: realtime.onlineIds().includes(String(listing.userId)), id: String(_id), saved: user?.wishlist?.includes(String(_id)) || false, canManage: !!user && listing.userId === user.userId };
  };
  app.get('/', (_req, res) => res.json({ service: 'nextazon', listings: '/listings' }));
  app.get('/catalog', async (req, res) => {
    const page = positiveInteger(req.query.page, 1, 1000000);
    const pageSize = positiveInteger(req.query.limit, 24, 100);
    const q = req.query.q || '';
    if (!page || !pageSize || typeof q !== 'string' || q.length > 100) return res.status(400).json({error:'Invalid catalog search.'});
    const filter = q.trim() ? searchFilter(q.trim()) : {};
    const collection = db.collection('catalog');
    const [items,total] = await Promise.all([collection.find(filter).sort({name:1,_id:1}).skip((page-1)*pageSize).limit(pageSize).toArray(),collection.countDocuments(filter)]);
    res.json({items:items.map(({_id,searchNames,...item})=>({...item,id:_id})),total,page,pageSize});
  });
  app.get('/listings', async (req, res) => {
    let parsed;
    try { parsed = parseFilters(req.query); } catch (error) { return res.status(400).json({ error: error.message }); }
    const { page, pageSize, category, scope, sort } = parsed;
    const filter = { ...parsed.filter };
    if(filter.online) {delete filter.online;filter.$and=[{userId:{$in:realtime.onlineIds()}}];}
    const user = await session(req);
    if (scope && !user) return res.status(401).json({ error: 'Please sign in or create an account.' });
    if (scope === 'mine') filter.userId = user ? user.userId : { $in: [] };
    if (scope === 'wishlist') filter._id = { $in: (user?.wishlist || []).flatMap(id => ObjectId.isValid(id) ? [id, new ObjectId(id)] : [id]) };
    const categoryFilter = category === 'Other' ? { $or: [{ category: 'Other' }, { category: { $exists: false } }] } : category ? { category } : {};
    const match = { $and: [filter, categoryFilter] };
    const collection = db.collection('listings');
    const [items, total, counts] = await Promise.all([
      collection.find(match).sort(sort).skip((page - 1) * pageSize).limit(pageSize).toArray(),
      collection.countDocuments(match),
      collection.aggregate([{ $match: filter }, { $group: { _id: { $ifNull: ['$category', 'Other'] }, count: { $sum: 1 } } }]).toArray(),
    ]);
    res.json({ items: items.map(item => serialize(item, user)), total, page, pageSize, categoryCounts: Object.fromEntries(counts.map(item => [item._id, item.count])) });
  });
  app.get('/listings/:id', async (req, res) => {
    const item = await db.collection('listings').findOne({ _id: idQuery(req.params.id) });
    if (!item) return res.status(404).json({ error: 'Listing not found.' });
    res.json(serialize(item, await session(req)));
  });
  app.post('/listings', async (req, res) => {
    const user = await session(req);
    if (!user) return res.status(401).json({ error: 'Please sign in or create an account.' });
    const { itemId, price, currency = 'Bells', offerType = 'price', tradeItemId, description = '', online = false } = req.body || {};
    if (typeof itemId !== 'string' || !['price','trade'].includes(offerType) || typeof description !== 'string' || description.length > 1000 || typeof online !== 'boolean') return res.status(400).json({error:'Choose an item and a valid offer.'});
    const item = await db.collection('catalog').findOne({_id:itemId});
    let tradeItem = null;
    if (offerType === 'trade') {
      if (typeof tradeItemId !== 'string') return res.status(400).json({error:'Choose the item you want in exchange.'});
      tradeItem = await db.collection('catalog').findOne({_id:tradeItemId});
      if (!tradeItem) return res.status(400).json({error:'Requested trade item not found.'});
    } else if (!['Bells','Nook Miles Tickets'].includes(currency) || !Number.isSafeInteger(price) || price < 1 || price > 999999999) {
      return res.status(400).json({error:'Enter a whole-number price from 1 to 999999999 in Bells or Nook Miles Tickets.'});
    }
    if (!item) return res.status(400).json({error:'Catalog item not found.'});
    const created = { _id: randomUUID(), ...snapshot(item), offerType, currency: offerType === 'price' ? currency : '', price: offerType === 'price' ? price : null, tradeItem: tradeItem ? snapshot(tradeItem) : null, seller: user.username, userId: user.userId, description: description.trim(), online, createdAt: new Date() };
    await db.collection('listings').insertOne(created);
    res.status(201).json(serialize(created, user));
  });
  app.delete('/listings/:id', async (req, res) => {
    const user = await session(req);
    if (!user) return res.status(401).json({ error: 'Please sign in or create an account.' });
    const result = await db.collection('listings').deleteOne({ _id: idQuery(req.params.id), userId: user.userId });
    if (!result.deletedCount) return res.status(404).json({ error: 'Owned listing not found.' });
    res.json({ deleted: true });
  });
  app.put('/wishlist/:id', async (req, res) => {
    const user = await session(req);
    if (!user) return res.status(401).json({ error: 'Please sign in or create an account.' });
    if (!await db.collection('listings').findOne({ _id: idQuery(req.params.id) })) return res.status(404).json({ error: 'Listing not found.' });
    await db.collection('users').updateOne({ _id: user.accountId }, { $addToSet: { wishlist: req.params.id } });
    res.json({ saved: true });
  });
  app.delete('/wishlist/:id', async (req, res) => {
    const user = await session(req);
    if (!user) return res.status(401).json({ error: 'Please sign in or create an account.' });
    await db.collection('users').updateOne({ _id: user.accountId }, { $pull: { wishlist: req.params.id } });
    res.json({ saved: false });
  });
  app.use((error, _req, res, _next) => {
    if (error.type === 'entity.parse.failed' || error.type === 'entity.too.large') return res.status(400).json({ error: 'Invalid request body.' });
    res.status(503).json({ error: 'Listings are temporarily unavailable.' });
  });
  return app;
}
module.exports = { createApp, positiveInteger };

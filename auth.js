const { randomBytes, randomUUID, scrypt, timingSafeEqual, createHash } = require('node:crypto');
const { promisify } = require('node:util');
const deriveKey = promisify(scrypt);
const hashToken = token => createHash('sha256').update(token).digest('hex');
const publicUser = user => ({ id: user._id, username: user.username});

async function passwordHash(password) {
  const salt = randomBytes(16).toString('hex');
  const key = await deriveKey(password, salt, 64);
  return `${salt}:${key.toString('hex')}`;
}
async function passwordMatches(password, stored) {
  const [salt, hash] = stored.split(':');
  const key = await deriveKey(password, salt, 64);
  const expected = Buffer.from(hash, 'hex');
  return expected.length === key.length && timingSafeEqual(expected, key);
}

function registerAuth(app, db, rawSession) {
  const attempts = new Map();
  function rateLimit(req, res, next) {
    const now = Date.now();
    for (const [ip, entry] of attempts) if (entry.until <= now) attempts.delete(ip);
    const entry = attempts.get(req.ip) || { count: 0, until: now + 15 * 60000 };
    entry.count += 1;
    if (!attempts.has(req.ip) && attempts.size >= 5000) return res.status(429).json({ error: 'Please try again later.' });
    attempts.set(req.ip, entry);
    if (entry.count > 30) return res.status(429).json({ error: 'Too many attempts. Please try again in 15 minutes.' });
    next();
  }
  async function issueSession(req, user) {
    const previous = await rawSession(req);
    if (previous && !previous.accountId) {
      await db.collection('users').updateOne({ _id: user._id }, { $addToSet: { wishlist: { $each: previous.wishlist || [] } } });
      await db.collection('listings').updateMany({ userId: previous.userId }, { $set: { userId: user._id } });
    }
    const token = randomBytes(32).toString('hex');
    await db.collection('sessions').insertOne({ _id: hashToken(token), userId: user._id, accountId: user._id, expiresAt: new Date(Date.now() + 30 * 86400000) });
    if (previous) await db.collection('sessions').deleteOne({ _id: previous._id });
    return token;
  }
  app.post('/auth/register', rateLimit, async (req, res) => {
    const { username, password } = req.body || {};
    if (typeof username !== 'string' || !/^[a-zA-Z0-9_]{3,24}$/.test(username) || typeof password !== 'string' || password.length < 8 || password.length > 128) {
      return res.status(400).json({ error: 'Use a 3–24 character username (letters, numbers, underscores), and a 8–128 character password.' });
    }
    const user = { _id: randomUUID(), username, usernameKey: username.toLowerCase(), passwordHash: await passwordHash(password), wishlist: [], createdAt: new Date() };
    try { await db.collection('users').insertOne(user); }
    catch (error) {
      if (error.code === 11000) return res.status(409).json({ error: 'That username is already registered.' });
      throw error;
    }
    res.status(201).json({ user: publicUser(user), token: await issueSession(req, user) });
  });
  app.post('/auth/login', rateLimit, async (req, res) => {
    const { username, password } = req.body || {};
    if (typeof username !== 'string' || !/^[a-zA-Z0-9_]{3,24}$/.test(username) || typeof password !== 'string' || password.length > 128) return res.status(400).json({ error: 'Enter your username and password.' });
    const user = await db.collection('users').findOne({ usernameKey: username.toLowerCase() });
    const valid = await passwordMatches(password, user?.passwordHash || `${'0'.repeat(32)}:${'0'.repeat(128)}`);
    if (!user || !valid) return res.status(401).json({ error: 'Incorrect username or password.' });
    res.json({ user: publicUser(user), token: await issueSession(req, user) });
  });
  app.get('/auth/me', async (req, res) => {
    const session = await rawSession(req);
    const user = session?.accountId ? await db.collection('users').findOne({ _id: session.accountId }) : null;
    if (!user) return res.status(401).json({ error: 'Please sign in.' });
    res.json({ user: publicUser(user) });
  });
  app.post('/auth/logout', async (req, res) => {
    const session = await rawSession(req);
    if (session) await db.collection('sessions').deleteOne({ _id: session._id });
    res.json({ signedOut: true });
  });
}
module.exports = { registerAuth };

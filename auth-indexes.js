async function ensureAuthIndexes(db) {
  const users = db.collection('users');
  let indexes = [];
  try { indexes = await users.listIndexes().toArray(); }
  catch (error) { if (error.code !== 26) throw error; }
  // Username-only accounts have no email. Preserve uniqueness for legacy emails
  // without limiting the entire collection to one account with a missing email.
  const emailIndex = indexes.find(index => index.name === 'email_1');
  if (emailIndex && !emailIndex.partialFilterExpression) await users.dropIndex('email_1');
  await users.createIndex({ email: 1 }, { unique: true, partialFilterExpression: { email: { $type: 'string' } } });
  await users.createIndex({ usernameKey: 1 }, { unique: true });
}
module.exports = { ensureAuthIndexes };

require('dotenv').config({ quiet: true });
const { MongoClient } = require('mongodb');
const { createRealtime } = require('./realtime');
const { createApp } = require('./app');
const { ensureAuthIndexes } = require('./auth-indexes');

async function start() {
  const client = new MongoClient(process.env.MONGO_URI, { serverSelectionTimeoutMS: 5000 });
  try {
    await client.connect();
    const db = client.db(process.env.MONGO_DB || 'nextazon');
    await db.collection('sessions').createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
    await ensureAuthIndexes(db);
    await db.collection('messages').createIndex({conversationId:1,createdAt:-1,_id:-1});
    await db.collection('conversations').createIndex({members:1,updatedAt:-1});
    const realtime=createRealtime(db);
    const app = createApp(db,realtime);
    const port = Number(process.env.PORT || 3002);
    const server = app.listen(port, () => console.log(`Nextazon API listening on ${port}`));
    const sockets=realtime.attach(server);
    server.on('error', async () => {
      console.error('Could not start the API listener. Check PORT and whether another instance is running.');
      await client.close();
      process.exitCode = 1;
    });
    function shutdown() {
      for(const socket of sockets.clients) socket.terminate();
      sockets.close();
      server.close(async () => { await client.close(); process.exit(0); });
    }
    process.once('SIGTERM', shutdown);
    process.once('SIGINT', shutdown);
  } catch {
    await client.close();
    throw new Error('Could not connect to MongoDB. Check MONGO_URI and database availability.');
  }
}

start().catch(error => { console.error(error.message); process.exitCode = 1; });

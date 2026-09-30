require('dotenv').config({ path: require('node:path').join(__dirname, '../.env'), quiet: true });
const { MongoClient } = require('mongodb');
const examples = require('../data/example-listings.json');

async function seed() {
  if (!process.env.MONGO_URI) throw new Error('MONGO_URI must be configured.');
  const client = new MongoClient(process.env.MONGO_URI, { serverSelectionTimeoutMS: 5000 });
  try {
    await client.connect();
    const collection = client.db(process.env.MONGO_DB || 'nextazon').collection('listings');
    const result = await collection.bulkWrite(examples.map(example => ({
      updateOne: {
        filter: { _id: example._id },
        update: { $setOnInsert: example },
        upsert: true,
      },
    })));
    console.log(JSON.stringify({ inserted: result.upsertedCount, alreadyPresent: result.matchedCount, total: await collection.countDocuments() }));
  } finally {
    await client.close();
  }
}
seed().catch(() => {
  console.error('Seeding failed. Check the MongoDB connection and database permissions.');
  process.exitCode = 1;
});

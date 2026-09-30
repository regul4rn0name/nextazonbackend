require('dotenv').config({quiet:true});
const {MongoClient} = require('mongodb');
const {buildCatalog, snapshot} = require('../catalog');
(async () => {
  const client = new MongoClient(process.env.MONGO_URI);
  try {
    await client.connect();
    const db = client.db(process.env.MONGO_DB || 'nextazon');
    const items = buildCatalog();
    for(let i=0;i<items.length;i+=500) await db.collection('catalog').bulkWrite(items.slice(i,i+500).map(({_id,...item}) => ({updateOne:{filter:{_id},update:{$set:item},upsert:true}})));
    await db.collection('catalog').createIndex({name:1,_id:1});
    let mapped=0;
    for(const listing of await db.collection('listings').find({}).toArray()) {
      const matches=items.filter(item=>item.name.toLowerCase()===listing.name.toLowerCase());
      const match=matches.find(item=>item.variant===listing.variant) || (matches.length===1 ? matches[0] : matches.find(item=>item.image===listing.image));
      if(match) {await db.collection('listings').updateOne({_id:listing._id},{$set:snapshot(match)});mapped++;}
    }
    console.log(JSON.stringify({catalogItems:items.length,mappedListings:mapped}));
  } finally {await client.close();}
})().catch(error=>{console.error(error.message);process.exitCode=1;});

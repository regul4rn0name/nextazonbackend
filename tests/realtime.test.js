require('dotenv').config({quiet:true});
const test=require('node:test');
const assert=require('node:assert/strict');
const {MongoClient}=require('mongodb');
const {randomUUID,createHash}=require('node:crypto');
const {WebSocket}=require('ws');
const {createApp}=require('../app');
const {createRealtime}=require('../realtime');
test('authenticated chat persists messages, protects membership, tracks unread and multi-tab presence',{skip:!process.env.MONGO_URI},async()=>{
 const client=await new MongoClient(process.env.MONGO_URI).connect();
 const db=client.db('nextazon_chat_test_'+randomUUID().replaceAll('-',''));
 const rt=createRealtime(db);const server=createApp(db,rt).listen(0,'127.0.0.1');
 await new Promise(r=>server.once('listening',r));const wss=rt.attach(server);const sockets=[];
 async function user(name){
  const response=await fetch(`http://127.0.0.1:${server.address().port}/auth/register`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:name,password:'test-password-123'})});
  const data=await response.json();
  const session=await db.collection('sessions').findOne({_id:createHash('sha256').update(data.token).digest('hex')});return {...session,username:name};
 }
 async function connect(user){
  const ws=new WebSocket(`ws://127.0.0.1:${server.address().port}/realtime`);sockets.push(ws);
  const wait=(predicate)=>new Promise((resolve,reject)=>{const timer=setTimeout(()=>{ws.off('message',handle);reject(new Error('Timed out'));},3000);function handle(raw){const d=JSON.parse(raw);if(predicate(d)){clearTimeout(timer);ws.off('message',handle);resolve(d);}}ws.on('message',handle);});
  const ready=wait(d=>d.type==='ready');await new Promise(r=>ws.once('open',r));ws.send(JSON.stringify({action:'authenticate',ticket:rt.issue(user)}));await ready;
  return {ws,wait,call:async(action,data={})=>{const id=randomUUID();const reply=wait(d=>d.id===id);ws.send(JSON.stringify({id,action,...data}));return reply;}};
 }
 try {
  const a=await user('alice_chat'),b=await user('bob_chat'),c=await user('eve_chat');
  const A=await connect(a),A2=await connect(a),B=await connect(b),C=await connect(c);
  assert.equal(rt.onlineIds().length,3);
  A2.ws.close();await new Promise(r=>A2.ws.once('close',r));assert.ok(rt.onlineIds().includes(a.accountId));
  const id=(await A.call('start',{peerId:b.accountId})).data.id;
  assert.ok((await C.call('history',{conversationId:id})).error);
  assert.ok((await C.call('send',{conversationId:id,text:'intrusion'})).error);
  const delivery=B.wait(d=>d.type==='message');
  const sent=await A.call('send',{conversationId:id,text:'Hello from my island'});
  assert.equal((await delivery).message._id,sent.data._id);
  assert.equal((await B.call('conversations')).data[0].unread,1);
  assert.equal((await B.call('history',{conversationId:id})).data[0].text,'Hello from my island');
  await B.call('read',{conversationId:id,ids:[sent.data._id]});
  assert.equal((await B.call('conversations')).data[0].unread,0);
  assert.ok((await A.call('send',{conversationId:id,text:' '.repeat(5)})).error);
  await db.collection('sessions').deleteOne({_id:a._id});
  const offline=B.wait(d=>d.type==='presence' && !d.ids.includes(a.accountId));
  const closed=new Promise(r=>A.ws.once('close',r));A.ws.send(JSON.stringify({action:'conversations',id:'revoked'}));await closed;await offline;
  assert.ok(!rt.onlineIds().includes(a.accountId));
 } finally {for(const ws of sockets)ws.terminate();await new Promise(r=>wss.close(r));await new Promise(r=>server.close(r));await db.dropDatabase();await client.close();}
});

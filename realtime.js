const { createOffers } = require('./offers');
const { WebSocketServer, WebSocket } = require('ws');
const { randomBytes, randomUUID } = require('node:crypto');

class ChatError extends Error {}

function createRealtime(db) {
  const tickets = new Map();
  const clients = new Map();
  const onlineIds = () => [...clients.keys()];
  const send = (ws, data) => { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(data)); };
  const broadcast = (ids, data) => ids.forEach(id => clients.get(id)?.forEach(ws => send(ws, data)));
  const offerCommand=createOffers(db,broadcast,ChatError);
  const presence = () => broadcast(onlineIds(), {type:'presence', ids:onlineIds()});
  async function valid(session) {
    return !!await db.collection('sessions').findOne({_id:session._id, accountId:session.accountId, expiresAt:{$gt:new Date()}});
  }
  function issue(session) {
    for(const [key,value] of tickets) if(value.expires < Date.now()) tickets.delete(key);
    const ticket=randomBytes(32).toString('hex');
    tickets.set(ticket,{session,expires:Date.now()+30000});
    return ticket;
  }
  async function command(user, input) {
    const uid=user.accountId;
    if(typeof input.action === 'string' && input.action.startsWith('offer.')) return offerCommand(user,input);
    if(input.action === 'conversations') {
      const conversations=await db.collection('conversations').find({members:uid}).sort({updatedAt:-1}).limit(100).toArray();
      return Promise.all(conversations.map(async c=>{
        const peer=await db.collection('users').findOne({_id:c.members.find(id=>id!==uid)},{projection:{username:1}});
        const unread=await db.collection('messages').countDocuments({conversationId:c._id,senderId:{$ne:uid},readAt:null});
        return {id:c._id,peerId:peer?._id,username:peer?.username || 'Deleted account',unread,lastMessage:c.lastMessage || ''};
      }));
    }
    if(input.action === 'start') {
      if(typeof input.peerId !== 'string' || input.peerId === uid) throw new ChatError('Choose another account to message.');
      const peer=await db.collection('users').findOne({_id:input.peerId});
      if(!peer) throw new ChatError('This seller does not have a messaging account.');
      const members=[uid,peer._id].sort();
      const id=members.join(':');
      await db.collection('conversations').updateOne({_id:id},{$setOnInsert:{members,updatedAt:new Date()}},{upsert:true});
      return {id};
    }
    if(typeof input.conversationId !== 'string') throw new ChatError('Choose a conversation.');
    const conversation=await db.collection('conversations').findOne({_id:input.conversationId,members:uid});
    if(!conversation) throw new ChatError('Conversation not found.');
    if(input.action === 'history') {
      const filter={conversationId:conversation._id};
      if(input.before) {
        if(typeof input.before !== 'string') throw new ChatError('Invalid cursor.');
        const cursor=await db.collection('messages').findOne({_id:input.before,conversationId:conversation._id});
        if(!cursor) throw new ChatError('Invalid cursor.');
        filter.$or=[{createdAt:{$lt:cursor.createdAt}},{createdAt:cursor.createdAt,_id:{$lt:cursor._id}}];
      }
      return (await db.collection('messages').find(filter).sort({createdAt:-1,_id:-1}).limit(50).toArray()).reverse();
    }
    if(input.action === 'read') {
      // Mark only messages already shown by the client, so a racing delivery stays unread.
      if(!Array.isArray(input.ids) || input.ids.length>100 || !input.ids.every(id=>typeof id==='string')) throw new ChatError('Invalid messages.');
      await db.collection('messages').updateMany({_id:{$in:input.ids},conversationId:conversation._id,senderId:{$ne:uid},readAt:null},{$set:{readAt:new Date()}});
      broadcast([uid],{type:'changed'});
      return {ok:true};
    }
    if(input.action === 'send') {
      if(typeof input.text !== 'string' || !input.text.trim() || input.text.length>2000) throw new ChatError('Messages must contain 1–2000 characters.');
      const message={_id:randomUUID(),conversationId:conversation._id,senderId:uid,text:input.text.trim(),createdAt:new Date(),readAt:null};
      await db.collection('messages').insertOne(message);
      await db.collection('conversations').updateOne({_id:conversation._id},{$set:{lastMessage:message.text,updatedAt:message.createdAt}});
      broadcast(conversation.members,{type:'message',message,username:user.username});
      return message;
    }
    throw new ChatError('Unknown chat action.');
  }
  function attach(server) {
    const wss=new WebSocketServer({server,path:'/realtime',maxPayload:8192});
    wss.on('connection',(ws)=>{
      let user;
      let alive=true;

      let count=0;
      const deadline=setTimeout(()=>ws.close(1008,'Authentication required'),5000);
      ws.on('pong',()=>{alive=true;});
      const heartbeat=setInterval(async()=>{
        try {if(!alive) return ws.terminate();
          if(user && !await valid(user)) return ws.close(1008,'Session ended');alive=false;count=0;ws.ping();}
        catch {ws.close(1011,'Service unavailable');}
      },15000);
      ws.on('message',async raw=>{
        let input;
        try {
          input=JSON.parse(raw.toString());
          if(!input || typeof input !== 'object') throw new ChatError('Invalid message.');
          if(++count>160) throw new ChatError('Please slow down.');

          if(!user) {
            const value=tickets.get(input.ticket);
            tickets.delete(input.ticket);
            if(input.action!=='authenticate' || !value || value.expires<Date.now() || !await valid(value.session)) return ws.close(1008,'Invalid ticket');
            user=value.session;
            clearTimeout(deadline);
            if(!clients.has(user.accountId)) clients.set(user.accountId,new Set());
            clients.get(user.accountId).add(ws);
            send(ws,{type:'ready'});presence();
          } else {
            if(!await valid(user)) return ws.close(1008,'Session ended');
            const data=await command(user,input);
            send(ws,{type:'response',id:input.id,data});
          }
        } catch(error) {send(ws,{type:'response',id:input?.id,error:error instanceof ChatError ? error.message : "Chat is temporarily unavailable."});}

      });
      ws.on('error',()=>{});
      ws.on('close',()=>{
        clearTimeout(deadline);clearInterval(heartbeat);
        if(user) {const sockets=clients.get(user.accountId);sockets?.delete(ws);if(!sockets?.size)clients.delete(user.accountId);presence();}
      });
    });
    return wss;
  }
  return {issue,attach,onlineIds};
}
module.exports={createRealtime};

const { ObjectId } = require('mongodb');

function createOffers(db, broadcast, ChatError) {
  async function terms(input) {
    if(input?.kind === 'item' && typeof input.itemId === 'string') {
      const item=await db.collection('catalog').findOne({_id:input.itemId});
      if(item) return {kind:'item',itemId:item._id,name:item.name,variant:item.variant};
    }
    if(input?.kind === 'price' && ['Bells','Nook Miles Tickets'].includes(input.currency) && Number.isSafeInteger(input.amount) && input.amount>=1 && input.amount<=999999999) return {kind:'price',amount:input.amount,currency:input.currency};
    throw new ChatError('Choose an item or a whole-number amount in Bells or Nook Miles Tickets.');
  }
  const label = value => value.kind==='item' ? `${value.name} (${value.variant})` : `${value.amount.toLocaleString('en-US')} ${value.currency}`;
  async function publish(message, members, user) {
    await db.collection('conversations').updateOne({_id:message.conversationId},{$set:{lastMessage:message.text,updatedAt:new Date()}});
    broadcast(members,{type:'message',message,username:user.username});
    return message;
  }
  return async function offerCommand(user,input) {
    const uid=user.accountId;
    if(input.action==='offer.list') {
      if(typeof input.conversationId!=='string' || !await db.collection('conversations').findOne({_id:input.conversationId,members:uid})) throw new ChatError('Conversation not found.');
      return db.collection('messages').find({conversationId:input.conversationId,'offer.status':'accepted'}).sort({createdAt:-1}).limit(20).toArray();
    }
    if(input.action==='offer.create') {
      if(typeof input.listingId!=='string' || typeof input.requestId!=='string' || !/^[a-f0-9-]{36}$/.test(input.requestId)) throw new ChatError('Invalid offer request.');
      const id=`offer-${uid}-${input.requestId}`;
      const existing=await db.collection('messages').findOne({_id:id});
      if(existing) return existing;
      const listing=await db.collection('listings').findOne({_id:ObjectId.isValid(input.listingId)?{$in:[input.listingId,new ObjectId(input.listingId)]}:input.listingId});
      if(!listing || listing.userId===uid) throw new ChatError('Choose an available listing from another seller.');
      const seller=await db.collection('users').findOne({_id:listing.userId});
      if(!seller) throw new ChatError('This example seller cannot receive offers. Choose a listing from a registered account.');
      let proposal;
      if(input.buy === true) {
        proposal=listing.offerType==='trade' ? await terms({kind:'item',itemId:listing.tradeItem?.itemId}) : await terms({kind:'price',amount:listing.price,currency:listing.currency==='Belle'?'Bells':listing.currency || 'Bells'});
      } else proposal=await terms(input.terms);
      const members=[uid,seller._id].sort();
      const conversationId=members.join(':');
      await db.collection('conversations').updateOne({_id:conversationId},{$setOnInsert:{members,updatedAt:new Date()}},{upsert:true});
      const message={_id:id,conversationId,senderId:uid,createdAt:new Date(),readAt:null,text:`Offer for ${listing.name}: ${label(proposal)}.`,offer:{listingId:String(listing._id),listingName:listing.name,buyerId:uid,sellerId:seller._id,proposerId:uid,recipientId:seller._id,terms:proposal,status:'pending',version:1}};
      try {await db.collection('messages').insertOne(message);} catch(error) {if(error.code===11000)return db.collection('messages').findOne({_id:id});throw error;}
      return publish(message,members,user);
    }
    if(typeof input.messageId!=='string' || !Number.isSafeInteger(input.version)) throw new ChatError('Invalid offer.');
    const message=await db.collection('messages').findOne({_id:input.messageId});
    const offer=message?.offer;
    if(!offer || ![offer.buyerId,offer.sellerId].includes(uid)) throw new ChatError('Offer not found.');
    if(offer.version!==input.version) throw new ChatError('This offer has changed. Reopen the conversation to see the latest offer.');
    const next={...offer,version:offer.version+1};
    let text;
    if(['offer.accept','offer.counter','offer.decline'].includes(input.action)) {
      if(offer.status!=='pending' || offer.recipientId!==uid) throw new ChatError('Only the recipient can respond to a pending offer.');
      if(input.action==='offer.counter') {
        next.terms=await terms(input.terms);next.proposerId=uid;next.recipientId=offer.proposerId;
        text=`Counteroffer for ${offer.listingName}: ${label(next.terms)}.`;
      } else {
        next.status=input.action==='offer.accept'?'accepted':'declined';
        if(next.status==='accepted')next.hostId=offer.sellerId;
        text=next.status==='accepted'?`Offer accepted for ${offer.listingName}: ${label(offer.terms)}. Waiting for the host’s Dodo Code.`:`Offer declined for ${offer.listingName}.`;
      }
    } else if(input.action==='offer.requestCode') {
      if(offer.status!=='accepted' || offer.buyerId!==uid || !offer.dodoCode) throw new ChatError('Only the buyer can request a replacement for a shared code.');
      if(!offer.codeRequestAvailableAt || Date.now()<Date.parse(offer.codeRequestAvailableAt)) throw new ChatError('You can ask for a new code 120 seconds after it is shared.');
      if(offer.codeRequested) throw new ChatError('A new code has already been requested.');
      next.codeRequested=true;
      text=`The buyer requested a new Dodo Code for ${offer.listingName}.`;
    } else if(input.action==='offer.code') {
      if(offer.status!=='accepted' || offer.hostId!==uid) throw new ChatError('Only the seller can share the airport code after acceptance.');
      if(typeof input.code!=='string' || !/^[A-Z0-9]{5}$/.test(input.code.trim().toUpperCase())) throw new ChatError('Enter the five-character Dodo Code from your in-game airport.');
      next.dodoCode=input.code.trim().toUpperCase();
      next.codeRequestAvailableAt=new Date(Date.now()+120000).toISOString();
      next.codeRequested=false;
      text=`Dodo Code shared for ${offer.listingName}. Open this conversation to view it.`;
    } else throw new ChatError('Unknown offer action.');
    const updated=await db.collection('messages').findOneAndUpdate({_id:message._id,'offer.version':input.version},{$set:{offer:next,text,senderId:uid,readAt:null}},{returnDocument:'after'});
    if(!updated) throw new ChatError('Someone has already updated this offer. Reopen the conversation.');
    return publish(updated,[offer.buyerId,offer.sellerId],user);
  };
}
module.exports={createOffers};

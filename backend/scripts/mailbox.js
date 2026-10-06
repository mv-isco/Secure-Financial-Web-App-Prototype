'use strict';
const config=require('../config');
const {createStore}=require('../store/database');
if(config.isProd)throw new Error('Local development mailbox is disabled in production.');
const email=process.argv[2]?.trim().toLowerCase();
if(!email)throw new Error('Usage: npm run mailbox -- <your-email>');
const store=createStore();
try{
 const messages=store.mailMessages(email);
 if(!messages.length)throw new Error('No recent verification message for this address.');
 console.log('Local email verification link (expires after 30 minutes):');
 console.log(config.cors.origins[0]+'/register?ticket='+messages.at(-1).ticket);
}finally{store.close();}

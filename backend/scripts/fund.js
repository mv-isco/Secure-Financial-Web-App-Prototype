'use strict';
const config=require('../config');
const {createStore}=require('../store/database');
const {toCents}=require('../utils/money');
if(config.isProd)throw new Error('Local test funding is disabled in production. Production funding requires a verified settlement integration.');
const [accountId,amount,reason]=process.argv.slice(2);
if(!accountId||!amount||!reason)throw new Error('Usage: npm run fund -- <account-id> <amount> <funding-reason>');
const store=createStore();
try{console.log('Recorded test funding: '+store.fund(accountId,toCents(amount),reason));}finally{store.close();}

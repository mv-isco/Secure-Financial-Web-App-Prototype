'use strict';
const {createStore}=require('../store/database');
const otp=require('../services/twoFactorService');
const [userId,caseReference,confirmation]=process.argv.slice(2);
if(!userId||!caseReference||confirmation!=='--identity-verified')throw new Error('Usage: npm run reset-2fa -- <user-id> <support-case> --identity-verified. Verify the customer identity outside this tool first.');
const store=createStore();
try{
 const codes=store.atomic(()=>{
  const user=store.userById(userId);if(!user?.isActive)throw new Error('Account unavailable.');
  store.revokeAll(userId);store.replaceSecret(userId,otp.generateSecret(user.email).base32);
  const codes=store.recoveryCodes(userId);store.audit('AUTH:SUPPORT_RESET',userId,{reference:caseReference});return codes;
 });
 console.log('Provide these single-use recovery codes securely to the verified customer. They still need their password.');
 console.log(codes.join('\n'));
}finally{store.close();}

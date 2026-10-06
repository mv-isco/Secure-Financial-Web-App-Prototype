'use strict';
const express=require('express');
const authenticate=require('../middleware/authenticate');
const limiter=require('../middleware/rateLimiter');
const {transferRules,paginationRules}=require('../middleware/validate');
const {toCents,transactionDTO}=require('../utils/money');
const otp=require('../services/twoFactorService');
const R=require('../utils/apiResponse');
module.exports=function transactionRoutes(store){
 const router=express.Router();router.use(authenticate);
 router.get('/attempts/:key',(req,res)=>{
  if(!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(req.params.key))return R.badRequest(res,'Invalid transfer key.');
  const row=store.get('SELECT status,response FROM idempotency WHERE userId=? AND key=?',req.user.id,req.params.key);
  return row?R.ok(res,{status:row.status,result:JSON.parse(row.response)}):R.notFound(res,'No completed result is available yet. Retry with the original details and saved key.');
 });
 router.post('/recipient',limiter('recipient-account',20,900000,true),(req,res)=>{
  if(typeof req.body?.accountNumber!=='string'||!/^\d{12}$/.test(req.body.accountNumber))return R.badRequest(res,'Enter a 12-digit account number.');
  const recipient=store.confirmRecipient(req.user.id,req.body.accountNumber);
  return recipient?R.ok(res,recipient):R.unprocessable(res,'Recipient account unavailable.');
 });
 router.post('/transfer',limiter('transfer-ip',20),limiter('transfer-account',10,900000,true),transferRules,(req,res)=>{
  const payload={...req.body,amountCents:toCents(req.body.amount)};
  const result=store.transfer(req.user.id,payload,()=>{
   const check=otp.verifyForUser(store,req.user.id,req.body.token);
   return check.ok?null:{status:check.locked?429:422,body:{success:false,code:check.locked?'TOTP_LOCKED':'STEP_UP_REQUIRED',message:'Invalid, expired or already used authenticator code. Wait for a new code.'}};
  });
  return res.status(result.status).json(result.body);
 });
 router.get('/',paginationRules,(req,res)=>{
  if(req.query.category!==undefined&&(typeof req.query.category!=='string'||req.query.category.length>64))return R.badRequest(res,'Invalid category filter.');
  const limit=Number(req.query.limit||50),offset=Number(req.query.offset||0);
  const {total,records}=store.history(req.user.id,{limit,offset,category:req.query.category});
  return R.ok(res,{transactions:records},'OK',{total,limit,offset,hasMore:offset+records.length<total});
 });
 router.get('/:id',(req,res)=>{const tx=store.get('SELECT * FROM transactions WHERE id=? AND userId=?',req.params.id,req.user.id);return tx?R.ok(res,transactionDTO(tx)):R.notFound(res);});
 return router;
};

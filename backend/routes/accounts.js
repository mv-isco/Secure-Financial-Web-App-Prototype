'use strict';
const express=require('express');
const authenticate=require('../middleware/authenticate');
const {paginationRules,testFundingRules}=require('../middleware/validate');
const config=require('../config');
const limiter=require('../middleware/rateLimiter');
const {toCents}=require('../utils/money');
const R=require('../utils/apiResponse');
const dto=a=>({id:a.id,label:a.label,accountNumber:a.accountNumber,balance:a.balanceCents/100,currency:a.currency,type:a.type,status:a.status});
module.exports=function accountsRoutes(store){
 const router=express.Router();router.use(authenticate);
 router.get('/',(req,res)=>{const accounts=store.accounts(req.user.id);return R.ok(res,{accounts:accounts.map(dto),totalBalance:accounts.reduce((s,a)=>s+a.balanceCents,0)/100,currency:'USD',count:accounts.length});});
 router.post('/:id/test-funds',(req,res,next)=>config.isProd||!config.testFunding.enabled?R.notFound(res):next(),limiter('test-funding-account',20,900000,true),testFundingRules,(req,res)=>{
  const result=store.testFund(req.user.id,{accountId:req.params.id,amountCents:toCents(req.body.amount),idempotencyKey:req.body.idempotencyKey});
  return res.status(result.status).json(result.body);
 });
 router.get('/:id',(req,res)=>{const a=store.account(req.params.id);return a?.userId===req.user.id?R.ok(res,dto(a)):R.notFound(res);});
 router.get('/:id/transactions',paginationRules,(req,res)=>{
  const a=store.account(req.params.id);if(a?.userId!==req.user.id)return R.notFound(res);
  const limit=Number(req.query.limit||50),offset=Number(req.query.offset||0);
  const {total,records}=store.history(req.user.id,{accountId:a.id,limit,offset});
  return R.ok(res,{transactions:records},'OK',{total,limit,offset,hasMore:offset+records.length<total});
 });
 return router;
};

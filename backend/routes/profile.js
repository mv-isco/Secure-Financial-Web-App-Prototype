'use strict';
const express=require('express');
const authenticate=require('../middleware/authenticate');
const limiter=require('../middleware/rateLimiter');
const {profileRules,passwordChangeRules}=require('../middleware/validate');
const password=require('../services/passwordService');
const otp=require('../services/twoFactorService');
const jwt=require('../services/jwtService');
const config=require('../config');
const R=require('../utils/apiResponse');
const userDTO=user=>({id:user.id,name:user.name,email:user.email,twoFactorEnabled:user.twoFactorEnabled,createdAt:user.createdAt});
module.exports=function profileRoutes(store){
 const router=express.Router();router.use(authenticate);
 router.get('/',(req,res)=>R.ok(res,{
  user:userDTO(req.user),
  security:{recoveryCodesRemaining:store.get('SELECT COUNT(*) AS n FROM recovery_codes WHERE userId=? AND used=0',req.user.id).n},
  sessions:store.all('SELECT id,expiresAt FROM sessions WHERE userId=? AND revoked=0 AND expiresAt>? ORDER BY expiresAt DESC',req.user.id,Date.now()).map(s=>({...s,current:s.id===req.sessionId})),
  activity:store.auditRecords(req.user.id,10,0),
  testFunding:{enabled:!config.isProd&&config.testFunding.enabled,singleLimit:config.testFunding.singleLimitCents/100,dailyLimit:config.testFunding.dailyLimitCents/100,balanceLimit:config.testFunding.balanceLimitCents/100},
 }));
 router.patch('/',limiter('profile-account',20,900000,true),profileRules,(req,res)=>{
  const user=store.atomic(()=>{
   store.run('UPDATE users SET name=? WHERE id=?',req.body.name,req.user.id);
   store.audit('PROFILE:NAME_UPDATED',req.user.id);
   return store.userById(req.user.id);
  });
  return R.ok(res,{user:userDTO(user)},'Profile updated.');
 });
 router.post('/password',limiter('password-change-account',5,900000,true),passwordChangeRules,async(req,res)=>{
  if(!await password.compare(req.body.currentPassword,req.user.passwordHash))return R.unprocessable(res,'Current password is incorrect.');
  if(req.body.currentPassword===req.body.newPassword)return R.badRequest(res,'Choose a different new password.');
  const newHash=await password.hash(req.body.newPassword);
  const outcome=store.atomic(()=>{
   const current=store.userById(req.user.id);
   if(current?.passwordHash!==req.user.passwordHash||!store.activeSession(req.sessionId,req.user.id))return {changed:true};
   const check=otp.verifyForUser(store,current.id,req.body.token);
   if(!check.ok)return {error:check};
   store.run('UPDATE users SET passwordHash=? WHERE id=?',newHash,current.id);
   store.revokeAll(current.id);
   store.run('UPDATE challenges SET used=1 WHERE userId=?',current.id);
   store.run('UPDATE registrations SET claimed=1 WHERE email=? COLLATE NOCASE',current.email);
   store.audit('PROFILE:PASSWORD_CHANGED',current.id);
   return {ok:true};
  });
  if(outcome.changed)return R.conflict(res,'Account or session changed. Sign in again.');
  if(outcome.error)return outcome.error.locked?R.tooManyRequests(res,'Authenticator temporarily locked. Try again in 15 minutes.'):R.unprocessable(res,'Invalid, expired or already used authenticator code. Wait for a new code.');
  jwt.clearRefreshCookie(res);
  return R.ok(res,{},'Password changed. Sign in again on all devices.');
 });
 router.delete('/sessions/:id',(req,res)=>{
  const session=store.get('SELECT id FROM sessions WHERE id=? AND userId=? AND revoked=0 AND expiresAt>?',req.params.id,req.user.id,Date.now());
  if(!session)return R.notFound(res);
  store.atomic(()=>{store.revokeSession(session.id);store.audit('AUTH:SESSION_REVOKED',req.user.id,{sessionId:session.id});});
  const current=session.id===req.sessionId;
  if(current)jwt.clearRefreshCookie(res);
  return R.ok(res,{current},'Session signed out.');
 });
 return router;
};

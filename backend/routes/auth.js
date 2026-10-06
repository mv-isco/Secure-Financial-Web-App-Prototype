'use strict';
const express = require('express');
const { randomUUID } = require('node:crypto');
const password = require('../services/passwordService');
const jwt = require('../services/jwtService');
const otp = require('../services/twoFactorService');
const authenticate = require('../middleware/authenticate');
const limiter = require('../middleware/rateLimiter');
const { registerRules, loginRules, twoFactorRules } = require('../middleware/validate');
const { body, validationResult } = require('express-validator');
const R = require('../utils/apiResponse');
const config = require('../config');
function cookieRequest(req,res,next) {
  let origin = req.get('Origin');
  if (!origin && req.get('Referer')) { try { origin = new URL(req.get('Referer')).origin; } catch {} }
  if (req.get('X-SecureVault-Request') !== '1' || !config.cors.origins.includes(origin)) return R.forbidden(res, 'Untrusted request origin.');
  next();
}
module.exports = function authRoutes(store) {
  const router = express.Router();
  const ip = scope => limiter(scope,10);
  const account = scope => limiter(scope,10,900000,true);
  function challenge(type,id) {
    const token = jwt.sign(type,id); store.challenge(jwt.verify(token,type)); return token;
  }
  function enrollment(user) {
    const secret = user?.twoFactorSecret || otp.generateSecret('enrollment').base32;
    const id = user?.id || 'usr_'+randomUUID();
    return { enrollmentToken: user ? challenge('enrollment',id) : jwt.sign('enrollment',id),
      twoFactor: { secret, otpAuthUrl: require('otplib').generateURI({ issuer:'SecureVault', label: user?.email || 'SecureVault', secret }) } };
  }
  function mint(id,sid) {
    const accessToken=jwt.sign('access',id,{sid,twoFa:true});
    const refreshToken=jwt.sign('refresh',id,{sid});
    store.addRefresh(refreshToken,jwt.verify(refreshToken,'refresh'));
    return {accessToken,refreshToken,tokenType:'Bearer',expiresIn:900};
  }
  function sendSession(res,user,pair,extra={}) {
    jwt.setRefreshCookie(res,pair.refreshToken);
    const {refreshToken,...data}=pair;
    return R.ok(res,{...data,user:{id:user.id,name:user.name,email:user.email,twoFactorEnabled:user.twoFactorEnabled},...extra});
  }
  function preauth(type,field) {
    return (req,res,next)=>{
      try {
        if(typeof req.body?.[field]!=='string') return R.unauthorized(res,'Password verification required.');
        const claims=jwt.verify(req.body[field],type);
        if(req.body.userId && req.body.userId!==claims.sub) return R.unauthorized(res,'Invalid challenge.');
        const user=store.userById(claims.sub);
        if(!user?.isActive||!store.validChallenge(claims)) return R.unauthorized(res,'Challenge expired or already used.');
        req.challenge=claims; req.user=user; next();
      } catch { return R.unauthorized(res,'Invalid or expired challenge.'); }
    };
  }
  const failure = (res,auth) => auth.locked ? R.tooManyRequests(res,'Authenticator temporarily locked. Try again in 15 minutes.') : R.unauthorized(res,'Invalid, expired or already used authenticator code. Wait for a new code.');

  router.post('/register',ip('register'),account('register-account'),registerRules,async(req,res)=>{
    const {name,email,password:plain}=req.body;
    const passwordHash=await password.hash(plain);
    const secret=otp.generateSecret(email);
    // Identical work and response for every address. Only the mailbox owner receives the proof.
    store.beginRegistration({name,email,passwordHash,twoFactorSecret:secret.base32});
    return R.created(res,{nextStep:'check-email'},'Check your email to continue. If you already have an account, sign in.');
  });

  router.post('/claim-registration',limiter('claim-ip',10),limiter('claim-proof',10,900000,req=>typeof req.body?.ticket==='string'?req.body.ticket.slice(0,64):req.ip),async(req,res)=>{
    if(typeof req.body?.ticket!=='string'||!/^[a-f0-9]{64}$/.test(req.body.ticket))return R.unauthorized(res,'Invalid email verification link.');
    const proof=store.registrationForTicket(req.body.ticket);
    if(!proof) return R.unauthorized(res,'Email verification link expired or already used.');
    if(typeof req.body.password!=='string'||Buffer.byteLength(req.body.password,'utf8')>72) return R.badRequest(res,'Enter the password you chose when requesting this link.');
    if(!await password.compare(req.body.password,proof.passwordHash)) return R.unauthorized(res,'Invalid verification link or password.');
    const result=store.claimRegistration(req.body.ticket,proof.passwordHash);
    if(!result)return R.unauthorized(res,'Email verification link expired or already used.');
    if(result.alreadyRegistered)return R.ok(res,{alreadyRegistered:true},'Please sign in to your existing account.');
    return R.ok(res,enrollment(result.user));
  });

  router.post('/login',ip('login-ip'),account('login-account'),loginRules,async(req,res)=>{
    const user=store.userByEmail(req.body.email);
    const matches=await password.compare(req.body.password,user?.passwordHash);
    if(!user?.isActive||!matches) { store.audit('AUTH:LOGIN_FAILURE',null); return R.unauthorized(res,'Invalid credentials.'); }
    if(!user.twoFactorEnabled && !user.recoveryPending) {
      store.beginRegistration({name:user.name,email:user.email,passwordHash:user.passwordHash,twoFactorSecret:otp.generateSecret(user.email).base32,purpose:'enrollment'});
      return R.ok(res,{nextStep:'check-email',requiresEmailVerification:true},'Check your email to finish authenticator enrollment.');
    }
    if(user.recoveryPending) return R.ok(res,{preAuthToken:challenge('preauth',user.id),twoFactorRequired:true,recoveryRequired:true});
    return R.ok(res,{preAuthToken:challenge('preauth',user.id),twoFactorRequired:true},'Enter your authenticator code.');
  });

  router.post('/verify-2fa',limiter('2fa-ip',20),preauth('preauth','preAuthToken'),twoFactorRules,(req,res)=>{
    const outcome=store.atomic(()=>{
      if(!store.validChallenge(req.challenge)) return {error:{ok:false}};
      if(!req.user.twoFactorEnabled) return {error:{ok:false}};
      const check=otp.verifyForUser(store,req.user.id,req.body.token);
      if(!check.ok) return {error:check};
      if(!store.consumeChallenge(req.challenge)) throw new Error('Challenge changed.');
      const pair=mint(req.user.id,store.newSession(req.user.id));
      store.audit('AUTH:2FA_SUCCESS',req.user.id);
      return {pair};
    });
    if(outcome.error) return failure(res,outcome.error);
    return sendSession(res,req.user,outcome.pair);
  });

  router.post('/setup-2fa',limiter('enrollment-ip',20),preauth('enrollment','enrollmentToken'),twoFactorRules,(req,res)=>{
    const outcome=store.atomic(()=>{
      const user=store.userById(req.user.id);
      if(!store.validChallenge(req.challenge)||user.twoFactorEnabled) return {error:{ok:false}};
      const check=otp.verifyForUser(store,user.id,req.body.token); if(!check.ok) return {error:check};
      store.consumeChallenge(req.challenge); store.enableTwoFactor(user.id);
      // All outstanding enrollment challenges are unusable once 2FA is enabled.
      const recoveryCodes=store.recoveryCodes(user.id);
      store.audit('AUTH:2FA_ENROLLED',user.id);
      return {pair:mint(user.id,store.newSession(user.id)),recoveryCodes};
    });
    if(outcome.error) return failure(res,outcome.error);
    return sendSession(res,store.userById(req.user.id),outcome.pair,{twoFactorEnabled:true,recoveryCodes:outcome.recoveryCodes});
  });

  router.post('/recover-2fa',limiter('recovery-ip',10),preauth('preauth','preAuthToken'),
    body('recoveryCode').isString().bail().matches(/^[a-f0-9]{32}$/),(req,res)=>{
    if(!validationResult(req).isEmpty()) return R.badRequest(res,'Invalid recovery code format.');
    const outcome=store.atomic(()=>{
      const user=store.userById(req.user.id);
      if(!store.validChallenge(req.challenge)||user.lockedUntil>Date.now()) return null;
      if(!store.useRecovery(user.id,req.body.recoveryCode)) { store.otpFailure(user.id); return null; }
      store.consumeChallenge(req.challenge); store.revokeAll(user.id);
      const secret=otp.generateSecret(user.email);
      store.replaceSecret(user.id,secret.base32);
      store.audit('AUTH:2FA_RECOVERED',user.id);
      return enrollment(store.userById(user.id));
    });
    return outcome ? R.ok(res,outcome) : R.unauthorized(res,'Invalid recovery challenge or code.');
  });

  router.post('/refresh',cookieRequest,limiter('refresh-ip',30),(req,res)=>{
    try {
      const token=req.cookies.refreshToken;
      if(!token) return R.unauthorized(res);
      const claims=jwt.verify(token,'refresh'),user=store.userById(claims.sub);
      if(!user?.isActive||!user.twoFactorEnabled) return R.unauthorized(res);
      const pair=store.rotateRefresh(token,claims,mint);
      if(!pair) { jwt.clearRefreshCookie(res); return R.unauthorized(res,'Session revoked. Sign in again.'); }
      return sendSession(res,user,pair);
    } catch { jwt.clearRefreshCookie(res); return R.unauthorized(res,'Session expired.'); }
  });

  router.post('/logout',cookieRequest,(req,res)=>{
    store.atomic(()=>{
      const candidates = [
        {token:req.cookies.refreshToken,type:'refresh'},
        {token:req.get('Authorization')?.slice(7),type:'access'}
      ];
      for(const c of candidates) {
        if(!c.token) continue;
        try { const claims=jwt.verify(c.token,c.type); store.revokeSession(claims.sid); store.audit('AUTH:LOGOUT',claims.sub); } catch {}
      }
    });
    jwt.clearRefreshCookie(res); return R.ok(res,{},'Signed out.');
  });
  router.post('/logout-all',authenticate,(req,res)=>{ store.atomic(()=>{store.revokeAll(req.user.id);store.audit('AUTH:LOGOUT_ALL',req.user.id);}); jwt.clearRefreshCookie(res); return R.ok(res); });
  router.get('/sessions',authenticate,(req,res)=>R.ok(res,{sessions:store.all('SELECT id,expiresAt FROM sessions WHERE userId=? AND revoked=0 AND expiresAt>?',req.user.id,Date.now()).map(s=>({...s,current:s.id===req.sessionId}))}));
  router.get('/me',authenticate,(req,res)=>R.ok(res,{id:req.user.id,name:req.user.name,email:req.user.email,twoFactorEnabled:req.user.twoFactorEnabled,createdAt:req.user.createdAt}));
  return router;
};

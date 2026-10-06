'use strict';
process.env.NODE_ENV='test';process.env.BCRYPT_ROUNDS='4';
const {randomBytes,randomUUID}=require('node:crypto');
for(const key of ['JWT_ACCESS_SECRET','JWT_REFRESH_SECRET','JWT_PREAUTH_SECRET','DATA_ENCRYPTION_KEY'])process.env[key]=randomBytes(32).toString('hex');
const request=require('supertest');
const {createApp}=require('../app');
const {createStore}=require('../store/database');
const jwt=require('../services/jwtService');
const otp=require('../services/twoFactorService');
const password=require('../services/passwordService');
const config=require('../config');
const {toCents}=require('../utils/money');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {spawn,execFileSync}=require('node:child_process');
let store,app,alice,bob,source,target,access,now,clock;
const plain='Abc<b>def</b>1!';
const origin='http://localhost:3000';
function api(){return request(app);}
function cookiePost(url,cookie){const req=api().post(url).set('Origin',origin).set('X-SecureVault-Request','1');return cookie?req.set('Cookie',cookie):req;}
function tokenFor(user){now+=31000;return otp.generateCurrentToken(user.twoFactorSecret);}
function accessFor(user){
 const sid=store.newSession(user.id),token=jwt.sign('refresh',user.id,{sid});store.addRefresh(token,jwt.verify(token,'refresh'));
 return {access:jwt.sign('access',user.id,{sid,twoFa:true}),cookie:'refreshToken='+token,sid,refresh:token};
}
async function fixture(email,name){
 const secret=otp.generateSecret(email).base32;
 const user=store.createUser({email,name,passwordHash:await password.hash(plain),twoFactorSecret:secret});
 store.enableTwoFactor(user.id);return store.userById(user.id);
}
function payload(extra={}){return {fromAccountId:source.id,toAccountNumber:target.accountNumber,amount:'19.99',note:'Rent – José',idempotencyKey:randomUUID(),token:tokenFor(alice),...extra};}
function transfer(body,auth=access){return api().post('/api/transactions/transfer').set('Authorization','Bearer '+auth).send(body);}
async function login(user=alice,pw=plain){
 return api().post('/api/auth/login').send({email:user.email,password:pw});
}
async function session(user=alice){
 const first=await login(user);expect(first.status).toBe(200);
 return api().post('/api/auth/verify-2fa').send({preAuthToken:first.body.data.preAuthToken,token:tokenFor(user)});
}
beforeEach(async()=>{
 now=Date.now();clock=jest.spyOn(Date,'now').mockImplementation(()=>now);
 store=createStore(':memory:');app=createApp({store,rateLimit:false});
 alice=await fixture('john.doe+bank@gmail.com','José 李');bob=await fixture('bob@example.com','Bob Smith');
 source=store.accounts(alice.id)[0];target=store.accounts(bob.id)[0];store.fund(source.id,20000000,'Test opening deposit');
 access=accessFor(alice).access;
});
afterEach(()=>{store.close();clock.mockRestore();});

describe('Profile and account security',()=>{
 const profile=()=>api().get('/api/profile').set('Authorization','Bearer '+access);
 const change=body=>api().post('/api/profile/password').set('Authorization','Bearer '+access).send(body);
 test('profile is private and exposes only this user and safe security information',async()=>{
  const other=accessFor(bob);store.recoveryCodes(alice.id);store.audit('PRIVATE_BOB_EVENT',bob.id);
  expect((await api().get('/api/profile')).status).toBe(401);
  const result=await profile();expect(result.status).toBe(200);
  expect(result.body.data.user.email).toBe(alice.email);expect(result.body.data.security.recoveryCodesRemaining).toBe(8);
  expect(result.body.data.sessions).toHaveLength(1);expect(result.body.data.sessions[0].current).toBe(true);
  expect(result.body.data.sessions.map(s=>s.id)).not.toContain(other.sid);
  for(const secret of [alice.passwordHash,alice.twoFactorSecret,bob.email,'PRIVATE_BOB_EVENT'])expect(JSON.stringify(result.body)).not.toContain(secret);
 });
 test('profile name updates preserve Unicode and cannot change email, password or role',async()=>{
  const result=await api().patch('/api/profile').set('Authorization','Bearer '+access).send({name:'  Мария Иванова  ',email:'attacker@example.com',role:'admin',passwordHash:'x',userId:bob.id});
  expect(result.status).toBe(200);expect(result.body.data.user.name).toBe('Мария Иванова');
  const current=store.userById(alice.id);expect(current.email).toBe(alice.email);expect(current.role).toBe('user');expect(current.passwordHash).toBe(alice.passwordHash);
  expect(store.userById(bob.id).name).toBe(bob.name);expect(store.auditRecords(alice.id,20,0).some(a=>a.event==='PROFILE:NAME_UPDATED')).toBe(true);
 });
 test.each(['A','<script>alert(1)</script>',[],null,'A'.repeat(61)])('rejects invalid profile name %p',async name=>{
  expect((await api().patch('/api/profile').set('Authorization','Bearer '+access).send({name})).status).toBe(400);expect(store.userById(alice.id).name).toBe(alice.name);
 });
 test('only an owned session can be revoked; other sessions remain usable',async()=>{
  const second=accessFor(alice),foreign=accessFor(bob);
  expect((await api().delete('/api/profile/sessions/'+foreign.sid).set('Authorization','Bearer '+access)).status).toBe(404);
  const result=await api().delete('/api/profile/sessions/'+second.sid).set('Authorization','Bearer '+access);
  expect(result.status).toBe(200);expect(result.body.data.current).toBe(false);expect(store.activeSession(second.sid,alice.id)).toBe(false);
  expect(store.activeSession(foreign.sid,bob.id)).toBe(true);expect((await profile()).status).toBe(200);
 });
 test('revoking the current session clears its cookie and rejects further access',async()=>{
  const current=(await profile()).body.data.sessions[0].id;
  const result=await api().delete('/api/profile/sessions/'+current).set('Authorization','Bearer '+access);
  expect(result.body.data.current).toBe(true);expect(result.headers['set-cookie'][0]).toContain('refreshToken=;');expect((await profile()).status).toBe(401);
 });
 test('changing the password revokes every session and old password challenges',async()=>{
  const other=accessFor(alice),first=await login();const savedRecovery=store.recoveryCodes(alice.id);
  store.beginRegistration({name:alice.name,email:alice.email,passwordHash:alice.passwordHash,twoFactorSecret:alice.twoFactorSecret,purpose:'enrollment'});
  const result=await change({currentPassword:plain,newPassword:'NewSecure@123',token:tokenFor(alice)});
  expect(result.status).toBe(200);expect(result.headers['set-cookie'][0]).toContain('refreshToken=;');
  const current=store.userById(alice.id);expect(await password.compare('NewSecure@123',current.passwordHash)).toBe(true);
  expect(current.twoFactorSecret).toBe(alice.twoFactorSecret);expect(current.twoFactorEnabled).toBe(true);
  expect(store.activeSession(other.sid,alice.id)).toBe(false);expect((await profile()).status).toBe(401);
  expect((await cookiePost('/api/auth/refresh',other.cookie)).status).toBe(401);
  expect((await login(alice,plain)).status).toBe(401);expect((await login(alice,'NewSecure@123')).status).toBe(200);
  expect((await api().post('/api/auth/verify-2fa').send({preAuthToken:first.body.data.preAuthToken,token:tokenFor(alice)})).status).toBe(401);
  expect(store.get('SELECT COUNT(*) AS n FROM recovery_codes WHERE userId=? AND used=0',alice.id).n).toBe(savedRecovery.length);
  expect(store.get('SELECT COUNT(*) AS n FROM registrations WHERE email=? AND claimed=0',alice.email).n).toBe(0);
 });
 test('incorrect current password does not consume the code or change the account',async()=>{
  const code=tokenFor(alice);expect((await change({currentPassword:'Incorrect@123',newPassword:'NewSecure@123',token:code})).status).toBe(422);
  expect(store.userById(alice.id).passwordHash).toBe(alice.passwordHash);expect((await profile()).status).toBe(200);
  expect((await change({currentPassword:plain,newPassword:'NewSecure@123',token:code})).status).toBe(200);
 });
 test('password change requires a fresh code and keeps authenticator protection',async()=>{
  const actual=tokenFor(alice),wrong=actual==='000000'?'111111':'000000';
  expect((await change({currentPassword:plain,newPassword:'NewSecure@123',token:wrong})).status).toBe(422);
  expect(store.userById(alice.id).passwordHash).toBe(alice.passwordHash);expect(store.userById(alice.id).otpFailures).toBe(1);
  expect(store.userById(alice.id).twoFactorEnabled).toBe(true);expect((await profile()).status).toBe(200);
 });
 test.each(['short','alllowercase1!','NoNumber!','NoSymbol123','Ж'.repeat(40)+'A1!'])('rejects weak or bcrypt-truncated new passwords %p',async newPassword=>{
  expect((await change({currentPassword:plain,newPassword,token:tokenFor(alice)})).status).toBe(400);expect(store.userById(alice.id).passwordHash).toBe(alice.passwordHash);
 });
 test('a session revoked while hashing cannot change the password',async()=>{
  const original=password.hash,current=(await profile()).body.data.sessions[0].id;
  const mock=jest.spyOn(password,'hash').mockImplementation(async value=>{store.revokeSession(current);return original(value);});
  try{expect((await change({currentPassword:plain,newPassword:'NewSecure@123',token:tokenFor(alice)})).status).toBe(409);expect(store.userById(alice.id).passwordHash).toBe(alice.passwordHash);}finally{mock.mockRestore();}
 });
});

describe('Artificial local account funding',()=>{
 const topup=(amount='19.99',key=randomUUID(),account=source.id,auth=access)=>api().post('/api/accounts/'+account+'/test-funds').set('Authorization','Bearer '+auth).send({amount,idempotencyKey:key});
 test.each(['19.99','0.29','1.15'])('credits exact cents for %s and records balanced ledger/history/audit',async amount=>{
  const result=await topup(amount);expect(result.status).toBe(201);expect(store.account(source.id).balanceCents).toBe(20000000+toCents(amount));
  expect(result.body.data.transaction.category).toBe('Test funding');expect(result.body.data.transaction.type).toBe('credit');expect(result.body.data.transaction.amount).toBe(Number(amount));expect(store.reconcile().ok).toBe(true);
  expect(store.auditRecords(alice.id,20,0).some(a=>a.event==='ACCOUNT:TEST_FUNDED')).toBe(true);
 });
 test('repeated requests and result recovery return one credit',async()=>{
  const key=randomUUID(),first=await topup('19.99',key),second=await topup('19.99',key);
  expect(second.body).toEqual(first.body);expect(second.status).toBe(201);expect(store.account(source.id).balanceCents).toBe(20001999);
  const recovered=await api().get('/api/transactions/attempts/'+key).set('Authorization','Bearer '+access);expect(recovered.body.data.result).toEqual(first.body);expect(store.reconcile().ok).toBe(true);
 });
 test('a top-up key is bound to user, account, amount and operation',async()=>{
  const key=randomUUID();await topup('19.99',key);expect((await topup('20.00',key)).status).toBe(409);
  expect((await topup('19.99',key,store.accounts(alice.id)[1].id)).status).toBe(409);expect((await transfer(payload({idempotencyKey:key}))).status).toBe(409);
  expect((await topup('19.99',key,target.id,accessFor(bob).access)).status).toBe(201);expect(store.account(source.id).balanceCents).toBe(20001999);expect(store.account(target.id).balanceCents).toBe(1999);
 });
 test('cannot fund another user, a missing account, treasury or an unauthenticated account',async()=>{
  for(const account of [target.id,'missing','treasury'])expect((await topup('10',randomUUID(),account)).status).toBe(404);
  expect((await api().post('/api/accounts/'+source.id+'/test-funds').send({amount:'10',idempotencyKey:randomUUID()})).status).toBe(401);
  expect(store.account(source.id).balanceCents).toBe(20000000);expect(store.account(target.id).balanceCents).toBe(0);
 });
 test('frozen accounts cannot be funded and the rejected intent stays rejected on retry',async()=>{
  const key=randomUUID();store.run("UPDATE accounts SET status='frozen' WHERE id=?",source.id);const first=await topup('10',key);expect(first.status).toBe(422);
  store.run("UPDATE accounts SET status='active' WHERE id=?",source.id);expect((await topup('10',key)).body).toEqual(first.body);expect(store.account(source.id).balanceCents).toBe(20000000);
 });
 test.each([0,-1,'1.001','1e1',50000.01,true,null,{},[]])('rejects invalid funding amount %p',async amount=>{
  expect((await topup(amount)).status).toBe(400);expect(store.account(source.id).balanceCents).toBe(20000000);
 });
 test('requires a UUID v4 retry key',async()=>{expect((await topup('10','invalid')).status).toBe(400);});
 test('daily limit is shared between accounts and resets after 24 hours',async()=>{
  expect((await topup('50000')).status).toBe(201);expect((await topup('50000',randomUUID(),store.accounts(alice.id)[1].id)).status).toBe(201);
  expect((await topup('0.01')).status).toBe(422);now+=86400001;expect((await topup('0.01',randomUUID(),source.id,accessFor(alice).access)).status).toBe(201);
 });
 test('caps the resulting account balance',async()=>{
  store.fund(source.id,80000000,'Balance cap fixture');expect((await topup('0.01')).status).toBe(422);expect(store.account(source.id).balanceCents).toBe(100000000);
 });
 test('an audit failure rolls back the credit, treasury, transaction and retry record',async()=>{
  store.db.exec("CREATE TRIGGER fail_test_audit BEFORE INSERT ON audit WHEN NEW.event='ACCOUNT:TEST_FUNDED' BEGIN SELECT RAISE(ABORT,'Fixture failure'); END;");
  const key=randomUUID(),log=jest.spyOn(console,'error').mockImplementation(()=>{});try{expect((await topup('19.99',key)).status).toBe(500);}finally{log.mockRestore();}
  expect(store.account(source.id).balanceCents).toBe(20000000);expect(store.get('SELECT key FROM idempotency WHERE key=?',key)).toBeUndefined();expect(store.reconcile().ok).toBe(true);
 });
 test('production hides the UI capability and rejects HTTP and store funding',async()=>{
  const previous=config.isProd;config.isProd=true;
  try{expect((await api().get('/api/profile').set('Authorization','Bearer '+access)).body.data.testFunding.enabled).toBe(false);expect((await topup('10')).status).toBe(404);expect(store.testFund(alice.id,{accountId:source.id,amountCents:1000,idempotencyKey:randomUUID()}).status).toBe(404);}finally{config.isProd=previous;}
  expect(store.account(source.id).balanceCents).toBe(20000000);
 });
});
describe('Validation and API hardening',()=>{
 test('unsupported encoding and malformed URL are client errors',async()=>{
  expect((await api().post('/api/auth/login').set('Content-Encoding','unknown').send({email:alice.email,password:plain})).status).toBe(415);
  expect((await api().get('/api/accounts/%ZZ').set('Authorization','Bearer '+access)).status).toBe(400);
 });
 test('missing static assets return 404 instead of the application HTML',async()=>{expect((await api().get('/assets/missing.js')).status).toBe(404);});
 test('readiness fails with an incorrect encryption key',async()=>{
  const key=config.dataKey;config.dataKey=randomBytes(32);
  try{expect((await api().get('/ready')).status).toBe(503);}finally{config.dataKey=key;}
  expect((await api().get('/ready')).status).toBe(200);
 });
 test('category filtering covers all pages and rejects duplicate filters',async()=>{
  await transfer(payload());
  const r=await api().get('/api/transactions?category=Transfer').set('Authorization','Bearer '+access);
  expect(r.body.meta.total).toBe(1);expect(r.body.data.transactions.every(t=>t.category==='Transfer')).toBe(true);
  expect((await api().get('/api/transactions?category=Transfer&category=Deposit').set('Authorization','Bearer '+access)).status).toBe(400);
 });
 test('health hides environment and readiness checks the DB',async()=>{
  expect((await api().get('/health')).body).toEqual({status:'ok'});
  expect((await api().get('/ready')).status).toBe(200);
 });
 test('security headers',async()=>{
  const r=await api().get('/health');expect(r.headers['x-frame-options']).toBe('DENY');expect(r.headers['x-content-type-options']).toBe('nosniff');expect(r.headers['content-security-policy']).toContain("frame-ancestors 'none'");
 });
 test('CORS rejects generically',async()=>{
  const r=await api().get('/health').set('Origin','https://attacker.example');expect(r.status).toBe(403);expect(JSON.stringify(r.body)).not.toContain('attacker');
 });
 test('malformed JSON returns 400',async()=>{expect((await api().post('/api/auth/login').set('Content-Type','application/json').send('{"email":')).status).toBe(400);});
 test('body above 10kb returns 413',async()=>{expect((await api().post('/api/auth/login').send({email:'x'.repeat(11000)})).status).toBe(413);});
 test.each([[],{},true,10,null])('invalid email type %p returns 400',async email=>{expect((await api().post('/api/auth/login').send({email,password:plain})).status).toBe(400);});
 test.each([[],{},true,10,null])('invalid password type %p returns 400',async password=>{expect((await api().post('/api/auth/login').send({email:alice.email,password})).status).toBe(400);});
 test.each([0.01,0.29,1.15,19.99,49999.99,50000,'4.35','0.57'])('amount %p transfers exact cents',async amount=>{
  const cents=toCents(amount),r=await transfer(payload({amount}));expect(r.status).toBe(201);
  expect(store.account(source.id).balanceCents).toBe(20000000-cents);expect(store.account(target.id).balanceCents).toBe(cents);
 });
 test.each([0,-1,1.005,[10],'1e1',true,null,{},' 10','1.000','NaN',50000.01,'1e309'])('reject amount %p without changing balances',async amount=>{
  expect((await transfer(payload({amount}))).status).toBe(400);expect(store.account(source.id).balanceCents).toBe(20000000);
 });
 test('unauthenticated transfer returns 401',async()=>{expect((await api().post('/api/transactions/transfer').send(payload())).status).toBe(401);});
 test('strict recipient format and mandatory retry key',async()=>{
  expect((await transfer(payload({toAccountNumber:'CHK-4821'}))).status).toBe(400);
  const body=payload();delete body.idempotencyKey;expect((await transfer(body)).status).toBe(400);
 });
 test('pagination rejects arrays and out-of-range values',async()=>{
  expect((await api().get('/api/transactions?limit=101').set('Authorization','Bearer '+access)).status).toBe(400);
  expect((await api().get('/api/transactions?offset=-1').set('Authorization','Bearer '+access)).status).toBe(400);
  expect((await api().get('/api/transactions?limit=1&limit=2').set('Authorization','Bearer '+access)).status).toBe(400);
 });
});
describe('Password-bound two-factor authentication',()=>{
 test('password bypass is rejected',async()=>{
  expect((await api().post('/api/auth/verify-2fa').send({userId:alice.id,token:tokenFor(alice)})).status).toBe(401);
 });
 test('valid login passes both factors',async()=>{const r=await session();expect(r.status).toBe(200);expect(r.body.data.accessToken).toBeTruthy();});
 test('unknown user and wrong password return identical errors',async()=>{
  const a=await api().post('/api/auth/login').send({email:'unknown@example.com',password:plain});
  const b=await login(alice,'Wrong@123');expect(a.status).toBe(401);expect(a.body).toEqual(b.body);
 });
 test('password is neither trimmed nor sanitized',async()=>{
  expect((await login(alice,'Abcdef1!')).status).toBe(401);
  expect((await login(alice,' '+plain+' ')).status).toBe(401);
  expect((await login()).status).toBe(200);
 });
 test('Gmail dots and plus tags round-trip with case folding',async()=>{
  const r=await api().post('/api/auth/login').send({email:' JOHN.DOE+BANK@GMAIL.COM ',password:plain});expect(r.status).toBe(200);
  expect(store.userByEmail('john.doe+bank@gmail.com').id).toBe(alice.id);
 });
 test('preauth for another user is rejected',async()=>{
  const first=await login();const r=await api().post('/api/auth/verify-2fa').send({userId:bob.id,preAuthToken:first.body.data.preAuthToken,token:tokenFor(bob)});expect(r.status).toBe(401);
 });
 test('forged preauth rejected',async()=>{
  expect((await api().post('/api/auth/verify-2fa').send({preAuthToken:'forged',token:tokenFor(alice)})).status).toBe(401);
 });
 test('expired preauth rejected',async()=>{
  const first=await login();now+=301000;
  expect((await api().post('/api/auth/verify-2fa').send({preAuthToken:first.body.data.preAuthToken,token:tokenFor(alice)})).status).toBe(401);
 });
 test('access and refresh tokens cannot serve as preauth',async()=>{
  const pair=accessFor(alice);
  for(const preAuthToken of [pair.access,pair.refresh])expect((await api().post('/api/auth/verify-2fa').send({preAuthToken,token:tokenFor(alice)})).status).toBe(401);
 });
 test('preauth cannot access accounts',async()=>{
  const first=await login();expect((await api().get('/api/accounts').set('Authorization','Bearer '+first.body.data.preAuthToken)).status).toBe(401);
 });
 test('preauth is single-use, even with a fresh code',async()=>{
  const first=await login(),body={preAuthToken:first.body.data.preAuthToken,token:tokenFor(alice)};
  expect((await api().post('/api/auth/verify-2fa').send(body)).status).toBe(200);
  expect((await api().post('/api/auth/verify-2fa').send({...body,token:tokenFor(alice)})).status).toBe(401);
 });
 test('TOTP replay blocked across distinct password challenges',async()=>{
  const first=await login(),code=tokenFor(alice);
  expect((await api().post('/api/auth/verify-2fa').send({preAuthToken:first.body.data.preAuthToken,token:code})).status).toBe(200);
  const next=await login();expect((await api().post('/api/auth/verify-2fa').send({preAuthToken:next.body.data.preAuthToken,token:code})).status).toBe(401);
 });
 test('five wrong codes lock the account across IPs and new challenges',async()=>{
  const first=await login();const actual=otp.generateCurrentToken(alice.twoFactorSecret),wrong=actual==='000000'?'111111':'000000';
  for(let i=0;i<5;i++)expect((await api().post('/api/auth/verify-2fa').send({preAuthToken:first.body.data.preAuthToken,token:wrong})).status).toBe(401);
  const next=await login();expect((await api().post('/api/auth/verify-2fa').set('X-Forwarded-For','10.0.0.1').send({preAuthToken:next.body.data.preAuthToken,token:tokenFor(alice)})).status).toBe(429);
  now+=901000;expect((await session()).status).toBe(200);
 });
 test('JWT extra cannot override reserved claims',()=>{
  const token=jwt.sign('access',alice.id,{type:'refresh',sub:bob.id,jti:'attacker',iss:'bad',aud:'bad'});
  // Signing rejects attempts to override issuer/audience rather than accepting them.
  expect(jwt.verify(token,'access').sub).toBe(alice.id);
 });
});
describe('Enrollment and recovery',()=>{
 const begin=()=>api().post('/api/auth/register').send({name:'New User',email:'new.user+tag@gmail.com',password:plain});
 const register=async()=>{await begin();const ticket=store.mailMessages('new.user+tag@gmail.com').at(-1).ticket;return api().post('/api/auth/claim-registration').send({ticket,password:plain});};
 test('an unsolicited signup link cannot create an account without the initiating password',async()=>{
  await begin();const ticket=store.mailMessages('new.user+tag@gmail.com').at(-1).ticket;
  expect((await api().post('/api/auth/claim-registration').send({ticket})).status).toBe(400);
  expect((await api().post('/api/auth/claim-registration').send({ticket,password:'Victim@123'})).status).toBe(401);
  expect(store.userByEmail('new.user+tag@gmail.com')).toBeNull();
  expect((await api().post('/api/auth/claim-registration').send({ticket,password:plain})).status).toBe(200);
 });
 test('a fresh enrollment proof rotates the secret and invalidates earlier enrollment challenges',async()=>{
  const initial=await register(),u=store.userByEmail('new.user+tag@gmail.com');
  await login(u);const ticket=store.mailMessages(u.email).at(-1).ticket;
  const resumed=await api().post('/api/auth/claim-registration').send({ticket,password:plain});
  expect(resumed.body.data.twoFactor.secret).not.toBe(initial.body.data.twoFactor.secret);
  expect((await api().post('/api/auth/setup-2fa').send({enrollmentToken:initial.body.data.enrollmentToken,token:tokenFor(u)})).status).toBe(401);
  const fresh=store.userById(u.id);
  expect((await api().post('/api/auth/setup-2fa').send({enrollmentToken:resumed.body.data.enrollmentToken,token:tokenFor(fresh)})).status).toBe(200);
 });
 test('expired and claimed verification links are never dispatched',async()=>{
  await begin();now+=1800001;expect(store.nextMail()).toBeNull();
  await register();expect(store.nextMail()).toBeNull();
 });
 test('mail leases prevent a stale worker from acknowledging a newer attempt',async()=>{
  await begin();const first=store.nextMail();now+=120001;const next=store.nextMail();
  store.markMailSent(first.id,first.attempt);expect(store.get('SELECT sent FROM mail_jobs WHERE id=?',first.id).sent).toBe(0);
  store.markMailSent(next.id,next.attempt);expect(store.nextMail()).toBeNull();
 });
 test('mail dispatcher sends valid proofs and drains before closing',async()=>{
  await begin();const transport={sendMail:jest.fn().mockResolvedValue({}),close:jest.fn()};
  const stop=require('../services/mailService').startMailDispatcher(store,{transport});
  await stop.dispatch();await stop();expect(transport.sendMail).toHaveBeenCalledTimes(1);expect(transport.close).toHaveBeenCalledTimes(1);expect(store.nextMail()).toBeNull();
 });
 test('mail shutdown waits for a pending delivery without closing its database early',async()=>{
  await begin();let finish;const transport={sendMail:jest.fn(()=>new Promise(resolve=>{finish=resolve;})),close:jest.fn()};
  const stop=require('../services/mailService').startMailDispatcher(store,{transport}),delivery=stop.dispatch(),stopping=stop();
  expect(transport.close).not.toHaveBeenCalled();finish({});await delivery;await stopping;
  expect(transport.close).toHaveBeenCalledTimes(1);expect(store.get('SELECT sent FROM mail_jobs').sent).toBe(1);
 });
 test('mail delivery errors retain the job and log no recipient or ticket',async()=>{
  await begin();const transport={sendMail:jest.fn().mockRejectedValue(new Error('sensitive SMTP detail')),close:jest.fn()};
  const log=jest.spyOn(console,'error').mockImplementation(()=>{}),stop=require('../services/mailService').startMailDispatcher(store,{transport});
  try{await stop.dispatch();expect(store.get('SELECT sent FROM mail_jobs').sent).toBe(0);expect(log).toHaveBeenCalledWith(JSON.stringify({event:'mail_delivery_failed'}));}
  finally{await stop();log.mockRestore();}
 });
 test('registration starts empty and enrollment works without a session',async()=>{
  const r=await register();expect(r.status).toBe(200);expect(r.body.data.enrollmentToken).toBeTruthy();
  const u=store.userByEmail('new.user+tag@gmail.com');expect(store.accounts(u.id).map(a=>a.balanceCents)).toEqual([0,0]);
  const setup=await api().post('/api/auth/setup-2fa').send({enrollmentToken:r.body.data.enrollmentToken,token:tokenFor(u)});
  expect(setup.status).toBe(200);expect(setup.body.data.recoveryCodes).toHaveLength(8);expect(store.userById(u.id).twoFactorEnabled).toBe(true);
 });
 test('duplicate registration has same status and fields, never exposes a secret',async()=>{
  const a=await begin(),b=await begin();
  expect(b.status).toBe(a.status);expect(b.body.message).toBe(a.body.message);
  expect(Object.keys(b.body.data)).toEqual(Object.keys(a.body.data));expect(a.body.data).toEqual({nextStep:'check-email'});expect(b.body.data).toEqual(a.body.data);
 });
 test('setup requires enrollment token and cannot be repeated',async()=>{
  const r=await register(),u=store.userByEmail('new.user+tag@gmail.com');
  expect((await api().post('/api/auth/setup-2fa').send({token:tokenFor(u)})).status).toBe(401);
  expect((await api().post('/api/auth/setup-2fa').send({enrollmentToken:r.body.data.enrollmentToken,token:tokenFor(u)})).status).toBe(200);
  expect((await api().post('/api/auth/setup-2fa').send({enrollmentToken:r.body.data.enrollmentToken,token:tokenFor(u)})).status).toBe(401);
 });
 test('unenrolled users resume only with fresh email proof and password',async()=>{
  await register();const u=store.userByEmail('new.user+tag@gmail.com'),r=await login(u);
  expect(r.body.data.requiresEmailVerification).toBe(true);expect(r.body.data.twoFactor).toBeUndefined();expect(r.body.data.enrollmentToken).toBeUndefined();
  const ticket=store.mailMessages(u.email).at(-1).ticket;
  const claimed=await api().post('/api/auth/claim-registration').send({ticket,password:plain});
  expect(claimed.status).toBe(200);expect(claimed.body.data.twoFactor.secret).not.toBe(u.twoFactorSecret);
 });
 test('recovery requires password challenge, uses a hashed single-use code and revokes sessions',async()=>{
  const codes=store.recoveryCodes(alice.id),first=await login(),old=accessFor(alice);
  expect(store.all('SELECT hash FROM recovery_codes').some(r=>r.hash===codes[0])).toBe(false);
  const recovery=await api().post('/api/auth/recover-2fa').send({preAuthToken:first.body.data.preAuthToken,recoveryCode:codes[0]});
  expect(recovery.status).toBe(200);expect(recovery.body.data.enrollmentToken).toBeTruthy();
  expect(store.activeSession(old.sid,alice.id)).toBe(false);expect(store.userById(alice.id).twoFactorEnabled).toBe(false);
  expect(store.useRecovery(alice.id,codes[0])).toBe(false);
  const resume=await login();expect(resume.body.data.recoveryRequired).toBe(true);expect(resume.body.data.twoFactor).toBeUndefined();
 });
 test('2FA secret is encrypted at rest',()=>{expect(store.get('SELECT twoFactorSecret FROM users WHERE id=?',alice.id).twoFactorSecret).not.toContain(alice.twoFactorSecret);});
 test('registration never creates an account before email proof',async()=>{
  const r=await begin();expect(r.body.data).toEqual({nextStep:'check-email'});expect(store.userByEmail('new.user+tag@gmail.com')).toBeNull();
 });
 test('verification links are single-use and expired links fail',async()=>{
  await begin();const ticket=store.mailMessages('new.user+tag@gmail.com').at(-1).ticket;
  expect((await api().post('/api/auth/claim-registration').send({ticket,password:plain})).status).toBe(200);
  expect((await api().post('/api/auth/claim-registration').send({ticket,password:plain})).status).toBe(401);
  await begin();const expired=store.mailMessages('new.user+tag@gmail.com').at(-1).ticket;now+=1800001;
  expect((await api().post('/api/auth/claim-registration').send({ticket:expired})).status).toBe(401);
 });
 test('mailbox tickets are encrypted and public callers cannot fetch them',async()=>{
  await begin();const ticket=store.mailMessages('new.user+tag@gmail.com').at(-1).ticket;
  expect(store.get('SELECT payload FROM mail_jobs').payload).not.toContain(ticket);
  expect((await api().get('/api/auth/mailbox')).status).toBe(404);
 });
 test('registration for an existing email cannot reset its credentials',async()=>{
  const old=alice.passwordHash;await api().post('/api/auth/register').send({email:alice.email,name:'Other User',password:'Different@123'});
  const ticket=store.mailMessages(alice.email).at(-1).ticket;
  expect((await api().post('/api/auth/claim-registration').send({ticket,password:'Different@123'})).body.data.alreadyRegistered).toBe(true);
  expect(store.userById(alice.id).passwordHash).toBe(old);
 });
 test('no demo account is seeded',()=>{expect(store.userByEmail('demo@securevault.com')).toBeNull();});
});
describe('Sessions and access control',()=>{
 test('refresh cookies reach logout and are HttpOnly',async()=>{
  const r=await session();const cookie=r.headers['set-cookie'][0];expect(cookie).toContain('Path=/api/auth;');expect(cookie).toContain('HttpOnly');expect(cookie).toContain('SameSite=Strict');
 });
 test('logout revokes refresh and access immediately',async()=>{
  const pair=accessFor(alice);expect((await cookiePost('/api/auth/logout',pair.cookie).set('Authorization','Bearer '+pair.access)).status).toBe(200);
  expect((await cookiePost('/api/auth/refresh',pair.cookie)).status).toBe(401);
  expect((await api().get('/api/accounts').set('Authorization','Bearer '+pair.access)).status).toBe(401);
 });
 test('cookie logout works when the access token is expired',async()=>{
  const pair=accessFor(alice);now+=901000;expect((await cookiePost('/api/auth/logout',pair.cookie)).status).toBe(200);expect((await cookiePost('/api/auth/refresh',pair.cookie)).status).toBe(401);
 });
 test('refresh rotation invalidates old tokens and reuse revokes descendants',async()=>{
  const pair=accessFor(alice),first=await cookiePost('/api/auth/refresh',pair.cookie);expect(first.status).toBe(200);
  const next=first.headers['set-cookie'][0].split(';')[0];
  expect((await cookiePost('/api/auth/refresh',pair.cookie)).status).toBe(401);
  expect((await cookiePost('/api/auth/refresh',next)).status).toBe(401);
  expect((await api().get('/api/accounts').set('Authorization','Bearer '+first.body.data.accessToken)).status).toBe(401);
 });
 test('refresh tokens are hashed',()=>{
  const pair=accessFor(alice);expect(store.get('SELECT hash FROM refresh_tokens WHERE sessionId=?',pair.sid).hash).not.toBe(pair.refresh);
 });
 test.each(['/api/auth/refresh','/api/auth/logout'])('cookie route %s rejects missing and hostile origin',async url=>{
  const pair=accessFor(alice);
  expect((await api().post(url).set('Cookie',pair.cookie)).status).toBe(403);
  expect((await api().post(url).set('Cookie',pair.cookie).set('Origin','https://attacker.example').set('X-SecureVault-Request','1')).status).toBe(403);
 });
 test('refresh requires custom request header even on trusted origin',async()=>{
  expect((await api().post('/api/auth/refresh').set('Origin',origin).set('Cookie',accessFor(alice).cookie)).status).toBe(403);
 });
 test('logout everywhere revokes all sessions',async()=>{
  const a=accessFor(alice),b=accessFor(alice);
  expect((await api().post('/api/auth/logout-all').set('Authorization','Bearer '+a.access)).status).toBe(200);
  expect(store.activeSession(a.sid,alice.id)).toBe(false);expect(store.activeSession(b.sid,alice.id)).toBe(false);
 });
 test('audit is always scoped to the caller and redacts PII',async()=>{
  store.audit('TEST',bob.id,{email:'bob@example.com',ip:'1.2.3.4',amountCents:12});
  store.audit('OWN',alice.id,{email:alice.email,ip:'1.1.1.1'});
  const r=await api().get('/api/audit?userId='+bob.id).set('Authorization','Bearer '+access);
  expect(r.status).toBe(200);expect(r.body.data.records.some(r=>r.event==='TEST')).toBe(false);
  const text=JSON.stringify(r.body);expect(text).not.toContain('gmail');expect(text).not.toContain('1.1.1.1');
 });
 test('account ownership and transaction DTOs',async()=>{
  expect((await api().get('/api/accounts/'+target.id).set('Authorization','Bearer '+access)).status).toBe(404);
  expect((await api().get('/api/accounts/'+target.id+'/transactions').set('Authorization','Bearer '+access)).status).toBe(404);
  const tx=await transfer(payload());const detail=await api().get('/api/transactions/'+tx.body.data.transaction.id).set('Authorization','Bearer '+access);
  expect(detail.body.data.toAccount).toBe('****'+target.accountNumber.slice(-4));expect(detail.body.data.userId).toBeUndefined();expect(detail.body.data.toAccountNumber).toBeUndefined();
  expect((await api().get('/api/transactions/'+tx.body.data.transaction.id).set('Authorization','Bearer '+accessFor(bob).access)).status).toBe(404);
 });
 test('disabled users cannot refresh or use access tokens',async()=>{
  const pair=accessFor(alice);store.run('UPDATE users SET isActive=0 WHERE id=?',alice.id);
  expect((await cookiePost('/api/auth/refresh',pair.cookie)).status).toBe(401);
  expect((await api().get('/api/accounts').set('Authorization','Bearer '+pair.access)).status).toBe(401);
 });
 test('account list uses exact cents and unique 12 digit numbers',async()=>{
  const r=await api().get('/api/accounts').set('Authorization','Bearer '+access);expect(r.body.data.totalBalance).toBe(200000);
  const numbers=store.all('SELECT accountNumber FROM accounts WHERE userId IS NOT NULL').map(a=>a.accountNumber);
  expect(new Set(numbers).size).toBe(numbers.length);expect(numbers.every(n=>/^\d{12}$/.test(n))).toBe(true);
 });
});
describe('Atomic money movement',()=>{
 test('a transfer result can be recovered by its owner without another payment',async()=>{
  const body=payload(),paid=await transfer(body),balance=store.account(source.id).balanceCents;
  const recovered=await api().get('/api/transactions/attempts/'+body.idempotencyKey).set('Authorization','Bearer '+access);
  expect(recovered.status).toBe(200);expect(recovered.body.data.result).toEqual(paid.body);expect(store.account(source.id).balanceCents).toBe(balance);
  expect(JSON.stringify(recovered.body)).not.toContain(target.accountNumber);
 });
 test('transfer result lookup cannot disclose another user transaction',async()=>{
  const body=payload();await transfer(body);
  expect((await api().get('/api/transactions/attempts/'+body.idempotencyKey).set('Authorization','Bearer '+accessFor(bob).access)).status).toBe(404);
  expect((await api().get('/api/transactions/attempts/'+body.idempotencyKey)).status).toBe(401);
  expect((await api().get('/api/transactions/attempts/not-a-key').set('Authorization','Bearer '+access)).status).toBe(400);
 });
 test.each([-1,0,0.5,NaN,'100',9007199254740992])('store refuses unsafe cents %p without relying on HTTP validators',cents=>{
  expect(store.transfer(alice.id,{...payload(),amountCents:cents},()=>null).status).toBe(400);expect(store.account(target.id).balanceCents).toBe(0);
 });
 test('reconciliation detects an unexplained balance and transaction history is append-only',async()=>{
  await transfer(payload());expect(store.reconcile().ok).toBe(true);
  expect(()=>store.run('UPDATE transactions SET amountCents=1')).toThrow('append-only');
  expect(()=>store.run('DELETE FROM transactions')).toThrow('append-only');
  store.run('UPDATE accounts SET balanceCents=balanceCents+1 WHERE id=?',source.id);expect(store.reconcile().accountMismatches).toBe(1);
 });
 test('fractional transaction cents are refused at the database boundary',()=>{
  expect(()=>store.run("INSERT INTO transactions VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)",randomUUID(),alice.id,source.id,'bad','debit',0.5,100,'bad','Transfer','',target.accountNumber,'completed',new Date(now).toISOString())).toThrow('Invalid transaction cents');
 });
 test('an internal transfer credits exactly once with balanced ledger rows',async()=>{
  const total=store.get('SELECT SUM(balanceCents) AS n FROM accounts').n,body=payload(),first=await transfer(body),second=await transfer(body);
  expect(first.status).toBe(201);expect(second.status).toBe(201);expect(second.body).toEqual(first.body);
  expect(store.account(target.id).balanceCents).toBe(1999);expect(store.get('SELECT SUM(balanceCents) AS n FROM accounts').n).toBe(total);
  expect(store.get('SELECT SUM(deltaCents) AS n FROM ledger_entries').n).toBe(0);
 });
 test('same key with different payload returns 409',async()=>{
  const body=payload();expect((await transfer(body)).status).toBe(201);
  expect((await transfer({...body,amount:'20.00'})).status).toBe(409);
 });
 test('same key across users does not disclose or reuse another transfer',async()=>{
  const body=payload();const a=await transfer(body);expect(a.status).toBe(201);
  const b=await transfer({...body,fromAccountId:target.id,toAccountNumber:source.accountNumber,amount:'.01',token:tokenFor(bob)},accessFor(bob).access);expect(b.status).toBe(400);
  const c=await transfer({...body,fromAccountId:target.id,toAccountNumber:source.accountNumber,amount:'0.01',token:tokenFor(bob)},accessFor(bob).access);expect(c.status).toBe(201);expect(c.body.data.transaction.id).not.toBe(a.body.data.transaction.id);
 });
 test('cached keys do not bypass source ownership',async()=>{
  const body=payload();await transfer(body);expect((await transfer(body,accessFor(bob).access)).status).toBe(403);
 });
 test('concurrent same-key retries produce one debit',async()=>{
  const body=payload(),results=await Promise.all(Array.from({length:12},()=>transfer(body)));
  expect(results.every(r=>r.status===201)).toBe(true);expect(new Set(results.map(r=>r.body.data.transaction.id)).size).toBe(1);expect(store.account(target.id).balanceCents).toBe(1999);
 });
 test('unknown recipient is rejected before debiting',async()=>{
  const r=await transfer(payload({toAccountNumber:'999999999999'}));expect(r.status).toBe(422);expect(store.account(source.id).balanceCents).toBe(20000000);
 });
 test('self transfer rejected',async()=>{expect((await transfer(payload({toAccountNumber:source.accountNumber}))).status).toBe(422);});
 test.each(['frozen','closed'])('sender or recipient %s rejected',async status=>{
  store.run('UPDATE accounts SET status=? WHERE id=?',status,target.id);expect((await transfer(payload())).status).toBe(422);
 });
 test('missing fresh TOTP cannot debit',async()=>{
  const body=payload({token:'000000'});if(otp.generateCurrentToken(alice.twoFactorSecret)==='000000')body.token='111111';
  expect((await transfer(body)).status).toBe(422);expect(store.account(source.id).balanceCents).toBe(20000000);
 });
 test('step-up replay for a new transfer is rejected',async()=>{
  const body=payload();expect((await transfer(body)).status).toBe(201);
  expect((await transfer({...body,idempotencyKey:randomUUID()})).status).toBe(422);
 });
 test('rolling daily limit totals debit cents across accounts',async()=>{
  for(let i=0;i<2;i++)expect((await transfer(payload({amount:'50000'}))).status).toBe(201);
  expect((await transfer(payload({amount:'0.01'}))).status).toBe(422);expect(store.rollingTotal(alice.id)).toBe(10000000);
 });
 test('rolling limit does not reset at midnight; drops only at 24 hours',async()=>{
  expect((await transfer(payload({amount:'50000'}))).status).toBe(201);
  const at=now;expect(store.rollingTotal(alice.id,at+3600000)).toBe(5000000);expect(store.rollingTotal(alice.id,at+86400001)).toBe(0);
 });
 test('business-rule failures are cached consistently',async()=>{
  const body=payload({toAccountNumber:'999999999999'});const first=await transfer(body);expect((await transfer(body)).body).toEqual(first.body);
 });
 test('database failure after debit rolls back balances, TOTP, records and idempotency',async()=>{
  const body=payload();
  store.db.exec("CREATE TRIGGER test_fail_credit BEFORE INSERT ON transactions WHEN NEW.type='credit' BEGIN SELECT RAISE(ABORT,'injected failure'); END;");
  const r=await transfer(body);expect(r.status).toBe(500);expect(store.account(source.id).balanceCents).toBe(20000000);expect(store.account(target.id).balanceCents).toBe(0);
  expect(store.get('SELECT COUNT(*) AS n FROM idempotency').n).toBe(0);expect(store.rollingTotal(alice.id)).toBe(0);
  store.db.exec('DROP TRIGGER test_fail_credit');expect((await transfer(body)).status).toBe(201);
 });
 test('append-only ledger and audit and balance constraints',()=>{
  expect(()=>store.run("UPDATE ledger_entries SET deltaCents=1")).toThrow('append-only');
  expect(()=>store.run('DELETE FROM audit')).toThrow('append-only');
  expect(()=>store.run('UPDATE accounts SET balanceCents=-1 WHERE id=?',source.id)).toThrow();
 });
 test('recipient confirmation gives minimal display name',async()=>{
  const r=await api().post('/api/transactions/recipient').set('Authorization','Bearer '+access).send({accountNumber:target.accountNumber});expect(r.status).toBe(200);expect(r.body.data.displayName).toBe('Bob S.');expect(r.body.data.email).toBeUndefined();
 });
 test('production payee cooling off is enforced before debit',async()=>{
  const old=config.transfer.payeeCoolingOffMs;config.transfer.payeeCoolingOffMs=1800000;
  try{
   expect((await transfer(payload())).status).toBe(422);
   const confirmed=store.confirmRecipient(alice.id,target.accountNumber);expect(confirmed.readyAt).toBe(now+1800000);
   expect((await transfer(payload())).status).toBe(422);now+=1800001;
   access=accessFor(alice).access;expect((await transfer(payload())).status).toBe(201);
  }finally{config.transfer.payeeCoolingOffMs=old;}
 });
});
describe('Durability, independent processes and deployment configuration',()=>{
 test('production server starts with durable storage, hardens headers and issues Secure cookies',async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'sv-production-')),file=path.join(dir,'vault.sqlite');let child;
  const net=require('node:net'),probe=net.createServer();
  const port=await new Promise(resolve=>probe.listen(0,'127.0.0.1',()=>resolve(probe.address().port)));await new Promise(resolve=>probe.close(resolve));
  const live=createStore(file),secret=otp.generateSecret('production@example.com').base32;
  try{
   const user=live.createUser({name:'Production Fixture',email:'production@example.com',passwordHash:await require('bcryptjs').hash(plain,12),twoFactorSecret:secret});live.enableTwoFactor(user.id);
  }finally{live.close();}
  try{
   child=spawn(process.execPath,['server.js'],{cwd:path.resolve(__dirname,'..'),env:{...process.env,NODE_ENV:'production',BCRYPT_ROUNDS:'12',PORT:String(port),DATABASE_PATH:file,CORS_ORIGINS:'https://vault.example',PUBLIC_ORIGIN:'https://vault.example',SMTP_HOST:'smtp.invalid',SMTP_USER:'fixture',SMTP_PASSWORD:'fixture',SMTP_FROM:'verify@example.com'},stdio:['ignore','pipe','pipe']});
   await new Promise((resolve,reject)=>{
    const timeout=setTimeout(()=>reject(new Error('Production server startup timed out.')),10000);
    child.stdout.on('data',data=>{if(String(data).includes('listening')){clearTimeout(timeout);resolve();}});
    child.once('error',error=>{clearTimeout(timeout);reject(error);});child.once('exit',code=>{clearTimeout(timeout);reject(new Error('Production server exited with '+code));});
   });
   const api=request('http://127.0.0.1:'+port),health=await api.get('/health');expect(health.status).toBe(200);expect(health.headers['strict-transport-security']).toBeTruthy();
   expect((await api.get('/ready')).status).toBe(200);
   const login=await api.post('/api/auth/login').send({email:'production@example.com',password:plain});expect(login.status).toBe(200);
   clock.mockImplementation(()=>new Date().getTime());
   const session=await api.post('/api/auth/verify-2fa').send({preAuthToken:login.body.data.preAuthToken,token:otp.generateCurrentToken(secret)});expect(session.status).toBe(200);expect(session.headers['set-cookie'][0]).toContain('Secure');
  }finally{
   if(child&&child.exitCode===null){const exited=new Promise(resolve=>child.once('exit',resolve));child.kill('SIGTERM');await exited;}
   clock.mockImplementation(()=>now);fs.rmSync(dir,{recursive:true,force:true});
  }
 },20000);
 test('schema 2 upgrades preserve money and credentials and invalidate old enrollment challenges',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'sv-upgrade-')),file=path.join(dir,'vault.sqlite');let live=createStore(file);
  try{
   const user=live.createUser({name:'Upgrade User',email:'upgrade@example.com',passwordHash:'fixture',twoFactorSecret:otp.generateSecret('upgrade').base32});
   const account=live.accounts(user.id)[0];live.fund(account.id,12345,'Upgrade fixture');
   live.challenge(jwt.verify(jwt.sign('enrollment',user.id),'enrollment'));
   live.db.exec('DROP TABLE app_metadata; ALTER TABLE registrations DROP COLUMN purpose; PRAGMA user_version=2;');
   live.close();live=createStore(file);
   expect(live.get('PRAGMA user_version').user_version).toBe(3);expect(live.account(account.id).balanceCents).toBe(12345);
   expect(live.userById(user.id).twoFactorSecret).toBe(user.twoFactorSecret);expect(live.get('SELECT COUNT(*) AS n FROM challenges').n).toBe(0);expect(live.reconcile().ok).toBe(true);
  }finally{live.close();fs.rmSync(dir,{recursive:true,force:true});}
 });
 test('backup refuses a missing source without creating either file',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'sv-empty-backup-')),sourceFile=path.join(dir,'missing.sqlite'),destination=path.join(dir,'backup.sqlite');
  try{
   expect(()=>execFileSync(process.execPath,['scripts/backup.js',destination],{cwd:path.resolve(__dirname,'..'),env:{...process.env,DATABASE_PATH:sourceFile},stdio:'pipe'})).toThrow();
   expect(fs.existsSync(sourceFile)).toBe(false);expect(fs.existsSync(destination)).toBe(false);
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
 });
 test('wrong encryption keys fail opening an existing database',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'sv-key-')),file=path.join(dir,'vault.sqlite');
  const live=createStore(file);live.close();const key=config.dataKey;config.dataKey=randomBytes(32);
  try{expect(()=>createStore(file)).toThrow();}finally{config.dataKey=key;fs.rmSync(dir,{recursive:true,force:true});}
 });
 test('configuration rejects mistyped environments, invalid ports and case-variant shared keys',()=>{
  const env={NODE_ENV:'test'};
  for(const k of ['JWT_ACCESS_SECRET','JWT_REFRESH_SECRET','JWT_PREAUTH_SECRET','DATA_ENCRYPTION_KEY'])env[k]=randomBytes(32).toString('hex');
  expect(()=>config.loadConfig({...env,NODE_ENV:'prod'})).toThrow('NODE_ENV');
  for(const port of ['NaN','0','65536','1.5'])expect(()=>config.loadConfig({...env,PORT:port})).toThrow('PORT');
  expect(()=>config.loadConfig({...env,SMTP_PORT:'wrong'})).toThrow('SMTP_PORT');
  expect(()=>config.loadConfig({...env,JWT_REFRESH_SECRET:env.JWT_ACCESS_SECRET.toUpperCase()})).toThrow('distinct');
  const dataDir=path.join(os.tmpdir(),'sv-config-fixture');expect(config.loadConfig({...env,SECUREVAULT_DATA_DIR:dataDir}).dataDir).toBe(dataDir);
 });
 test('backup command creates a consistent usable snapshot and refuses overwrite',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'sv-backup-')),file=path.join(dir,'live.sqlite'),destination=path.join(dir,'backup.sqlite');
  const live=createStore(file);let restored;
  try{
   const u=live.createUser({name:'Backup User',email:'backup@example.com',passwordHash:'fixture',twoFactorSecret:otp.generateSecret('b').base32});
   const a=live.accounts(u.id)[0];live.fund(a.id,12345,'Backup test');
   const options={cwd:path.resolve(__dirname,'..'),env:{...process.env,DATABASE_PATH:file},stdio:'pipe'};
   execFileSync(process.execPath,['scripts/backup.js',destination],options);
   restored=createStore(destination);expect(restored.account(a.id).balanceCents).toBe(12345);expect(restored.get('PRAGMA integrity_check').integrity_check).toBe('ok');
   expect(()=>execFileSync(process.execPath,['scripts/backup.js',destination],options)).toThrow();
  }finally{if(restored)restored.close();live.close();fs.rmSync(dir,{recursive:true,force:true});}
 });
 test('accounts, balances, sessions, replay state and audit survive reopening',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'sv-persist-')),file=path.join(dir,'db.sqlite');
  let persistent=createStore(file);
  try{
   const u=persistent.createUser({name:'Durable User',email:'durable@example.com',passwordHash:'fixture',twoFactorSecret:otp.generateSecret('d').base32});
   const a=persistent.accounts(u.id)[0];persistent.fund(a.id,12345,'Durability test');const sid=persistent.newSession(u.id);persistent.acceptOtp(u.id,123);
   persistent.close();persistent=createStore(file);
   expect(persistent.account(a.id).balanceCents).toBe(12345);expect(persistent.activeSession(sid,u.id)).toBe(true);expect(persistent.acceptOtp(u.id,123)).toBe(false);expect(persistent.auditRecords(u.id,10,0).length).toBeGreaterThan(0);
  }finally{persistent.close();fs.rmSync(dir,{recursive:true,force:true});}
 });
 test('multiple processes cannot overdraw a shared durable database',async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'sv-race-')),file=path.join(dir,'db.sqlite'),shared=createStore(file);
  try{
   const a=shared.createUser({name:'Sender',email:'sender@example.com',passwordHash:'fixture',twoFactorSecret:otp.generateSecret('a').base32});
   const b=shared.createUser({name:'Recipient',email:'recipient@example.com',passwordHash:'fixture',twoFactorSecret:otp.generateSecret('b').base32});
   const from=shared.accounts(a.id)[0],to=shared.accounts(b.id)[0];shared.fund(from.id,10000,'Race test');
   const code=`const {createStore}=require('./store/database');const {randomUUID}=require('node:crypto');const s=createStore(process.env.RACE_DB);const r=s.transfer(process.env.RACE_USER,{fromAccountId:process.env.RACE_FROM,toAccountNumber:process.env.RACE_TO,amountCents:3000,note:'',idempotencyKey:randomUUID()},()=>null);s.close();console.log(r.status);`;
   const results=await Promise.all(Array.from({length:8},()=>new Promise((resolve,reject)=>{
    const child=spawn(process.execPath,['-e',code],{cwd:path.resolve(__dirname,'..'),env:{...process.env,RACE_DB:file,RACE_USER:a.id,RACE_FROM:from.id,RACE_TO:to.accountNumber}});
    let output='',errors='';child.stdout.on('data',d=>output+=d);child.stderr.on('data',d=>errors+=d);child.on('error',reject);child.on('exit',c=>c===0?resolve(Number(output.trim())):reject(new Error(errors)));
   })));
   expect(results.filter(s=>s===201)).toHaveLength(3);expect(shared.account(from.id).balanceCents).toBe(1000);expect(shared.account(to.id).balanceCents).toBe(9000);expect(shared.get('SELECT SUM(deltaCents) AS n FROM ledger_entries').n).toBe(0);
  }finally{shared.close();fs.rmSync(dir,{recursive:true,force:true});}
 },30000);
 test('persistent rate limits are separated and shared across store connections',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'sv-limit-')),file=path.join(dir,'db.sqlite'),a=createStore(file),b=createStore(file);
  try{expect(a.hitLimit('login',1,900000)).toBe(true);expect(b.hitLimit('login',1,900000)).toBe(false);expect(b.hitLimit('register',1,900000)).toBe(true);now+=900001;expect(b.hitLimit('login',1,900000)).toBe(true);}
  finally{a.close();b.close();fs.rmSync(dir,{recursive:true,force:true});}
 });
 test('real route rate limits are enabled, isolated and can be exercised',async()=>{
  const limited=createApp({store,rateLimit:true});
  for(let i=0;i<10;i++)await request(limited).post('/api/auth/login').send({email:'missing@example.com',password:plain});
  expect((await request(limited).post('/api/auth/login').send({email:alice.email,password:plain})).status).toBe(429);
  expect((await request(limited).post('/api/auth/register').send({name:'New User',email:'isolated@example.com',password:plain})).status).toBe(201);
 });
 test('production rejects weak, default and equal secrets and missing durability',()=>{
  const env={NODE_ENV:'production',CORS_ORIGINS:'https://vault.example',DATABASE_PATH:path.resolve(os.tmpdir(),'production.sqlite'),SMTP_HOST:'smtp.example.com',SMTP_USER:'test',SMTP_PASSWORD:'test',SMTP_FROM:'verify@example.com',PUBLIC_ORIGIN:'https://vault.example'};
  for(const k of ['JWT_ACCESS_SECRET','JWT_REFRESH_SECRET','JWT_PREAUTH_SECRET','DATA_ENCRYPTION_KEY'])env[k]=randomBytes(32).toString('hex');
  expect(config.loadConfig(env).isProd).toBe(true);
  expect(()=>config.loadConfig({...env,JWT_ACCESS_SECRET:'dev-access-secret-change-in-production-min-64-chars!!'})).toThrow();
  expect(()=>config.loadConfig({...env,DATA_ENCRYPTION_KEY:'0'.repeat(64)})).toThrow();
  expect(()=>config.loadConfig({...env,DATA_ENCRYPTION_KEY:'abcdef0123456789'.repeat(4)})).toThrow();
  expect(()=>config.loadConfig({...env,JWT_REFRESH_SECRET:env.JWT_ACCESS_SECRET})).toThrow();
  expect(()=>config.loadConfig({...env,DATABASE_PATH:':memory:'})).toThrow();
  expect(()=>config.loadConfig({...env,CORS_ORIGINS:'http://vault.example'})).toThrow();
 });
});

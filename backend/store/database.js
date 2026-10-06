'use strict';
const { DatabaseSync } = require('node:sqlite');
const { randomUUID, randomInt, createHash, createCipheriv, createDecipheriv, randomBytes } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const config = require('../config');
const { maskAccount, transactionDTO } = require('../utils/money');
const hash = value => createHash('sha256').update(value).digest('hex');
const schema = `
CREATE TABLE IF NOT EXISTS users (
 id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE COLLATE NOCASE, passwordHash TEXT NOT NULL,
 twoFactorSecret TEXT NOT NULL, twoFactorEnabled INTEGER NOT NULL DEFAULT 0,
 isActive INTEGER NOT NULL DEFAULT 1, role TEXT NOT NULL DEFAULT 'user' CHECK(role IN ('user','admin')),
 lastTotpStep INTEGER NOT NULL DEFAULT -1, otpFailures INTEGER NOT NULL DEFAULT 0, lockedUntil INTEGER NOT NULL DEFAULT 0, recoveryPending INTEGER NOT NULL DEFAULT 0,
 createdAt TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS accounts (
 id TEXT PRIMARY KEY, userId TEXT REFERENCES users(id), label TEXT NOT NULL, accountNumber TEXT NOT NULL UNIQUE,
 balanceCents INTEGER NOT NULL DEFAULT 0 CHECK(typeof(balanceCents) = 'integer' AND (type='system' OR balanceCents>=0) AND balanceCents BETWEEN -9007199254740991 AND 9007199254740991),
 currency TEXT NOT NULL DEFAULT 'USD', type TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','frozen','closed')));
CREATE TABLE IF NOT EXISTS transactions (
 id TEXT PRIMARY KEY, userId TEXT NOT NULL REFERENCES users(id), accountId TEXT NOT NULL REFERENCES accounts(id),
 reference TEXT NOT NULL, type TEXT NOT NULL CHECK(type IN ('debit','credit')), amountCents INTEGER NOT NULL CHECK(amountCents > 0),
 balanceAfterCents INTEGER NOT NULL, description TEXT NOT NULL, category TEXT NOT NULL DEFAULT 'Transfer', note TEXT,
 toAccountNumber TEXT, status TEXT NOT NULL DEFAULT 'completed', createdAt TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS tx_user_time ON transactions(userId, createdAt);
CREATE TABLE IF NOT EXISTS ledger_entries (
 id INTEGER PRIMARY KEY, reference TEXT NOT NULL, accountId TEXT NOT NULL REFERENCES accounts(id),
 deltaCents INTEGER NOT NULL CHECK(typeof(deltaCents) = 'integer' AND deltaCents != 0), createdAt TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS ledger_ref ON ledger_entries(reference);
CREATE TABLE IF NOT EXISTS sessions (
 id TEXT PRIMARY KEY, userId TEXT NOT NULL REFERENCES users(id), expiresAt INTEGER NOT NULL, revoked INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS refresh_tokens (
 hash TEXT PRIMARY KEY, sessionId TEXT NOT NULL REFERENCES sessions(id), expiresAt INTEGER NOT NULL, used INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS challenges (
 jti TEXT PRIMARY KEY, userId TEXT NOT NULL REFERENCES users(id), type TEXT NOT NULL, expiresAt INTEGER NOT NULL, used INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS recovery_codes (
 hash TEXT PRIMARY KEY, userId TEXT NOT NULL REFERENCES users(id), used INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS idempotency (
 userId TEXT NOT NULL REFERENCES users(id), key TEXT NOT NULL, fingerprint TEXT NOT NULL, status INTEGER NOT NULL, response TEXT NOT NULL,
 createdAt INTEGER NOT NULL, PRIMARY KEY(userId,key));
CREATE TABLE IF NOT EXISTS rate_limits (key TEXT PRIMARY KEY, count INTEGER NOT NULL, expiresAt INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS payees (userId TEXT NOT NULL REFERENCES users(id), accountId TEXT NOT NULL REFERENCES accounts(id), readyAt INTEGER NOT NULL, PRIMARY KEY(userId,accountId));
CREATE TABLE IF NOT EXISTS registrations (ticketHash TEXT PRIMARY KEY, email TEXT NOT NULL, name TEXT NOT NULL, passwordHash TEXT NOT NULL, secret TEXT NOT NULL, expiresAt INTEGER NOT NULL, claimed INTEGER NOT NULL DEFAULT 0, purpose TEXT NOT NULL DEFAULT 'registration');
CREATE TABLE IF NOT EXISTS mail_jobs (id TEXT PRIMARY KEY, payload TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, lockedUntil INTEGER NOT NULL DEFAULT 0, sent INTEGER NOT NULL DEFAULT 0, createdAt INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS audit (
 id TEXT PRIMARY KEY, userId TEXT, event TEXT NOT NULL, meta TEXT NOT NULL, createdAt TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS audit_user ON audit(userId, createdAt);
CREATE TRIGGER IF NOT EXISTS ledger_no_update BEFORE UPDATE ON ledger_entries BEGIN SELECT RAISE(ABORT,'Ledger is append-only'); END;
CREATE TRIGGER IF NOT EXISTS ledger_no_delete BEFORE DELETE ON ledger_entries BEGIN SELECT RAISE(ABORT,'Ledger is append-only'); END;
CREATE TRIGGER IF NOT EXISTS audit_no_update BEFORE UPDATE ON audit BEGIN SELECT RAISE(ABORT,'Audit is append-only'); END;
CREATE TRIGGER IF NOT EXISTS audit_no_delete BEFORE DELETE ON audit BEGIN SELECT RAISE(ABORT,'Audit is append-only'); END;
CREATE TABLE IF NOT EXISTS app_metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TRIGGER IF NOT EXISTS tx_integer_cents BEFORE INSERT ON transactions WHEN typeof(NEW.amountCents)!='integer' OR NEW.amountCents>9007199254740991 OR typeof(NEW.balanceAfterCents)!='integer' OR NEW.balanceAfterCents<0 OR NEW.balanceAfterCents>9007199254740991 BEGIN SELECT RAISE(ABORT,'Invalid transaction cents'); END;
CREATE TRIGGER IF NOT EXISTS tx_no_update BEFORE UPDATE ON transactions BEGIN SELECT RAISE(ABORT,'Transactions are append-only'); END;
CREATE TRIGGER IF NOT EXISTS tx_no_delete BEFORE DELETE ON transactions BEGIN SELECT RAISE(ABORT,'Transactions are append-only'); END;
PRAGMA user_version = 3;
`;
function createStore(filename = config.databasePath) {
  if (config.isProd && filename === ':memory:') throw new Error('Production storage must be durable.');
  if (filename !== ':memory:') fs.mkdirSync(path.dirname(filename), { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(filename, { timeout: 5000 });
  if (filename !== ':memory:' && process.platform !== 'win32') {
    for (const file of [filename,filename+'-wal',filename+'-shm']) if (fs.existsSync(file)) fs.chmodSync(file,0o600);
  }
  db.exec('PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;');
  try {
    db.exec('BEGIN IMMEDIATE');
    const version = db.prepare('PRAGMA user_version').get().user_version;
    if (version > 3) throw new Error('Database schema is newer than this application.');
    db.exec(schema);
    if (version === 1 && !db.prepare('PRAGMA table_info(users)').all().some(c => c.name === 'recoveryPending')) db.exec('ALTER TABLE users ADD COLUMN recoveryPending INTEGER NOT NULL DEFAULT 0');
    if (!db.prepare('PRAGMA table_info(registrations)').all().some(c=>c.name==='purpose')) db.exec("ALTER TABLE registrations ADD COLUMN purpose TEXT NOT NULL DEFAULT 'registration'");
    if(version>0&&version<3)db.exec("DELETE FROM challenges WHERE type='enrollment'");
    const canary = db.prepare("SELECT value FROM app_metadata WHERE key='data-key'").get();
    if (canary) { if(decrypt(canary.value)!=='securevault:data-key:v1') throw new Error('Encryption key does not match this database.'); }
    else {
      const sample = db.prepare('SELECT twoFactorSecret AS secret FROM users LIMIT 1').get() || db.prepare('SELECT secret FROM registrations LIMIT 1').get();
      if(sample) decrypt(sample.secret);
      db.prepare('INSERT INTO app_metadata VALUES(?,?)').run('data-key',encrypt('securevault:data-key:v1'));
    }
    db.exec('COMMIT');
  } catch (err) { if (db.isTransaction) db.exec('ROLLBACK'); db.close(); throw err; }
  const run = (sql, ...args) => db.prepare(sql).run(...args);
  const get = (sql, ...args) => db.prepare(sql).get(...args);
  const all = (sql, ...args) => db.prepare(sql).all(...args);
  function atomic(fn) {
    if (db.isTransaction) return fn();
    db.exec('BEGIN IMMEDIATE');
    try { const result = fn(); if (result && typeof result.then === 'function') throw new Error('Database transactions must be synchronous.'); db.exec('COMMIT'); return result; }
    catch (err) { db.exec('ROLLBACK'); throw err; }
  }
  function encrypt(secret) {
    const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', config.dataKey, iv);
    const encrypted = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
    return [iv, cipher.getAuthTag(), encrypted].map(b => b.toString('base64')).join('.');
  }
  function decrypt(secret) {
    const [iv, tag, data] = secret.split('.').map(s => Buffer.from(s, 'base64'));
    const cipher = createDecipheriv('aes-256-gcm', config.dataKey, iv); cipher.setAuthTag(tag);
    return Buffer.concat([cipher.update(data), cipher.final()]).toString('utf8');
  }
  function user(row) { return row ? { ...row, isActive: !!row.isActive, twoFactorEnabled: !!row.twoFactorEnabled, twoFactorSecret: decrypt(row.twoFactorSecret) } : null; }
  function audit(event, userId = null, meta = {}) {
    // Explicit metadata allowlist excludes IPs, emails, raw inputs and secrets.
    const safe = Object.fromEntries(Object.entries(meta).filter(([k]) => ['reference','accountId','amountCents','reason','sessionId'].includes(k)));
    run('INSERT INTO audit VALUES(?,?,?,?,?)', randomUUID(), userId, event, JSON.stringify(safe), new Date(Date.now()).toISOString());
  }
  function accountNumber() {
    let number;
    do { number = String(randomInt(100000,1000000)) + String(randomInt(0,1000000)).padStart(6,'0'); } while (get('SELECT id FROM accounts WHERE accountNumber=?', number));
    return number;
  }
  function newSession(userId) {
    const id = randomUUID(); run('INSERT INTO sessions VALUES(?,?,?,0)', id, userId, Date.now()+7*86400000); return id;
  }
  function activeSession(id, userId) { return typeof id === 'string' && !!get('SELECT id FROM sessions WHERE id=? AND userId=? AND revoked=0 AND expiresAt>?', id, userId, Date.now()); }
  function addRefresh(token, claims) { run('INSERT INTO refresh_tokens VALUES(?,?,?,0)', hash(token), claims.sid, claims.exp*1000); }
  function consumeChallenge(claims) {
    return run('UPDATE challenges SET used=1 WHERE jti=? AND userId=? AND type=? AND used=0 AND expiresAt>?', claims.jti, claims.sub, claims.type, Date.now()).changes === 1;
  }
  const store = {
    db, atomic, get, all, run, audit, close: () => db.close(),
    userById: id => user(get('SELECT * FROM users WHERE id=?', id)),
    userByEmail: email => user(get('SELECT * FROM users WHERE email=? COLLATE NOCASE', email)),
    createUser({ name, email, passwordHash, twoFactorSecret }) {
      return atomic(() => {
        const id = 'usr_' + randomUUID();
        run('INSERT INTO users(id,name,email,passwordHash,twoFactorSecret,createdAt) VALUES(?,?,?,?,?,?)', id,name,email,passwordHash,encrypt(twoFactorSecret),new Date(Date.now()).toISOString());
        for (const type of ['checking','savings']) run('INSERT INTO accounts(id,userId,label,accountNumber,type) VALUES(?,?,?,?,?)', 'acct_'+randomUUID(),id,type === 'checking' ? 'Checking' : 'Savings',accountNumber(),type);
        audit('AUTH:REGISTER_SUCCESS',id);
        return store.userById(id);
      });
    },
    accounts: id => all('SELECT * FROM accounts WHERE userId=?', id),
    beginRegistration({name,email,passwordHash,twoFactorSecret,purpose='registration'}) {
      return atomic(() => {
        const ticket=randomBytes(32).toString('hex');
        run('INSERT INTO registrations(ticketHash,email,name,passwordHash,secret,expiresAt,purpose) VALUES(?,?,?,?,?,?,?)',hash(ticket),email,name,passwordHash,encrypt(twoFactorSecret),Date.now()+1800000,purpose);
        run('INSERT INTO mail_jobs(id,payload,createdAt) VALUES(?,?,?)',randomUUID(),encrypt(JSON.stringify({email,ticket})),Date.now());
      });
    },
    registrationForTicket(ticket) { return get('SELECT * FROM registrations WHERE ticketHash=? AND claimed=0 AND expiresAt>?',hash(ticket),Date.now()); },
    claimRegistration(ticket,verifiedPasswordHash) {
      return atomic(() => {
        const row=get('SELECT * FROM registrations WHERE ticketHash=? AND claimed=0 AND expiresAt>?',hash(ticket),Date.now());
        if(!row || row.passwordHash!==verifiedPasswordHash)return null;
        run('UPDATE registrations SET claimed=1 WHERE ticketHash=?',hash(ticket));
        const existing=store.userByEmail(row.email);
        if(existing) {
          if(row.purpose==='enrollment'&&existing.isActive&&!existing.twoFactorEnabled&&!existing.recoveryPending&&existing.passwordHash===verifiedPasswordHash) {
            run('UPDATE users SET twoFactorSecret=?,lastTotpStep=-1 WHERE id=?',row.secret,existing.id);
            run("UPDATE challenges SET used=1 WHERE userId=? AND type='enrollment'",existing.id);
            return {user:store.userById(existing.id)};
          }
          return {alreadyRegistered:true};
        }
        if(row.purpose!=='registration')return null;
        const created=store.createUser({name:row.name,email:row.email,passwordHash:row.passwordHash,twoFactorSecret:decrypt(row.secret)});
        return {user:created};
      });
    },
    // Local operator/dispatcher access only; never exposed as an HTTP mailbox.
    mailMessages(email) { return all('SELECT payload FROM mail_jobs ORDER BY rowid').map(r=>JSON.parse(decrypt(r.payload))).filter(m=>m.email===email); },
    nextMail() {
      return atomic(()=>{
        const rows=all('SELECT * FROM mail_jobs WHERE sent=0 AND lockedUntil<=? AND attempts<5 ORDER BY rowid LIMIT 20',Date.now());
        for(const row of rows) {
          const payload=JSON.parse(decrypt(row.payload));
          if(!store.registrationForTicket(payload.ticket)) { run('DELETE FROM mail_jobs WHERE id=?',row.id); continue; }
          run('UPDATE mail_jobs SET lockedUntil=?,attempts=attempts+1 WHERE id=?',Date.now()+120000,row.id);
          return {id:row.id,attempt:row.attempts+1,...payload};
        }
        return null;
      });
    },
    markMailSent(id,attempt) { run('UPDATE mail_jobs SET sent=1 WHERE id=? AND attempts=?',id,attempt); },
    assertReady() { if(decrypt(get("SELECT value FROM app_metadata WHERE key='data-key'").value)!=='securevault:data-key:v1') throw new Error('Encryption key mismatch.'); },
    reconcile() {
      const accounts=all('SELECT a.id FROM accounts a LEFT JOIN ledger_entries l ON l.accountId=a.id GROUP BY a.id HAVING a.balanceCents!=COALESCE(SUM(l.deltaCents),0)');
      const references=all('SELECT reference FROM ledger_entries GROUP BY reference HAVING SUM(deltaCents)!=0 OR COUNT(*)!=2');
      const records=all("SELECT t.id FROM transactions t WHERE NOT EXISTS(SELECT 1 FROM ledger_entries l WHERE l.reference=t.reference AND l.accountId=t.accountId AND l.deltaCents=(CASE WHEN t.type='debit' THEN -t.amountCents ELSE t.amountCents END))");
      return {ok:!accounts.length&&!references.length&&!records.length,accountMismatches:accounts.length,unbalancedReferences:references.length,unmatchedTransactions:records.length};
    },
    account: id => get('SELECT * FROM accounts WHERE id=?', id),
    accountByNumber: number => get('SELECT * FROM accounts WHERE accountNumber=?',number),
    confirmRecipient(userId, number) {
      return atomic(() => {
        const account = store.accountByNumber(number);
        if (!account?.userId || account.status !== 'active') return null;
        const recipient = store.userById(account.userId);
        if (!recipient?.isActive) return null;
        const readyAt = Date.now() + (account.userId === userId ? 0 : config.transfer.payeeCoolingOffMs);
        run('INSERT OR IGNORE INTO payees VALUES(?,?,?)', userId, account.id, readyAt);
        const names = recipient.name.trim().split(/\s+/);
        return { displayName: names[0] + (names.length > 1 ? ' ' + names.at(-1)[0] + '.' : ''), readyAt: get('SELECT readyAt FROM payees WHERE userId=? AND accountId=?',userId,account.id).readyAt };
      });
    },
    newSession, activeSession, addRefresh, consumeChallenge,
    challenge(claims) { run('INSERT INTO challenges VALUES(?,?,?,?,0)',claims.jti,claims.sub,claims.type,claims.exp*1000); },
    validChallenge(c) { return !!get('SELECT jti FROM challenges WHERE jti=? AND userId=? AND type=? AND used=0 AND expiresAt>?',c.jti,c.sub,c.type,Date.now()); },
    revokeSession(id) { run('UPDATE sessions SET revoked=1 WHERE id=?',id); },
    revokeAll(id) { run('UPDATE sessions SET revoked=1 WHERE userId=?',id); },
    rotateRefresh(token, claims, mint) {
      return atomic(() => {
        const row = get('SELECT * FROM refresh_tokens WHERE hash=?',hash(token));
        if (!row || row.sessionId !== claims.sid || !activeSession(claims.sid,claims.sub)) return null;
        if (row.used) { store.revokeSession(claims.sid); audit('AUTH:REFRESH_REUSE',claims.sub,{sessionId:claims.sid}); return null; }
        if (row.expiresAt <= Date.now()) return null;
        run('UPDATE refresh_tokens SET used=1 WHERE hash=?',hash(token));
        return mint(claims.sub,claims.sid);
      });
    },
    acceptOtp(userId, step) {
      return run('UPDATE users SET lastTotpStep=?,otpFailures=0,lockedUntil=0 WHERE id=? AND lastTotpStep<? AND lockedUntil<=?',step,userId,step,Date.now()).changes === 1;
    },
    otpFailure(userId) {
      run('UPDATE users SET otpFailures=CASE WHEN lockedUntil>0 AND lockedUntil<=? THEN 1 ELSE otpFailures+1 END, lockedUntil=CASE WHEN (CASE WHEN lockedUntil>0 AND lockedUntil<=? THEN 1 ELSE otpFailures+1 END)>=5 THEN ? ELSE 0 END WHERE id=?',
        Date.now(),Date.now(),Date.now()+900000,userId);
    },
    recoveryCodes(userId) {
      run('DELETE FROM recovery_codes WHERE userId=?',userId);
      const codes = Array.from({length:8},()=>randomBytes(16).toString('hex'));
      for (const code of codes) run('INSERT INTO recovery_codes VALUES(?,?,0)',hash(code),userId);
      return codes;
    },
    useRecovery(userId,code) { return run('UPDATE recovery_codes SET used=1 WHERE userId=? AND hash=? AND used=0',userId,hash(code)).changes===1; },
    enableTwoFactor(id) { run('UPDATE users SET twoFactorEnabled=1,recoveryPending=0 WHERE id=? AND twoFactorEnabled=0',id); },
    replaceSecret(id,secret) { run('UPDATE users SET twoFactorSecret=?,twoFactorEnabled=0,recoveryPending=1,lastTotpStep=-1,otpFailures=0,lockedUntil=0 WHERE id=?',encrypt(secret),id); },
    hitLimit(key,max,windowMs) {
      return atomic(() => {
        run('INSERT INTO rate_limits VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET count=CASE WHEN expiresAt<=? THEN 1 ELSE count+1 END,expiresAt=CASE WHEN expiresAt<=? THEN excluded.expiresAt ELSE expiresAt END',key,Date.now()+windowMs,Date.now(),Date.now());
        return get('SELECT count FROM rate_limits WHERE key=?',key).count<=max;
      });
    },
    cleanup() {
      atomic(() => {
        run('DELETE FROM rate_limits WHERE expiresAt<?',Date.now());
        run('DELETE FROM registrations WHERE expiresAt<?',Date.now());
        run('DELETE FROM mail_jobs WHERE createdAt<?',Date.now()-86400000);
        run('DELETE FROM challenges WHERE expiresAt<?',Date.now());
        run('DELETE FROM refresh_tokens WHERE expiresAt<?',Date.now());
        run('DELETE FROM sessions WHERE expiresAt<? AND NOT EXISTS(SELECT 1 FROM refresh_tokens WHERE sessionId=sessions.id)',Date.now());
      });
    },
    history(userId,{limit=50,offset=0,accountId,category}={}) {
      const where = 'userId=?'+(accountId?' AND accountId=?':'')+(category?' AND category=?':'');
      const params = [userId,...(accountId?[accountId]:[]),...(category?[category]:[])];
      return { total:get('SELECT COUNT(*) AS n FROM transactions WHERE '+where,...params).n,
        records:all('SELECT * FROM transactions WHERE '+where+' ORDER BY createdAt DESC,rowid DESC LIMIT ? OFFSET ?',...params,limit,offset).map(transactionDTO) };
    },
    auditRecords(userId,limit,offset) { return all('SELECT id,event,createdAt,meta FROM audit WHERE userId=? ORDER BY rowid DESC LIMIT ? OFFSET ?',userId,limit,offset).map(r=>({...r,meta:JSON.parse(r.meta)})); },
    rollingTotal(userId,now=Date.now()) { return get("SELECT COALESCE(SUM(amountCents),0) AS total FROM transactions WHERE userId=? AND type='debit' AND category='Transfer' AND createdAt>?",userId,new Date(now-86400000).toISOString()).total; },
    // Every funding operation has a balancing control entry, transaction and audit record.
    fund(accountId,cents,reason,{test=false}={}) {
      if (!Number.isSafeInteger(cents)||cents<=0||cents>100000000000||typeof reason!=='string'||!reason.trim()) throw new Error('Invalid funding instruction.');
      return atomic(()=>{
        const account=store.account(accountId); if(!account||account.status!=='active') throw new Error('Account unavailable.');
        run("INSERT OR IGNORE INTO accounts(id,label,accountNumber,type) VALUES('treasury','Funding control','000000000000','system')");
        const reference='FUND-'+randomUUID(),createdAt=new Date(Date.now()).toISOString();
        run('UPDATE accounts SET balanceCents=balanceCents+? WHERE id=?',cents,accountId);
        run("UPDATE accounts SET balanceCents=balanceCents-? WHERE id='treasury'",cents);
        run('INSERT INTO ledger_entries(reference,accountId,deltaCents,createdAt) VALUES(?,?,?,?),(?,?,?,?)',reference,'treasury',-cents,createdAt,reference,accountId,cents,createdAt);
        run('INSERT INTO transactions VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)',randomUUID(),account.userId,accountId,reference,'credit',cents,store.account(accountId).balanceCents,test?'Test money top-up':'Recorded funding',test?'Test funding':'Income',reason,null,'completed',createdAt);
        audit(test?'ACCOUNT:TEST_FUNDED':'ACCOUNT:FUNDED',account.userId,{reference,accountId,amountCents:cents});
        return reference;
      });
    },
    testFund(userId,{accountId,amountCents,idempotencyKey}) {
      if(config.isProd||!config.testFunding.enabled)return {status:404,body:{success:false,message:'Resource not found'}};
      if(!Number.isSafeInteger(amountCents)||amountCents<1||amountCents>config.testFunding.singleLimitCents)return {status:400,body:{success:false,message:'Invalid test funding amount.'}};
      const fingerprint=hash(JSON.stringify({operation:'test-funding',accountId,amountCents}));
      return atomic(()=>{
        const account=store.account(accountId);
        if(!account||account.userId!==userId)return {status:404,body:{success:false,message:'Account unavailable.'}};
        const cached=get('SELECT * FROM idempotency WHERE userId=? AND key=?',userId,idempotencyKey);
        if(cached)return cached.fingerprint===fingerprint?{status:cached.status,body:JSON.parse(cached.response)}:{status:409,body:{success:false,message:'This retry key belongs to different operation details.'}};
        const reject=message=>{
          const body={success:false,code:'TEST_FUNDING_REJECTED',message};
          run('INSERT INTO idempotency VALUES(?,?,?,?,?,?)',userId,idempotencyKey,fingerprint,422,JSON.stringify(body),Date.now());
          return {status:422,body};
        };
        if(account.status!=='active')return reject('Choose an active account.');
        if(account.balanceCents+amountCents>config.testFunding.balanceLimitCents)return reject('Test account balance cannot exceed $1,000,000.');
        const daily=get("SELECT COALESCE(SUM(amountCents),0) AS total FROM transactions WHERE userId=? AND category='Test funding' AND createdAt>?",userId,new Date(Date.now()-86400000).toISOString()).total;
        if(daily+amountCents>config.testFunding.dailyLimitCents)return reject('Test funding is limited to $100,000 per user over 24 hours.');
        const reference=store.fund(accountId,amountCents,'Artificial funds for local testing only',{test:true});
        const transaction=transactionDTO(get('SELECT * FROM transactions WHERE reference=? AND userId=?',reference,userId));
        const body={success:true,message:'Test money added. These funds have no real monetary value.',data:{transaction}};
        run('INSERT INTO idempotency VALUES(?,?,?,?,?,?)',userId,idempotencyKey,fingerprint,201,JSON.stringify(body),Date.now());
        return {status:201,body};
      });
    },
    transfer(userId,payload,authorize) {
      if(!Number.isSafeInteger(payload.amountCents)||payload.amountCents<1||payload.amountCents>config.transfer.singleLimitCents) return {status:400,body:{success:false,message:'Invalid transfer amount.'}};
      const {fromAccountId,toAccountNumber,amountCents,note='',idempotencyKey}=payload;
      const fingerprint=hash(JSON.stringify({fromAccountId,toAccountNumber,amountCents,note}));
      return atomic(()=>{
        // Ownership is checked before any cached result can be returned.
        const from=store.account(fromAccountId);
        if(!from||from.userId!==userId) return {status:403,body:{success:false,message:'Source account unavailable.'}};
        const cached=get('SELECT * FROM idempotency WHERE userId=? AND key=?',userId,idempotencyKey);
        if(cached) return cached.fingerprint===fingerprint ? {status:cached.status,body:JSON.parse(cached.response)} : {status:409,body:{success:false,message:'This retry key belongs to different transfer details.'}};
        // Fresh step-up is consumed with the transfer. Retries of a completed operation need no new code.
        const auth=authorize(); if(auth) return auth;
        const reject=(status,message)=>{
          const body={success:false,code:'TRANSFER_REJECTED',message};
          run('INSERT INTO idempotency VALUES(?,?,?,?,?,?)',userId,idempotencyKey,fingerprint,status,JSON.stringify(body),Date.now());
          audit('TXN:TRANSFER_REJECTED',userId,{reason:message});
          return {status,body};
        };
        const to=store.accountByNumber(toAccountNumber);
        if(!to||!to.userId) return reject(422,'Recipient account does not exist. External transfers are unavailable.');
        const recipient=store.userById(to.userId);
        if(from.status!=='active'||to.status!=='active'||!recipient?.isActive) return reject(422,'Account is frozen, closed or disabled.');
        if(from.id===to.id) return reject(422,'Cannot transfer to the same account.');
        if (to.userId !== userId && config.transfer.payeeCoolingOffMs > 0) {
          const payee = get('SELECT readyAt FROM payees WHERE userId=? AND accountId=?',userId,to.id);
          if (!payee || payee.readyAt > Date.now()) return {status:422,body:{success:false,code:'PAYEE_COOLING_OFF',message:'Confirm the recipient and wait for the new-recipient cooling-off period.'}};
        }
        if(from.currency!==to.currency) return reject(422,'Currency mismatch.');
        if(amountCents>config.transfer.singleLimitCents) return reject(422,'Single transfer limit exceeded.');
        if(store.rollingTotal(userId)+amountCents>config.transfer.dailyLimitCents) return reject(422,'Rolling 24-hour transfer limit exceeded.');
        if(run('UPDATE accounts SET balanceCents=balanceCents-? WHERE id=? AND balanceCents>=? AND status=\'active\'',amountCents,from.id,amountCents).changes!==1) return reject(422,'Insufficient funds.');
        run('UPDATE accounts SET balanceCents=balanceCents+? WHERE id=?',amountCents,to.id);
        const reference='TXN-'+randomUUID(),createdAt=new Date(Date.now()).toISOString();
        const debit={id:randomUUID(),userId,accountId:from.id,reference,type:'debit',amountCents,balanceAfterCents:store.account(from.id).balanceCents,description:'Transfer to '+maskAccount(to.accountNumber),category:'Transfer',note,toAccountNumber:to.accountNumber,status:'completed',createdAt};
        const credit={...debit,id:randomUUID(),userId:to.userId,accountId:to.id,type:'credit',balanceAfterCents:store.account(to.id).balanceCents,description:'Transfer from '+maskAccount(from.accountNumber),toAccountNumber:from.accountNumber};
        for(const tx of [debit,credit]) run('INSERT INTO transactions VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)',tx.id,tx.userId,tx.accountId,tx.reference,tx.type,tx.amountCents,tx.balanceAfterCents,tx.description,tx.category,tx.note,tx.toAccountNumber,tx.status,tx.createdAt);
        run('INSERT INTO ledger_entries(reference,accountId,deltaCents,createdAt) VALUES(?,?,?,?),(?,?,?,?)',reference,from.id,-amountCents,createdAt,reference,to.id,amountCents,createdAt);
        audit('TXN:TRANSFER_SUCCESS',userId,{reference,accountId:from.id,amountCents});
        audit('TXN:TRANSFER_RECEIVED',to.userId,{reference,accountId:to.id,amountCents});
        const body={success:true,message:'Transfer completed.',data:{transaction:transactionDTO(debit)}};
        run('INSERT INTO idempotency VALUES(?,?,?,?,?,?)',userId,idempotencyKey,fingerprint,201,JSON.stringify(body),Date.now());
        return {status:201,body};
      });
    },
  };
  return store;
}
module.exports = { createStore, hash };

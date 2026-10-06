'use strict';
const { randomBytes } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
if (process.env.SECUREVAULT_ENV_FILE) require('dotenv').config({ path: process.env.SECUREVAULT_ENV_FILE, quiet: true });
function loadConfig(env = process.env) {
  const dataDir = path.resolve(env.SECUREVAULT_DATA_DIR || path.join(os.homedir(), '.securevault'));
  if (env.NODE_ENV && !['development','test','production'].includes(env.NODE_ENV)) throw new Error('NODE_ENV must be development, test or production.');
  const isProd = env.NODE_ENV === 'production', isTest = env.NODE_ENV === 'test';
  const [nodeMajor,nodeMinor]=process.versions.node.split('.').map(Number);
  if(isProd&&(nodeMajor<24||(nodeMajor===24&&nodeMinor<21)))throw new Error('Production requires Node.js 24.21 or later.');
  const names = ['JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET', 'JWT_PREAUTH_SECRET', 'DATA_ENCRYPTION_KEY'];
  let local = {};
  if (!isProd && !isTest && names.some(k => !env[k])) {
    fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 });
    const file = path.join(dataDir, 'keys.json');
    if (!fs.existsSync(file)) {
      const keys = Object.fromEntries(names.map(k => [k, randomBytes(32).toString('hex')]));
      try { fs.writeFileSync(file, JSON.stringify(keys), { flag: 'wx', mode: 0o600 }); }
      catch (err) { if (err.code !== 'EEXIST') throw err; }
    }
    local = JSON.parse(fs.readFileSync(file, 'utf8'));
  }
  const secrets = names.map(k => {
    const value = env[k] || local[k] || (isTest ? randomBytes(32).toString('hex') : '');
    const periodic = [1,2,4,8,16].some(n => value.toLowerCase() === value.slice(0,n).toLowerCase().repeat(64/n));
    if (!/^[a-f0-9]{64}$/i.test(value) || new Set(value.toLowerCase()).size < 8 || periodic) throw new Error(k + ' must be an independently generated 32-byte hex secret.');
    return value.toLowerCase();
  });
  if (new Set(secrets).size !== secrets.length) throw new Error('Signing and encryption keys must be distinct.');
  const origins = (env.CORS_ORIGINS || (isProd ? '' : 'http://localhost:3000,http://localhost:5173')).split(',').map(o=>o.trim()).filter(Boolean);
  if (!origins.length || origins.some(o => { try { return new URL(o).origin !== o || (isProd && !o.startsWith('https://')); } catch { return true; } })) throw new Error('CORS_ORIGINS must contain exact trusted origins (HTTPS in production).');
  if (isProd && (!env.DATABASE_PATH || env.DATABASE_PATH === ':memory:' || !path.isAbsolute(env.DATABASE_PATH))) throw new Error('Production requires an absolute persistent DATABASE_PATH.');
  if (isProd && (['SMTP_HOST','SMTP_USER','SMTP_PASSWORD','SMTP_FROM','PUBLIC_ORIGIN'].some(k => !env[k]) || !origins.includes(env.PUBLIC_ORIGIN) || !/^[^\s@]+@[^\s@]+$/.test(env.SMTP_FROM))) throw new Error('Production requires SMTP credentials, a sender address and a trusted PUBLIC_ORIGIN.');
  const rounds = Number(env.BCRYPT_ROUNDS || 12);
  if (!Number.isInteger(rounds) || rounds < (isTest ? 4 : 12) || rounds > 16) throw new Error('Invalid BCRYPT_ROUNDS.');
  const proxy = env.TRUST_PROXY || 'false';
  if (!['false', 'loopback'].includes(proxy) && !/^\d+$/.test(proxy)) throw new Error('Invalid TRUST_PROXY.');
  const port = Number(env.PORT || 5000), mailPort = Number(env.SMTP_PORT || 465);
  if (![port,mailPort].every(p=>Number.isInteger(p)&&p>=1&&p<=65535)) throw new Error('PORT and SMTP_PORT must be integers from 1 to 65535.');
  return {
    env: env.NODE_ENV || 'development', isProd, isTest, port, dataDir,
    databasePath: env.DATABASE_PATH || (isTest ? ':memory:' : path.join(dataDir, 'vault.sqlite')),
    dataKey: Buffer.from(secrets[3], 'hex'), trustProxy: proxy === 'false' ? false : proxy === 'loopback' ? 'loopback' : Number(proxy),
    jwt: { accessSecret: secrets[0], refreshSecret: secrets[1], preAuthSecret: secrets[2], issuer: 'securevault-api', audience: 'securevault-client', accessExpiresIn: '15m', refreshExpiresIn: '7d' },
    bcrypt: { rounds }, cors: { origins }, rateLimit: { windowMs: 900000, max: 100, authMax: 10, transferMax: 10 },
    mail: { host: env.SMTP_HOST, port: mailPort, user: env.SMTP_USER, password: env.SMTP_PASSWORD, from: env.SMTP_FROM, origin: env.PUBLIC_ORIGIN },
    transfer: { singleLimitCents: 5000000, dailyLimitCents: 10000000, payeeCoolingOffMs: isProd ? 1800000 : 0 },
    testFunding: { enabled: !isProd, singleLimitCents: 5000000, dailyLimitCents: 10000000, balanceLimitCents: 100000000 },
  };
}
module.exports = { ...loadConfig(), loadConfig };

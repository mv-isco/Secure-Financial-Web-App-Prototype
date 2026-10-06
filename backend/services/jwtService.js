'use strict';
const jwt = require('jsonwebtoken');
const { randomUUID } = require('node:crypto');
const config = require('../config');
const key = type => type === 'refresh' ? config.jwt.refreshSecret : ['preauth', 'enrollment', 'recovery'].includes(type) ? config.jwt.preAuthSecret : config.jwt.accessSecret;
function sign(type, userId, extra = {}) {
  const safe = { ...(typeof extra.sid === 'string' ? { sid: extra.sid } : {}), ...(typeof extra.twoFa === 'boolean' ? { twoFa: extra.twoFa } : {}) };
  return jwt.sign({ ...safe, sub: userId, jti: randomUUID(), type }, key(type), { algorithm: 'HS256',
    issuer: config.jwt.issuer, audience: config.jwt.audience, expiresIn: type === 'refresh' ? '7d' : type === 'access' ? '15m' : '5m' });
}
function verify(token, type) {
  const claims = jwt.verify(token, key(type), { algorithms: ['HS256'], issuer: config.jwt.issuer, audience: config.jwt.audience });
  if (claims.type !== type || typeof claims.sub !== 'string' || typeof claims.jti !== 'string') throw new Error('Invalid token type.');
  return claims;
}
const cookieOptions = { httpOnly: true, secure: config.isProd, sameSite: 'strict', path: '/api/auth' };
module.exports = { sign, verify,
  signAccessToken: (id, extra) => sign('access', id, extra), signPreAuthToken: id => sign('preauth', id), signRefreshToken: (id, extra) => sign('refresh', id, extra),
  verifyAccessToken: token => verify(token, 'access'), verifyRefreshToken: token => verify(token, 'refresh'),
  setRefreshCookie: (res, token) => res.cookie('refreshToken', token, { ...cookieOptions, maxAge: 7 * 86400000 }),
  clearRefreshCookie: res => { res.clearCookie('refreshToken', cookieOptions); res.clearCookie('refreshToken', { ...cookieOptions, path: '/api/auth/refresh' }); },
};

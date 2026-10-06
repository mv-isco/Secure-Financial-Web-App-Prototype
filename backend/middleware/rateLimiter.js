'use strict';
const { createHmac } = require('node:crypto');
const config = require('../config');
const R = require('../utils/apiResponse');
// Persistent buckets share limits across processes on the same database.
module.exports = function limiter(scope, max, windowMs = 900000, account = false) {
  return (req, res, next) => {
    if (!req.app.locals.rateLimit) return next();
    const identity = typeof account==='function'?account(req):account ? req.user?.id || (typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : req.ip) : req.ip;
    const key = createHmac('sha256',config.jwt.preAuthSecret).update(scope + ':' + identity).digest('hex');
    const allowed = req.app.locals.store.hitLimit(key, max, windowMs);
    if (!allowed) { res.set('Retry-After', String(Math.ceil(windowMs / 1000))); return R.tooManyRequests(res); }
    next();
  };
};

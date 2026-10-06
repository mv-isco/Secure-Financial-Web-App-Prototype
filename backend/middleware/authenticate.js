'use strict';
const jwt = require('../services/jwtService');
const R = require('../utils/apiResponse');
module.exports = (req, res, next) => {
  try {
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) return R.unauthorized(res);
    const claims = jwt.verify(header.slice(7), 'access');
    const store = req.app.locals.store;
    const user = store.userById(claims.sub);
    if (!user?.isActive || !user.twoFactorEnabled || !store.activeSession(claims.sid, user.id)) return R.unauthorized(res, 'Session expired or revoked.');
    req.user = user; req.sessionId = claims.sid;
    next();
  } catch { return R.unauthorized(res, 'Invalid or expired session.'); }
};

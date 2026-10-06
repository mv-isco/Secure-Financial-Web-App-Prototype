'use strict';
const otp = require('otplib');
function generateSecret(email) {
  const base32 = otp.generateSecret();
  return { base32, otpAuthUrl: otp.generateURI({ issuer: 'SecureVault', label: email, secret: base32 }) };
}
function verifyForUser(store, userId, token) {
  const user = store.userById(userId);
  if (!user || !user.isActive || user.lockedUntil > Date.now()) return { ok: false, locked: !!user && user.lockedUntil > Date.now() };
  let result;
  try { result = otp.verifySync({ secret: user.twoFactorSecret, token, epochTolerance: 0 }); } catch { result = { valid: false }; }
  if (!result.valid || !store.acceptOtp(user.id, result.timeStep)) {
    store.otpFailure(user.id); store.audit('AUTH:2FA_FAILURE', user.id);
    return { ok: false };
  }
  return { ok: true };
}
module.exports = { generateSecret, verifyForUser, generateCurrentToken: (secret, epoch = Math.floor(Date.now()/1000)) => otp.generateSync({ secret, epoch }) };

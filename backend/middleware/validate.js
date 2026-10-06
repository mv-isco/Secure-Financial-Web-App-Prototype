'use strict';
const { body, query, validationResult } = require('express-validator');
const { toCents } = require('../utils/money');
const R = require('../utils/apiResponse');
const result = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return R.badRequest(res, 'Validation failed', errors.array().map(e => ({ field: e.path, message: e.msg })));
  next();
};
const text = key => body(key).isString().withMessage('Must be a string.').bail();
const email = () => text('email').trim().toLowerCase().isLength({ max: 254 }).isEmail();
const otp = () => text('token').matches(/^\d{6}$/).withMessage('Enter a six-digit authenticator code.');
const registerRules = [text('name').trim().isLength({ min: 2, max: 60 }).matches(/^[\p{L}\p{M}\s'.-]+$/u), email(),
  text('password').isLength({ min: 8, max: 72 }).custom(v => Buffer.byteLength(v, 'utf8') <= 72).withMessage('Password must not exceed 72 UTF-8 bytes.').matches(/[A-Z]/).matches(/[0-9]/).matches(/[^A-Za-z0-9]/), result];
const loginRules = [email(), text('password').notEmpty().custom(v => Buffer.byteLength(v, 'utf8') <= 72), result];
const twoFactorRules = [otp(), result];
const transferRules = [text('fromAccountId').isLength({ min: 1, max: 64 }), text('toAccountNumber').matches(/^\d{12}$/),
  body('amount').custom(v => { toCents(v); return true; }), text('idempotencyKey').isUUID(4), text('token').matches(/^\d{6}$/),
  body('note').optional().isString().bail().trim().isLength({ max: 120 }).matches(/^[^\u0000-\u001f\u007f]*$/), result];
const paginationRules = [query('limit').optional().isString().bail().isInt({ min: 1, max: 100 }), query('offset').optional().isString().bail().isInt({ min: 0, max: 100000 }), result];
const profileRules = [text('name').trim().isLength({ min: 2, max: 60 }).matches(/^[\p{L}\p{M}\s'.-]+$/u), result];
const passwordChangeRules = [text('currentPassword').notEmpty().custom(v => Buffer.byteLength(v, 'utf8') <= 72),
  text('newPassword').isLength({ min: 8, max: 72 }).custom(v => Buffer.byteLength(v, 'utf8') <= 72).matches(/[A-Z]/).matches(/[0-9]/).matches(/[^A-Za-z0-9]/), otp(), result];
const testFundingRules = [body('amount').custom(v => { toCents(v); return true; }), text('idempotencyKey').isUUID(4), result];
module.exports = { registerRules, loginRules, twoFactorRules, setupTwoFactorRules: twoFactorRules, transferRules, paginationRules, profileRules, passwordChangeRules, testFundingRules };

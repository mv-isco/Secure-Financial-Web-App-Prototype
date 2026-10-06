'use strict';

// ─────────────────────────────────────────────────────────────────
//  API Response Helpers
//  All endpoints return a consistent envelope:
//  { success, data?, message?, errors?, meta? }
// ─────────────────────────────────────────────────────────────────

/**
 * 200 OK with data payload
 */
const ok = (res, data = {}, message = 'Success', meta = null) => {
  const body = { success: true, message, data };
  if (meta) body.meta = meta;
  return res.status(200).json(body);
};

/**
 * 201 Created
 */
const created = (res, data = {}, message = 'Resource created') =>
  res.status(201).json({ success: true, message, data });

/**
 * 400 Bad Request — validation failures
 */
const badRequest = (res, message = 'Bad request', errors = null) => {
  const body = { success: false, message };
  if (errors) body.errors = errors;
  return res.status(400).json(body);
};

/**
 * 401 Unauthorized
 */
const unauthorized = (res, message = 'Authentication required') =>
  res.status(401).json({ success: false, message });

/**
 * 403 Forbidden
 */
const forbidden = (res, message = 'Access denied') =>
  res.status(403).json({ success: false, message });

/**
 * 404 Not Found
 */
const notFound = (res, message = 'Resource not found') =>
  res.status(404).json({ success: false, message });

/**
 * 409 Conflict
 */
const conflict = (res, message = 'Resource conflict') =>
  res.status(409).json({ success: false, message });

/**
 * 422 Unprocessable Entity — business logic rejections
 */
const unprocessable = (res, message, details = null) => {
  const body = { success: false, message };
  if (details) body.details = details;
  return res.status(422).json(body);
};

/**
 * 429 Too Many Requests
 */
const tooManyRequests = (res, message = 'Too many requests. Please try again later.') =>
  res.status(429).json({ success: false, message });

/**
 * 500 Internal Server Error
 */
const serverError = (res, message = 'An unexpected error occurred') =>
  res.status(500).json({ success: false, message });

module.exports = { ok, created, badRequest, unauthorized, forbidden, notFound, conflict, unprocessable, tooManyRequests, serverError };

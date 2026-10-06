/**
 * Shared formatting helpers
 */

/** Format a number as USD currency */
export const fmt = (n) =>
  new Intl.NumberFormat('en-US', {
    style:                 'currency',
    currency:              'USD',
    minimumFractionDigits: 2,
  }).format(n ?? 0);

/** Format an ISO date string as "Jul 14" */
export const fmtDate = (iso) =>
  new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

/** Format an ISO date string as "Jul 14, 2025" */
export const fmtDateLong = (iso) =>
  new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

/** Format an ISO date string as "14:32 EST" */
export const fmtTime = (iso) =>
  new Date(iso).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', timeZoneName: 'short' });

/** Mask an account number — show only last 4 digits */
export const maskAccount = (num) => {
  const clean = String(num).replace(/\D/g, '');
  return `•••• ${clean.slice(-4)}`;
};

/** Strip any character that isn't safe for a plain-text field */
export const sanitizeText = (v) =>
  String(v ?? '').replace(/[<>"'&]/g, '');

/**
 * Clamp a number to 2 decimal places without floating-point drift.
 * Uses integer arithmetic: (Math.round(n * 100)) / 100
 */
export const round2 = (n) => Math.round((n ?? 0) * 100) / 100;

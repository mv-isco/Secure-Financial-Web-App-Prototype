'use strict';
// Audit records are written inside database transactions by store.audit.
// This adapter accepts a store explicitly; there is no process-local audit array.
module.exports = { record: (store,event,userId,meta) => store.audit(event,userId,meta) };

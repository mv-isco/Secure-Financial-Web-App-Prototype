'use strict';
const bcrypt = require('bcryptjs');
const { randomBytes } = require('node:crypto');
const config = require('../config');
// Real bcrypt work for unknown accounts, at the same cost as registered accounts.
const dummyHash = bcrypt.hash(randomBytes(32).toString('hex'), config.bcrypt.rounds);
module.exports = {
  hash: password => bcrypt.hash(password, config.bcrypt.rounds),
  compare: async (password, hash) => bcrypt.compare(password, hash || await dummyHash),
};

'use strict';
module.exports = { testEnvironment: 'node', testMatch: ['**/tests/**/*.test.js'], testTimeout: 20000, clearMocks: true, collectCoverageFrom: ['app.js','routes/**/*.js','services/**/*.js','middleware/**/*.js','store/database.js'] };

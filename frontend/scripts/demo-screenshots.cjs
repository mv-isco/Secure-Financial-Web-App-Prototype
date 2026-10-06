'use strict';

// Capture the real UI against a disposable database containing fictional data.
// Clear inherited configuration before importing the backend config module.
delete process.env.SECUREVAULT_ENV_FILE;
process.env.NODE_ENV = 'test';
process.env.BCRYPT_ROUNDS = '4';
const { randomBytes, randomUUID } = require('node:crypto');
for (const key of ['JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET', 'JWT_PREAUTH_SECRET', 'DATA_ENCRYPTION_KEY']) {
  process.env[key] = randomBytes(32).toString('hex');
}
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright-core');
const { createStore } = require('../../backend/store/database');
const { createApp } = require('../../backend/app');
const otp = require('../../backend/services/twoFactorService');
const password = require('../../backend/services/passwordService');
const config = require('../../backend/config');

async function main() {
  const output = path.resolve(__dirname, '../../docs/screenshots');
  fs.mkdirSync(output, { recursive: true });
  const store = createStore(':memory:');
  const realNow = Date.now;
  let browser, server;
  try {
    const secret = otp.generateSecret('ava.morgan@example.com').base32;
    const demoPassword = randomBytes(24).toString('hex') + 'A!';
    const passwordHash = await password.hash(demoPassword);
    const user = store.createUser({ name: 'Ava Morgan', email: 'ava.morgan@example.com', passwordHash, twoFactorSecret: secret });
    const recipient = store.createUser({ name: 'Alex Rivera', email: 'alex.rivera@example.com', passwordHash, twoFactorSecret: otp.generateSecret('alex.rivera@example.com').base32 });
    for (const id of [user.id, recipient.id]) {
      store.enableTwoFactor(id);
      store.recoveryCodes(id);
      store.audit('AUTH:2FA_ENROLLED', id);
    }
    const checking = store.accounts(user.id).find(account => account.type === 'checking');
    const savings = store.accounts(user.id).find(account => account.type === 'savings');
    const target = store.accounts(recipient.id).find(account => account.type === 'checking');
    for (const [account, number] of [[checking, '100200300401'], [savings, '100200300402'], [target, '100200300501']]) {
      store.run('UPDATE accounts SET accountNumber=? WHERE id=?', number, account.id);
      account.accountNumber = number;
    }

    const seedTime = realNow();
    const atDaysAgo = days => { Date.now = () => seedTime - days * 86400000; };
    const seedTransfer = (fromUser, from, to, cents, note) => {
      const result = store.transfer(fromUser.id, {
        fromAccountId: from.id, toAccountNumber: to.accountNumber,
        amountCents: cents, note, idempotencyKey: randomUUID(),
      }, () => null);
      assert.equal(result.status, 201, result.body.message);
    };
    atDaysAgo(6);
    store.fund(checking.id, 1250000, 'Fictional demo funds', { test: true });
    store.fund(savings.id, 800000, 'Fictional demo savings', { test: true });
    store.fund(target.id, 150000, 'Fictional recipient funds', { test: true });
    atDaysAgo(4);
    seedTransfer(user, checking, savings, 50000, 'Savings contribution');
    atDaysAgo(3);
    seedTransfer(recipient, target, checking, 12500, 'Shared expenses');
    atDaysAgo(2);
    seedTransfer(user, checking, target, 7500, 'Dinner reimbursement');
    atDaysAgo(1);
    seedTransfer(user, checking, savings, 25000, 'Monthly savings');
    Date.now = realNow;

    const app = createApp({ store, rateLimit: false });
    server = await new Promise(resolve => {
      const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
    });
    const origin = 'http://127.0.0.1:' + server.address().port;
    config.cors.origins.push(origin);
    const executablePath = process.env.BROWSER_PATH || [
      'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
      'C:/Program Files/Google/Chrome/Application/chrome.exe',
      '/usr/bin/chromium', '/usr/bin/google-chrome',
    ].find(candidate => fs.existsSync(candidate));
    browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
    const context = await browser.newContext({
      viewport: { width: 800, height: 900 }, deviceScaleFactor: 1,
      locale: 'en-US', timezoneId: 'Asia/Kuala_Lumpur', reducedMotion: 'reduce',
    });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const capture = async (name, fullPage = false) => {
      await page.evaluate(() => document.fonts.ready);
      await page.locator('body').click({ position: { x: 1, y: 1 } });
      await page.screenshot({ path: path.join(output, name + '.png'), fullPage, animations: 'disabled' });
      console.log('Captured ' + name + '.png');
    };

    await page.goto(origin + '/register');
    await page.getByRole('heading', { name: 'Create account', exact: true }).waitFor();
    await capture('register');
    await page.goto(origin + '/login');
    await page.getByRole('heading', { name: 'Sign in', exact: true }).waitFor();
    await capture('login');
    await page.getByLabel('Email address').fill(user.email);
    await page.getByLabel('Password', { exact: true }).fill(demoPassword);
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
    await page.getByLabel('6-digit authenticator code').waitFor();
    // Capture the empty verification form before supplying any code.
    await capture('authenticator');
    await page.getByLabel('6-digit authenticator code').fill(otp.generateCurrentToken(secret));
    await page.getByRole('button', { name: 'Verify & sign in' }).click();
    await page.setViewportSize({ width: 1440, height: 960 });
    await page.getByText('Total net worth', { exact: true }).waitFor();
    await page.getByText('Recent Activity', { exact: true }).waitFor();
    await page.getByText(/Transfer to/).first().waitFor();
    await page.getByText('Last updated:', { exact: false }).filter({ hasNotText: 'Not loaded' }).waitFor();
    await capture('dashboard');

    await page.getByRole('button', { name: 'Transfer', exact: true }).first().click();
    await page.getByLabel('Recipient account number').fill(target.accountNumber);
    await page.getByLabel('Amount (USD)').fill('250.00');
    await page.getByLabel('Note (optional)').fill('Shared expenses');
    await page.getByRole('button', { name: 'Review transfer' }).click();
    await page.getByText('Alex R.', { exact: true }).waitFor();
    await capture('transfer-review');

    await page.getByRole('button', { name: 'History', exact: true }).first().click();
    await page.getByRole('button', { name: 'Test funding', exact: true }).waitFor();
    await page.getByText(/Transfer from/).first().waitFor();
    await capture('history');

    await page.getByRole('button', { name: 'Profile', exact: true }).click();
    await page.getByRole('heading', { name: 'Your profile', exact: true }).waitFor();
    await page.getByText('Active sessions (1)', { exact: true }).waitFor();
    await page.getByText('LOCAL TEST MODE', { exact: true }).waitFor();
    await capture('profile', true);

    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole('button', { name: 'Dashboard', exact: true }).click();
    await page.getByText(/Transfer to/).first().waitFor();
    const dimensions = await page.evaluate(() => ({ width: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth }));
    assert.ok(dimensions.scroll <= dimensions.width, 'Mobile dashboard overflows horizontally.');
    await capture('dashboard-mobile', true);
    assert.equal(store.reconcile().ok, true);
    assert.deepEqual(errors, []);
    console.log('Saved eight demo screenshots with fictional data and a balanced ledger.');
  } finally {
    Date.now = realNow;
    if (browser) await browser.close();
    if (server) await new Promise(resolve => server.close(resolve));
    store.close();
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });

'use strict';
process.env.NODE_ENV='test';process.env.BCRYPT_ROUNDS='4';
const {randomBytes}=require('node:crypto');
for(const key of ['JWT_ACCESS_SECRET','JWT_REFRESH_SECRET','JWT_PREAUTH_SECRET','DATA_ENCRYPTION_KEY'])process.env[key]=randomBytes(32).toString('hex');
const assert=require('node:assert/strict');
const {chromium}=require('playwright-core');
const {createStore}=require('../../backend/store/database');
const {createApp}=require('../../backend/app');
const otp=require('../../backend/services/twoFactorService');
const password=require('../../backend/services/passwordService');
const config=require('../../backend/config');
const fs=require('node:fs');
async function main(){
 const store=createStore(':memory:');
 const app=createApp({store,rateLimit:false});
 const server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});
 const origin='http://127.0.0.1:'+server.address().port;
 config.cors.origins.push(origin);
 const executable=process.env.BROWSER_PATH || [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  '/usr/bin/chromium','/usr/bin/google-chrome'
 ].find(p=>fs.existsSync(p));
 let browser;
 try{
  browser=await chromium.launch(executable?{headless:true,executablePath:executable}:{headless:true});
  const context=await browser.newContext();
  let page=await context.newPage();
  const errors=[],csp=[];
  page.on('pageerror',err=>errors.push(err.message));
  page.on('console',msg=>{if(msg.text().includes('Content Security Policy'))csp.push(msg.text());});
  await page.goto(origin+'/login');
  await page.getByRole('heading',{name:'Sign in',exact:true}).waitFor();
  assert.equal(await page.getByLabel('Email address').inputValue(),'');
  assert.equal(await page.getByLabel('Password',{exact:true}).inputValue(),'');
  assert.equal(await page.locator('body').evaluate(el=>getComputedStyle(el).margin),'0px');
  const secret=otp.generateSecret('browser@example.com').base32;
  const user=store.createUser({name:'Browser User',email:'browser@example.com',passwordHash:await password.hash('Browser@123'),twoFactorSecret:secret});
  store.enableTwoFactor(user.id);
  const source=store.accounts(user.id)[0];store.fund(source.id,10000,'Browser test funding');
  const recipient=store.createUser({name:'Recipient Example',email:'recipient@example.com',passwordHash:await password.hash('Recipient@123'),twoFactorSecret:otp.generateSecret('recipient').base32});
  const target=store.accounts(recipient.id)[0];
  await page.getByLabel('Email address').fill(user.email);await page.getByLabel('Password',{exact:true}).fill('Browser@123');
  await page.getByRole('button',{name:'Continue',exact:true}).click();
  await page.getByLabel('6-digit authenticator code').fill(otp.generateCurrentToken(secret));
  await page.getByRole('button',{name:'Verify & sign in'}).click();
  await page.getByText('Total net worth').waitFor();
  await page.getByRole('button').filter({hasText:'Transfer'}).first().click();
  await page.getByLabel('Recipient account number').fill(target.accountNumber);
  await page.getByLabel('Amount (USD)').fill('19.99');
  await page.getByRole('button',{name:'Review transfer'}).click();
  await page.getByText('Recipient E.',{exact:true}).waitFor();
  const realNow=Date.now;Date.now=()=>realNow()+31000;
  try{
    await page.getByLabel('Fresh authenticator code').fill(otp.generateCurrentToken(secret));
    await page.getByRole('button',{name:'Authorize & send'}).click();
    await page.getByRole('heading',{name:'Transfer completed'}).waitFor();
  }finally{Date.now=realNow;}
  assert.equal(store.account(source.id).balanceCents,8001);assert.equal(store.account(target.id).balanceCents,1999);
  // Commit a transfer, drop its response, navigate away and reload before retrying.
  await page.getByRole('button',{name:'New transfer'}).click();
  await page.getByLabel('Recipient account number').fill(target.accountNumber);
  await page.getByLabel('Amount (USD)').fill('5.00');
  await page.getByRole('button',{name:'Review transfer'}).click();
  const retryKeys=[];let drop=true;
  await page.route('**/api/transactions/transfer',async route=>{
    retryKeys.push(route.request().postDataJSON().idempotencyKey);
    if(drop){drop=false;const response=await route.fetch();assert.equal(response.status(),201);await route.abort('failed');}
    else await route.continue();
  });
  Date.now=()=>realNow()+62000;
  try{
    await page.getByLabel('Fresh authenticator code').fill(otp.generateCurrentToken(secret));
    await page.getByRole('button',{name:'Authorize & send'}).click();
    await page.getByText(/The result is unconfirmed/).waitFor();
  }finally{Date.now=realNow;}
  await page.getByRole('button',{name:'History',exact:true}).first().click();
  await page.getByRole('button',{name:'Transfer',exact:true}).first().click();
  await page.getByRole('button',{name:'Retry transfer',exact:true}).waitFor();
  await page.reload();await page.getByText('Total net worth').waitFor();
  await page.getByRole('button',{name:'Transfer',exact:true}).first().click();
  await page.getByLabel('Fresh authenticator code').fill('123456');
  await page.getByRole('button',{name:'Retry transfer',exact:true}).click();
  await page.getByRole('heading',{name:'Transfer completed'}).waitFor();
  assert.equal(retryKeys.length,2);assert.equal(retryKeys[0],retryKeys[1]);
  assert.equal(store.account(source.id).balanceCents,7501);assert.equal(store.account(target.id).balanceCents,2499);
  await page.unroute('**/api/transactions/transfer');
  // Close the tab after another committed response is lost; recover by its opaque key.
  const paymentTab=await context.newPage();await paymentTab.goto(origin+'/dashboard');await paymentTab.getByText('Total net worth').waitFor();
  await paymentTab.getByRole('button',{name:'Transfer',exact:true}).first().click();
  await paymentTab.getByLabel('Recipient account number').fill(target.accountNumber);await paymentTab.getByLabel('Amount (USD)').fill('0.03');await paymentTab.getByRole('button',{name:'Review transfer'}).click();
  await page.getByRole('button',{name:'New transfer'}).click();
  await page.getByLabel('Recipient account number').fill(target.accountNumber);await page.getByLabel('Amount (USD)').fill('0.01');
  await page.getByRole('button',{name:'Review transfer'}).click();
  await page.route('**/api/transactions/transfer',async route=>{const response=await route.fetch();assert.equal(response.status(),201);await route.abort('failed');});
  Date.now=()=>realNow()+93000;
  try{await page.getByLabel('Fresh authenticator code').fill(otp.generateCurrentToken(secret));await page.getByRole('button',{name:'Authorize & send'}).click();await page.getByText(/The result is unconfirmed/).waitFor();}finally{Date.now=realNow;}
  await paymentTab.getByLabel('Fresh authenticator code').fill('123456');await paymentTab.getByRole('button',{name:'Authorize & send'}).click();
  await paymentTab.getByText('Confirm the earlier transfer before sending another.').waitFor();assert.equal(store.account(target.id).balanceCents,2500);await paymentTab.close();
  const persisted=await page.evaluate(()=>Object.entries(localStorage));assert.equal(persisted.length,1);assert.match(persisted[0][1],/^[a-f0-9-]{36}$/i);
  await page.close();page=await context.newPage();
  page.on('pageerror',err=>errors.push(err.message));page.on('console',msg=>{if(msg.text().includes('Content Security Policy'))csp.push(msg.text());});
  await page.goto(origin+'/dashboard');await page.getByText('Total net worth').waitFor();
  await page.getByRole('button',{name:'Transfer',exact:true}).first().click();
  await page.getByRole('button',{name:'Check previous transfer'}).click();
  await page.getByRole('heading',{name:'Transfer completed'}).waitFor();assert.equal(store.account(source.id).balanceCents,7500);assert.equal(store.account(target.id).balanceCents,2500);
  assert.equal(await page.evaluate(()=>localStorage.length),0);
  // An interrupted history load retries the same page rather than skipping it.
  for(let i=0;i<45;i++)store.fund(source.id,1,'History fixture');
  await page.reload();await page.getByText('Total net worth').waitFor();
  await page.getByRole('button',{name:'History',exact:true}).first().click();
  const offsets=[];let failPage=true;
  await page.route('**/api/transactions?*',async route=>{
    const offset=Number(new URL(route.request().url()).searchParams.get('offset'));
    offsets.push(offset);
    if(offset===20&&failPage){failPage=false;await route.abort('failed');}else await route.continue();
  });
  await page.getByRole('button',{name:'Load more transactions'}).click();
  await page.getByRole('alert').waitFor();
  await page.getByRole('button',{name:'Load more transactions'}).click();
  await page.getByRole('alert').waitFor({state:'detached'});
  assert.deepEqual(offsets,[20,20]);
  await page.unroute('**/api/transactions?*');
  // Concurrent tab restoration must serialize refresh-cookie rotation.
  const tabs=await Promise.all([page.context().newPage(),page.context().newPage()]);
  await Promise.all(tabs.map(p=>p.goto(origin+'/dashboard')));
  await Promise.all(tabs.map(p=>p.getByText('Total net worth').waitFor()));
  assert.equal(store.get('SELECT COUNT(*) AS n FROM sessions WHERE userId=? AND revoked=0',user.id).n,1);
  await page.getByRole('button',{name:'Toggle navigation'}).click();
  assert.equal(await page.getByRole('button',{name:'Sign out'}).count(),1);
  await page.getByRole('button',{name:'Toggle navigation'}).click();
  await page.setViewportSize({width:390,height:844});
  await page.getByRole('button',{name:'Dashboard',exact:true}).click();
  const widths=await page.evaluate(()=>({client:document.documentElement.clientWidth,scroll:document.documentElement.scrollWidth}));
  assert.ok(widths.scroll<=widths.client,'Mobile layout overflows horizontally.');
  assert.equal(store.reconcile().ok,true);
  await page.getByRole('button',{name:'Sign out',exact:true}).click();
  await page.getByRole('heading',{name:'Sign in',exact:true}).waitFor();
  await Promise.all(tabs.map(p=>p.getByRole('heading',{name:'Sign in',exact:true}).waitFor()));
  await Promise.all(tabs.map(p=>p.close()));
  assert.equal(store.get('SELECT COUNT(*) AS n FROM sessions WHERE userId=? AND revoked=0',user.id).n,0);
  await page.goto(origin+'/register');
  await page.getByLabel('Full name').fill('New Browser User');
  await page.getByLabel('Email address').fill('newbrowser@example.com');
  await page.getByLabel('Password',{exact:true}).fill('Browser@123');
  await page.getByLabel('Confirm password').fill('Browser@123');
  await page.getByRole('button',{name:'Continue',exact:true}).click();
  await page.getByRole('heading',{name:'Check your email'}).waitFor();
  assert.equal(store.userByEmail('newbrowser@example.com'),null);
  const ticket=store.mailMessages('newbrowser@example.com').at(-1).ticket;
  await page.goto(origin+'/register?ticket='+ticket);
  await page.getByRole('heading',{name:'Confirm your verification link'}).waitFor();
  await page.getByLabel('Password',{exact:true}).fill('Browser@123');
  await page.getByRole('button',{name:'Verify email & continue'}).click();
  await page.getByRole('heading',{name:'Set up authenticator'}).waitFor();
  assert.equal(await page.locator('svg').count(),1);
  const enrolled=store.userByEmail('newbrowser@example.com');
  await page.getByLabel('6-digit authenticator code').fill(otp.generateCurrentToken(enrolled.twoFactorSecret));
  await page.getByRole('button',{name:'Activate authenticator'}).click();
  await page.getByRole('heading',{name:'Save recovery codes'}).waitFor();
  await page.getByRole('button',{name:'I saved my codes. Continue'}).click();
  await page.getByText('Total net worth').waitFor();
  assert.equal(csp.length,0,'Unexpected CSP violations: '+csp.join('; '));
  assert.equal(errors.length,0,'Unexpected browser errors: '+errors.join('; '));
  console.log('Browser regression passed: login, exact-cent transfer, lost-response retry after navigation/reload (one debit), closed-tab result recovery, failed history-page retry, concurrent tabs and sign-out propagation, mobile layout, password-bound email proof, QR enrollment and recovery codes; balanced ledger and no CSP or JavaScript errors.');
 }finally{
  if(browser)await browser.close();
  await new Promise(resolve=>server.close(resolve));store.close();
 }
}
main().catch(err=>{console.error(err);process.exitCode=1;});

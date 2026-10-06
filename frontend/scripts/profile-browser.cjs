'use strict';
process.env.NODE_ENV='test';process.env.BCRYPT_ROUNDS='4';
const {randomBytes}=require('node:crypto');
for(const key of ['JWT_ACCESS_SECRET','JWT_REFRESH_SECRET','JWT_PREAUTH_SECRET','DATA_ENCRYPTION_KEY'])process.env[key]=randomBytes(32).toString('hex');
const assert=require('node:assert/strict');
const {chromium}=require('playwright-core');
const fs=require('node:fs');
const {createStore}=require('../../backend/store/database');
const {createApp}=require('../../backend/app');
const otp=require('../../backend/services/twoFactorService');
const password=require('../../backend/services/passwordService');
const config=require('../../backend/config');
async function main(){
 const store=createStore(':memory:'),app=createApp({store,rateLimit:false});
 const server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});
 const origin='http://127.0.0.1:'+server.address().port;config.cors.origins.push(origin);
 const executable=process.env.BROWSER_PATH||['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe','C:/Program Files/Google/Chrome/Application/chrome.exe','/usr/bin/chromium','/usr/bin/google-chrome'].find(p=>fs.existsSync(p));
 let browser;const realNow=Date.now;let now=realNow();Date.now=()=>now;
 try{
  browser=await chromium.launch(executable?{headless:true,executablePath:executable}:{headless:true});
  const context=await browser.newContext(),page=await context.newPage();
  const errors=[],csp=[];page.on('pageerror',err=>errors.push(err.message));page.on('console',msg=>{if(msg.text().includes('Content Security Policy'))csp.push(msg.text());});
  const secret=otp.generateSecret('profile-browser@example.com').base32;
  const user=store.createUser({name:'Profile Browser',email:'profile-browser@example.com',passwordHash:await password.hash('Browser@123'),twoFactorSecret:secret});store.enableTwoFactor(user.id);store.recoveryCodes(user.id);
  const account=store.accounts(user.id)[0];
  const login=async(p,plain='Browser@123')=>{
   await p.goto(origin+'/login');await p.getByLabel('Email address').fill(user.email);await p.getByLabel('Password',{exact:true}).fill(plain);await p.getByRole('button',{name:'Continue',exact:true}).click();
   now+=31000;await p.getByLabel('6-digit authenticator code').fill(otp.generateCurrentToken(secret));await p.getByRole('button',{name:'Verify & sign in',exact:true}).click();await p.getByRole('button',{name:'Dashboard',exact:true}).waitFor();await p.getByRole('button',{name:'Dashboard',exact:true}).click();await p.getByText('Total net worth').waitFor();
  };
  await page.goto(origin+'/profile');await page.getByRole('heading',{name:'Sign in',exact:true}).waitFor();
  // A protected deep link is restored after login.
  await page.getByLabel('Email address').fill(user.email);await page.getByLabel('Password',{exact:true}).fill('Browser@123');await page.getByRole('button',{name:'Continue',exact:true}).click();
  now+=31000;await page.getByLabel('6-digit authenticator code').fill(otp.generateCurrentToken(secret));await page.getByRole('button',{name:'Verify & sign in',exact:true}).click();await page.getByRole('heading',{name:'Your profile'}).waitFor();
  await page.getByText(/8 unused recovery codes/).waitFor();assert.equal(await page.getByLabel('Verified email address').inputValue(),user.email);
  await page.getByLabel('Full name').fill('Profile Updated');await page.getByRole('button',{name:'Save profile'}).click();await page.getByText('Your profile has been updated.').waitFor();assert.equal(store.userById(user.id).name,'Profile Updated');
  if(process.env.PROFILE_SCREENSHOT_DIR)await page.screenshot({path:process.env.PROFILE_SCREENSHOT_DIR+'/profile-desktop.png',fullPage:true,animations:'disabled'});
  // Lose a committed response, navigate/reload, then retry the same credit.
  const keys=[];let drop=true;await page.route('**/api/accounts/*/test-funds',async route=>{
   keys.push(route.request().postDataJSON().idempotencyKey);
   if(drop){drop=false;const response=await route.fetch();assert.equal(response.status(),201);await route.abort('failed');}else await route.continue();
  });
  await page.getByLabel('Test amount (USD)').fill('19.99');await page.getByRole('button',{name:'Add test money'}).click();await page.getByText(/The previous top-up needs confirmation/).waitFor();
  await page.getByRole('button',{name:'Dashboard',exact:true}).click();await page.getByText('Total net worth').waitFor();
  await page.getByRole('button',{name:'Profile',exact:true}).click();await page.getByRole('button',{name:'Retry test top-up'}).waitFor();await page.reload();await page.getByRole('button',{name:'Retry test top-up'}).click();
  await page.getByRole('status').filter({hasText:/in test money added/}).waitFor();assert.equal(keys.length,2);assert.equal(keys[0],keys[1]);assert.equal(store.account(account.id).balanceCents,1999);
  // Close a tab after a second lost response; the next tab recovers its opaque key.
  drop=true;await page.getByLabel('Test amount (USD)').fill('0.29');await page.getByRole('button',{name:'Add test money'}).click();await page.getByText(/The previous top-up needs confirmation/).waitFor();await page.close();
  const recovered=await context.newPage();recovered.on('pageerror',err=>errors.push(err.message));await recovered.goto(origin+'/profile');await recovered.getByRole('button',{name:'Check previous top-up'}).click();await recovered.getByRole('status').filter({hasText:/in test money added/}).waitFor();
  assert.equal(store.account(account.id).balanceCents,2028);assert.equal(await recovered.evaluate(()=>localStorage.length),0);
  await recovered.getByRole('button',{name:'History',exact:true}).click();await recovered.getByText('Test money top-up').first().waitFor();
  await recovered.getByRole('button',{name:'Profile',exact:true}).click();await recovered.getByRole('heading',{name:'Your profile'}).waitFor();
  // Revocation affects only the chosen session, including its refresh cookie.
  const secondContext=await browser.newContext(),second=await secondContext.newPage();await login(second);await recovered.reload();await recovered.getByText('Active sessions (2)').waitFor();
  await recovered.getByRole('button',{name:/Sign out session \d/}).click();await recovered.getByText('Active sessions (1)').waitFor();await second.reload();await second.getByRole('heading',{name:'Sign in',exact:true}).waitFor();
  await login(second);await recovered.reload();await recovered.getByText('Active sessions (2)').waitFor();
  await recovered.setViewportSize({width:390,height:844});
  await recovered.waitForFunction(()=>document.querySelector('.vault-sidebar').getBoundingClientRect().width<=64.1);
  const widths=await recovered.evaluate(()=>({client:document.documentElement.clientWidth,scroll:document.documentElement.scrollWidth}));assert.ok(widths.scroll<=widths.client,'Profile overflows on mobile.');
  if(process.env.PROFILE_SCREENSHOT_DIR)await recovered.screenshot({path:process.env.PROFILE_SCREENSHOT_DIR+'/profile-mobile.png',fullPage:true,animations:'disabled'});
  // Changing the password signs out both sessions and preserves mandatory 2FA.
  await recovered.getByLabel('Current password').fill('Browser@123');await recovered.getByLabel('New password',{exact:true}).fill('ChangedBrowser@456');await recovered.getByLabel('Confirm new password').fill('ChangedBrowser@456');
  now+=31000;await recovered.getByLabel('Fresh authenticator code').fill(otp.generateCurrentToken(secret));await recovered.getByRole('button',{name:'Change password & sign out'}).click();await recovered.getByRole('heading',{name:'Sign in',exact:true}).waitFor();
  await second.reload();await second.getByRole('heading',{name:'Sign in',exact:true}).waitFor();assert.equal(store.get('SELECT COUNT(*) AS n FROM sessions WHERE userId=? AND revoked=0',user.id).n,0);
  assert.equal(await password.compare('Browser@123',store.userById(user.id).passwordHash),false);assert.equal(store.userById(user.id).twoFactorEnabled,true);
  // Sign out everywhere through the profile and propagate to another tab.
  await login(recovered,'ChangedBrowser@456');const sharedTab=await context.newPage();await sharedTab.goto(origin+'/dashboard');await sharedTab.getByText('Total net worth').waitFor();
  await recovered.getByRole('button',{name:'Profile',exact:true}).click();await recovered.getByRole('button',{name:'Sign out on all devices',exact:true}).click();await recovered.getByRole('button',{name:'Confirm sign out on all devices'}).click();
  await recovered.getByRole('heading',{name:'Sign in',exact:true}).waitFor();await sharedTab.getByRole('heading',{name:'Sign in',exact:true}).waitFor();
  assert.equal(store.reconcile().ok,true);assert.equal(errors.length,0,errors.join('; '));assert.equal(csp.length,0,csp.join('; '));
  console.log('Profile browser regression passed: protected profile, name update, exact-cent test top-ups, lost-response retry after navigation/reload, closed-tab recovery, history, session revocation, password change, sign-out on all devices and mobile layout; balanced ledger and no browser errors.');
 }finally{Date.now=realNow;if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));store.close();}
}
main().catch(err=>{console.error(err);process.exitCode=1;});

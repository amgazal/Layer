// Public-domain smoke: all personalization stays in this disposable browser.
// No sign-in requests, hosted rows, dashboard settings, or email configuration.
import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
const origin='https://layer.amgazal.com';
const browser=await chromium.launch();
const context=await browser.newContext({viewport:{width:393,height:852},reducedMotion:'reduce'});
const page=await context.newPage();
const exceptions=[],assetFailures=[],weatherResponses=[];
page.on('pageerror',error=>exceptions.push(error.message));
page.on('response',response=>{
  if(response.url().startsWith(origin)&&response.status()>=400)assetFailures.push(response.url());
  if(response.url().includes('api.open-meteo.com'))weatherResponses.push(response.status());
});
let count=0;
const pass=name=>{count++;console.log(`PASS ${name}`);};
const visible=async locator=>{await locator.waitFor({state:'visible',timeout:30000});};
try {
  const response=await page.goto(origin,{waitUntil:'networkidle'});
  assert.equal(response.status(),200);assert.ok((await response.securityDetails())?.protocol);pass('HTTPS root with certificate validation');
  await visible(page.getByRole('button',{name:'See my recommendation'}));
  await page.getByRole('button',{name:'Sign in',exact:true}).click();
  await page.getByRole('button',{name:'Continue with email'}).click();
  await visible(page.getByRole('textbox',{name:'Email address'}));pass('returning-user email sign-in UI (no email sent)');
  await page.getByRole('button',{name:'Back to setup'}).click();
  await page.getByRole('button',{name:'Four seasons'}).click();
  await page.getByRole('button',{name:'About the same',exact:true}).click();
  await page.getByRole('button',{name:'See my recommendation'}).click();
  for(let attempt=0;attempt<3;attempt++){
    try {await page.getByText('Wear this',{exact:true}).waitFor({timeout:15000});break;}
    catch(error){if(attempt===2)throw error;await page.getByRole('button',{name:'Retry',exact:true}).click();}
  }
  assert.ok(weatherResponses.includes(200));pass('real weather request and personalized recommendation');
  const before=await page.evaluate(()=>JSON.parse(localStorage.getItem('layer:wx-cache:v8')).at);
  await page.getByRole('button',{name:'Refresh weather',exact:true}).click();
  await page.waitForFunction(before=>JSON.parse(localStorage.getItem('layer:wx-cache:v8')).at>before,before);
  pass('manual weather refresh');
  await page.getByRole('button',{name:'Use my location',exact:true}).click();
  await visible(page.getByText('Location unavailable. Using Cornell campus weather.',{exact:true}));pass('denied location fallback');
  await page.getByRole('button',{name:'Use campus location',exact:true}).click();
  await context.grantPermissions(['geolocation']);
  await context.setGeolocation({latitude:42.454321,longitude:-76.475678,accuracy:30});
  await page.getByRole('button',{name:'Use my location',exact:true}).click();
  // The campus subtitle is deliberately hidden in the narrow mobile header.
  await page.waitForFunction(()=>document.querySelector('.campus-line small')?.textContent==='Near you on campus');
  assert.ok(!(await page.evaluate(()=>JSON.stringify(localStorage)+JSON.stringify(sessionStorage)+location.href)).includes('42.454321'));
  pass('allowed location and coordinate persistence check');
  await page.getByRole('button',{name:'Use campus location',exact:true}).click();
  await page.getByRole('button',{name:'Plan a later time'}).click();
  await visible(page.locator('.compact-planner'));pass('expanded outing planner');
  await page.getByRole('button',{name:'Rate this outing'}).click();
  await page.getByRole('button',{name:'Just right',exact:true}).click();
  await page.waitForFunction(()=>JSON.parse(localStorage.getItem('layer:model:v5')).history.length===1);pass('local feedback and streak');
  await page.getByRole('button',{name:'Open profile and account'}).click();
  await visible(page.getByRole('dialog'));pass('profile modal');
  await page.keyboard.press('Escape');
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));pass('393px mobile layout');
  await page.screenshot({path:'test-results/production-custom-domain-393.png',fullPage:true});
  await page.reload({waitUntil:'networkidle'});await visible(page.getByText('Wear this',{exact:true}));pass('hard reload with saved local personalization');
  const walk=dir=>fs.readdirSync(dir,{withFileTypes:true}).flatMap(entry=>entry.isDirectory()?walk(path.join(dir,entry.name)):[path.join(dir,entry.name)]);
  for(const file of walk('public'))assert.equal((await context.request.get(`${origin}/${file.slice(7)}`)).status(),200,file);
  pass('all public static assets return 200');
  const html=await (await context.request.get(origin)).text();
  assert.ok(html.includes('https://layer.amgazal.com/'));pass('custom-domain metadata');
  const bundlePath=html.match(/src="([^"]+\.js)"/)[1];
  const bundle=await (await context.request.get(new URL(bundlePath,origin).href)).text();
  assert.ok(bundle.includes('layer:auth-result-v2'));assert.ok(bundle.includes('Account sync will continue in the background.'));
  assert.ok(!/sb_secret_[A-Za-z0-9_-]{20,}|\bre_[A-Za-z0-9_-]{24,}\b/.test(bundle));
  for(const jwt of bundle.match(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g)||[]){
    assert.notEqual(JSON.parse(Buffer.from(jwt.split('.')[1],'base64url')).role,'service_role');
  }
  pass(`deployed fix markers and public-only credential scan (${bundlePath})`);
  await page.goto(`${origin}/auth-callback.html`);
  await page.waitForURL(`${origin}/?layer_auth_return=1`);pass('direct custom-domain callback returns to root');
  assert.deepEqual(exceptions,[]);assert.deepEqual(assetFailures,[]);pass('no page exceptions or application asset failures');
  console.log(`${count} production smoke checks passed. Weather response statuses: ${weatherResponses.join(',')}`);
  console.log('Real production email sign-in still requires an authorized account and email interaction.');
} finally {await browser.close();}

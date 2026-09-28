import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
const clock = new Date('2026-09-27T16:00:00Z');
const epoch = clock.getTime()/1000;
function response(mode='dry') {
  const series=(length,step)=>({time:Array.from({length},(_,i)=>epoch+i*step),
    temperature_2m:Array.from({length},(_,i)=>67-Math.min(i*step/3600,2)*6.5),
    apparent_temperature:Array.from({length},(_,i)=>67-Math.min(i*step/3600,2)*6.5),
    weather_code:Array(length).fill(0), is_day:Array(length).fill(1),
    wind_speed_10m:Array(length).fill(5),wind_gusts_10m:Array(length).fill(8),
    precipitation:Array.from({length},(_,i)=>mode==='rain' && i===0 || mode==='later' && i*step>=1800 && i*step<3600 ? .2 : 0),
    precipitation_probability:Array(length).fill(mode==='later'?55:0)});
  return {current:{time:epoch,interval:900,temperature_2m:67,apparent_temperature:67,weather_code:0,is_day:1,wind_speed_10m:5,wind_gusts_10m:8,precipitation:mode==='rain'?.2:0,rain:0,showers:0},minutely_15:series(97,900),hourly:series(48,3600)};
}
async function setup(page,mode='dry',seed=true) {
  await page.clock.install({time:clock});
  if(seed) await page.addInitScript(()=>!localStorage.getItem('layer:model:v5') && localStorage.setItem('layer:model:v5',JSON.stringify({v:5,seeded:true,regime:{cold:{off:0,n:0},mild:{off:0,n:0},warm:{off:0,n:0}},factors:{wind:0,wet:0,sun:0},history:[]})));
  await page.route('**/api.open-meteo.com/**',route=>mode==='fail'?route.abort():route.fulfill({json:response(mode)}));
  await page.goto('/');
}
test('first use, activity, duration and local feedback persist',async({page})=>{
  await setup(page,'dry',false);
  await page.getByRole('button',{name:'Four seasons'}).click();
  await page.getByRole('button',{name:'About the same',exact:true}).click();
  await page.getByRole('button',{name:'See my recommendation'}).click();
  await expect(page.getByText('Wear this',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'20 min',exact:true}).click();
  const short=await page.locator('.read-you .read-v').innerText();
  await page.getByRole('button',{name:'4+ hrs',exact:true}).click();
  await expect(page.locator('.read-you .read-v')).not.toHaveText(short);
  await expect(page.getByText(/Bring:/)).toBeVisible();
  await page.getByRole('button',{name:/Standing/}).click();
  await page.getByRole('button',{name:'Rate this outing'}).click();
  await page.getByRole('button',{name:'Too cold',exact:true}).click();
  await page.getByRole('button',{name:'Not sure'}).click();
  const saved=await page.evaluate(()=>localStorage.getItem('layer:model:v5'));
  await page.reload();
  expect(await page.evaluate(()=>localStorage.getItem('layer:model:v5'))).toBe(saved);
  await expect(page.getByRole('button',{name:'See my recommendation'})).toHaveCount(0);
});
test('short rain beats clear code and local report refreshes then expires',async({page})=>{
  await setup(page,'rain');
  await expect(page.locator('.cond-inline')).toHaveText('Light rain');
  let requests=0; page.on('request',r=>{if(r.url().includes('api.open-meteo'))requests++;});
  await page.getByRole('button',{name:'Conditions look wrong?'}).click();
  await page.getByRole('button',{name:'Dry here',exact:true}).click();
  await expect(page.locator('.cond-inline')).toContainText('Dry here');
  await expect.poll(()=>requests).toBeGreaterThan(0);
  await page.clock.fastForward(15*60_000);
  await expect(page.locator('.cond-inline')).toHaveText('Light rain');
});
test('future rain leaves current header dry, including later departure',async({page})=>{
  await setup(page,'later');
  await expect(page.locator('.cond-inline')).toHaveText('Clear');
  await expect(page.locator('.wear-list')).toContainText(/shell|jacket/i);
  await expect(page.locator('.warnbar')).toContainText('Rain is possible');
  await page.getByRole('button',{name:'Plan a later time'}).click();
  await page.getByRole('button',{name:'1:00 PM',exact:true}).click();
  await expect(page.locator('.cond-inline')).toHaveText('Clear');
});
test('failure shows retry and never a synthetic recommendation',async({page})=>{
  await setup(page,'fail');
  await expect(page.getByRole('heading',{name:'Weather unavailable'})).toBeVisible();
  await expect(page.getByText('71°',{exact:true})).toHaveCount(0);
  await expect(page.getByText('Wear this',{exact:true})).toHaveCount(0);
  await page.unroute('**/api.open-meteo.com/**');
  await page.route('**/api.open-meteo.com/**',r=>r.fulfill({json:response()}));
  await page.getByRole('button',{name:'Retry',exact:true}).click();
  await expect(page.getByText('Wear this',{exact:true})).toBeVisible();
});
for(const age of [60_000,3600_000]) test(`cache age ${age} survives failure and refreshes`,async({page})=>{
  const raw=response();
  const data={current:{actual:67,apparent:67,code:0,wind:5,gust:8,precip:0,precipRate:0,time:epoch,isDay:1},minutely:raw.minutely_15,hourly:raw.hourly};
  await page.addInitScript(({data,at})=>localStorage.setItem('layer:wx-cache:v8',JSON.stringify({data,at})),{data,at:clock.getTime()-age});
  await setup(page,'fail');
  await expect(page.getByText('Wear this',{exact:true})).toBeVisible();
  if(age>900000) await expect(page.locator('.weather-age')).toContainText('Weather may be outdated');
  await page.unroute('**/api.open-meteo.com/**');
  await page.route('**/api.open-meteo.com/**',r=>r.fulfill({json:response()}));
  await page.getByRole('button',{name:'Refresh weather',exact:true}).click();
  await expect(page.locator('.weather-age')).toHaveText('Updated now');
});
for(const width of [320,375,430,768,1024,1440]) test(`responsive ${width}, keyboard profile and accessibility`,async({page})=>{
  await page.setViewportSize({width,height:900});
  await setup(page);
  await expect(page.getByText('Wear this',{exact:true})).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  if ([375,1440].includes(width)) await page.screenshot({path:`test-results/layer-${width}.png`,fullPage:true});
  await page.getByRole('button',{name:'Open profile and account'}).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  const dialogAxe=await new AxeBuilder({page}).include('[role=dialog]').withTags(['wcag2a','wcag2aa']).analyze();
  expect(dialogAxe.violations.map(v=>({id:v.id,nodes:v.nodes.map(n=>n.target)}))).toEqual([]);
  await page.keyboard.press('Shift+Tab');
  expect(await page.evaluate(()=>!!document.activeElement.closest('[role="dialog"]'))).toBe(true);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button',{name:'Open profile and account'})).toBeFocused();
  const results=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa']).analyze();
  expect(results.violations.map(v => ({ id:v.id, nodes:v.nodes.map(n=>({target:n.target,reason:n.failureSummary})) }))).toEqual([]);
});
test('precise location is optional and never stored',async({page,context})=>{
  await context.grantPermissions(['geolocation']);
  await context.setGeolocation({latitude:42.454321,longitude:-76.475678,accuracy:30});
  await setup(page);
  await page.getByRole('button',{name:'Use my location',exact:true}).click();
  await expect(page.getByText('Near you on campus',{exact:true})).toBeVisible();
  expect(await page.evaluate(()=>JSON.stringify(localStorage))).not.toContain('42.454321');
  await page.getByRole('button',{name:'Use campus location',exact:true}).click();
  await expect(page.locator('.campus-line small')).toHaveText('Campus');
});
test('manual refresh and simultaneous visibility/focus events share one request pair',async({page})=>{
  await setup(page);
  await expect(page.getByText('Wear this',{exact:true})).toBeVisible();
  await page.clock.fastForward(100_000);
  await page.unroute('**/api.open-meteo.com/**');
  let release;const gate=new Promise(r=>release=r);let requests=0;
  await page.route('**/api.open-meteo.com/**',async r=>{requests++;await gate;await r.fulfill({json:response()});});
  await page.getByRole('button',{name:'Refresh weather',exact:true}).click();
  await page.evaluate(()=>{window.dispatchEvent(new Event('focus'));window.dispatchEvent(new Event('pageshow'));document.dispatchEvent(new Event('visibilitychange'));});
  await expect.poll(()=>requests).toBe(2);
  release();
  await expect(page.locator('.weather-age')).not.toContainText('Updating…');
  expect(requests).toBe(2);
});
test('denied location falls back to campus without blocking weather',async({page})=>{
  await page.addInitScript(()=>Object.defineProperty(navigator,'geolocation',{value:{getCurrentPosition:(_,error)=>error({code:1})}}));
  await setup(page);
  await page.getByRole('button',{name:'Use my location',exact:true}).click();
  await expect(page.getByText('Location unavailable. Using Cornell campus weather.')).toBeVisible();
  await expect(page.getByText('Wear this',{exact:true})).toBeVisible();
});
test('onboarding and unavailable state pass automated accessibility checks',async({page})=>{
  await setup(page,'fail',false);
  const audit=async()=>{
    const result=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa']).analyze();
    expect(result.violations.map(v=>({id:v.id,nodes:v.nodes.map(n=>n.target)}))).toEqual([]);
  };
  await audit();
  await page.getByRole('button',{name:'Four seasons'}).click();
  await page.getByRole('button',{name:'About the same',exact:true}).click();
  await page.getByRole('button',{name:'See my recommendation'}).click();
  await expect(page.getByRole('heading',{name:'Weather unavailable'})).toBeVisible();
  await audit();
});

for (const minutes of [9,16,31]) test(`fresh fetch with provider age ${minutes} minutes`,async({page})=>{
  await setup(page);
  await expect(page.locator('.weather-age')).toHaveText('Updated now');
  await page.unroute('**/api.open-meteo.com/**');
  let release; const gate=new Promise(r=>release=r);
  await page.route('**/api.open-meteo.com/**',async r=>{
    await gate;const data=response();data.current.time=epoch-minutes*60;await r.fulfill({json:data});
  });
  try {
    await page.getByRole('button',{name:'Refresh weather',exact:true}).click();
    await expect(page.locator('.weather-age')).toHaveText('Updating…');
  } finally { release(); }
  await expect(page.locator('.weather-age')).toHaveText(minutes>30?'Weather may be outdated':'Updated now');
  await expect(page.locator('.hero [role=status]').filter({hasText:/Updated|Updating|outdated/})).toHaveCount(1);
  if(minutes>30){
    await expect(page.getByText('Weather may be outdated',{exact:true})).toHaveCount(1);
    await expect(page.getByRole('button',{name:'Refresh',exact:true})).toBeVisible();
    for (const width of [320,375,430,768]) {
      await page.setViewportSize({width,height:900});
      expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
      await page.screenshot({path:`test-results/freshness-stale-${width}.png`,fullPage:false});
    }
    const audit=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa']).analyze();
    expect(audit.violations.map(v=>({id:v.id,nodes:v.nodes.map(n=>({target:n.target,reason:n.failureSummary}))}))).toEqual([]);
  }
});
test('failed refresh retains recent weather with one compact status',async({page})=>{
  await setup(page);
  await expect(page.locator('.weather-age')).toHaveText('Updated now');
  await page.unroute('**/api.open-meteo.com/**');
  await page.route('**/api.open-meteo.com/**',r=>r.abort());
  await page.getByRole('button',{name:'Refresh weather',exact:true}).click();
  await expect(page.locator('.weather-age')).toHaveText('Couldn’t update · Showing recent weather');
  await expect(page.getByText('Wear this',{exact:true})).toBeVisible();
});
for(const [coords,notice] of [
  [{latitude:40,longitude:-73,accuracy:20},'Layer supports the Ithaca area. Showing Cornell campus weather.'],
  [{latitude:42.454321,longitude:-76.475678,accuracy:900},'Location unavailable. Using Cornell campus weather.'],
]) test(`location fallback: ${notice}`,async({page,context})=>{
  await context.grantPermissions(['geolocation']);await context.setGeolocation(coords);await setup(page);
  await page.getByRole('button',{name:'Use my location',exact:true}).click();
  await expect(page.getByText(notice)).toBeVisible();
  await expect(page.locator('.campus-line small')).toHaveText('Campus');
  const storage=await page.evaluate(()=>JSON.stringify(localStorage));
  expect(storage).not.toContain(String(coords.longitude));
});
test('feedback streak stays in feedback section and does not train just-right ratings',async({page})=>{
  await page.emulateMedia({reducedMotion:'reduce'});await setup(page);
  const before=await page.evaluate(()=>JSON.parse(localStorage.getItem('layer:model:v5')));
  await page.getByRole('button',{name:'Rate this outing'}).click();
  await page.getByRole('button',{name:'Just right',exact:true}).click();
  await expect(page.locator('.feedback-streak')).toHaveText('1-day feedback streak');
  await expect(page.locator('.toast')).toHaveText('Thanks — another outing rated.');
  await expect(page.locator('.hero')).not.toContainText('streak');
  const after=await page.evaluate(()=>JSON.parse(localStorage.getItem('layer:model:v5')));
  expect(after.regime).toEqual(before.regime);expect(after.factors).toEqual(before.factors);
  await page.getByRole('button',{name:'No',exact:true}).click();
  await page.getByRole('button',{name:'Too cold',exact:true}).click();
  await page.getByRole('button',{name:'Not sure'}).click();
  const unrated=await page.evaluate(()=>JSON.parse(localStorage.getItem('layer:model:v5')));
  expect(unrated.history).toHaveLength(2);expect(unrated.regime).toEqual(before.regime);
  await page.reload();await expect(page.locator('.feedback-streak')).toHaveText('1-day feedback streak');
  await page.setViewportSize({width:375,height:812});
  const audit=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa']).analyze();
  expect(audit.violations.map(v=>({id:v.id,nodes:v.nodes.map(n=>({target:n.target,reason:n.failureSummary}))}))).toEqual([]);
  await page.setViewportSize({width:844,height:390});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});

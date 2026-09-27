import {test,expect} from '@playwright/test';
for(const base of ['/','/Layer/'])test(`production assets under ${base}`,async({page,request})=>{
  const failures=[];page.on('response',r=>{if(r.url().startsWith('http://127.0.0.1:4175')&&r.status()>=400)failures.push(r.url());});
  await page.route('**/api.open-meteo.com/**',r=>r.abort());
  await page.goto(base);
  await expect(page.getByRole('button',{name:'See my recommendation'})).toBeVisible();
  for(const asset of ['auth-callback.html','manifest.webmanifest','backgrounds/rain.webp','backgrounds/clear-campus.webp','backgrounds/rain-loop.mp4'])expect((await request.get(base+asset)).ok()).toBe(true);
  expect(failures).toEqual([]);
});

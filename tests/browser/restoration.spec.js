import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { seedModel } from '../../src/lib/model.js';

const saved = seedModel('tropical', 'colder');
saved.regime.cold.n = 12;
const local = seedModel('cold', 'warmer');

// The real React app, StrictMode, sync layer and static callback run unchanged.
// Only the Supabase transport is controlled so every race has a deterministic gate.
async function setup(page, options = {}) {
  await page.route('**/src/lib/supabase.js', route => route.fulfill({contentType:'application/javascript', body:`
    export const cloudEnabled=true, providerEnabled={}, CORNELL_DOMAIN='cornell.edu';
    export const authRedirectUrl=()=>new URL('auth-callback.html',location.href).href;
    let listener, user=null, release;
    const gate=new Promise(r=>release=r);
    const options=${JSON.stringify(options)};
    const a=window.account={reads:[],writes:[],exchanges:0,fail:options.fail,
      release,signIn(){user={id:'returning',is_anonymous:false,email:'returning@example.test'};listener('SIGNED_IN',{user});},
      repeat(){listener('SIGNED_IN',{user});}, signOut(){user=null;listener('SIGNED_OUT',null);}};
    export const supabase={auth:{
      onAuthStateChange(fn){listener=fn;queueMicrotask(()=>fn('INITIAL_SESSION',user?{user}:null));},
      async getSession(){return {data:{session:user?{user}:null}};},
      async exchangeCodeForSession(){a.exchanges++;a.signIn();return {data:{user}};},
      async signInWithOtp(){return {error:null};},
      async signOut(){a.signOut();return {error:null};}
    },from(table){return {
      select(){return {eq(){return {async maybeSingle(){a.reads.push(table);await gate;if(a.fail)return {error:new Error('offline')};return {data:table==='model_state'?(options.model?{model:options.model}:null):(options.profile||null)};}};}};},
      upsert(row){a.writes.push({table,row});return Promise.resolve({error:null});},
      update(){return {eq(){return Promise.resolve({error:null});}};},
      delete(){return {eq(){return Promise.resolve({error:null});}};}
    };}};
  `}));
  await page.route('**/api.open-meteo.com/**', r => r.abort());
  await page.addInitScript(({localModel,lateRead}) => {
    if(localModel)localStorage.setItem('layer:model:v5',JSON.stringify(localModel));
    if(lateRead){
      let reads=0;
      window.storage={get(key){
        if(key==='layer:model:v5' && ++reads===1)return new Promise(resolve=>window.releaseOldLocal=()=>resolve({value:JSON.stringify({seeded:false})}));
        const value=localStorage.getItem(key);return Promise.resolve(value?{value}:null);
      },async set(key,value){localStorage.setItem(key,value);}};
    }
  }, {localModel:options.local,lateRead:options.lateRead});
  await page.goto('/');
}
async function signIn(page) {
  await page.evaluate(() => {
    window.onboardingFlashes=[];
    window.watchOnboarding=new MutationObserver(()=>{
      if([...document.querySelectorAll('button')].some(b=>b.textContent==='See my recommendation'))window.onboardingFlashes.push(document.body.innerText);
    });
    window.account.signIn();
  });
  await expect(page.getByText('Loading your saved Layer profile…')).toBeVisible();
  await page.evaluate(()=>window.watchOnboarding.observe(document.getElementById('root'),{subtree:true,childList:true}));
}
async function main(page, model) {
  await expect(page.getByRole('heading',{name:'Weather unavailable'})).toBeVisible();
  expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('layer:model:v5')))).toEqual(model);
  expect(await page.evaluate(()=>window.onboardingFlashes)).toEqual([]);
}

test('StrictMode stale local read cannot replace restored personalization after sign-in', async({page})=>{
  await setup(page,{model:saved,lateRead:true});
  await expect(page.getByRole('button',{name:'See my recommendation'})).toBeVisible();
  await signIn(page);
  await page.evaluate(()=>account.release());
  await main(page,saved);
  await page.evaluate(()=>window.releaseOldLocal());
  await main(page,saved);
});
for(const kind of ['model','profile','attach'])test(`asynchronous ${kind} restore wins, repeated auth does not overwrite`,async({page})=>{
  await setup(page,kind==='model'?{model:saved,local}:kind==='profile'?{profile:{climate:'tropical',tolerance:'colder'}}:{local});
  await signIn(page);
  await page.evaluate(()=>{account.repeat();dispatchEvent(new Event('focus'));dispatchEvent(new Event('pageshow'));});
  expect(await page.evaluate(()=>account.writes)).toEqual([]);
  await page.evaluate(()=>account.release());
  await main(page,kind==='model'?saved:kind==='profile'?seedModel('tropical','colder'):local);
  await page.evaluate(async()=>{const s=await import('/src/lib/sync.js');await s.flushPendingModel();});
  expect(await page.evaluate(()=>account.reads)).toEqual(kind==='model'?['model_state']:['model_state','profiles']);
  expect(await page.evaluate(()=>account.writes.length)).toBe(kind==='model'?0:1);
});
test('confirmed empty is the only permanent-account path to setup',async({page})=>{
  await setup(page);
  await signIn(page);
  await page.evaluate(()=>account.release());
  await expect(page.getByRole('button',{name:'See my recommendation'})).toBeVisible();
  await expect(page.getByText(/No saved Layer profile was found yet/)).toBeVisible();
  expect(await page.evaluate(()=>account.writes)).toEqual([]);
});
test('failed restore stays recoverable; keyboard Retry restores saved personalization',async({page})=>{
  await setup(page,{model:saved,fail:true});
  await signIn(page);
  await page.evaluate(()=>account.release());
  await expect(page.getByRole('heading',{name:'Your saved profile couldn’t load'})).toBeVisible();
  await expect(page.getByRole('button',{name:'See my recommendation'})).toHaveCount(0);
  expect((await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa']).analyze()).violations).toEqual([]);
  expect(await page.evaluate(()=>account.writes)).toEqual([]);
  await page.evaluate(()=>account.fail=false);
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button',{name:'Retry profile'})).toBeFocused();
  await page.keyboard.press('Enter');
  await main(page,saved);
});

for(const transport of ['broadcast','storage'])test(`${transport} callback handoff completes without replay and can sign in again`,async({page,context})=>{
  if(transport==='storage')await context.addInitScript(()=>{window.BroadcastChannel=undefined;});
  await setup(page,{model:saved});
  await expect(page.getByRole('button',{name:'Sign in',exact:true})).toBeVisible();
  const callback=await context.newPage();
  await callback.goto('/auth-callback.html?code=first');
  await expect(page.getByText('Loading your saved Layer profile…')).toBeVisible();
  await expect(callback.getByRole('heading',{name:"You're signed in"})).toBeVisible();
  await page.evaluate(()=>account.release());
  await expect(page.getByRole('heading',{name:'Weather unavailable'})).toBeVisible();
  expect(await page.evaluate(()=>account.exchanges)).toBe(1);
  await callback.close();
  // A second legitimate code in the same original tab must not be ignored.
  await page.evaluate(()=>account.signOut());
  const second=await context.newPage();
  await second.goto('/auth-callback.html?code=second');
  await expect(second.getByRole('heading',{name:"You're signed in"})).toBeVisible();
  expect(await page.evaluate(()=>account.exchanges)).toBe(2);
  await second.close();
});
for(const base of ['/','/Layer/'])test(`callback fallback stays on same origin under ${base}`,async({page})=>{
  // The static server serves the callback at both deployment bases.
  if(base!=='/')await page.route(url=>url.pathname==='/Layer/auth-callback.html',async route=>{
    const response=await page.request.get('/auth-callback.html');
    await route.fulfill({body:await response.text(),contentType:'text/html'});
  });
  await page.route(url=>url.pathname===base && !!url.search,route=>route.fulfill({body:'<main>App destination</main>',contentType:'text/html'}));
  await page.goto(`${base}auth-callback.html?code=fallback&next=https://example.com`);
  await expect(page).toHaveURL(new RegExp(`${base.replaceAll('/','\\/')}\\?code=fallback&next=https%3A%2F%2Fexample.com&layer_auth_return=1$`));
});
for(const width of [320,375,393,430,768,1024,1440])test(`auth surfaces fit ${width}px including loading and recoverable error`,async({page})=>{
  await page.setViewportSize({width,height:width===768?390:844});
  await setup(page,{model:saved,fail:true});
  const fits=async()=>expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await expect(page.getByRole('button',{name:'See my recommendation'})).toBeVisible();await fits();
  await page.getByRole('button',{name:'Sign in',exact:true}).click();
  await page.getByRole('button',{name:'Continue with email'}).click();
  await page.getByRole('textbox',{name:'Email address'}).fill('returning@example.test');
  await page.getByRole('button',{name:'Email me a link'}).click();
  await expect(page.getByRole('heading',{name:'Check your email'})).toBeVisible();await fits();
  await signIn(page);await fits();
  expect((await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa']).analyze()).violations).toEqual([]);
  await page.evaluate(()=>account.release());
  await expect(page.getByRole('button',{name:'Retry profile'})).toBeVisible();await fits();
  if(width===393)await page.screenshot({path:'test-results/auth-restore-error-393.png'});
});
test('a confirmed-empty signed-in account saves setup to the account without anonymous opt-in',async({page})=>{
  await setup(page);
  await signIn(page);await page.evaluate(()=>account.release());
  await page.getByRole('button',{name:'Four seasons'}).click();
  await page.getByRole('button',{name:'About the same',exact:true}).click();
  await page.getByRole('button',{name:'See my recommendation'}).click();
  await expect(page.getByRole('heading',{name:'Weather unavailable'})).toBeVisible();
  await page.evaluate(async()=>{await (await import('/src/lib/sync.js')).flushPendingModel();});
  expect(await page.evaluate(()=>localStorage.getItem('layer:cloud-pref'))).toBe('on');
  expect(await page.evaluate(()=>account.writes.map(w=>w.table).sort())).toEqual(['model_state','profiles']);
});
test('stored callback code survives StrictMode mount cleanup without exchanging twice',async({page})=>{
  await page.addInitScript(()=>localStorage.setItem('layer:auth-code-handoff-v2',JSON.stringify({type:'layer-auth-code',code:'stored',nonce:'stored-nonce',at:Date.now()})));
  await setup(page,{model:saved});
  await expect(page.getByText('Loading your saved Layer profile…')).toBeVisible();
  await page.evaluate(()=>account.release());
  await expect(page.getByRole('heading',{name:'Weather unavailable'})).toBeVisible();
  expect(await page.evaluate(()=>account.exchanges)).toBe(1);
  expect(await page.evaluate(()=>account.reads)).toEqual(['model_state']);
});

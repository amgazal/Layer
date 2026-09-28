import { beforeEach, afterEach, it, expect, vi } from 'vitest';
const state=vi.hoisted(()=>({user:{id:'a',is_anonymous:true},getSession:vi.fn(),upsert:vi.fn(),maybeSingle:vi.fn(),signOut:vi.fn(),onAuth:null}));
vi.mock('./supabase',()=>({cloudEnabled:true,authRedirectUrl:()=>'',providerEnabled:{},CORNELL_DOMAIN:'cornell.edu',supabase:{
  auth:{getSession:state.getSession,signInAnonymously:vi.fn(),signOut:state.signOut,onAuthStateChange:fn=>{state.onAuth=fn;}},
  from:()=>({upsert:state.upsert,select:()=>({eq:()=>({maybeSingle:state.maybeSingle})}),update:()=>({eq:()=>Promise.resolve({})}),delete:()=>({eq:()=>Promise.resolve({})})}),
}}));
let sync;
beforeEach(async()=>{
  vi.resetModules();vi.useFakeTimers();vi.clearAllMocks();
  const data=new Map([['layer:cloud-pref','on']]);
  vi.stubGlobal('window',{localStorage:{getItem:k=>data.get(k)??null,setItem:(k,v)=>data.set(k,v),removeItem:k=>data.delete(k)},addEventListener:()=>{}});
  vi.stubGlobal('document',{addEventListener:()=>{}});
  state.getSession.mockResolvedValue({data:{session:{user:state.user}},error:null});
  state.upsert.mockResolvedValue({error:null});state.maybeSingle.mockResolvedValue({data:null,error:null});state.signOut.mockResolvedValue({error:null});
  sync=await import('./sync');
});
afterEach(()=>{vi.useRealTimers();vi.unstubAllGlobals();});
it('retries failed authentication in the same session',async()=>{
  state.getSession.mockRejectedValueOnce(new Error('offline'));
  expect(await sync.ensureAuth()).toBeNull();
  expect(await sync.ensureAuth()).toEqual(state.user);
});
it('distinguishes failed cloud reads from missing profiles',async()=>{
  state.maybeSingle.mockResolvedValueOnce({error:new Error('offline')});
  await expect(sync.pullModel()).rejects.toThrow('offline');
  expect(await sync.pullModel()).toBeNull();
});
it('serializes overlapping model writes so the newest finishes last',async()=>{
  let release;state.upsert.mockImplementationOnce(()=>new Promise(r=>{release=r;}));
  sync.pushModel({version:1},1); const first=sync.flushPendingModel();
  await vi.waitFor(()=>expect(state.upsert).toHaveBeenCalledTimes(1));
  sync.pushModel({version:2},2);const second=sync.flushPendingModel();
  expect(state.upsert).toHaveBeenCalledTimes(1);
  release({error:null});await first;await second;
  expect(state.upsert.mock.calls.map(c=>c[0].model.version)).toEqual([1,2]);
});
it('reset follows in-flight writes and cannot be overwritten by them',async()=>{
  let release;state.upsert.mockImplementationOnce(()=>new Promise(r=>{release=r;}));
  sync.pushModel({version:1},1);const first=sync.flushPendingModel();
  await vi.waitFor(()=>expect(state.upsert).toHaveBeenCalledTimes(1));
  const reset=sync.resetPersonalizationCloud({seeded:false});release({error:null});await first;await reset;
  expect(state.upsert.mock.calls.at(-1)[0].observations).toBe(0);
  expect(sync.hasPendingReset()).toBe(false);
});
it('sign-out errors are shown and successful sign-out opts out',async()=>{
  state.signOut.mockResolvedValueOnce({error:new Error('network')});
  expect((await sync.signOutCloud()).ok).toBe(false);expect(sync.cloudAllowed()).toBe(true);
  expect((await sync.signOutCloud()).ok).toBe(true);expect(sync.cloudAllowed()).toBe(false);
});
it('repeated auth focus events do not restart account restoration',()=>{
  const user={id:'a',is_anonymous:false};state.onAuth('INITIAL_SESSION',{user});
  const initial=sync.currentAuth().signedInAt;vi.advanceTimersByTime(1000);
  state.onAuth('SIGNED_IN',{user});expect(sync.currentAuth().signedInAt).toBe(initial);
});
it('overlapping event flushes preserve feedback added in flight',async()=>{
  state.onAuth('INITIAL_SESSION',{user:state.user});
  let release;state.upsert.mockImplementationOnce(()=>new Promise(r=>release=r));
  const first=sync.logEvent({outcome:'cold'});
  await vi.waitFor(()=>expect(state.upsert).toHaveBeenCalledTimes(1));
  sync.logEvent({outcome:'warm'});
  const again=sync.flushOutbox();
  release({error:null});await first;await again;
  await vi.runOnlyPendingTimersAsync();
  expect(state.upsert.mock.calls.map(c=>c[0][0].outcome)).toEqual(['cold','warm']);
  expect(JSON.parse(window.localStorage.getItem('layer:outbox'))).toEqual([]);
});
it('queued events are not uploaded under a different account',async()=>{
  window.localStorage.setItem('layer:outbox',JSON.stringify([{owner:'other-user',client_event_id:'old'}]));
  await sync.flushOutbox();
  expect(state.upsert).not.toHaveBeenCalled();
});
it('rapid re-sign-in has a new restore revision even within one millisecond',()=>{
  const user={id:'a',is_anonymous:false};
  state.onAuth('SIGNED_IN',{user});const first=sync.currentAuth().signedInAt;
  state.onAuth('SIGNED_OUT',null);state.onAuth('SIGNED_IN',{user});
  expect(sync.currentAuth().signedInAt).toBeGreaterThan(first);
  const second=sync.currentAuth().signedInAt;
  state.onAuth('INITIAL_SESSION',{user});state.onAuth('SIGNED_IN',{user});
  expect(sync.currentAuth().signedInAt).toBe(second);
});
it('external sign-out cancels queued model uploads',async()=>{
  sync.pushModel({seeded:true},1);
  state.onAuth('SIGNED_OUT',null);
  await vi.runOnlyPendingTimersAsync();
  expect(state.upsert).not.toHaveBeenCalled();
});
it('failed setup reads and pending resets cannot be classified as empty',async()=>{
  state.maybeSingle.mockResolvedValueOnce({error:new Error('offline')});
  await expect(sync.pullProfile()).rejects.toThrow('offline');
  expect(await sync.pullProfile()).toBeNull();
  window.localStorage.setItem('layer:reset-pending','1');
  await expect(sync.pullProfile()).rejects.toThrow('reset');
  await expect(sync.pullModel()).rejects.toThrow('reset');
});

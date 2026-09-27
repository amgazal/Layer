// Local-only real Supabase Auth/PostgREST integration. Never contacts hosted data.
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
const status = JSON.parse(execFileSync('npm', ['exec','--yes','--package=supabase','--','supabase','status','-o','json'], {encoding:'utf8'}));
const url = status.API_URL;
assert.equal(new URL(url).hostname, '127.0.0.1');
assert.equal(new URL(url).port, '55421');
const client = () => createClient(url,status.ANON_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
let passed=0;
const check=(name,fn)=>Promise.resolve().then(fn).then(()=>{passed++;console.log(`✓ ${name}`);});
const A=client(), B=client(), guest=client();
const a=await A.auth.signInAnonymously(), b=await B.auth.signInAnonymously();
assert.ifError(a.error); assert.ifError(b.error);
const model={v:5,seeded:true,regime:{cold:{off:-4,n:2},mild:{off:0,n:1},warm:{off:0,n:0}},factors:{wind:0,wet:0,sun:0},history:[]};
const users=[{client:A,id:a.data.user.id},{client:B,id:b.data.user.id}];
try {
  for(const u of users) {
    await check('authenticated anonymous account writes and reads own profile',async()=>{
      assert.ifError((await u.client.from('profiles').insert({id:u.id,climate:'temperate',tolerance:'same'})).error);
      const r=await u.client.from('profiles').select('*').eq('id',u.id).single(); assert.ifError(r.error); assert.equal(r.data.id,u.id);
    });
    assert.ifError((await u.client.from('model_state').insert({user_id:u.id,model,observations:3})).error);
    u.event=randomUUID();
    assert.ifError((await u.client.from('events').insert({user_id:u.id,client_event_id:u.event,outcome:'cold',duration:60})).error);
  }
  for(const [actor,other] of [[users[0],users[1]],[users[1],users[0]]]) {
    for(const [table,key,patch] of [['profiles','id',{climate:'cold'}],['model_state','user_id',{observations:99}],['events','user_id',{outcome:'warm'}]]) {
      await check(`${table}: cross-user read denied`,async()=>{
        const r=await actor.client.from(table).select('*').eq(key,other.id);assert.ifError(r.error);assert.equal(r.data.length,0);
      });
      await check(`${table}: cross-user update/delete has no effect`,async()=>{
        const before=await other.client.from(table).select('*').eq(key,other.id);
        await actor.client.from(table).update(patch).eq(key,other.id);
        await actor.client.from(table).delete().eq(key,other.id);
        const after=await other.client.from(table).select('*').eq(key,other.id);
        assert.deepEqual(after.data,before.data);
      });
    }
    await check('feedback impersonation rejected',async()=>{
      assert.ok((await actor.client.from('events').insert({user_id:other.id,client_event_id:randomUUID()})).error);
    });
  }
  for(const table of ['profiles','model_state','events']) await check(`${table}: unauthenticated read denied`,async()=>{
    const r=await guest.from(table).select('*'); assert.ok(r.error || r.data.length===0);
  });
  for(const [label,bad,observations] of [['oversized',{...model,junk:'x'.repeat(200000)},3],['scalar',42,3],['history',{...model,history:Array(81).fill({at:1})},3],['history object',{...model,history:{}},3],['observations',model,1e30],['model counts',{...model,regime:{cold:{off:0,n:1e30}}},3],['factor',{...model,factors:{wind:900}},3]]) {
    await check(`reject ${label}`,async()=>{
      assert.ok((await A.from('model_state').upsert({user_id:users[0].id,model:bad,observations})).error);
    });
  }
  await check('invalid profile rejected',async()=>{assert.ok((await A.from('profiles').update({climate:'mars'}).eq('id',users[0].id)).error);});
  await check('duplicate feedback is idempotent',async()=>{
    assert.ifError((await A.from('events').upsert({user_id:users[0].id,client_event_id:users[0].event},{onConflict:'client_event_id',ignoreDuplicates:true})).error);
    const r=await A.from('events').select('*').eq('client_event_id',users[0].event);assert.equal(r.data.length,1);
  });
  await check('anonymous email linking preserves identity and data; new sign-in restores it',async()=>{
    const email=`layer-${randomUUID()}@example.test`, password=`Test-${randomUUID()}!`;
    const linked=await A.auth.updateUser({email,password});assert.ifError(linked.error);assert.equal(linked.data.user.id,users[0].id);
    const returning=client();const signed=await returning.auth.signInWithPassword({email,password});assert.ifError(signed.error);assert.equal(signed.data.user.id,users[0].id);
    const restored=await returning.from('model_state').select('model').eq('user_id',users[0].id).single();assert.ifError(restored.error);assert.deepEqual(restored.data.model,model);
    assert.ifError((await returning.auth.signOut()).error);
  });
  console.log(`${passed} authenticated integration checks passed.`);
} finally {
  // Keep local Auth users for inspection; remove only rows created by this run.
  for(const u of users) for(const [table,key] of [['events','user_id'],['model_state','user_id'],['profiles','id']]) await u.client.from(table).delete().eq(key,u.id);
}

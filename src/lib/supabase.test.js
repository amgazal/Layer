import { afterEach, expect, it, vi } from 'vitest';
afterEach(()=>{vi.unstubAllGlobals();vi.unstubAllEnvs();vi.resetModules();});
for(const base of ['https://layer.amgazal.com/','https://amgazal.github.io/Layer/'])it(`derives exact callback for ${base}`,async()=>{
  vi.stubEnv('VITE_SUPABASE_URL','');vi.stubEnv('VITE_SUPABASE_ANON_KEY','');vi.stubEnv('VITE_AUTH_REDIRECT_URL','');vi.stubEnv('BASE_URL','./');
  vi.stubGlobal('window',{location:{href:`${base}?layer_auth_return=1`,origin:new URL(base).origin}});
  const {authRedirectUrl}=await import('./supabase');
  expect(authRedirectUrl()).toBe(`${base}auth-callback.html`);
});

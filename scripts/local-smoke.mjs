import {execFileSync,spawnSync} from 'node:child_process';
const local=JSON.parse(execFileSync('npm',['exec','--yes','--package=supabase','--','supabase','status','-o','json'],{encoding:'utf8'}));
if(local.API_URL!=='http://127.0.0.1:55421')throw new Error('Only isolated local Supabase is allowed');
const result=spawnSync('node',['scripts/smoke-test.mjs'],{stdio:'inherit',env:{...process.env,VITE_SUPABASE_URL:local.API_URL,VITE_SUPABASE_ANON_KEY:local.ANON_KEY}});
process.exit(result.status??1);

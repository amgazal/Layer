import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
const tracked=execFileSync('git',['ls-files','--cached','--others','--exclude-standard','-z'],{encoding:'utf8'}).split('\0').filter(Boolean);
const walk=dir=>fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(path.join(dir,e.name)):[path.join(dir,e.name)]);
const files=[...new Set([...tracked,...(fs.existsSync('dist')?walk('dist'):[])])];
let failures=0;
for(const file of files){
  if(!/\.(js|jsx|mjs|html|json|sql|md|yml|example)$/.test(file))continue;
  const text=fs.readFileSync(file,'utf8');
  let bad=/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(text) || /sb_secret_[A-Za-z0-9_-]{20,}/.test(text);
  for(const token of text.match(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g)??[]) {
    try {if(JSON.parse(Buffer.from(token.split('.')[1],'base64url')).role==='service_role')bad=true;}catch{}
  }
  if (/\bre_[A-Za-z0-9_-]{24,}\b/.test(text)) bad=true;
  if(bad){console.error(`Private credential pattern found in ${file}`);failures++;}
}
if(failures)process.exit(1);
console.log(`No private-key, Supabase secret-key, Resend key, or service-role JWT patterns in ${files.length} tracked/build files.`);

// Scan shipped application sources, not documentation or test fixtures.
const appFiles = [...walk('src'), ...walk('public'), 'index.html'].filter(file =>
  /\.(js|jsx|mjs|html)$/.test(file) && !/\.test\./.test(file));
const pickerCall = /\b(?:showOpenFilePicker|showSaveFilePicker|showDirectoryPicker)\s*\(|\[\s*['"](?:showOpenFilePicker|showSaveFilePicker|showDirectoryPicker)['"]\s*\]\s*\(/;
for (const file of appFiles) {
  if (pickerCall.test(fs.readFileSync(file, 'utf8'))) {
    console.error(`Unreviewed filesystem picker call in ${file}`);
    process.exitCode = 1;
  }
}
if (!process.exitCode) console.log('No browser filesystem picker calls in application sources.');

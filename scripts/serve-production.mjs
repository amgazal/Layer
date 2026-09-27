import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
const types={'.html':'text/html','.js':'application/javascript','.css':'text/css','.webp':'image/webp','.png':'image/png','.mp4':'video/mp4','.webmanifest':'application/manifest+json'};
http.createServer((req,res)=>{
  let name=decodeURIComponent(new URL(req.url,'http://localhost').pathname).replace(/^\/Layer\//,'/');
  if(name.endsWith('/')) name+='index.html';
  const file=path.resolve('dist',`.${name}`);
  if(!file.startsWith(path.resolve('dist')+path.sep) || !fs.existsSync(file)){res.writeHead(404);res.end();return;}
  res.setHeader('Content-Type',types[path.extname(file)]??'application/octet-stream');fs.createReadStream(file).pipe(res);
}).listen(4175,'127.0.0.1');

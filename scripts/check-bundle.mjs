import {readdirSync,readFileSync} from 'node:fs';
import {gzipSync} from 'node:zlib';
const files=readdirSync('dist/assets').filter(f=>f.endsWith('.js'));
const bytes=files.reduce((n,f)=>n+gzipSync(readFileSync('dist/assets/'+f)).length,0);
console.log(`Frontend JS gzip: ${(bytes/1024).toFixed(1)} KiB / 200 KiB budget`);
if(!files.length || bytes>200*1024) process.exit(1);

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {startServer} from '../server.mjs';
test('API authentication, persisted login, Markdown and request isolation',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'paperdesk-api-'));let svc=await startServer({dataDir:dir,port:0});
 let cookie='';const request=async(route,method='GET',body,extra={})=>{
  const r=await fetch(svc.url+route,{method,headers:{...(cookie?{cookie}:{}),...(body?{'Content-Type':'application/json'}:{}),...extra},body:body?JSON.stringify(body):undefined});
  const set=r.headers.get('set-cookie');if(set)cookie=set.split(';')[0];return {status:r.status,data:await r.json()};
 };
 try{
  assert.equal((await request('/api/papers')).status,401);
  assert.equal((await request('/api/auth/setup','POST',{username:'研究者',password:'1',remember:true})).status,200);
  assert.equal((await request('/api/auth/status')).data.authenticated,true);
  const n=await request('/api/notes','POST',{title:'传感器灵感',markdown:'# 想法\n\n[[调制]] 与 **同步**'});
  assert.equal(n.status,200);const id=n.data.paper.id;
  assert.match((await request('/api/papers/'+id+'/note')).data.markdown,/想法/);
  assert.equal((await request('/api/papers/'+id+'/note','PUT',{markdown:'# Updated\nretain this note'})).status,200);
  assert.equal((await request('/api/papers/'+id,'PATCH',{title:'Renamed',tags:['MIMO'],status:'reading'})).status,200);
  assert.equal((await request('/api/papers')).data.papers[0].hasNote,true);
  assert.equal((await request('/api/notes','POST',{title:'blocked'},{Origin:'https://untrusted.example'})).status,403);
  assert.equal((await request('/api/papers/missing/note','PUT',{markdown:'x'})).status,404);
  const token=(await request('/api/integrations/token','POST',{})).data.token;
  assert.ok(token.length>=32);
  const remembered=cookie;await svc.close();svc=await startServer({dataDir:dir,port:0});
  assert.equal((await request('/api/auth/status')).data.authenticated,true);
  await request('/api/auth/logout','POST',{});cookie=remembered;
  assert.equal((await request('/api/auth/status')).data.authenticated,false);
  cookie='';
  assert.equal((await request('/api/papers','GET',undefined,{Authorization:'Bearer '+token})).status,200);
  assert.equal((await request('/api/auth/login','POST',{username:'研究者',password:'wrong'})).status,401);
  assert.equal((await request('/api/auth/login','POST',{username:'研究者',password:'1'})).status,200);
  assert.equal((await request('/api/papers/'+id,'DELETE',{})).status,200);
  assert.equal((await request('/api/papers')).data.papers.length,0);
 }finally{await svc.close();fs.rmSync(dir,{recursive:true,force:true})}
});

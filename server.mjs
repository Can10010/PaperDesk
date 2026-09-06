import express from 'express';
import multer from 'multer';
import {createHash,randomBytes,randomUUID,scryptSync,timingSafeEqual} from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {Vault} from './lib/vault.mjs';
import {syncVault,testConnection,pairProfile,revokeProfile,profileAuthStatus} from './lib/sync.mjs';
import {listPairedDevices,revokePairedDevice,revokeAllPairings} from './lib/sync-auth.mjs';
import {normalizeModelConfig,publicModelConfig,mergeModelConfig,resolveModelTasks,testModel} from './lib/model-config.mjs';
import {extractPdf,searchPapers,askPapers,buildKnowledge} from './lib/knowledge.mjs';

export const rootDir=path.dirname(fileURLToPath(import.meta.url));
export function defaultDataDir(){return process.env.PAPERDESK_DATA_DIR||(process.platform==='win32'&&fs.existsSync('D:\\')?'D:\\PaperDeskData':path.join(os.homedir(),'PaperDeskData'))}
const digest=s=>createHash('sha256').update(s).digest('hex');
const hashPassword=(p,salt)=>scryptSync(p,salt,64).toString('hex');
const safeEqual=(a,b)=>typeof a==='string'&&typeof b==='string'&&a.length===b.length&&timingSafeEqual(Buffer.from(a),Buffer.from(b));
const cleanPaper=p=>{if(!p)return p;const {chunks,...r}=p;return {...r,indexed:!!chunks?.length}};
export async function startServer({dataDir=defaultDataDir(),port=Number(process.env.PAPERDESK_PORT||47821),host='127.0.0.1'}={}){
 const vault=new Vault(dataDir),app=express(); let syncing=false;
 app.disable('x-powered-by');
 app.use((req,res,next)=>{
  res.setHeader('X-Content-Type-Options','nosniff');
  res.setHeader('Referrer-Policy','no-referrer');
  res.setHeader('Cache-Control',req.path.startsWith('/api/')?'no-store':'no-cache');
  const origin=req.headers.origin;
  if(origin&&!['http://127.0.0.1:'+port,'http://localhost:'+port,'http://127.0.0.1:5173'].includes(origin)) return res.status(403).json({error:'请求来源不受信任'});
  if(req.path.startsWith('/api/')&&!['GET','HEAD','OPTIONS'].includes(req.method)&&!/^application\/json|^multipart\/form-data/.test(req.headers['content-type']||''))return res.status(415).json({error:'需要 JSON 或文件上传请求'});
  next();
 });
 app.use(express.json({limit:'2mb'}));
 const sessions=()=>vault.getSetting('sessions',{});
 function authenticated(req){
  const bearer=req.headers.authorization?.match(/^Bearer (.+)$/)?.[1];
  if(bearer&&safeEqual(digest(bearer),vault.getSetting('apiTokenHash','')))return true;
  const token=req.headers.cookie?.split(';').map(x=>x.trim()).find(x=>x.startsWith('paperdesk_session='))?.slice(18);
  return !!(token&&sessions()[digest(token)]>Date.now());
 }
 function issueSession(res,remember=true){
  const token=randomBytes(32).toString('hex'),expires=Date.now()+(remember?365:1)*86400000;
  const values=Object.fromEntries(Object.entries(sessions()).filter(([,v])=>v>Date.now()));
  values[digest(token)]=expires;vault.setSetting('sessions',values);
  res.setHeader('Set-Cookie','paperdesk_session='+token+'; HttpOnly; SameSite=Strict; Path=/'+(remember?'; Max-Age=31536000':''));
 }
 const failures=new Map();
 app.get('/api/health',(_,res)=>res.json({ok:true,app:'PaperDesk',version:'1.1.0',dataDir:path.resolve(dataDir)}));
 app.get('/api/auth/status',(req,res)=>res.json({configured:!!vault.getAccount(),authenticated:authenticated(req),username:vault.getAccount()?.username||''}));
 app.post('/api/auth/setup',(req,res)=>{
  if(vault.getAccount())return res.status(409).json({error:'此资料库已设置账号，请登录'});
  const username=String(req.body.username||'').trim(),password=String(req.body.password||'');
  if(!username||username.length>80||!password||password.length>256)return res.status(400).json({error:'请输入名字和密码；允许简单密码'});
  const salt=randomBytes(16).toString('hex');vault.setAccount({username,salt,passwordHash:hashPassword(password,salt)});issueSession(res,req.body.remember!==false);
  res.json({ok:true,username});
 });
 app.post('/api/auth/login',(req,res)=>{
  const key=req.ip,entry=failures.get(key)||{count:0,at:0};
  if(entry.count>=12&&Date.now()-entry.at<60000)return res.status(429).json({error:'尝试过于频繁，请一分钟后再试'});
  const account=vault.getAccount(),password=String(req.body.password||'');
  if(!account||password.length>256||account.username!==String(req.body.username||'').trim()||!safeEqual(hashPassword(password,account.salt),account.passwordHash)){
   failures.set(key,{count:entry.count+1,at:Date.now()});return res.status(401).json({error:'名字或密码不正确'});
  }
  failures.delete(key);issueSession(res,req.body.remember!==false);res.json({ok:true,username:account.username});
 });
 app.use('/api',(req,res,next)=>authenticated(req)?next():res.status(401).json({error:'请先登录'}));
 app.post('/api/auth/logout',(req,res)=>{
  const token=req.headers.cookie?.split(';').map(x=>x.trim()).find(x=>x.startsWith('paperdesk_session='))?.slice(18);
  if(token){const s=sessions();delete s[digest(token)];vault.setSetting('sessions',s)}
  res.setHeader('Set-Cookie','paperdesk_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');res.json({ok:true});
 });
 app.post('/api/auth/change-password',(req,res)=>{
  const a=vault.getAccount(),p=String(req.body.password||'');
  if(!p||p.length>256)return res.status(400).json({error:'密码不能为空'});
  if(!safeEqual(hashPassword(String(req.body.currentPassword||''),a.salt),a.passwordHash))return res.status(403).json({error:'原密码不正确'});
  const salt=randomBytes(16).toString('hex');vault.setAccount({...a,salt,passwordHash:hashPassword(p,salt)});vault.setSetting('sessions',{});revokeAllPairings(vault);issueSession(res,true);res.json({ok:true});
 });
 const allPapers=()=>vault.listPapers().map(p=>({...p,note:vault.readNote(p.id)||''}));
 const summary=p=>({...cleanPaper(p),hasNote:!!vault.readNote(p.id)});
 app.get('/api/papers',(req,res)=>{
  let papers=vault.listPapers();
  if(req.query.q){const q=String(req.query.q).toLocaleLowerCase();papers=papers.filter(p=>[p.title,p.authors,p.doi,...(p.tags||[])].join(' ').toLocaleLowerCase().includes(q)||vault.readNote(p.id).toLocaleLowerCase().includes(q))}
  if(req.query.status)papers=papers.filter(p=>p.status===req.query.status);
  res.json({papers:papers.map(summary)});
 });
 const upload=multer({storage:multer.memoryStorage(),limits:{fileSize:100*1024*1024,files:20}});
 async function importOne(bytes,name){
  if(!bytes.subarray(0,1024).includes(Buffer.from('%PDF-')))throw new Error(name+' 不是有效的 PDF');
  const metadata=await extractPdf(bytes,name);
  return {...vault.importPdf(bytes,metadata),warnings:metadata.warnings||[]};
 }
 app.post('/api/papers/import',upload.array('files',20),async(req,res)=>{
  const results=[],errors=[];for(const file of req.files||[]){try{results.push(await importOne(file.buffer,Buffer.from(file.originalname,'latin1').toString('utf8')))}catch(e){errors.push({name:file.originalname,error:e.message})}}
  res.json({results:results.map(r=>({...r,paper:cleanPaper(r.paper)})),errors});
 });
 app.post('/api/papers/import-path',async(req,res)=>{
  const target=path.resolve(String(req.body.path||''));
  if(path.extname(target).toLowerCase()!=='.pdf')return res.status(400).json({error:'仅支持本机 PDF 文件'});
  const stat=fs.statSync(target);if(!stat.isFile()||stat.size>100*1024*1024)return res.status(400).json({error:'PDF 必须小于 100MB'});
  const r=await importOne(fs.readFileSync(target),path.basename(target));res.json({results:[{...r,paper:cleanPaper(r.paper)}],errors:[]});
 });
 app.post('/api/notes',(req,res)=>{
  const now=new Date().toISOString(),paper={id:randomUUID(),title:String(req.body.title||'未命名笔记').slice(0,300),kind:'note',tags:[],status:'unread',authors:'',year:'',doi:'',pages:0,chunks:[],createdAt:now,updatedAt:now};
  vault.upsertPaper(paper);vault.saveNote(paper.id,String(req.body.markdown||''));res.json({paper:summary(vault.getPaper(paper.id))});
 });
 app.get('/api/papers/:id',(req,res)=>{const p=vault.getPaper(req.params.id);if(!p)return res.status(404).json({error:'文献不存在'});res.json({paper:summary(p)})});
 app.get('/api/papers/:id/text',(req,res)=>{
  const p=vault.getPaper(req.params.id);if(!p)return res.status(404).json({error:'文献不存在'});
  const page=req.query.page===undefined?null:Number(req.query.page);
  if(page!==null&&(!Number.isInteger(page)||page<1||page>(p.pages||0)))return res.status(400).json({error:'页码超出论文范围'});
  const chunks=(p.chunks||[]).filter(chunk=>page===null||chunk.page===page);
  res.json({paper:{...summary(p),chunks}});
 });
 app.patch('/api/papers/:id',(req,res)=>{
  const p=vault.getPaper(req.params.id);if(!p)return res.status(404).json({error:'文献不存在'});
  const patch={};for(const k of ['title','authors','year','doi','tags','status'])if(req.body[k]!==undefined)patch[k]=req.body[k];
  if(patch.title!==undefined){patch.title=String(patch.title).trim().slice(0,500);if(!patch.title)return res.status(400).json({error:'标题不能为空'})}
  if(patch.tags!==undefined){if(!Array.isArray(patch.tags))return res.status(400).json({error:'标签必须为数组'});patch.tags=patch.tags.map(x=>String(x).trim().slice(0,80)).filter(Boolean).slice(0,30)}
  if(patch.status&&!['unread','reading','done'].includes(patch.status))return res.status(400).json({error:'阅读状态不正确'});
  for(const k of ['authors','year','doi'])if(patch[k]!==undefined)patch[k]=String(patch[k]).slice(0,2000);
  vault.upsertPaper({...p,...patch,updatedAt:new Date().toISOString()});res.json({paper:summary(vault.getPaper(p.id))});
 });
 app.delete('/api/papers/:id',(req,res)=>{if(!vault.getPaper(req.params.id))return res.status(404).json({error:'文献不存在'});vault.deletePaper(req.params.id);res.json({ok:true})});
 app.get('/api/papers/:id/pdf',(req,res)=>{if(!vault.getPaper(req.params.id))return res.status(404).json({error:'文献不存在'});const p=vault.pdfPath(req.params.id);if(!p||!fs.existsSync(p))return res.status(404).json({error:'此笔记没有 PDF'});res.type('pdf').sendFile(path.resolve(p),{dotfiles:'allow'})});
 app.get('/api/papers/:id/note',(req,res)=>{if(!vault.getPaper(req.params.id))return res.status(404).json({error:'文献不存在'});res.json({markdown:vault.readNote(req.params.id)})});
 app.put('/api/papers/:id/note',(req,res)=>{if(!vault.getPaper(req.params.id))return res.status(404).json({error:'文献不存在'});if(typeof req.body.markdown!=='string')return res.status(400).json({error:'笔记必须为 Markdown 文本'});const markdown=vault.saveNote(req.params.id,req.body.markdown,req.body.baseMarkdown);res.json({ok:true,markdown,conflict:markdown!==req.body.markdown})});

 const modelConfig=()=>normalizeModelConfig(vault.getSetting('modelConfig'),vault.getSetting('llm',{}));
 const scopeOf=value=>['all','papers','notes'].includes(value)?value:'all';
 app.get('/api/search',(req,res)=>res.json({results:searchPapers(allPapers(),String(req.query.q||''),Math.max(1,Math.min(Number(req.query.limit)||15,50)),{scope:scopeOf(req.query.scope)})}));
 app.post('/api/ask',async(req,res)=>{
  if(!String(req.body.question||'').trim())return res.status(400).json({error:'请输入问题'});
  const config=resolveModelTasks(modelConfig()),index=vault.getSetting('knowledgeIndex',{});
  const provider=config.embeddingModel?config.embeddingBaseUrl:'';
  res.json(await askPapers(allPapers(),String(req.body.question).slice(0,10000),{...config,scope:scopeOf(req.body.scope),cachedEmbeddingModel:index.model,embeddings:index.model===config.embeddingModel&&(index.provider||'')===provider?index.embeddings||[]:[]}));
 });
 app.post('/api/knowledge/build',async(req,res)=>{
  const papers=allPapers(),config=resolveModelTasks(modelConfig()),previous=vault.getSetting('knowledgeIndex',{});
  const provider=config.embeddingModel?config.embeddingBaseUrl:'';
  const index=await buildKnowledge(papers,{...config,cachedEmbeddingModel:previous.model,embeddings:(previous.provider||'')===provider?previous.embeddings||[]:[]});
  vault.setSetting('knowledgeIndex',index);res.json({indexed:index.indexedChunks,papers:papers.length,model:index.model,builtAt:index.builtAt});
 });
 const defaultSync={type:'ssh',host:'',port:22,remoteAppDir:'D:/Apps/PaperDesk',remoteDataDir:'D:/PaperDeskData'};
 function profiles(){const current=vault.getSetting('syncProfiles');if(Array.isArray(current))return current;const old=vault.getSetting('syncProfile');return old?.host?[{...defaultSync,...old,id:'legacy-ssh',name:'工位机'}]:[];}
 function selectedProfile(req){const items=profiles(),p=req.body?.profileId?items.find(p=>p.id===req.body.profileId):items[0];if(!p)throw Object.assign(new Error('请先添加并保存一个同步目标'),{code:'PROFILE_REQUIRED'});return p;}
 function normalizedProfiles(items){
  if(!Array.isArray(items)||items.length>20)throw new Error('最多添加 20 个同步目标');const ids=new Set();
  return items.map(item=>{
   const id=String(item.id||''),type=item.type||'ssh',name=String(item.name||'').trim().slice(0,100);
   if(!/^[A-Za-z0-9_-]{1,100}$/.test(id)||ids.has(id))throw new Error('同步目标编号无效或重复');ids.add(id);
   if(!name)throw new Error('请为同步目标填写名称');
   if(type==='folder'){
    const folderPath=String(item.folderPath||'').trim();if(!path.isAbsolute(folderPath)||/[\x00-\x1f]/.test(folderPath))throw new Error('同步文件夹需要完整绝对路径');
    const folder=path.resolve(folderPath),data=path.resolve(dataDir);if(folder===data||folder.startsWith(data+path.sep)||data.startsWith(folder+path.sep))throw new Error('同步文件夹必须独立于正式资料库目录');
    return {id,name,type,folderPath:folder};
   }
   if(type!=='ssh')throw new Error('不支持的同步方式');
   const host=String(item.host||'').trim(),port=Number(item.port||22);
   if(!/^(?:[A-Za-z0-9_][A-Za-z0-9_.-]*@)?[A-Za-z0-9][A-Za-z0-9_.:-]*$/.test(host))throw new Error('SSH 地址格式应为 用户名@主机');
   if(!Number.isInteger(port)||port<1||port>65535)throw new Error('SSH 端口无效');
   const result={id,name,type,host,port};for(const key of ['remoteAppDir','remoteDataDir']){const value=String(item[key]||defaultSync[key]).trim();if(!/^[A-Za-z]:[\\/]/.test(value)||/[\x00-\x1f]/.test(value))throw new Error('远程目录需要 Windows 绝对路径');result[key]=value;}return result;
  });
 }
 app.get('/api/settings',(_,res)=>res.json({modelConfig:publicModelConfig(modelConfig()),syncProfiles:profiles(),dataDir,apiTokenPreview:vault.getSetting('apiTokenPreview',''),knowledge:vault.getSetting('knowledgeIndex',{}).builtAt||null,hermes:{command:process.execPath,scriptPath:path.join(rootDir,'scripts','hermes-mcp.mjs'),tokenFile:path.join(dataDir,'hermes-token.txt'),url:'http://127.0.0.1:'+server.address().port}}));
 app.put('/api/settings',(req,res)=>{
  const nextModel=req.body.modelConfig===undefined?null:mergeModelConfig(modelConfig(),req.body.modelConfig);
  const nextProfiles=req.body.syncProfiles===undefined?null:normalizedProfiles(req.body.syncProfiles);
  if(nextModel)vault.setSetting('modelConfig',nextModel);
  if(nextProfiles){for(const old of profiles())if(!nextProfiles.some(p=>p.id===old.id&&p.type===old.type&&p.host===old.host&&p.port===old.port&&p.remoteAppDir===old.remoteAppDir&&p.remoteDataDir===old.remoteDataDir&&p.folderPath===old.folderPath))revokeProfile(vault,old);vault.setSetting('syncProfiles',nextProfiles);}
  res.json({ok:true});
 });
 app.post('/api/models/test',async(req,res)=>res.json(await testModel(mergeModelConfig(modelConfig(),req.body.config),req.body.modelId)));
 app.post('/api/integrations/token',(_,res)=>{
  const token=randomBytes(32).toString('hex');vault.setSetting('apiTokenHash',digest(token));vault.setSetting('apiTokenPreview',token.slice(0,6)+'…'+token.slice(-4));fs.writeFileSync(path.join(dataDir,'hermes-token.txt'),token,{mode:0o600});res.json({token});
 });
 app.get('/api/sync/status',(_,res)=>{const dirty=vault.getDirty(),states=profiles().map(profile=>({id:profile.id,...profileAuthStatus(vault,profile)}));res.json({profiles:states,dirty:states.length?states.some(s=>s.pendingChanges):dirty,lastSync:vault.getSetting('lastSyncAt',null),syncing});});
 app.get('/api/sync/paired-devices',(_,res)=>res.json({devices:listPairedDevices(vault)}));
 app.post('/api/sync/revoke-device',(req,res)=>{revokePairedDevice(vault,String(req.body.id||''));res.json({ok:true});});
 app.post('/api/sync/revoke',(req,res)=>{revokeProfile(vault,selectedProfile(req));res.json({ok:true});});
 app.post('/api/sync/pair',async(req,res)=>res.json(await pairProfile(vault,selectedProfile(req),{username:String(req.body.username||'').trim(),password:String(req.body.password||''),remember:req.body.remember!==false})));
 app.post('/api/sync/test',async(req,res)=>res.json(await testConnection(selectedProfile(req))));
 app.post('/api/sync/run',async(req,res)=>{
  if(syncing)return res.status(409).json({error:'同步正在进行'});syncing=true;try{const result=await syncVault(vault,selectedProfile(req));res.json({...result,lastSync:vault.getSetting('lastSyncAt',null)});}finally{syncing=false;}
 });
 app.use(express.static(path.join(rootDir,'dist'),{index:'index.html'}));
 app.get('/{*path}',(_,res)=>res.sendFile(path.join(rootDir,'dist','index.html')));
 app.use((err,req,res,next)=>{console.error('[PaperDesk]',err.message);res.status(err.status||400).json({error:err.code==='LIMIT_FILE_SIZE'?'单个 PDF 不能超过 100MB':err.message||'操作失败',...(err.code?{code:err.code}:{})})});
 const server=await new Promise((resolve,reject)=>{const s=app.listen(port,host,()=>resolve(s));s.on('error',reject)});
 return {app,server,vault,url:'http://127.0.0.1:'+server.address().port,close:()=>new Promise(r=>server.close(()=>{vault.close();r()}))};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const svc=await startServer();console.log('PaperDesk ready '+svc.url);
 for(const signal of ['SIGTERM','SIGINT'])process.on(signal,async()=>{await svc.close();process.exit(0)});
}


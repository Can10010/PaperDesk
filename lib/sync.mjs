import { spawn } from 'node:child_process';
import { snapshotDigest } from './vault.mjs';

function validateProfile(profile) {
  if (!profile || typeof profile.host !== 'string' || !/^(?:[A-Za-z0-9_][A-Za-z0-9_.-]*@)?[A-Za-z0-9][A-Za-z0-9_.:-]*$/.test(profile.host)) throw new Error('SSH 地址格式应为 用户名@主机，例如 researcher@workstation.example。');
  const port = Number(profile.port || 22);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('SSH 端口无效。');
  for (const key of ['remoteAppDir', 'remoteDataDir']) {
    if (typeof profile[key] !== 'string' || !/^[A-Za-z]:[\\/]/.test(profile[key]) || /[\x00-\x1f]/.test(profile[key])) throw new Error('远程目录必须是 Windows 绝对路径。');
  }
  return { ...profile, port };
}
const psQuote = (text) => `'${String(text).replace(/'/g, "''")}'`;

export async function peerRequest(profile, request) {
  const config = validateProfile(profile);
  const appDir = config.remoteAppDir.replace(/[\\/]+$/, '');
  const nodePath = `${appDir}/resources/runtime/node.exe`;
  const helperPath = `${appDir}/resources/app/scripts/sync-peer.mjs`;
  const command = `$ErrorActionPreference='Stop'; $ProgressPreference='SilentlyContinue'; & ${psQuote(nodePath)} ${psQuote(helperPath)} --data-dir ${psQuote(config.remoteDataDir)}; exit $LASTEXITCODE`;
  const encoded = Buffer.from(command, 'utf16le').toString('base64');
  const args = ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=12', '-o', 'ServerAliveInterval=15', '-o', 'ServerAliveCountMax=2', '-p', String(config.port), config.host, 'powershell.exe', '-NoProfile', '-NonInteractive', '-EncodedCommand', encoded];
  return await new Promise((resolve, reject) => {
    const child = spawn(process.platform === 'win32' ? 'ssh.exe' : 'ssh', args, { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'], shell: false });
    const out = [], err = [];
    let size = 0, settled = false;
    const finish = (error, result) => { if (settled) return; settled = true; clearTimeout(timer); error ? reject(error) : resolve(result); };
    const timer = setTimeout(() => { child.kill(); finish(new Error('SSH 同步超时，请检查网络和远程设备。')); }, 180000);
    child.on('error', (error) => finish(new Error(`无法启动 SSH：${error.message}`)));
    child.stdout.on('data', (chunk) => {
      size += chunk.length;
      if (size > 1024 * 1024 * 1024) { child.kill(); finish(new Error('同步快照超过 1 GB，请分开文献库后重试。')); }
      else out.push(chunk);
    });
    child.stderr.on('data', (chunk) => { if (err.reduce((sum, part) => sum + part.length, 0) < 32000) err.push(chunk); });
    child.stdin.on('error', () => {});
    child.on('close', (code) => {
      if (code !== 0) {
        const detail = Buffer.concat(err).toString('utf8').trim().slice(0, 2500);
        finish(new Error(`SSH 同步失败（${code}）。${detail || '请确认已配置密钥登录，并已在远程安装 PaperDesk。'}`));
        return;
      }
      try {
        const result = JSON.parse(Buffer.concat(out).toString('utf8').replace(/^\uFEFF/, '').trim());
        if (!result.ok) { finish(authError(result.code || 'SYNC_FAILED', result.error || '远程同步失败。')); return; }
        finish(null, result);
      } catch (error) { finish(new Error(`远程同步响应无效：${error.message}`)); }
    });
    child.stdin.end(JSON.stringify(request));
  });
}

import fs from 'node:fs';import path from 'node:path';import os from 'node:os';import {createHash,randomBytes,scryptSync,createCipheriv,createDecipheriv,hkdfSync} from 'node:crypto';
import {verifyAccount,authError,accountFingerprint} from './sync-auth.mjs';
const memoryCredentials=new Map();
const hash=s=>createHash('sha256').update(String(s)).digest('hex');
const profileKey=p=>p.id||hash(JSON.stringify(p)).slice(0,24);
const endpointKey=p=>hash(JSON.stringify(p.type==='folder'?{type:'folder',folder:path.resolve(p.folderPath||'')}:{type:'ssh',host:p.host,port:Number(p.port||22),app:p.remoteAppDir,data:p.remoteDataDir}));
function credential(vault,profile){const id=profileKey(profile),key=vault.dataDir+'|'+id;const c=memoryCredentials.get(key)||vault.getSetting('syncCredentials',{})[id];return c&&c.fingerprint===accountFingerprint(vault)&&c.endpoint===endpointKey(profile)&&c.epoch===vault.getSetting('syncAuthEpoch','')?c:null;}
function saveCredential(vault,profile,value,remember){const id=profileKey(profile),key=vault.dataDir+'|'+id;const c={...value,fingerprint:accountFingerprint(vault),endpoint:endpointKey(profile),epoch:vault.getSetting('syncAuthEpoch',''),remembered:remember};const entries=vault.getSetting('syncCredentials',{});delete entries[id];memoryCredentials.delete(key);if(remember)entries[id]=c;else memoryCredentials.set(key,c);vault.setSetting('syncCredentials',entries);return c;}
export function revokeProfile(vault,profile){const id=profileKey(profile);memoryCredentials.delete(vault.dataDir+'|'+id);const entries=vault.getSetting('syncCredentials',{});delete entries[id];vault.setSetting('syncCredentials',entries);const checkpoints=vault.getSetting('syncCheckpoints',{});delete checkpoints[id];vault.setSetting('syncCheckpoints',checkpoints);}
export function profileAuthStatus(vault,profile){const c=credential(vault,profile),stored=vault.getSetting('syncCheckpoints',{})[profileKey(profile)];const checkpoint=stored?.endpoint===endpointKey(profile)?stored:null;const incoming=c?.remoteDeviceId?vault.getSetting('incomingSyncCheckpoints',{})[c.remoteDeviceId]:null;const at=Math.max(checkpoint?.checkpoint??-1,incoming?.checkpoint??-1);return {paired:!!c,remembered:!!c?.remembered,pendingChanges:at<vault._meta('changeSeq'),lastSync:checkpoint?.lastSync||incoming?.lastSync||null,lastSyncAt:checkpoint?.lastSync||incoming?.lastSync||null};}
function markTarget(vault,profile,checkpoint){const entries=vault.getSetting('syncCheckpoints',{}),lastSync=new Date().toISOString();entries[profileKey(profile)]={endpoint:endpointKey(profile),checkpoint,lastSync};vault.setSetting('syncCheckpoints',entries);vault.setSetting('lastSyncAt',lastSync);const configured=vault.getSetting('syncProfiles')||[profile];if(configured.every(p=>!profileAuthStatus(vault,p).pendingChanges))vault.markSynced(checkpoint);}
function folderInfo(vault,profile){
 if(!path.isAbsolute(profile.folderPath||''))throw new Error('同步文件夹需要完整绝对路径。');const folder=path.resolve(profile.folderPath);const data=path.resolve(vault.dataDir);const canonical=p=>{let cursor=p,suffix=[];while(!fs.existsSync(cursor)){const parent=path.dirname(cursor);if(parent===cursor)break;suffix.unshift(path.basename(cursor));cursor=parent;}return path.join(fs.realpathSync(cursor),...suffix).toLowerCase();};const f=canonical(folder),d=canonical(data);if(f===d||f.startsWith(d+path.sep)||d.startsWith(f+path.sep))throw new Error('同步文件夹必须独立于正式资料库目录。');
 const username=vault.getAccount()?.username;if(!username)throw authError('PAIRING_REQUIRED','请先设置文献系统账号。');return {folder,prefix:'paperdesk-'+hash(username).slice(0,24)+'-',username};
}
function folderBundles(info){if(!fs.existsSync(info.folder))return [];return fs.readdirSync(info.folder).filter(n=>n.startsWith(info.prefix)&&/^[A-Za-z0-9_-]+\.pdsync$/.test(n)).map(n=>path.join(info.folder,n));}
function decryptBundle(filename,key){
 const stat=fs.statSync(filename);if(stat.size>1024*1024*1024)throw new Error('单个同步包超过 1 GB。');
 try{const envelope=JSON.parse(fs.readFileSync(filename,'utf8'));if(envelope.version!==1)throw new Error('version');const salt=Buffer.from(envelope.salt,'base64'),iv=Buffer.from(envelope.iv,'base64'),tag=Buffer.from(envelope.tag,'base64');if(salt.length!==16||iv.length!==12||tag.length!==16)throw Error('format');const derived=hkdfSync('sha256',Buffer.from(key,'hex'),salt,Buffer.from('PaperDesk encrypted sync v1'),32);const decipher=createDecipheriv('aes-256-gcm',derived,iv);decipher.setAAD(Buffer.from('PaperDesk encrypted sync v1'));decipher.setAuthTag(tag);return JSON.parse(Buffer.concat([decipher.update(Buffer.from(envelope.data,'base64')),decipher.final()]).toString('utf8'));}catch{throw authError('AUTH_FAILED','同步包无法解密：请检查两端名字和密码，并等待网盘文件下载完整。若刚修改过应用密码，请在所有设备改用一个新的空同步文件夹，重新发布文献；原同步包请保留作备份。现有文献没有被覆盖。');}
}
function encryptBundle(snapshot,key){const salt=randomBytes(16),iv=randomBytes(12),derived=hkdfSync('sha256',Buffer.from(key,'hex'),salt,Buffer.from('PaperDesk encrypted sync v1'),32),cipher=createCipheriv('aes-256-gcm',derived,iv);cipher.setAAD(Buffer.from('PaperDesk encrypted sync v1'));const data=Buffer.concat([cipher.update(JSON.stringify(snapshot),'utf8'),cipher.final()]);return JSON.stringify({version:1,salt:salt.toString('base64'),iv:iv.toString('base64'),tag:cipher.getAuthTag().toString('base64'),data:data.toString('base64')});}
export async function pairProfile(vault,profile,{username,password,remember=true,request}={}){
 const initialFingerprint=accountFingerprint(vault),initialEpoch=vault.getSetting('syncAuthEpoch','');
 const assertUnchanged=()=>{if(accountFingerprint(vault)!==initialFingerprint||vault.getSetting('syncAuthEpoch','')!==initialEpoch)throw authError('PAIRING_REQUIRED','配对期间账号或授权已变更，请使用当前密码重新配对。');};
 const identity=verifyAccount(vault,username,password);
 if(profile.type==='folder'){const info=folderInfo(vault,profile),key=scryptSync(password,'PaperDesk folder v1:'+identity.username,32,{N:32768,maxmem:64*1024*1024}).toString('hex');for(const f of folderBundles(info))decryptBundle(f,key);saveCredential(vault,profile,{username:identity.username,key},remember);return {ok:true,message:'已验证账号并解锁加密同步文件夹。'};}
 const send=request||((payload)=>peerRequest(profile,payload));const ping=await send({action:'ping'});assertUnchanged();if(ping.protocol!==2)throw authError('PEER_UPDATE_REQUIRED','远程 PaperDesk 需要先升级到 1.1，然后在两边设置相同名字和密码。');
 const result=await send({action:'pair',protocol:2,username:identity.username,password,deviceId:vault.deviceId,deviceName:os.hostname()});assertUnchanged();if(!result.ok||!result.token)throw authError(result.code||'AUTH_FAILED',result.error||'远程账号验证失败。');
 saveCredential(vault,profile,{username:identity.username,token:result.token,remoteDeviceId:result.deviceId,pairingId:result.id},remember);return {ok:true,message:'两端用户名和密码验证通过，设备已配对。'};
}
export async function testConnection(profile){
 if(profile.type==='folder'){if(!path.isAbsolute(profile.folderPath||''))throw new Error('请选择完整同步文件夹路径。');if(!fs.existsSync(profile.folderPath))return {ok:true,message:'路径有效；首次同步时将创建文件夹。'};if(!fs.statSync(profile.folderPath).isDirectory())throw new Error('目标不是文件夹。');fs.accessSync(profile.folderPath,fs.constants.R_OK|fs.constants.W_OK);return {ok:true,message:'同步文件夹可读写。网盘是否完成传输请查看网盘客户端。'};}
 const result=await peerRequest(profile,{action:'ping'});if(result.protocol!==2)throw authError('PEER_UPDATE_REQUIRED','SSH 已连接，但远程 PaperDesk 需要先升级到 1.1。');return {ok:true,username:result.username||null,dataDir:result.dataDir,message:'SSH 连接正常；同步前仍需验证文献系统账号。'};
}
export async function syncVault(vault,profile,options={}){
 if(options.password!==undefined)await pairProfile(vault,profile,options);
 const c=credential(vault,profile);if(!c)throw authError('PAIRING_REQUIRED','首次同步请先输入文献系统的名字和密码，验证后可以记住设备。');
 const identity={authenticated:true,username:c.username};
 if(profile.type==='folder'){
  const info=folderInfo(vault,profile),bundles=folderBundles(info).map(f=>decryptBundle(f,c.key));let changed=0,conflicts=0;for(const snapshot of bundles){const stats=vault.mergeSnapshot(snapshot,identity);changed+=stats.papersChanged+stats.notesChanged;conflicts=Math.max(conflicts,stats.conflicts);}
  const outgoing=vault.exportSnapshot(),serialized=encryptBundle(outgoing,c.key);if(Buffer.byteLength(serialized)>1024*1024*1024)throw new Error('同步包超过 1 GB，请使用较小的资料库。');fs.mkdirSync(info.folder,{recursive:true});const filename=path.join(info.folder,info.prefix+vault.deviceId+'.pdsync'),tmp=filename+'.'+randomBytes(8).toString('hex')+'.tmp';fs.writeFileSync(tmp,serialized,{flag:'wx'});try{fs.renameSync(tmp,filename);}catch(e){try{fs.unlinkSync(tmp);}catch{}throw e;}
  markTarget(vault,profile,outgoing.checkpoint);return {ok:true,papers:vault.listPapers().length,changed,conflicts,pendingChanges:profileAuthStatus(vault,profile).pendingChanges,message:'已读取当前同步包并发布本机加密快照。请等网盘传输完成，再在其他设备点击同步。'};
 }
 const transport=options.request||((payload)=>peerRequest(profile,payload));const assertCredential=()=>{const now=credential(vault,profile);if(!now||now.token!==c.token||now.fingerprint!==c.fingerprint||now.epoch!==c.epoch)throw authError('PAIRING_REQUIRED','同步期间授权已撤销或账号已变更，请重新配对。');};const request=async payload=>{assertCredential();const response=await transport({...payload,protocol:2,deviceId:vault.deviceId,token:c.token});assertCredential();if(!response.ok)throw authError(response.code||'SYNC_FAILED',response.error||'远程同步失败。');return response;};
 let conflicts=0,changed=0;const initial=await request({action:'export'});if(!initial.snapshot)throw new Error('无法读取远程文献库。');let stats=vault.mergeSnapshot(initial.snapshot,identity);conflicts=stats.conflicts;changed+=stats.papersChanged+stats.notesChanged;
 for(let rounds=1;rounds<=4;rounds++){
  const outgoing=vault.exportSnapshot(),response=await request({action:'merge',snapshot:outgoing});if(!response.snapshot)throw new Error('远程合并没有返回快照。');stats=vault.mergeSnapshot(response.snapshot,identity);changed+=stats.papersChanged+stats.notesChanged;conflicts=Math.max(conflicts,stats.conflicts,response.stats?.conflicts||0);
  const local=vault.exportSnapshot(),digest=snapshotDigest(local);if(digest!==snapshotDigest(response.snapshot))continue;const acknowledgement=await request({action:'ack',digest});
  if(acknowledgement.matched){markTarget(vault,profile,local.checkpoint);return {ok:true,papers:vault.listPapers().length,changed,conflicts,rounds,pendingChanges:profileAuthStatus(vault,profile).pendingChanges,message:conflicts?'同步完成，并行修改均已保留，请整理冲突内容。':'双向同步完成。'};}
  if(acknowledgement.snapshot){stats=vault.mergeSnapshot(acknowledgement.snapshot,identity);conflicts=Math.max(conflicts,stats.conflicts);}
 }
 return {ok:true,papers:vault.listPapers().length,changed,conflicts,pendingChanges:true,message:'文献已安全合并，但同步期间仍有编辑，请完成编辑后再同步一次。'};
}
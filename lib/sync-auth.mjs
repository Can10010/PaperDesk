import {createHash,randomBytes,scryptSync,timingSafeEqual,randomUUID} from 'node:crypto';
const digest=s=>createHash('sha256').update(String(s)).digest('hex');
const safe=(a,b)=>typeof a==='string'&&typeof b==='string'&&a.length===b.length&&timingSafeEqual(Buffer.from(a),Buffer.from(b));
export const authError=(code,message)=>Object.assign(new Error(message),{code});
export const accountFingerprint=vault=>digest(JSON.stringify(vault.getAccount()));
function verifyAccountUnlocked(vault,username,password){
 const limit=vault.getSetting('syncAuthAttempts',{count:0,at:0});if(limit.count>=12&&Date.now()-limit.at<60000)throw authError('AUTH_LOCKED','尝试过于频繁，请一分钟后重新配对。');
 const account=vault.getAccount();let valid=false;
 if(account&&typeof password==='string'&&password.length>0&&password.length<=256&&account.username===String(username||'').trim())valid=safe(scryptSync(password,account.salt,64).toString('hex'),account.passwordHash);
 if(!valid){vault.setSetting('syncAuthAttempts',{count:Date.now()-limit.at<60000?limit.count+1:1,at:Date.now()});throw authError('AUTH_FAILED',account?'文献系统的名字或密码不正确；两台设备需使用相同名字和密码。':'请先在这台设备打开 PaperDesk，设置与你其它设备相同的名字和密码。');}
 vault.setSetting('syncAuthAttempts',{count:0,at:0});return {username:account.username,authenticated:true};
}
function authTransaction(vault,fn){let value,error;vault._transaction(()=>{try{value=fn();}catch(e){error=e;}});if(error)throw error;return value;}
export function verifyAccount(vault,username,password){return authTransaction(vault,()=>verifyAccountUnlocked(vault,username,password));}
function issuePairingUnlocked(vault,request){
 const identity=verifyAccountUnlocked(vault,request.username,request.password);
 if(!/^[A-Za-z0-9_-]{1,100}$/.test(request.deviceId||''))throw authError('AUTH_FAILED','设备编号无效。');
 const token=randomBytes(32).toString('hex'),id=randomUUID(),devices=vault.getSetting('pairedDevices',{});
 for(const [key,value]of Object.entries(devices))if(value.deviceId===request.deviceId)delete devices[key];
 devices[id]={id,deviceId:request.deviceId,name:String(request.deviceName||request.deviceId).slice(0,100),username:identity.username,tokenHash:digest(token),fingerprint:accountFingerprint(vault),pairedAt:new Date().toISOString()};
 vault.setSetting('pairedDevices',devices);return {token,id,username:identity.username,deviceId:vault.deviceId};
}
export function issuePairing(vault,request){return authTransaction(vault,()=>issuePairingUnlocked(vault,request));}
export function authenticatePeer(vault,request){
 const entries=vault.getSetting('pairedDevices',{});const entry=Object.values(entries).find(x=>x.deviceId===request.deviceId&&x.fingerprint===accountFingerprint(vault)&&safe(x.tokenHash,digest(request.token||'')));
 if(!entry)throw authError('PAIRING_REQUIRED','此设备尚未通过账号密码验证，或配对已撤销。请重新配对。');return {authenticated:true,username:entry.username,deviceId:entry.deviceId,pairingId:entry.id};
}
export function listPairedDevices(vault){return Object.values(vault.getSetting('pairedDevices',{})).map(({tokenHash,fingerprint,...v})=>v);}
export function revokePairedDevice(vault,id){vault._transaction(()=>{const devices=vault.getSetting('pairedDevices',{});delete devices[id];vault.setSetting('pairedDevices',devices);});}
export function revokeAllPairings(vault){vault._transaction(()=>{vault.setSetting('pairedDevices',{});vault.setSetting('syncCredentials',{});vault.setSetting('syncAuthEpoch',randomUUID());});}
export function handlePeerRequest(vault,request){
 if(request.action==='ping')return {ok:true,protocol:2,username:vault.getAccount()?.username||null,dataDir:vault.dataDir,deviceId:vault.deviceId};
 if(request.protocol!==2)throw authError('PEER_UPDATE_REQUIRED','两台设备都需要升级到 PaperDesk 1.1 后才能配对同步。');
 if(request.action==='pair')return {ok:true,protocol:2,...issuePairing(vault,request)};
 const identity=authenticatePeer(vault,request);
 if(request.action==='export')return {ok:true,snapshot:vault.exportSnapshot()};
 if(request.action==='merge'){const stats=vault.mergeSnapshot(request.snapshot,identity);return {ok:true,stats,snapshot:vault.exportSnapshot()};}
 if(request.action==='ack'){
  const snapshot=vault.exportSnapshot(),matched=request.digest===snapshotHash(snapshot);
  if(matched){vault._transaction(()=>{const received=vault.getSetting('incomingSyncCheckpoints',{});received[identity.deviceId]={checkpoint:snapshot.checkpoint,lastSync:new Date().toISOString()};vault.setSetting('incomingSyncCheckpoints',received);vault.setSetting('lastSyncAt',new Date().toISOString());});}
  return {ok:true,matched,...(matched?{}:{snapshot})};
 }
 throw new Error('不支持的同步操作。');
}
import {snapshotDigest as snapshotHash} from './vault.mjs';
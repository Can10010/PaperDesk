import {Vault} from '../lib/vault.mjs';import {handlePeerRequest} from '../lib/sync-auth.mjs';
const index=process.argv.indexOf('--data-dir');let vault;
try{
 if(index<0||!process.argv[index+1])throw new Error('缺少 --data-dir 参数。');
 const chunks=[];let bytes=0;for await(const chunk of process.stdin){bytes+=chunk.length;if(bytes>1024*1024*1024)throw new Error('同步请求超过 1 GB。');chunks.push(chunk);}
 const request=JSON.parse(Buffer.concat(chunks).toString('utf8'));vault=new Vault(process.argv[index+1]);process.stdout.write(JSON.stringify(handlePeerRequest(vault,request)));
}catch(error){process.stdout.write(JSON.stringify({ok:false,error:error.message,code:error.code||'SYNC_FAILED'}));}finally{vault?.close();}
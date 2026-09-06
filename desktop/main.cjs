const {app,BrowserWindow,ipcMain,shell,dialog,Menu}=require('electron');
const path=require('node:path'),fs=require('node:fs'),os=require('node:os'),{spawn}=require('node:child_process');
const dataDir=path.resolve(process.env.PAPERDESK_DATA_DIR||(fs.existsSync('D:\\')?'D:\\PaperDeskData':path.join(os.homedir(),'PaperDeskData')));
const desktopDir=path.join(dataDir,'desktop'),sessionDir=desktopDir;
fs.mkdirSync(sessionDir,{recursive:true});app.setPath('userData',desktopDir);app.setPath('sessionData',sessionDir);
const lock=app.requestSingleInstanceLock();if(!lock)app.quit();
let win,allowQuit=false;
const port=Number(process.env.PAPERDESK_PORT||47821),url='http://127.0.0.1:'+port;
const normalizePath=value=>path.resolve(value).replace(/[\\/]+$/,'').toLowerCase();
async function runningServer(){
 let response;try{response=await fetch(url+'/api/health',{signal:AbortSignal.timeout(1500)})}catch{return false}
 if(!response.ok)throw new Error('端口 '+port+' 已被其他服务占用。请关闭占用该端口的服务，或通过 PAPERDESK_PORT 选择其他端口。');
 const health=await response.json();
 if(health.app!=='PaperDesk')throw new Error('端口 '+port+' 已被其他服务占用，PaperDesk 没有连接该服务。');
 if(!health.dataDir||!health.version)throw new Error('端口 '+port+' 上仍运行旧版 PaperDesk 后台服务。请退出旧版后台服务后重新打开；已有文献不受影响。');
 if(normalizePath(health.dataDir)!==normalizePath(dataDir))throw new Error('端口 '+port+' 上的 PaperDesk 使用了另一个文献库：\n'+health.dataDir+'\n\n当前选择：\n'+dataDir+'\n\n请关闭原后台服务或为当前文献库设置另一个 PAPERDESK_PORT。');
 if(health.version!==app.getVersion())throw new Error('PaperDesk 界面版本 '+app.getVersion()+' 与后台版本 '+health.version+' 不一致。请退出旧版后台服务后重新打开。');
 return true;
}
async function ensureServer(){
 if(await runningServer())return;
 const root=app.isPackaged?path.join(process.resourcesPath,'app'):path.resolve(__dirname,'..');
 const node=app.isPackaged?path.join(process.resourcesPath,'runtime','node.exe'):path.join(root,'runtime','node.exe');
 const log=fs.openSync(path.join(dataDir,'service.log'),'a');
 let spawnError=null;
 const child=spawn(node,[path.join(root,'server.mjs')],{cwd:root,detached:true,windowsHide:true,stdio:['ignore',log,log],env:{...process.env,PAPERDESK_DATA_DIR:dataDir,PAPERDESK_PORT:String(port)}});
 child.on('error',error=>{spawnError=error});child.unref();fs.closeSync(log);
 for(let i=0;i<120;i++){
  await new Promise(resolve=>setTimeout(resolve,250));
  if(spawnError)throw new Error('无法启动本地服务：'+spawnError.message+'\n请确认安装目录中存在 Node 运行时。');
  if(await runningServer())return;
  if(child.exitCode!==null)throw new Error('本地服务已提前退出，请查看 '+path.join(dataDir,'service.log'));
 }
 throw new Error('本地服务启动失败，请查看 '+path.join(dataDir,'service.log'));
}
function setFullscreen(value){if(!win||win.isDestroyed())return false;win.setFullScreen(Boolean(value));return win.isFullScreen()}
function toggleFullscreen(){return setFullscreen(!win?.isFullScreen())}
app.on('second-instance',()=>{if(win){if(win.isMinimized())win.restore();win.show();win.focus()}});
app.on('web-contents-created',(_event,contents)=>{
 contents.on('before-input-event',(event,input)=>{
  if(input.type!=='keyDown')return;
  if(input.key==='F11'){event.preventDefault();toggleFullscreen()}
  if(input.key==='Escape'&&win&&!win.isDestroyed()){
   if(win.isFullScreen()){event.preventDefault();setFullscreen(false)}
   win.webContents.send('paperdesk:escape');
  }
 });
});
if(lock)app.whenReady().then(async()=>{
 try{
  await ensureServer();
  win=new BrowserWindow({width:1440,height:940,minWidth:960,minHeight:650,backgroundColor:'#18181b',title:'PaperDesk 文献库',autoHideMenuBar:true,webPreferences:{preload:path.join(__dirname,'preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true}});
  Menu.setApplicationMenu(Menu.buildFromTemplate([{label:'视图',submenu:[{label:'切换全屏',accelerator:'F11',click:toggleFullscreen}]}]));
  win.webContents.setWindowOpenHandler(({url:target})=>{if(/^https?:\/\//.test(target))shell.openExternal(target);return {action:'deny'}});
  win.webContents.on('will-navigate',(e,target)=>{if(!target.startsWith(url+'/')){e.preventDefault();if(/^https?:\/\//.test(target))shell.openExternal(target)}});
  win.on('enter-full-screen',()=>win.webContents.send('paperdesk:fullscreen-changed',true));
  win.on('leave-full-screen',()=>win.webContents.send('paperdesk:fullscreen-changed',false));
  win.on('close',e=>{if(!allowQuit){e.preventDefault();win.webContents.send('paperdesk:quit-requested')}});
  await win.loadURL(url);
 }catch(e){dialog.showErrorBox('PaperDesk 启动失败',e.message);allowQuit=true;app.quit()}
});
ipcMain.on('paperdesk:quit',()=>{allowQuit=true;app.quit()});
ipcMain.handle('paperdesk:toggle-fullscreen',toggleFullscreen);
ipcMain.handle('paperdesk:get-fullscreen',()=>!!win?.isFullScreen());
app.on('window-all-closed',()=>app.quit());

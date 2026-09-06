const {contextBridge,ipcRenderer}=require('electron');
function subscribe(channel,callback){
 const listener=(_event,value)=>callback(value);
 ipcRenderer.on(channel,listener);
 return()=>ipcRenderer.removeListener(channel,listener);
}
contextBridge.exposeInMainWorld('paperdesk',{
 quit:()=>ipcRenderer.send('paperdesk:quit'),
 toggleFullscreen:()=>ipcRenderer.invoke('paperdesk:toggle-fullscreen'),
 getFullscreen:()=>ipcRenderer.invoke('paperdesk:get-fullscreen'),
 onFullscreenChanged:callback=>subscribe('paperdesk:fullscreen-changed',callback),
 onEscape:callback=>subscribe('paperdesk:escape',callback),
 onQuitRequested:callback=>subscribe('paperdesk:quit-requested',callback)
});

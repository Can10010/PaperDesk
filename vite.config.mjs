import { defineConfig } from 'vite';
export default defineConfig({base:'./',server:{host:'127.0.0.1',port:5173,proxy:{'/api':'http://127.0.0.1:47821'}},build:{outDir:'dist'}});

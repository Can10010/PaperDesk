import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {chromium} from '@playwright/test';
import {startServer} from '../server.mjs';

test('resizers, math preview, autosave races and failure recovery', {timeout:120000}, async t => {
  const dir = fs.mkdtempSync(path.resolve('.test-data/ui-111-'));
  const svc = await startServer({dataDir:dir, port:47823});
  const browser = await chromium.launch({headless:true, ...(process.env.PAPERDESK_TEST_BROWSER ? {executablePath:process.env.PAPERDESK_TEST_BROWSER} : {})});
  t.after(async () => {await browser.close(); await svc.close(); fs.rmSync(dir,{recursive:true,force:true});});
  const page = await browser.newPage({viewport:{width:1440,height:1000}});
  const errors=[];page.on('pageerror', e => errors.push(e.message));
  const request=async (route,body) => (await page.request.post(svc.url+route,{data:body})).json();
  await request('/api/auth/setup',{username:'UI test',password:'1'});
  const paper=svc.vault.importPdf(Buffer.from('%PDF-1.4\n%%EOF'),{title:'Resize fixture'}).paper;
  const second=await request('/api/notes',{title:'Second note',markdown:'# Second'});
  await page.goto(svc.url);
  await page.getByRole('heading',{name:'Resize fixture',exact:true}).click();
  const lib=page.getByRole('separator',{name:'文献列表与详情宽度'});
  async function drag(locator, delta) {const box=await locator.boundingBox();await page.mouse.move(box.x+4,box.y+box.height/2);await page.mouse.down();await page.mouse.move(box.x+4+delta,box.y+box.height/2,{steps:12});await page.mouse.up();}
  const initialListWidth=(await page.locator('.paper-list-pane').boundingBox()).width;
  await drag(lib,-170);
  assert.ok((await page.locator('.paper-list-pane').boundingBox()).width<initialListWidth-100);
  const ratio=Number(await lib.getAttribute('aria-valuenow'));assert.ok(ratio<35);
  await page.getByRole('tab',{name:'边读边记',exact:true}).click();
  const split=page.getByRole('separator',{name:'PDF 与笔记宽度'});
  const initialPdfWidth=(await page.locator('.pdf-view').boundingBox()).width;
  await drag(split,100);assert.ok((await page.locator('.pdf-view').boundingBox()).width>initialPdfWidth+50);assert.ok(Number(await split.getAttribute('aria-valuenow'))>52);
  await split.press('ArrowLeft');await split.dblclick();assert.equal(await split.getAttribute('aria-valuenow'),'52');
  await page.setViewportSize({width:960,height:700});await lib.press('End');await split.press('End');
  assert.ok(await page.locator('.note-workspace').isVisible());
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth));
  await page.setViewportSize({width:1440,height:1000});
  await lib.press('Home');await drag(lib,70);
  const persisted=Number(await lib.getAttribute('aria-valuenow'));
  await split.dblclick();
  await page.reload();await page.getByRole('heading',{name:'Resize fixture',exact:true}).click();
  assert.equal(Number(await lib.getAttribute('aria-valuenow')),persisted);
  await page.getByRole('tab',{name:'边读边记',exact:true}).click();
  const editor=page.getByRole('textbox',{name:'Markdown 笔记编辑器'});
  const markdown=String.raw`# Heading

| A | B |
| --- | --- |
| one | two |

- [x] Task

$x_i^2$ and \(\frac{a}{b}\)

$$
\sum_{i=1}^{N} x_i
$$

<img src=x onerror="window.markdownUnsafe=true">
`;
  await editor.fill(markdown);
  await page.waitForFunction(() => document.querySelector('.note-footer')?.textContent.includes('已保存到本地'));
  assert.equal(svc.vault.readNote(paper.id),markdown);
  await page.getByRole('button',{name:'分栏',exact:true}).click();
  assert.equal(await page.locator('.preview-half .katex').count(),3);
  assert.equal(await page.locator('.preview-half table').count(),1);
  assert.equal(await page.evaluate(() => !!window.markdownUnsafe),false);
  assert.equal(await page.locator('.preview-half [onerror]').count(),0);
  await page.screenshot({path:'.test-data/ui-111-layout.png',fullPage:true});
  // Stop request 1 in flight, edit again, then navigate: both edits must be drained.
  const endpoint='**/api/papers/'+paper.id+'/note';
  let release, enteredResolve;
  const entered=new Promise(r=>enteredResolve=r), gate=new Promise(r=>release=r);
  await page.route(endpoint,async route=>{if(route.request().method()==='PUT'){enteredResolve();await gate;}await route.continue();});
  await editor.fill('First inflight');await entered;
  await editor.fill('Second edit while saving');
  await page.getByRole('navigation',{name:'主导航'}).getByRole('button',{name:/笔记/}).click();release();
  await page.getByRole('heading',{name:'Second note',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('textarea.markdown-input')?.value==='# Second');
  assert.equal(svc.vault.readNote(paper.id),'Second edit while saving');
  assert.equal(svc.vault.readNote(second.paper.id),'# Second');
  await page.unroute(endpoint);
  const secondEndpoint='**/api/papers/'+second.paper.id+'/note';
  await page.route(secondEndpoint,async route=>{if(route.request().method()==='PUT')return route.fulfill({status:503,contentType:'application/json',body:'{"error":"Simulated offline"}'});await route.continue();});
  await editor.fill('Retain me after failure');
  await page.waitForFunction(()=>document.querySelector('.note-footer')?.textContent.includes('保存失败'));
  assert.equal(await editor.inputValue(),'Retain me after failure');
  await page.getByRole('navigation',{name:'主导航'}).getByRole('button',{name:/文献库/}).click();
  assert.equal(await editor.inputValue(),'Retain me after failure');
  await page.unroute(secondEndpoint);
  await page.getByRole('button',{name:'保存',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('.note-footer')?.textContent.includes('已保存到本地'));
  assert.equal(svc.vault.readNote(second.paper.id),'Retain me after failure');
  await page.getByRole('button',{name:'Markdown 语法与保存说明'}).click();
  assert.ok(await page.getByRole('dialog').isVisible());
  assert.equal(errors.length,0,errors.join('\n'));
});

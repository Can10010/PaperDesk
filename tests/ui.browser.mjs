import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {chromium} from '@playwright/test';
import {startServer} from '../server.mjs';

function smallPdf({ text = 'Synthetic research abstract with reliable evidence for retrieval.', metadataTitle = 'An Accurate Method for Radar Direction Estimation', title = 'An Accurate Method for Radar Direction Estimation' } = {}) {
  const stream = text ? `BT /F1 18 Tf 50 740 Td (${title}) Tj 0 -40 Td /F1 11 Tf (${text}) Tj ET` : '';
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
    `<< /Title (${metadataTitle}) /Author (Research Team) >>`,
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((object, index) => { offsets.push(Buffer.byteLength(pdf)); pdf += `${index + 1} 0 obj\n${object}\nendobj\n`; });
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1)) pdf += String(offset).padStart(10, '0') + ' 00000 n \n';
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R /Info 6 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(pdf);
}

test('live editing, resizers, math, autosave races and failure recovery', {timeout:120000}, async t => {
  const dir = fs.mkdtempSync(path.resolve('.test-data/ui-112-'));
  const svc = await startServer({dataDir:dir, port:47823});
  const browser = await chromium.launch({headless:true, ...(process.env.PAPERDESK_TEST_BROWSER ? {executablePath:process.env.PAPERDESK_TEST_BROWSER} : {})});
  t.after(async () => {await browser.close(); await svc.close(); fs.rmSync(dir,{recursive:true,force:true});});
  const page = await browser.newPage({viewport:{width:1440,height:1000}});
  const errors=[];page.on('pageerror', e => errors.push(e.message));
  const request=async (route,body) => (await page.request.post(svc.url+route,{data:body})).json();
  await request('/api/auth/setup',{username:'UI test',password:'1'});
  const paper=svc.vault.importPdf(smallPdf(),{title:'Resize fixture'}).paper;
  const second=await request('/api/notes',{title:'Second note',markdown:'# Second'});
  // Keep an actual iframe for drag testing; the native Edge PDF plugin steals focus while loading.
  // PDF bytes and extraction are covered by the API/knowledge tests.
  await page.route('**/api/papers/*/pdf',route=>route.fulfill({contentType:'text/html',body:'<html><body style="font:16px Georgia;padding:30px;color:#222"><h2>Research paper</h2><p>A synthetic reading surface for editor interaction tests.</p></body></html>'}));
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
  await page.locator('.live-markdown-editor').waitFor({state:'visible'});
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
  async function fillEditor(text) {await editor.focus();await editor.press('Control+a');await page.keyboard.insertText(text);}
  async function readEditor() {await editor.focus();await editor.press('Control+a');return (await page.locator('.cm-line').allTextContents()).join('\n');}
  assert.equal(await page.getByRole('button',{name:'预览',exact:true}).count(),0);
  assert.equal(await page.getByRole('button',{name:'分栏',exact:true}).count(),0);
  assert.equal(await page.getByRole('button',{name:'编辑',exact:true}).count(),0);
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
  await fillEditor(markdown);
  await page.waitForFunction(() => document.querySelector('.note-footer')?.textContent.includes('已保存到本地'));
  assert.equal(svc.vault.readNote(paper.id),markdown);
  await page.getByRole('heading',{name:'Resize fixture',exact:true}).last().click();
  assert.equal(await page.locator('.cm-rendered-block .katex').count(),3);
  assert.equal(await page.locator('.cm-rendered-block table').count(),1);
  assert.equal(await page.evaluate(() => !!window.markdownUnsafe),false);
  assert.equal(await page.locator('.cm-rendered-block [onerror]').count(),0);
  await page.locator('.cm-scroller').evaluate(el=>el.scrollTop=0);
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  await page.screenshot({path:'.test-data/ui-112-layout.png',fullPage:true});
  // Rendered text can be clicked and edited, with undo and no mode switches.
  await page.locator('.cm-rendered-block h1').click();
  await editor.press('End');await page.keyboard.insertText(' changed');
  await page.waitForFunction(()=>document.querySelector('.note-footer')?.textContent.includes('已保存到本地'));
  assert.ok(svc.vault.readNote(paper.id).includes('# Heading changed'));
  await editor.press('Control+z');
  await page.waitForFunction(()=>document.querySelector('.note-footer')?.textContent.includes('已保存到本地'));
  assert.equal(svc.vault.readNote(paper.id),markdown);
  await page.getByRole('heading',{name:'Resize fixture',exact:true}).last().click();
  await page.getByRole('checkbox',{name:'切换任务完成状态'}).click();
  await page.waitForFunction(()=>document.querySelector('.note-footer')?.textContent.includes('已保存到本地'));
  assert.ok(svc.vault.readNote(paper.id).includes('- [ ] Task'));
  await fillEditor('An idea');await editor.press('Control+a');await editor.press('Control+b');
  await page.waitForFunction(()=>document.querySelector('.note-footer')?.textContent.includes('已保存到本地'));
  assert.equal(svc.vault.readNote(paper.id),'**An idea**');
  // Stop request 1 in flight, edit again, then navigate: both edits must be drained.
  const endpoint='**/api/papers/'+paper.id+'/note';
  let release, enteredResolve;
  const entered=new Promise(r=>enteredResolve=r), gate=new Promise(r=>release=r);
  await page.route(endpoint,async route=>{if(route.request().method()==='PUT'){enteredResolve();await gate;}await route.continue();});
  await fillEditor('First inflight');await entered;
  await fillEditor('Second edit while saving');
  await page.getByRole('navigation',{name:'主导航'}).getByRole('button',{name:/笔记/}).click();release();
  await page.getByRole('heading',{name:'Second note',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('.live-markdown-editor')?.textContent.includes('Second'));
  assert.equal(await readEditor(),'# Second');
  assert.equal(svc.vault.readNote(paper.id),'Second edit while saving');
  assert.equal(svc.vault.readNote(second.paper.id),'# Second');
  await page.unroute(endpoint);
  const secondEndpoint='**/api/papers/'+second.paper.id+'/note';
  await page.route(secondEndpoint,async route=>{if(route.request().method()==='PUT')return route.fulfill({status:503,contentType:'application/json',body:'{"error":"Simulated offline"}'});await route.continue();});
  await fillEditor('Retain me after failure');
  await page.waitForFunction(()=>document.querySelector('.note-footer')?.textContent.includes('保存失败'));
  assert.equal(await readEditor(),'Retain me after failure');
  await page.getByRole('navigation',{name:'主导航'}).getByRole('button',{name:/文献库/}).click();
  assert.equal(await readEditor(),'Retain me after failure');
  await page.unroute(secondEndpoint);
  await page.getByRole('button',{name:'保存',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('.note-footer')?.textContent.includes('已保存到本地'));
  assert.equal(svc.vault.readNote(second.paper.id),'Retain me after failure');
  // A Hermes/external edit and a newer local draft must both survive conflict saving.
  let releaseConflict, conflictEnteredResolve;
  const conflictEntered=new Promise(r=>conflictEnteredResolve=r), conflictGate=new Promise(r=>releaseConflict=r);
  await page.route(secondEndpoint,async route=>{if(route.request().method()==='PUT'){conflictEnteredResolve();await conflictGate;}await route.continue();});
  await fillEditor('Local before response');await conflictEntered;
  svc.vault.saveNote(second.paper.id,'Hermes concurrent idea');
  await fillEditor('Latest local idea');releaseConflict();
  await page.waitForFunction(()=>document.querySelector('.note-footer')?.textContent.includes('已保存到本地'));
  const retained=svc.vault.readNote(second.paper.id);
  assert.ok(retained.includes('Hermes concurrent idea'));
  assert.ok(retained.includes('Latest local idea'));
  assert.equal(await readEditor(),retained);
  await page.unroute(secondEndpoint);
  // Opening and browsing an existing CRLF document must not normalize or autosave it.
  const exact='#   Preserved\r\n\r\nOriginal $x_i$ text.  \r\n';
  const untouched=await request('/api/notes',{title:'Untouched source',markdown:exact});
  await page.reload();await page.getByRole('navigation',{name:'主导航'}).getByRole('button',{name:/笔记/}).click();
  await page.getByRole('heading',{name:'Untouched source',exact:true}).click();
  let writes=0;page.on('request',req=>{if(req.method()==='PUT' && req.url().endsWith('/note'))writes++;});
  await page.locator('.cm-rendered-block h1').click();await editor.press('ArrowRight');
  await page.getByRole('heading',{name:'Untouched source',exact:true}).last().click();
  await new Promise(resolve=>setTimeout(resolve,1300));
  assert.equal(writes,0);assert.equal(svc.vault.readNote(untouched.paper.id),exact);
  await page.getByRole('button',{name:'Markdown 语法与保存说明'}).click();
  assert.ok(await page.getByRole('dialog').isVisible());
  assert.equal(errors.length,0,errors.join('\n'));
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Vault, snapshotDigest } from '../lib/vault.mjs';
import { syncVault, pairProfile, profileAuthStatus, revokeProfile } from '../lib/sync.mjs';

import {scryptSync} from 'node:crypto';
import {handlePeerRequest,revokeAllPairings,revokePairedDevice,listPairedDevices} from '../lib/sync-auth.mjs';
const setAccount=(v,username='Researcher',password='1')=>v.setAccount({username,salt:'isolated-test-salt',passwordHash:scryptSync(password,'isolated-test-salt',64).toString('hex')});
const pdf = (text = 'example') => Buffer.from(`%PDF-1.4\n${text}\n%%EOF`);
function pair(t) {
  const directory = mkdtempSync(path.join(tmpdir(), 'paperdesk-sync-test-'));
  const a = new Vault(path.join(directory, 'a'));
  const b = new Vault(path.join(directory, 'b'));
  setAccount(a);setAccount(b);
  t.after(() => { a.close(); b.close(); rmSync(directory, { recursive: true, force: true }); });
  return { a, b, directory };
}
const transfer = (a, b) => b.mergeSnapshot(a.exportSnapshot(),{authenticated:true,username:a.getAccount().username});

test('SHA and normalized DOI deduplicate; matching titles are only candidates', (t) => {
  const { a } = pair(t);
  const first = a.importPdf(pdf(), { title: 'A paper', doi: 'https://doi.org/10.1000/ABC' });
  assert.equal(a.importPdf(pdf(), { title: 'Renamed' }).reason, 'sha256');
  assert.equal(a.importPdf(pdf('second'), { title: 'Other', doi: 'doi: 10.1000/abc' }).reason, 'doi');
  const similar = a.importPdf(pdf('third'), { title: 'A Paper!' });
  assert.equal(similar.duplicate, false);
  assert.equal(similar.candidateMatches[0].id, first.paper.id);
  assert.equal(a.listPapers().length, 2);
});

test('PDF filename follows title, remains valid on Windows, and originals survive deletion', (t) => {
  const { a } = pair(t);
  const paper = a.importPdf(pdf(), { title: 'CON:<A>/test?' }).paper;
  const before = a.pdfPath(paper.id);
  assert.equal(readFileSync(before).toString(), pdf().toString());
  assert.ok(!/[<>:"|?*]/.test(path.basename(before)));
  a.upsertPaper({ id: paper.id, title: 'A new name' });
  const after = a.pdfPath(paper.id);
  assert.notEqual(before, after);
  assert.equal(existsSync(before), false);
  assert.match(path.basename(after), /^A new name--/);
  a.deletePaper(paper.id);
  assert.equal(a.listPapers().length, 0);
  assert.equal(Object.keys(a.exportSnapshot().assets).length, 1);
});

test('concurrent Markdown edits survive and merge is idempotent', (t) => {
  const { a, b } = pair(t);
  const paper = a.upsertPaper({ kind: 'note', title: 'Ideas' });
  a.saveNote(paper.id, 'base');
  transfer(a, b);
  a.saveNote(paper.id, 'local hypothesis');
  b.saveNote(paper.id, 'remote hypothesis');
  transfer(b, a);
  transfer(a, b);
  assert.match(a.readNote(paper.id), /local hypothesis/);
  assert.match(a.readNote(paper.id), /remote hypothesis/);
  assert.equal(a.readNote(paper.id), b.readNote(paper.id));
  const before = snapshotDigest(a.exportSnapshot());
  transfer(b, a);
  assert.equal(snapshotDigest(a.exportSnapshot()), before);
  a.saveNote(paper.id, 'resolved hypothesis');
  transfer(a, b);
  assert.equal(b.readNote(paper.id), 'resolved hypothesis');
  assert.equal(b.exportSnapshot().notes[0].versions.length, 1);
});

test('offline delete versus edit preserves edit; later deliberate delete converges', (t) => {
  const { a, b } = pair(t);
  const paper = a.upsertPaper({ kind: 'note', title: 'Initial' });
  transfer(a, b);
  a.deletePaper(paper.id);
  b.upsertPaper({ id: paper.id, title: 'Edited offline' });
  transfer(b, a);
  assert.equal(a.getPaper(paper.id).title, 'Edited offline');
  assert.ok(a.getPaper(paper.id).conflicts.some((version) => version.deleted));
  a.deletePaper(paper.id);
  transfer(a, b);
  assert.equal(b.getPaper(paper.id), null);
});

test('external Markdown changes are captured before incoming merge and retained', (t) => {
  const { a, b } = pair(t);
  const paper = a.upsertPaper({ kind: 'note', title: 'External editor' });
  a.saveNote(paper.id, 'base');
  transfer(a, b);
  b.saveNote(paper.id, 'remote change');
  writeFileSync(a.notePath(paper.id), 'edited in Obsidian');
  transfer(b, a);
  assert.match(a.readNote(paper.id), /edited in Obsidian/);
  assert.match(a.readNote(paper.id), /remote change/);
  assert.equal(readFileSync(a.notePath(paper.id), 'utf8'), a.readNote(paper.id));
});

test('settings and password hashes stay local; unauthenticated and other-user merge rejected',t=>{
 const {a,b}=pair(t);a.setSetting('apiKey','private-provider-secret');const original=b.getAccount();const snapshot=a.exportSnapshot();const serialized=JSON.stringify(snapshot);assert.ok(!serialized.includes('private-provider-secret'));assert.ok(!serialized.includes('passwordHash'));assert.ok(!serialized.includes('isolated-test-salt'));assert.throws(()=>b.mergeSnapshot(snapshot),/验证/);transfer(a,b);assert.deepEqual(b.getAccount(),original);setAccount(b,'Another');assert.throws(()=>transfer(a,b),/验证/);
});

test('simultaneous imports on separate devices deduplicate by DOI without losing notes', (t) => {
  const { a, b } = pair(t);
  const first = a.importPdf(pdf('edition-a'), { title: 'First version', doi: '10.1000/test' }).paper;
  const second = b.importPdf(pdf('edition-b'), { title: 'Second version', doi: 'https://doi.org/10.1000/TEST' }).paper;
  a.saveNote(first.id, 'first notes');
  b.saveNote(second.id, 'second notes');
  transfer(b, a);
  transfer(a, b);
  assert.equal(a.listPapers().length, 1);
  assert.equal(b.listPapers().length, 1);
  assert.match(a.readNote(first.id), /first notes/);
  assert.match(a.readNote(first.id), /second notes/);
  assert.equal(snapshotDigest(a.exportSnapshot()), snapshotDigest(b.exportSnapshot()));
});

test('running Vault instances see helper changes and dirty checkpoints preserve new edits', (t) => {
  const { a, directory } = pair(t);
  const helper = new Vault(path.join(directory, 'a'));

  const paper = a.upsertPaper({ kind: 'note', title: 'Concurrent connection' });
  a.saveNote(paper.id, 'initial');
  const checkpoint = a.exportSnapshot().checkpoint;
  helper.saveNote(paper.id, 'from helper');
  assert.equal(a.readNote(paper.id), 'from helper');
  a.markSynced(checkpoint);
  assert.equal(a.getDirty(), true);
  a.markSynced();
  assert.equal(a.getDirty(), false);
  helper.close();
});

test('corrupt or incomplete PDF snapshots roll back the complete merge', (t) => {
  const { a, b } = pair(t);
  a.importPdf(pdf(), { title: 'Paper' });
  const corrupted = a.exportSnapshot();
  corrupted.assets[Object.keys(corrupted.assets)[0]] = Buffer.from('bad').toString('base64');
  assert.throws(() => b.mergeSnapshot(corrupted,{authenticated:true,username:'Researcher'}), /校验失败/);
  const incomplete = a.exportSnapshot();
  incomplete.assets = {};
  assert.throws(() => b.mergeSnapshot(incomplete,{authenticated:true,username:'Researcher'}), /缺少引用/);
  assert.equal(b.listPapers().length, 0);
});

test('authenticated manual sync preserves a peer edit during merge',async t=>{
 const {a,b}=pair(t),profile={id:'peer',type:'ssh',host:'test',remoteAppDir:'D:/Test',remoteDataDir:'D:/Data'};const paper=a.upsertPaper({kind:'note',title:'Race'});a.saveNote(paper.id,'original');let raced=false;
 const request=async message=>{if(message.action==='merge'&&!raced){const stats=b.mergeSnapshot(message.snapshot,{authenticated:true,username:'Researcher'});raced=true;b.saveNote(paper.id,'remote edit during sync');return {ok:true,stats,snapshot:b.exportSnapshot()};}return handlePeerRequest(b,message);};
 await assert.rejects(syncVault(a,profile,{request}),e=>e.code==='PAIRING_REQUIRED');await pairProfile(a,profile,{username:'Researcher',password:'1',request});const result=await syncVault(a,profile,{request});assert.equal(result.pendingChanges,false);assert.equal(a.readNote(paper.id),'remote edit during sync');assert.equal(snapshotDigest(a.exportSnapshot()),snapshotDigest(b.exportSnapshot()));assert.equal(profileAuthStatus(a,profile).paired,true);
 revokePairedDevice(b,listPairedDevices(b)[0].id);await assert.rejects(syncVault(a,profile,{request}),e=>e.code==='PAIRING_REQUIRED');
});

test('saving a note does not silently resolve concurrent metadata versions', (t) => {
  const { a, b } = pair(t);
  const paper = a.upsertPaper({ kind: 'note', title: 'Initial' });
  transfer(a, b);
  a.upsertPaper({ id: paper.id, title: 'Title A' });
  b.upsertPaper({ id: paper.id, title: 'Title B' });
  transfer(b, a);
  a.saveNote(paper.id, 'A new note');
  const titles = a.exportSnapshot().papers[0].versions.map((version) => version.data.title).sort();
  assert.deepEqual(titles, ['Title A', 'Title B']);
});

test('unconfigured peers require explicit account setup and no bootstrap',t=>{const {a,directory}=pair(t);const empty=new Vault(path.join(directory,'empty'));try{a.importPdf(pdf('first'),{title:'Same title'});assert.throws(()=>empty.mergeSnapshot(a.exportSnapshot(),{authenticated:true,username:'Researcher'}),/验证/);assert.equal(empty.getAccount(),null);setAccount(empty);transfer(a,empty);assert.equal(empty.listPapers().length,1);}finally{empty.close();}});

test('stale GUI save preserves unseen Hermes edits and can resolve explicitly',t=>{
 const {a}=pair(t);const {paper}=a.importPdf(pdf('stale-gui'),{title:'Concurrency'});
 a.saveNote(paper.id,'baseline');const base=a.readNote(paper.id);
 a.saveNote(paper.id,'Hermes new idea');
 const merged=a.saveNote(paper.id,'GUI unsaved idea',base);
 assert.match(merged,/Hermes new idea/);assert.match(merged,/GUI unsaved idea/);assert.match(merged,/同步冲突/);
 const resolved=a.saveNote(paper.id,'整理：Hermes new idea + GUI unsaved idea',merged);
 assert.doesNotMatch(resolved,/同步冲突/);
});
import fs from 'node:fs';

test('SSH pairing verifies both passwords, rejects legacy protocol and invalidates after password change',async t=>{
 const {a,b}=pair(t),profile={id:'p',host:'test',remoteAppDir:'D:/Test',remoteDataDir:'D:/Data'},request=async m=>handlePeerRequest(b,m);
 assert.throws(()=>handlePeerRequest(b,{action:'export'}),e=>e.code==='PEER_UPDATE_REQUIRED');
 await assert.rejects(pairProfile(a,profile,{username:'Researcher',password:'wrong',request}),e=>e.code==='AUTH_FAILED');
 setAccount(b,'Researcher','2');await assert.rejects(pairProfile(a,profile,{username:'Researcher',password:'1',request}),e=>e.code==='AUTH_FAILED');
 setAccount(b);await pairProfile(a,profile,{username:'Researcher',password:'1',remember:false,request});assert.equal(profileAuthStatus(a,profile).remembered,false);assert.deepEqual(a.getSetting('syncCredentials'),{});assert.ok(profileAuthStatus(a,profile).paired);
 revokeAllPairings(a);assert.equal(profileAuthStatus(a,profile).paired,false);await assert.rejects(syncVault(a,profile,{request}),e=>e.code==='PAIRING_REQUIRED');
});

test('encrypted per-device folder bundles synchronize three devices without plaintext or destructive overwrites',async t=>{
 let c;t.after(()=>c?.close());const {a,b,directory}=pair(t);c=new Vault(path.join(directory,'c'));setAccount(c);
 const profile={id:'folder',name:'Test folder',type:'folder',folderPath:path.join(directory,'exchange')};
 a.setSetting('syncProfiles',[profile,{id:'another',name:'Another',type:'folder',folderPath:path.join(directory,'other')}]);
 for(const v of [a,b,c])await pairProfile(v,profile,{username:'Researcher',password:'1'});
 const paper=a.importPdf(pdf('SECRET-PDF-CONTENT'),{title:'SECRET-PAPER-TITLE'}).paper;a.saveNote(paper.id,'SECRET-NOTE-A');await syncVault(a,profile);
 const names=fs.readdirSync(profile.folderPath);const encrypted=fs.readFileSync(path.join(profile.folderPath,names[0]),'utf8');assert.ok(!encrypted.includes('SECRET'));assert.ok(!encrypted.includes('passwordHash'));assert.equal(profileAuthStatus(a,profile).pendingChanges,false);assert.equal(a.getDirty(),true);
 await syncVault(b,profile);b.saveNote(paper.id,'note from B');await syncVault(b,profile);await syncVault(c,profile);c.saveNote(paper.id,'note from C');await syncVault(c,profile);await syncVault(a,profile);await syncVault(b,profile);await syncVault(c,profile);assert.equal(a.readNote(paper.id),b.readNote(paper.id));assert.equal(b.readNote(paper.id),c.readNote(paper.id));assert.equal(fs.readdirSync(profile.folderPath).filter(n=>n.endsWith('.pdsync')).length,3);
 const before=snapshotDigest(a.exportSnapshot());const target=path.join(profile.folderPath,fs.readdirSync(profile.folderPath)[0]);fs.writeFileSync(target,'corrupt');await assert.rejects(syncVault(a,profile),e=>e.code==='AUTH_FAILED');assert.equal(snapshotDigest(a.exportSnapshot()),before);
 revokeProfile(a,profile);assert.equal(profileAuthStatus(a,profile).paired,false);
});
test('password change and revocation during in-flight pairing cannot recreate remembered access',async t=>{
 const {a,b}=pair(t),profile={id:'race-auth',host:'test',remoteAppDir:'D:/Test',remoteDataDir:'D:/Data'};
 const request=async message=>{const result=handlePeerRequest(b,message);if(message.action==='pair'){setAccount(a,'Researcher','2');revokeAllPairings(a);}return result;};
 await assert.rejects(pairProfile(a,profile,{username:'Researcher',password:'1',request}),e=>e.code==='PAIRING_REQUIRED');assert.equal(profileAuthStatus(a,profile).paired,false);
});
test('revocation during an in-flight read stops the sync before local merge',async t=>{
 const {a,b}=pair(t),profile={id:'race-sync',host:'test',remoteAppDir:'D:/Test',remoteDataDir:'D:/Data'};const request=async message=>handlePeerRequest(b,message);await pairProfile(a,profile,{username:'Researcher',password:'1',request});b.upsertPaper({kind:'note',title:'Must not arrive after revocation'});
 await assert.rejects(syncVault(a,profile,{request:async message=>{const result=handlePeerRequest(b,message);if(message.action==='export')revokeProfile(a,profile);return result;}}),e=>e.code==='PAIRING_REQUIRED');assert.equal(a.listPapers().length,0);
});
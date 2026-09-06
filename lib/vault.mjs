import { DatabaseSync } from 'node:sqlite';
import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, renameSync, existsSync, unlinkSync } from 'node:fs';
import path from 'node:path';

const hash = (value) => createHash('sha256').update(value).digest('hex');
const parse = (value, fallback = null) => value == null ? fallback : JSON.parse(value);
const iso = () => new Date().toISOString();
const validId = (id) => typeof id === 'string' && /^[A-Za-z0-9_-]{1,100}$/.test(id);
const doiKey = (doi) => String(doi || '').trim().replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, '').replace(/^doi\s*:\s*/i, '').toLowerCase();
const titleKey = (title) => String(title || '').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
const safeStem = (value) => {
  let result = String(value || 'Untitled').normalize('NFC').replace(/\.pdf$/i, '').replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/[. ]+$/g, '').trim().slice(0, 110);
  if (!result || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(result)) result = `Paper_${result}`;
  return result;
};
const stable = (value) => {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
};
const heads = (versions) => {
  const unique = new Map();
  for (const version of versions) {
    const previous = unique.get(version.rev);
    if (previous && stable(previous) !== stable(version)) throw new Error('同步快照包含内容不一致的修订编号。');
    unique.set(version.rev, version);
  }
  const superseded = new Set([...unique.values()].flatMap((version) => version.ancestors));
  return [...unique.values()].filter((version) => !superseded.has(version.rev)).sort((a, b) => a.rev.localeCompare(b.rev));
};
const winner = (versions) => {
  const live = versions.filter((version) => !version.data.deleted);
  return [...(live.length ? live : versions)].sort((a, b) => a.modifiedAt.localeCompare(b.modifiedAt) || a.rev.localeCompare(b.rev)).at(-1);
};
const same = (a, b) => stable(a) === stable(b);

export class Vault {
  constructor(dataDir) {
    this.dataDir = path.resolve(dataDir);
    for (const folder of ['', 'papers', 'notes', 'objects']) mkdirSync(path.join(this.dataDir, folder), { recursive: true });
    this.db = new DatabaseSync(path.join(this.dataDir, 'vault.sqlite'));
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=10000;
      CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS papers (id TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS notes (id TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS aliases (id TEXT PRIMARY KEY, target TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS assets (sha TEXT PRIMARY KEY, bytes BLOB NOT NULL);
      CREATE TABLE IF NOT EXISTS note_files (id TEXT PRIMARY KEY, hash TEXT NOT NULL, versions TEXT NOT NULL DEFAULT '[]');
      CREATE TABLE IF NOT EXISTS pdf_files (id TEXT PRIMARY KEY, filename TEXT NOT NULL, sha TEXT NOT NULL);`);
    if (!this.db.prepare('PRAGMA table_info(note_files)').all().some((column) => column.name === 'versions')) this.db.exec("ALTER TABLE note_files ADD COLUMN versions TEXT NOT NULL DEFAULT '[]'" );
    this._transaction(() => {
      if (!this._meta('deviceId')) this._setMeta('deviceId', randomUUID());
      if (this._meta('changeSeq') === null) this._setMeta('changeSeq', 0);
      if (this._meta('syncedSeq') === null) this._setMeta('syncedSeq', 0);
    });
    this.deviceId = this._meta('deviceId');
  }
  _transaction(fn) {
    this.db.exec('BEGIN IMMEDIATE');
    try { const result = fn(); this.db.exec('COMMIT'); return result; }
    catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  _meta(key) { return parse(this.db.prepare('SELECT value FROM meta WHERE key=?').get(key)?.value); }
  _setMeta(key, value) { this.db.prepare('INSERT INTO meta(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key, JSON.stringify(value)); }
  _changed() { this._setMeta('changeSeq', this._meta('changeSeq') + 1); }
  _doc(table, id) { return parse(this.db.prepare(`SELECT value FROM ${table} WHERE id=?`).get(id)?.value, []); }
  _put(table, id, versions) { this.db.prepare(`INSERT INTO ${table}(id,value) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value`).run(id, JSON.stringify(heads(versions))); }
  _resolve(id) {
    if (!validId(id)) throw new Error('无效的文献编号。');
    const visited = new Set();
    let current = id;
    while (!visited.has(current)) {
      visited.add(current);
      const row = this.db.prepare('SELECT target FROM aliases WHERE id=?').get(current);
      if (!row) return current;
      current = row.target;
    }
    throw new Error('文献别名循环。');
  }
  _revision(data, previous) {
    return { rev: randomUUID(), deviceId: this.deviceId, modifiedAt: iso(), ancestors: [...new Set(previous.flatMap((version) => [version.rev, ...version.ancestors]))].sort(), data };
  }
  getAccount() { return this._meta('account'); }
  setAccount(account) {
    if (!account || typeof account.username !== 'string' || !account.username.trim() || typeof account.salt !== 'string' || typeof account.passwordHash !== 'string') throw new Error('账号信息不完整。');
    this._transaction(() => {
      this._setMeta('account', { username: account.username.trim(), salt: account.salt, passwordHash: account.passwordHash });
      this._changed();
    });
    return this.getAccount();
  }
  getSetting(key, defaultValue = null) { return parse(this.db.prepare('SELECT value FROM settings WHERE key=?').get(key)?.value, defaultValue); }
  setSetting(key, value) {
    this.db.prepare('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key, JSON.stringify(value));
    return value;
  }
  _paper(id) {
    const versions = this._doc('papers', id);
    const active = winner(versions);
    if (!active || active.data.deleted) return null;
    const paper = { ...active.data, id };
    if (paper.sha256 && active.data.id !== id) {
      const originalId = String(active.data.id || '');
      const originalSuffix = '--' + originalId.slice(-12) + '.pdf';
      const stem = String(paper.fileName || paper.title);
      paper.fileName = safeStem(stem.endsWith(originalSuffix) ? stem.slice(0, -originalSuffix.length) : stem) + '--' + id.slice(-12) + '.pdf';
    }
    if (versions.length > 1) paper.conflicts = versions.filter((version) => version.rev !== active.rev).map((version) => ({ revision: version.rev, modifiedAt: version.modifiedAt, ...version.data }));
    return paper;
  }
  listPapers() {
    this._captureExternalNotes();
    return this.db.prepare('SELECT id FROM papers').all().filter((row) => this._resolve(row.id) === row.id).map((row) => this._paper(row.id)).filter(Boolean).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }
  getPaper(id) { return this._paper(this._resolve(id)); }
  _normalizePaper(patch, existing, id) {
    const now = iso();
    const result = { title: '未命名文献', authors: [], year: null, doi: '', tags: [], status: 'unread', kind: 'paper', createdAt: now, pages: 0, abstract: '', ...existing, ...patch, id, updatedAt: now };
    delete result.conflicts;
    delete result.deleted;
    result.title = String(result.title || '未命名文献').trim();
    result.tags = Array.isArray(result.tags) ? [...new Set(result.tags.map(String))] : [];
    if (!['unread', 'reading', 'done'].includes(result.status)) result.status = 'unread';
    if (result.sha256 && !/^[a-f0-9]{64}$/.test(result.sha256)) throw new Error('无效的 PDF 校验值。');
    if (result.sha256) {
      let label = result.title;
      if (patch.fileName && patch.fileName !== existing?.fileName) label = patch.fileName;
      else if (!patch.title && existing?.fileName) label = existing.fileName;
      label = String(label).replace(new RegExp(`--${id.slice(-12)}(?:\\.pdf)?$`, 'i'), '');
      result.fileName = `${safeStem(label)}--${id.slice(-12)}.pdf`;
    } else delete result.fileName;
    return result;
  }
  upsertPaper(patch) {
    const id = patch.id ? this._resolve(patch.id) : randomUUID();
    this._transaction(() => {
      const previous = this._doc('papers', id);
      const paper = this._normalizePaper(patch, this._paper(id), id);
      this._put('papers', id, [this._revision(paper, previous)]);
      this._changed();
      this._reconcileDuplicates();
    });
    const paper = this.getPaper(id);
    if (paper?.sha256) this.pdfPath(paper.id);
    return paper;
  }
  importPdf(bytes, metadata = {}) {
    const content = Buffer.from(bytes);
    if (!content.subarray(0, 1024).includes(Buffer.from('%PDF-'))) throw new Error('文件不是有效的 PDF。');
    const sha256 = hash(content);
    const doi = doiKey(metadata.doi);
    const papers = this.listPapers();
    const duplicate = papers.find((paper) => paper.sha256 === sha256 || (doi && doiKey(paper.doi) === doi));
    if (duplicate) return { paper: duplicate, duplicate: true, reason: duplicate.sha256 === sha256 ? 'sha256' : 'doi', candidateMatches: [] };
    const candidateMatches = papers.filter((paper) => titleKey(paper.title) && titleKey(paper.title) === titleKey(metadata.title)).map((paper) => ({ id: paper.id, title: paper.title }));
    const id = `paper-${sha256.slice(0, 40)}`;
    this._transaction(() => {
      this.db.prepare('INSERT OR IGNORE INTO assets(sha,bytes) VALUES(?,?)').run(sha256, content);
      const previous = this._doc('papers', id);
      const paper = this._normalizePaper({ ...metadata, id, sha256, kind: 'paper' }, this._paper(id), id);
      this._put('papers', id, [this._revision(paper, previous)]);
      this._changed();
    });
    this.pdfPath(id);
    return { paper: this.getPaper(id), duplicate: false, reason: candidateMatches.length ? 'similar-title' : null, candidateMatches };
  }
  deletePaper(paperId) {
    const id = this._resolve(paperId);
    this._captureExternalNotes();
    this._transaction(() => {
      const previous = this._doc('papers', id);
      if (!previous.length) return;
      this._put('papers', id, [this._revision({ ...winner(previous).data, id, deleted: true, updatedAt: iso() }, previous)]);
      this._changed();
    });
    return true;
  }
  _noteText(id) {
    const versions = this._doc('notes', id);
    if (!versions.length) return '';
    const primary = winner(versions);
    let text = primary.data.markdown || '';
    const alternatives = versions.filter((version) => version.rev !== primary.rev && version.data.markdown !== primary.data.markdown);
    for (const alternative of alternatives) text += `\n\n---\n\n> 同步冲突：保留来自另一设备的笔记版本（${alternative.modifiedAt}）。整理后保存即可解决。\n\n${alternative.data.markdown || ''}`;
    return text;
  }
  notePath(paperId) { return path.join(this.dataDir, 'notes', `${this._resolve(paperId)}.md`); }
  _writeAtomic(filename, bytes) {
    const temp = `${filename}.${randomUUID()}.tmp`;
    writeFileSync(temp, bytes);
    try { renameSync(temp, filename); } catch (error) { try { unlinkSync(temp); } catch {} throw error; }
  }
  _captureExternalNote(id) {
    const filename = path.join(this.dataDir, 'notes', `${id}.md`);
    if (!existsSync(filename)) return;
    const text = readFileSync(filename, 'utf8');
    const fileHash = hash(text);
    const recorded = this.db.prepare('SELECT hash,versions FROM note_files WHERE id=?').get(id);
    if (recorded?.hash === fileHash) return;
    const canonical = this._resolve(id);
    const current = this._doc('notes', canonical);
    let visibleVersions = current;
    if (text !== this._noteText(canonical)) {
      // An external editor only observed the revisions in its materialized file.
      // Preserve any newer database revision it has not yet seen as a conflict.
      const parents = parse(recorded?.versions, []);
      const edit = this._revision({ markdown: text }, parents);
      this._put('notes', canonical, [...current, edit]);
      visibleVersions = [edit];
      this._changed();
    }
    this.db.prepare('INSERT INTO note_files(id,hash,versions) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET hash=excluded.hash,versions=excluded.versions').run(id, fileHash, JSON.stringify(visibleVersions));
  }
  _captureExternalNotes() {
    const ids = new Set([...this.db.prepare('SELECT id FROM papers').all(), ...this.db.prepare('SELECT id FROM notes').all()].map((row) => row.id));
    this._transaction(() => { for (const id of ids) this._captureExternalNote(id); });
  }
  _materializeNote(id) {
    this._captureExternalNote(id);
    const text = this._noteText(id);
    const filename = this.notePath(id);
    if (!existsSync(filename) || readFileSync(filename, 'utf8') !== text) this._writeAtomic(filename, text);
    this.db.prepare('INSERT INTO note_files(id,hash,versions) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET hash=excluded.hash,versions=excluded.versions').run(id, hash(text), JSON.stringify(this._doc('notes', id)));
    return text;
  }
  readNote(paperId) {
    this._captureExternalNotes();
    const id = this._resolve(paperId);
    return this._transaction(() => this._materializeNote(id));
  }
  saveNote(paperId, markdown, baseMarkdown) {
    this._captureExternalNotes();
    const id = this._resolve(paperId);
    if (!this._paper(id)) throw new Error('文献不存在。');
    this._transaction(() => {
      const previous = this._doc('notes', id);
      if (previous.length === 1 && previous[0].data.markdown === String(markdown)) return;
      const stale = baseMarkdown !== undefined && this._noteText(id) !== String(baseMarkdown);
      this._put('notes', id, stale ? [...previous, this._revision({ markdown: String(markdown) }, [])] : [this._revision({ markdown: String(markdown) }, previous)]);
      const paperVersions = this._doc('papers', id);
      const visible = winner(paperVersions);
      const paper = { ...visible.data, updatedAt: iso() };
      // Saving Markdown does not implicitly resolve concurrent title/metadata edits.
      this._put('papers', id, [...paperVersions.filter((version) => version.rev !== visible.rev), this._revision(paper, [visible])]);
      this._changed();
      this._materializeNote(id);
    });
    return this.readNote(id);
  }
  pdfPath(paperId) {
    const id = this._resolve(paperId);
    const paper = this._paper(id);
    if (!paper?.sha256) return null;
    const record = this.db.prepare('SELECT bytes FROM assets WHERE sha=?').get(paper.sha256);
    if (!record) throw new Error('PDF 数据缺失，请重新同步。');
    const objectPath = path.join(this.dataDir, 'objects', `${paper.sha256}.pdf`);
    if (!existsSync(objectPath) || hash(readFileSync(objectPath)) !== paper.sha256) this._writeAtomic(objectPath, record.bytes);
    const filename = `${safeStem(String(paper.fileName || paper.title).replace(new RegExp(`--${id.slice(-12)}(?:\\.pdf)?$`, 'i'), ''))}--${id.slice(-12)}.pdf`;
    const target = path.join(this.dataDir, 'papers', filename);
    this._transaction(() => {
      const previous = this.db.prepare('SELECT filename,sha FROM pdf_files WHERE id=?').get(id);
      if (!existsSync(target)) this._writeAtomic(target, record.bytes);
      else if (hash(readFileSync(target)) !== paper.sha256) {
        renameSync(target, `${target}.external-${randomUUID()}.pdf`);
        this._writeAtomic(target, record.bytes);
      }
      if (previous && previous.filename !== filename) {
        const old = path.join(this.dataDir, 'papers', path.basename(previous.filename));
        if (existsSync(old) && hash(readFileSync(old)) === previous.sha) unlinkSync(old);
      }
      this.db.prepare('INSERT INTO pdf_files(id,filename,sha) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET filename=excluded.filename,sha=excluded.sha').run(id, filename, paper.sha256);
    });
    return target;
  }
  getDirty() { this._captureExternalNotes(); return this._meta('changeSeq') > this._meta('syncedSeq'); }
  markSynced(checkpoint = this._meta('changeSeq')) {
    this._transaction(() => this._setMeta('syncedSeq', Math.max(this._meta('syncedSeq'), Math.min(Number(checkpoint), this._meta('changeSeq')))));
  }
  _reconcileDuplicates() {
    const seenSha = new Map(), seenDoi = new Map();
    for (const { id: rawId } of this.db.prepare('SELECT id FROM papers ORDER BY id').all()) {
      const id = this._resolve(rawId);
      if (id !== rawId) continue;
      const paper = this._paper(id);
      if (!paper || (!paper.sha256 && !doiKey(paper.doi))) continue;
      const match = seenSha.get(paper.sha256) || (doiKey(paper.doi) && seenDoi.get(doiKey(paper.doi)));
      if (match && this._resolve(match) !== id) {
        const target = [this._resolve(match), id].sort()[0];
        const source = target === id ? this._resolve(match) : id;
        this._put('papers', target, [...this._doc('papers', target), ...this._doc('papers', source)]);
        this._put('notes', target, [...this._doc('notes', target), ...this._doc('notes', source)]);
        this.db.prepare('INSERT INTO aliases(id,target) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET target=excluded.target').run(source, target);
        this.db.prepare('DELETE FROM papers WHERE id=?').run(source);
        this.db.prepare('DELETE FROM notes WHERE id=?').run(source);
      }
      const resolved = this._resolve(id);
      if (paper.sha256) seenSha.set(paper.sha256, resolved);
      if (doiKey(paper.doi)) seenDoi.set(doiKey(paper.doi), resolved);
    }
  }
  exportSnapshot() {
    this._captureExternalNotes();
    return this._transaction(() => ({
      schemaVersion: 1, sourceDeviceId: this.deviceId, checkpoint: this._meta('changeSeq'), account: this.getAccount() ? { username: this.getAccount().username } : null,
      papers: this.db.prepare('SELECT id,value FROM papers ORDER BY id').all().map((row) => ({ id: row.id, versions: parse(row.value) })),
      notes: this.db.prepare('SELECT id,value FROM notes ORDER BY id').all().map((row) => ({ id: row.id, versions: parse(row.value) })),
      aliases: this.db.prepare('SELECT id,target FROM aliases ORDER BY id').all(),
      assets: Object.fromEntries(this.db.prepare('SELECT sha,bytes FROM assets ORDER BY sha').all().map((row) => [row.sha, Buffer.from(row.bytes).toString('base64')]))
    }));
  }
  mergeSnapshot(snapshot, identity) {
    if (!identity?.authenticated || !this.getAccount() || identity.username !== this.getAccount().username || snapshot?.account?.username !== identity.username) throw Object.assign(new Error('必须先验证同一账号的用户名和密码才能同步。'), {code:'PAIRING_REQUIRED'});
    if (!snapshot || snapshot.schemaVersion !== 1 || !Array.isArray(snapshot.papers) || !Array.isArray(snapshot.notes) || !snapshot.assets || !Array.isArray(snapshot.aliases || [])) throw new Error('不支持的同步快照格式。');
    const account = this.getAccount();
    if (account && snapshot.account && account.username !== snapshot.account.username) throw new Error('远程文献库属于其他用户名，已拒绝同步。');
    const assets = [];
    for (const [sha, encoded] of Object.entries(snapshot.assets)) {
      if (!/^[a-f0-9]{64}$/.test(sha) || typeof encoded !== 'string') throw new Error('同步 PDF 校验信息无效。');
      const bytes = Buffer.from(encoded, 'base64');
      if (hash(bytes) !== sha) throw new Error('同步 PDF 内容校验失败。');
      assets.push([sha, bytes]);
    }
    for (const type of ['papers', 'notes']) for (const doc of snapshot[type]) {
      if (!validId(doc.id) || !Array.isArray(doc.versions)) throw new Error('同步文档编号无效。');
      for (const version of doc.versions) {
        if (!validId(version.rev) || typeof version.modifiedAt !== 'string' || !Array.isArray(version.ancestors) || !version.ancestors.every(validId) || !version.data || typeof version.data !== 'object') throw new Error('同步修订格式无效。');
        if (type === 'notes' && typeof version.data.markdown !== 'string') throw new Error('同步笔记格式无效。');
        if (type === 'papers' && version.data.sha256 && !/^[a-f0-9]{64}$/.test(version.data.sha256)) throw new Error('同步文献的 PDF 校验值无效。');
      }
    }
    for (const alias of snapshot.aliases || []) if (!validId(alias.id) || !validId(alias.target) || alias.target >= alias.id) throw new Error('同步别名无效。');
    this._captureExternalNotes();
    const stats = { papersChanged: 0, notesChanged: 0, assetsAdded: 0, conflicts: 0 };
    this._transaction(() => {
      const currentAccount = this.getAccount();
      if (currentAccount && snapshot.account && currentAccount.username !== snapshot.account.username) throw new Error('远程文献库属于其他用户名，已拒绝同步。');
      for (const [sha, bytes] of assets) stats.assetsAdded += Number(this.db.prepare('INSERT OR IGNORE INTO assets(sha,bytes) VALUES(?,?)').run(sha, bytes).changes);
      for (const alias of snapshot.aliases || []) {
        const oldTarget = this.db.prepare('SELECT target FROM aliases WHERE id=?').get(alias.id)?.target;
        const target = oldTarget ? [oldTarget, alias.target].sort()[0] : alias.target;
        this.db.prepare('INSERT INTO aliases(id,target) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET target=excluded.target').run(alias.id, target);
      }
      // Route both existing and incoming branches through aliases before reducing revisions.
      for (const type of ['papers', 'notes']) {
        const all = [...this.db.prepare(`SELECT id,value FROM ${type}`).all().map((row) => ({ id: row.id, versions: parse(row.value) })), ...snapshot[type]];
        const grouped = new Map();
        for (const doc of all) {
          const id = this._resolve(doc.id);
          grouped.set(id, [...(grouped.get(id) || []), ...doc.versions]);
        }
        for (const [id, versions] of grouped) {
          const merged = heads(versions);
          if (!same(this._doc(type, id), merged)) { this._put(type, id, merged); stats[type === 'papers' ? 'papersChanged' : 'notesChanged']++; }
        }
        for (const doc of all) if (this._resolve(doc.id) !== doc.id) this.db.prepare(`DELETE FROM ${type} WHERE id=?`).run(doc.id);
      }
      this._reconcileDuplicates();
      for (const row of this.db.prepare('SELECT value FROM papers').all()) for (const version of parse(row.value)) {
        if (version.data.sha256 && !this.db.prepare('SELECT 1 FROM assets WHERE sha=?').get(version.data.sha256)) throw new Error('快照缺少引用的 PDF，已取消本次合并。');
      }
      if (stats.papersChanged || stats.notesChanged || stats.assetsAdded || (!account && snapshot.account)) this._changed();
      for (const type of ['papers', 'notes']) for (const row of this.db.prepare(`SELECT value FROM ${type}`).all()) if (parse(row.value).length > 1) stats.conflicts++;
    });
    // Capture external edits once more before refreshing the human-readable Markdown files.
    this._captureExternalNotes();
    this._transaction(() => {
      for (const row of this.db.prepare('SELECT id FROM notes').all()) this._materializeNote(row.id);
    });
    for (const row of this.db.prepare('SELECT id FROM papers').all()) if (this._paper(row.id)?.sha256) this.pdfPath(row.id);
    return stats;
  }
  close() { this.db.close(); }
}

export function snapshotDigest(snapshot) {
  return hash(stable({ schemaVersion: snapshot.schemaVersion, account: snapshot.account?.username || null, papers: snapshot.papers, notes: snapshot.notes, aliases: snapshot.aliases || [], assets: Object.keys(snapshot.assets).sort() }));
}



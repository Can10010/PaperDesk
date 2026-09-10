import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { BookOpen, Library, Network, FilePenLine, RefreshCw, Settings, CircleHelp, Search, Plus, Upload, ChevronDown, ChevronRight, ArrowUpRight, ArrowLeft, Check, X, LoaderCircle, LockKeyhole, LogOut, FileText, MoreHorizontal, Pencil, Trash2, Tags, BookMarked, Save, Eye, Code2, Columns2, Copy, CheckCheck, SlidersHorizontal, Sparkles, Link2, Terminal, HardDrive, Laptop, ShieldCheck, ArrowRight, AlertCircle, CheckCircle2, Bold, Heading2, List, Quote, Braces, ExternalLink, PanelLeftClose, PanelLeftOpen, Send, FolderOpen, Wifi, Clock3, Maximize2, Minimize2, Focus, PanelRightClose, PanelRightOpen } from 'lucide-react';
import {renderMarkdown, markdownHelp} from './markdown.mjs';
import 'katex/dist/katex.min.css';
import ResizableDivider, {useSplitRatio} from './ResizableDivider.jsx';
import DOMPurify from 'dompurify';
import SettingsPage from './SettingsPage.jsx';

const STATUS = { unread: '待读', reading: '阅读中', done: '已读' };
const NAV = [
  { id: 'library', label: '文献库', icon: Library },
  { id: 'knowledge', label: '知识库', icon: Network },
  { id: 'notes', label: '笔记', icon: FilePenLine },
  { id: 'sync', label: '同步', icon: RefreshCw },
];
const isNote = p => p?.kind === 'note' || p?.type === 'note' || p?.isNote;
const authorsText = p => Array.isArray(p?.authors) ? p.authors.join(', ') : (p?.authors || '作者未识别');
const dateText = value => value ? new Date(value).toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' }) : '';
const timeText = value => value ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '尚未同步';
const errorText = error => typeof error === 'string' ? error : error?.message || error?.error || JSON.stringify(error);

async function api(path, options = {}) {
  const isForm = options.body instanceof FormData;
  let response;
  try {
    response = await fetch(path, { credentials: 'same-origin', ...options, headers: { ...(isForm ? {} : { 'Content-Type': 'application/json' }), ...options.headers }, body: options.body && !isForm ? JSON.stringify(options.body) : options.body });
  } catch { throw new Error('无法连接本地服务。请确认 PaperDesk 已启动，再重试。'); }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) { const error = new Error(data.error?.message || data.error || data.message || `请求失败 (${response.status})`); error.code = data.code; error.status = response.status; error.data = data; throw error; }
  return data;
}

function IconButton({ icon: Icon, label, className = '', ...props }) {
  return <button type="button" className={`icon-button ${className}`} title={label} aria-label={label} {...props}><Icon size={17} strokeWidth={1.7} /></button>;
}
function Button({ children, icon: Icon, busy, variant = 'secondary', className = '', ...props }) {
  return <button type="button" className={`button ${variant} ${className}`} {...props} disabled={props.disabled || busy}>{busy ? <LoaderCircle size={15} className="spin" /> : Icon ? <Icon size={15} strokeWidth={1.8} /> : null}{children}</button>;
}
function EmptyState({ icon: Icon = BookOpen, title, children, action, compact = false }) {
  return <div className={`empty-state ${compact ? 'compact' : ''}`}><div className="empty-icon"><Icon size={28} strokeWidth={1.2} /></div><h3>{title}</h3><p>{children}</p>{action}</div>;
}
function Modal({ title, subtitle, children, onClose, className = '' }) {
  const innerRef = useRef(null);
  useEffect(() => {
    const handler = e => { if (e.key === 'Escape') onClose?.(); };
    const previous = document.activeElement;
    innerRef.current?.querySelector('input,button,textarea')?.focus();
    document.addEventListener('keydown', handler);
    return () => { document.removeEventListener('keydown', handler); previous?.focus?.(); };
  }, []);
  function trapTab(e) {
    if (e.key !== 'Tab') return;
    const nodes = [...innerRef.current.querySelectorAll('button:not(:disabled),input:not(:disabled),textarea:not(:disabled),select:not(:disabled),a[href]')];
    const first = nodes[0], last = nodes[nodes.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
  }
  return <div className="modal-backdrop" onMouseDown={e => e.target === e.currentTarget && onClose?.()}><section ref={innerRef} onKeyDown={trapTab} className={`modal ${className}`} role="dialog" aria-modal="true" aria-label={title}><div className="modal-header"><div><h2>{title}</h2>{subtitle && <p>{subtitle}</p>}</div>{onClose && <IconButton icon={X} label="关闭" onClick={onClose} />}</div>{children}</section></div>;
}
function Markdown({ text, onPaperLink }) {
  const html = useMemo(() => DOMPurify.sanitize(renderMarkdown(text), { ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto|paperdesk):|[^a-z]|[a-z+.-]+(?:[^a-z+.-:]|$))/i }), [text]);
  return <div className="markdown" onClick={e => { const a = e.target.closest('a'); if (!a) return; const match = a.getAttribute('href')?.match(/^paperdesk:\/\/paper\/(.+)$/); if (match && onPaperLink) { e.preventDefault(); onPaperLink(decodeURIComponent(match[1])); } else if (a.href && /^https?:/.test(a.href)) { a.target = '_blank'; a.rel = 'noopener noreferrer'; } }} dangerouslySetInnerHTML={{ __html: html }} />;
}
function CopyButton({ value, label = '复制' }) {
  const [copied, setCopied] = useState(false);
  return <Button icon={copied ? Check : Copy} onClick={async () => { try { await navigator.clipboard.writeText(value); setCopied(true); setTimeout(() => setCopied(false), 1800); } catch { setCopied(false); } }}>{copied ? '已复制' : label}</Button>;
}

function Auth({ configured, onDone }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function submit(e) {
    e.preventDefault(); setError(''); setBusy(true);
    try { await api(configured ? '/api/auth/login' : '/api/auth/setup', { method: 'POST', body: { username: username.trim(), password, remember } }); onDone(); }
    catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }
  return <div className="auth-screen"><div className="auth-scene" aria-hidden="true"><div className="orbit orbit-one" /><div className="orbit orbit-two" /><div className="auth-paper paper-back" /><div className="auth-paper paper-front"><BookOpen size={38} strokeWidth={1} /><i /><i /><i /></div></div><div className="auth-card"><div className="brand auth-brand"><span className="brand-symbol"><BookOpen size={23} /></span>PaperDesk<span className="brand-dot">.</span></div><span className="eyebrow">为研究留一方安静的空间</span><h1>{configured ? '欢迎回来。' : '从一篇文献开始。'}</h1><p className="auth-description">文献、笔记与灵感，在这里慢慢连接。<br />本地保存，由你掌控。</p><form onSubmit={submit}><label className="field">{configured ? '用户名' : '给自己取个名字'}<input autoFocus autoComplete="username" value={username} onChange={e => setUsername(e.target.value)} required maxLength={80} placeholder="你的名字" /></label><label className="field">密码<input type="password" autoComplete={configured ? 'current-password' : 'new-password'} value={password} onChange={e => setPassword(e.target.value)} required minLength={1} placeholder={configured ? '输入密码' : '你熟悉的密码就好'} /></label><label className="checkbox-label"><input type="checkbox" checked={remember} onChange={e => setRemember(e.target.checked)} />在这台设备上记住我</label>{error && <div className="inline-error" role="alert"><AlertCircle size={15} />{error}</div>}<button className="button primary auth-submit" type="submit" disabled={busy}>{busy ? <LoaderCircle size={17} className="spin" /> : null}{configured ? '进入工作空间' : '创建我的工作空间'}<ArrowRight size={17} /></button></form><div className="auth-foot"><LockKeyhole size={13} />不需要邮箱 · 允许简单密码 · 无需每次登录</div></div><span className="auth-version">PAPERDESK / LOCAL FIRST</span></div>;
}

export default function App() {
  const [auth, setAuth] = useState(null);
  const [authError, setAuthError] = useState('');
  const refreshAuth = useCallback(async () => { try { setAuth(await api('/api/auth/status')); setAuthError(''); } catch (e) { setAuthError(e.message); } }, []);
  useEffect(() => { refreshAuth(); }, [refreshAuth]);
  useEffect(() => { if (!auth?.authenticated) return window.paperdesk?.onQuitRequested?.(() => window.paperdesk.quit()); }, [auth?.authenticated]);
  if (authError) return <div className="boot-screen"><EmptyState icon={AlertCircle} title="本地服务暂时没有回应" action={<Button icon={RefreshCw} onClick={refreshAuth}>重新连接</Button>}>{authError}</EmptyState></div>;
  if (!auth) return <div className="boot-screen"><BookOpen size={34} /><LoaderCircle className="spin" size={19} /><span>正在打开工作空间…</span></div>;
  if (!auth.authenticated) return <Auth configured={auth.configured} onDone={refreshAuth} />;
  return <Workspace auth={auth} onAuthChange={refreshAuth} />;
}

function Workspace({ auth, onAuthChange }) {
  const [route, setRoute] = useState('library');
  const [papers, setPapers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [libraryError, setLibraryError] = useState('');
  const [selectedId, setSelectedId] = useState(null);
  const [detailTab, setDetailTab] = useState('pdf');
  const [pdfPage, setPdfPage] = useState(1);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all');
  const [sort, setSort] = useState('newest');
  const [noteText, setNoteText] = useState('');
  const [noteBaseline, setNoteBaseline] = useState('');
  const [noteLoading, setNoteLoading] = useState(false);
  const [noteError, setNoteError] = useState('');
  const [noteSaving, setNoteSaving] = useState(false);
  const [noteSaveError, setNoteSaveError] = useState('');
  const [noteComposing, setNoteComposing] = useState(false);
  const [markdownHelpOpen, setMarkdownHelpOpen] = useState(false);
  const [libraryRatio, setLibraryRatio] = useSplitRatio('paperdesk.libraryRatio', 35);
  const [readingRatio, setReadingRatio] = useSplitRatio('paperdesk.readingRatio', 52);
  const libraryRef = useRef(null), readingRef = useRef(null);
  const noteOwner = useRef(null);
  const [noteMode, setNoteMode] = useState('edit');
  const [toast, setToast] = useState(null);
  const [importing, setImporting] = useState(false);
  const [importReport, setImportReport] = useState(null);
  const [dragOver, setDragOver] = useState(false);
  const [editPaper, setEditPaper] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const [newNote, setNewNote] = useState(false);
  const [syncStatus, setSyncStatus] = useState({ dirty: false, lastSync: null });
  const [quitModal, setQuitModal] = useState(false);
  const [quittingSync, setQuittingSync] = useState(false);
  const [quitProfiles, setQuitProfiles] = useState([]);
  const [quitProfileId, setQuitProfileId] = useState('');
  const [sidebarClosed, setSidebarClosed] = useState(false);
  const [listClosed, setListClosed] = useState(false);
  const [focusMode, setFocusMode] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const fileInput = useRef(null);
  const searchInput = useRef(null);
  const noteInput = useRef(null);
  const selectedIdRef = useRef(selectedId);
  const currentNoteRef = useRef({ id: null, text: '', dirty: false, loading: false });
  const toastTimer = useRef(null);
  const selected = papers.find(p => p.id === selectedId);
  const noteDirty = noteText !== noteBaseline;
  selectedIdRef.current = selectedId;
  currentNoteRef.current = { id: noteOwner.current, text: noteText, base: noteBaseline, dirty: noteDirty, loading: noteLoading };
  const notify = useCallback((message, type = 'success') => { clearTimeout(toastTimer.current); setToast({ message, type }); toastTimer.current = setTimeout(() => setToast(null), type === 'error' ? 7000 : 4200); }, []);
  const refreshSync = useCallback(async () => { try { setSyncStatus(await api('/api/sync/status')); } catch {} }, []);
  const loadPapers = useCallback(async () => {
    try { const data = await api('/api/papers'); setPapers(data.papers || []); setLibraryError(''); return data.papers || []; }
    catch (e) { setLibraryError(e.message); return null; }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { loadPapers(); refreshSync(); }, [loadPapers, refreshSync]);
  useEffect(() => {
    if (!selectedId) { setNoteText(''); setNoteBaseline(''); setNoteError(''); return; }
    let cancelled = false;
    noteOwner.current = null; setNoteSaveError('');
    setNoteLoading(true); setNoteText(''); setNoteBaseline(''); setNoteError('');
    api(`/api/papers/${encodeURIComponent(selectedId)}/note`).then(data => { if (!cancelled) { noteOwner.current = selectedId; setNoteText(data.markdown || ''); setNoteBaseline(data.markdown || ''); } }).catch(e => { if (!cancelled) setNoteError(e.message); }).finally(() => { if (!cancelled) setNoteLoading(false); });
    return () => { cancelled = true; };
  }, [selectedId]);
  const pendingSave = useRef(null);
  const saveNote = useCallback(async (quiet = false) => {
    if (pendingSave.current) return pendingSave.current;
    const operation = (async () => {
      // Drain new edits made during a request before allowing navigation or quit.
      while (currentNoteRef.current.dirty) {
        const current = {...currentNoteRef.current};
        if (!current.id || current.id !== selectedIdRef.current || current.loading) return false;
        setNoteSaving(true); setNoteSaveError('');
        try {
          const saved = await api(`/api/papers/${encodeURIComponent(current.id)}/note`, {method:'PUT', body:{markdown:current.text, baseMarkdown:current.base}});
          if (selectedIdRef.current !== current.id) return false;
          const baseline = saved.markdown ?? current.text;
          let text = currentNoteRef.current.text;
          if (saved.conflict) {
            // A newer local draft must not implicitly resolve an unseen remote conflict.
            text = text === current.text ? baseline : baseline + '\n\n---\n\n> 保存期间继续编辑的本机内容（请整理后保存）：\n\n' + text;
          }
          currentNoteRef.current = {...currentNoteRef.current, base:baseline, text, dirty:text !== baseline};
          setNoteBaseline(baseline);
          if (saved.conflict) setNoteText(text);
          if (saved.conflict) notify('另一端也修改了笔记，两份内容均已保留，请整理后保存。', 'error');
          setPapers(prev => prev.map(p => p.id === current.id ? {...p, hasNote:!!baseline.trim(), updatedAt:new Date().toISOString()} : p));
          refreshSync();
        } catch (e) {
          setNoteSaveError(e.message); notify(`笔记未能保存：${e.message}`, 'error'); return false;
        }
      }
      if (!quiet) notify('笔记已保存');
      return true;
    })();
    pendingSave.current = operation;
    try { return await operation; }
    finally { pendingSave.current = null; setNoteSaving(false); }
  }, [notify, refreshSync]);
  useEffect(() => {
    if (!noteDirty || noteLoading || noteComposing || noteError) return;
    const timer = setTimeout(() => { saveNote(true); }, 1000);
    return () => clearTimeout(timer);
  }, [noteText, selectedId, noteLoading, noteComposing, noteError, saveNote]);
  async function changeDetailTab(next) {
    if (next !== detailTab && !(await saveNote(true))) return;
    setDetailTab(next);
  }
  const toggleFullscreen = useCallback(async () => {
    try {
      if (window.paperdesk?.toggleFullscreen) { setFullscreen(await window.paperdesk.toggleFullscreen()); return; }
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
    } catch (error) { notify('无法切换全屏：' + error.message, 'error'); }
  }, [notify]);
  useEffect(() => {
    const onChange = () => setFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', onChange);
    const offFullscreen = window.paperdesk?.onFullscreenChanged?.(setFullscreen);
    const offEscape = window.paperdesk?.onEscape?.(() => { if (!document.querySelector('[role=dialog]')) setFocusMode(false); });
    window.paperdesk?.getFullscreen?.().then(setFullscreen).catch(() => {});
    return () => { document.removeEventListener('fullscreenchange', onChange); offFullscreen?.(); offEscape?.(); };
  }, []);
  const quitHandler = useRef(null);
  quitHandler.current = async () => {
    if (!(await saveNote(true))) return;
    try {
      const [state, settings] = await Promise.all([api('/api/sync/status'), api('/api/settings')]);
      setSyncStatus(state); setQuitProfiles(settings.syncProfiles || []);
      setQuitProfileId(previous => settings.syncProfiles?.some(profile => profile.id === previous) ? previous : settings.syncProfiles?.[0]?.id || '');
      if (state.dirty) setQuitModal(true); else window.paperdesk?.quit();
    } catch { setQuitModal(true); }
  };
  useEffect(() => {
    const keydown = e => { if (e.key === 'F11' && !window.paperdesk?.toggleFullscreen) { e.preventDefault(); toggleFullscreen(); } if (e.key === 'Escape' && !document.querySelector('[role=dialog]')) { setFocusMode(false); if (!window.paperdesk?.toggleFullscreen && document.fullscreenElement) document.exitFullscreen().catch(() => {}); } if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); saveNote(); } if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); searchInput.current?.focus(); } };
    const beforeUnload = e => { if (!window.paperdesk && (currentNoteRef.current.dirty || syncStatus.dirty)) { e.preventDefault(); e.returnValue = ''; } };
    window.addEventListener('keydown', keydown); window.addEventListener('beforeunload', beforeUnload);
    return () => { window.removeEventListener('keydown', keydown); window.removeEventListener('beforeunload', beforeUnload); };
  }, [saveNote, syncStatus.dirty, toggleFullscreen]);
  useEffect(() => { const cleanup = window.paperdesk?.onQuitRequested?.(() => quitHandler.current?.()); return typeof cleanup === 'function' ? cleanup : undefined; }, []);
  async function selectPaper(id, tab) {
    if (id !== selectedId && !(await saveNote(true))) return;
    setSelectedId(id); setPdfPage(1);
    const p = papers.find(p => p.id === id);
    setDetailTab(tab || (isNote(p) || route === 'notes' ? 'note' : 'pdf'));
  }
  async function navigate(next) {
    if (!(await saveNote(true))) return;
    setRoute(next); setFocusMode(false);
    if (next === 'notes') { setDetailTab('note'); setQuery(''); setFilter('all'); if (selected && !isNote(selected) && !selected.hasNote) setSelectedId(null); }
    if (next === 'library') { setQuery(''); setFilter('all'); if (isNote(selected)) setSelectedId(null); }
    refreshSync();
  }
  async function importFiles(files) {
    const pdfs = [...files].filter(f => f.name.toLowerCase().endsWith('.pdf'));
    if (!pdfs.length) { notify('请选择 PDF 文件', 'error'); return; }
    setImporting(true);
    try {
      const form = new FormData(); pdfs.forEach(f => form.append('files', f));
      const result = await api('/api/papers/import', { method: 'POST', body: form });
      const imported = (result.results || []).filter(r => !r.duplicate).length;
      const duplicates = (result.results || []).filter(r => r.duplicate).length;
      await loadPapers(); refreshSync();
      if ((result.errors || []).length || duplicates || result.results?.some(r => r.candidateMatches?.length || r.warnings?.length)) setImportReport({ ...result, imported, duplicates });
      else notify(`已导入 ${imported} 篇文献`);
      const first = result.results?.find(r => r.paper)?.paper;
      if (first && await saveNote(true)) { setSelectedId(first.id); setDetailTab('pdf'); setRoute('library'); }
    } catch (e) { notify(e.message, 'error'); }
    finally { setImporting(false); if (fileInput.current) fileInput.current.value = ''; }
  }
  async function updatePaper(id, changes) {
    const data = await api(`/api/papers/${encodeURIComponent(id)}`, { method: 'PATCH', body: changes });
    setPapers(prev => prev.map(p => p.id === id ? { ...p, ...changes, ...data.paper } : p));
    refreshSync(); return data.paper;
  }
  async function removePaper() {
    if (!deleting) return;
    try { await api(`/api/papers/${encodeURIComponent(deleting.id)}`, { method: 'DELETE' }); if (selectedId === deleting.id) { setSelectedId(null); setNoteText(''); setNoteBaseline(''); } setPapers(prev => prev.filter(p => p.id !== deleting.id)); setDeleting(null); refreshSync(); notify('已删除；删除操作会在下次同步时传播'); }
    catch (e) { notify(e.message, 'error'); }
  }
  function insertMarkdown(before, after = '') {
    const input = noteInput.current; if (!input) return;
    const start = input.selectionStart, end = input.selectionEnd;
    const selection = noteText.slice(start, end), content = selection || (after ? '文字' : '');
    setNoteText(noteText.slice(0, start) + before + content + after + noteText.slice(end));
    requestAnimationFrame(() => { input.focus(); input.setSelectionRange(start + before.length, start + before.length + content.length); });
  }
  const visiblePapers = useMemo(() => {
    let list = papers.filter(p => route === 'notes' ? isNote(p) || p.hasNote : !isNote(p));
    if (filter !== 'all') list = list.filter(p => (p.status || 'unread') === filter);
    const q = query.trim().toLowerCase();
    if (q) list = list.filter(p => q.startsWith('#') ? (p.tags || []).some(t => t.toLowerCase().includes(q.slice(1))) : [p.title, authorsText(p), p.year, p.doi, ...(p.tags || [])].join(' ').toLowerCase().includes(q));
    return [...list].sort((a, b) => sort === 'title' ? (a.title || '').localeCompare(b.title || '', 'zh-CN') : new Date(b.updatedAt || b.createdAt || 0) - new Date(a.updatedAt || a.createdAt || 0));
  }, [papers, route, filter, query, sort]);
  const paperCount = papers.filter(p => !isNote(p)).length;
  const noteCount = papers.filter(p => isNote(p) || p.hasNote).length;
  const allTags = [...new Set(papers.flatMap(p => p.tags || []))].sort();
  const libraryRoute = route === 'library' || route === 'notes';
  const readingFocus = focusMode && libraryRoute && !!selected;
  return <div className={`app-shell ${sidebarClosed || readingFocus ? 'sidebar-collapsed' : ''} ${readingFocus ? 'reading-focus' : ''}`} onDragOver={e => { if ([...e.dataTransfer.types].includes('Files')) { e.preventDefault(); setDragOver(true); } }} onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget)) setDragOver(false); }} onDrop={e => { e.preventDefault(); setDragOver(false); if (!importing) importFiles(e.dataTransfer.files); }}>
    <aside className="sidebar"><div className="sidebar-top"><button className="brand" onClick={() => navigate('library')} aria-label="PaperDesk 首页"><span className="brand-symbol"><BookOpen size={21} strokeWidth={1.7} /></span><span>PaperDesk<span className="brand-dot">.</span></span></button><IconButton icon={PanelLeftClose} label="收起侧栏" className="collapse-toggle" onClick={() => setSidebarClosed(true)} /></div><div className="workspace-label"><span className="workspace-dot" />个人工作空间</div><div className="nav-caption">工作空间</div><nav aria-label="主导航">{NAV.map(({ id, label, icon: Icon }) => <button key={id} className={`nav-item ${route === id ? 'active' : ''}`} onClick={() => navigate(id)}><Icon size={18} strokeWidth={1.65} /><span>{label}</span>{id === 'library' && <span className="nav-count">{paperCount}</span>}{id === 'notes' && noteCount > 0 && <span className="nav-count">{noteCount}</span>}{id === 'sync' && syncStatus.dirty && <span className="unread-dot" />}</button>)}</nav><div className="sidebar-divider" /><div className="tag-heading"><span className="nav-caption">标签</span><Tags size={13} /></div><div className="sidebar-tags">{allTags.length ? allTags.map(tag => <button className={`tag-nav ${query === `#${tag}` ? 'selected' : ''}`} key={tag} onClick={async () => { await navigate('library'); setQuery(`#${tag}`); }}><span>#</span><span>{tag}</span><small>{papers.filter(p => (p.tags || []).includes(tag)).length}</small></button>) : <p className="sidebar-hint">为文献添加标签，<br />在这里整理研究主题。</p>}</div><div className="sidebar-bottom"><button className="local-status" onClick={() => navigate('sync')}><span className={`status-orb ${syncStatus.dirty ? 'pending' : ''}`} /><span><strong>{syncStatus.dirty ? '有更改待同步' : '本地工作空间'}<small>{syncStatus.dirty ? noteDirty ? '笔记尚有未保存内容' : '所有更改已保存在此设备' : '你的文献，保存在你的设备'}</small></strong></span><ChevronRight size={13} /></button><nav><button className={`nav-item ${route === 'settings' ? 'active' : ''}`} onClick={() => navigate('settings')}><Settings size={17} /><span>设置</span></button><button className={`nav-item ${route === 'help' ? 'active' : ''}`} onClick={() => navigate('help')}><CircleHelp size={17} /><span>使用说明</span><ArrowUpRight size={13} /></button></nav><div className="account"><div className="avatar">{(auth.username || '我').slice(0, 1).toUpperCase()}</div><div><strong>{auth.username || '我的工作空间'}</strong><small>本地账户</small></div><IconButton icon={LogOut} label="退出登录 / 锁定工作空间" onClick={async () => { if (!(await saveNote(true))) return; try { await api('/api/auth/logout', { method: 'POST' }); onAuthChange(); } catch (e) { notify(e.message, 'error'); } }} /></div></div></aside>
    <main className={`main ${libraryRoute ? 'library-main' : ''}`}><div className="window-bar"><div className="workspace-panel-controls"><IconButton icon={sidebarClosed || readingFocus ? PanelLeftOpen : PanelLeftClose} label={sidebarClosed || readingFocus ? '展开主侧栏' : '收起主侧栏'} aria-pressed={!sidebarClosed && !readingFocus} onClick={() => { if (readingFocus) { setFocusMode(false); setSidebarClosed(false); } else setSidebarClosed(value => !value); }} />{libraryRoute && <IconButton icon={listClosed || readingFocus ? PanelRightOpen : PanelRightClose} label={listClosed || readingFocus ? '展开文献列表' : '收起文献列表'} aria-pressed={!listClosed && !readingFocus} onClick={() => { if (readingFocus) { setFocusMode(false); setListClosed(false); } else setListClosed(value => !value); }} />}</div><span className="breadcrumb"><span>工作空间</span><ChevronRight size={12} />{[...NAV, { id: 'settings', label: '设置' }, { id: 'help', label: '使用说明' }].find(n => n.id === route)?.label}</span><span className="focus-document-title">{readingFocus ? selected?.title : ''}</span><div className="workspace-view-controls">{libraryRoute && selected && <IconButton icon={Focus} label={readingFocus ? '退出专注阅读 (Esc)' : '专注阅读'} aria-pressed={readingFocus} className={readingFocus ? 'active' : ''} onClick={() => setFocusMode(value => !value)} />}<IconButton icon={fullscreen ? Minimize2 : Maximize2} label={fullscreen ? '退出全屏 (F11)' : '进入全屏 (F11)'} aria-pressed={fullscreen} onClick={toggleFullscreen} /></div></div>
    {libraryRoute ? <><header className="page-header"><div><span className="eyebrow">{route === 'notes' ? 'THOUGHTS, CONNECTED' : 'YOUR RESEARCH, IN ONE PLACE'}</span><h1>{route === 'notes' ? '笔记' : '文献库'}<span className="heading-count">{route === 'notes' ? noteCount : paperCount}</span></h1><p>{route === 'notes' ? '把阅读的片段，写成自己的理解。' : '收藏值得阅读的论文，留住每一次思考。'}</p></div><div className="header-actions">{route === 'notes' ? <Button variant="primary" icon={Plus} onClick={() => setNewNote(true)}>新建笔记</Button> : <><Button icon={FilePenLine} onClick={() => setNewNote(true)} className="new-note-header">新建笔记</Button><Button variant="primary" icon={Plus} busy={importing} onClick={() => fileInput.current?.click()}>{importing ? '正在导入' : '导入文献'}</Button></>}</div></header>
    <div className="library-toolbar"><div className="filter-tabs" role="tablist" aria-label="阅读状态">{(route === 'notes' ? ['all'] : ['all', 'unread', 'reading', 'done']).map(key => <button key={key} role="tab" aria-selected={filter === key} className={filter === key ? 'active' : ''} onClick={() => setFilter(key)}>{key === 'all' ? '全部' : STATUS[key]}{key === 'all' && <span>{route === 'notes' ? noteCount : paperCount}</span>}</button>)}</div><div className="library-search"><Search size={15} /><input ref={searchInput} value={query} onChange={e => setQuery(e.target.value)} placeholder={route === 'notes' ? '搜索笔记标题、标签…' : '搜索标题、作者、标签…'} aria-label="搜索文献" />{query ? <IconButton icon={X} label="清空搜索" onClick={() => setQuery('')} /> : <kbd>Ctrl K</kbd>}</div><select className="sort-select" value={sort} onChange={e => setSort(e.target.value)} aria-label="排序方式"><option value="newest">最近更新</option><option value="title">标题 A–Z</option></select></div>
    <div ref={libraryRef} style={{'--library-ratio': `${libraryRatio}%`}} className={`library-content ${selected ? 'has-selection' : ''} ${listClosed || readingFocus ? 'list-collapsed' : ''}`}><section className="paper-list-pane" aria-label="文献列表"><div className="list-caption"><span>{query ? '搜索结果' : route === 'notes' ? '我的笔记' : '我的文献'}</span><span>{visiblePapers.length} {route === 'notes' ? '条' : '篇'}</span></div><div className="paper-list">{loading ? <div className="list-loading">{[1,2,3,4].map(i => <div className="skeleton-card" key={i}><i /><i /><i /></div>)}</div> : libraryError ? <EmptyState compact icon={AlertCircle} title="文献暂时无法加载" action={<Button onClick={loadPapers}>重试</Button>}>{libraryError}</EmptyState> : !visiblePapers.length ? <EmptyState compact icon={route === 'notes' ? FilePenLine : query || filter !== 'all' ? Search : Library} title={query || filter !== 'all' ? '没有找到匹配的内容' : route === 'notes' ? '想法，值得写下来' : '第一篇文献，从这里开始'} action={query || filter !== 'all' ? <Button onClick={() => { setQuery(''); setFilter('all'); }}>清除筛选</Button> : <Button icon={Plus} onClick={() => route === 'notes' ? setNewNote(true) : fileInput.current?.click()}>{route === 'notes' ? '新建笔记' : '选择 PDF 文件'}</Button>}>{query || filter !== 'all' ? '试试其他关键词，或清除当前筛选。' : route === 'notes' ? '创建独立笔记，或在论文旁记录阅读心得。' : '拖入 PDF，自动识别标题、去重并归档。'}</EmptyState> : visiblePapers.map(p => <button key={p.id} className={`paper-row ${selectedId === p.id ? 'selected' : ''}`} onClick={() => selectPaper(p.id)}><div className={`paper-file-icon ${isNote(p) ? 'note-icon' : ''}`}>{isNote(p) ? <FilePenLine size={19} strokeWidth={1.5} /> : <FileText size={19} strokeWidth={1.5} />}</div><div className="paper-row-body"><div className="paper-row-top"><span className={`paper-status ${isNote(p) ? 'note' : p.status || 'unread'}`}>{isNote(p) ? 'MARKDOWN' : STATUS[p.status || 'unread'] || p.status}</span><span className="paper-row-date">{dateText(p.updatedAt || p.createdAt)}</span></div><h3>{p.title || '未命名文献'}</h3><p>{isNote(p) ? '独立笔记' : [authorsText(p), p.year].filter(Boolean).join(' · ')}</p><div className="paper-row-bottom"><div className="paper-tags">{(p.tags || []).slice(0, 3).map(tag => <span className="tag" key={tag}>{tag}</span>)}</div>{p.hasNote && !isNote(p) && <FilePenLine size={13} className="has-note-icon" />}</div></div><ChevronRight size={14} className="row-arrow" /></button>)}</div><div className="list-footer"><span><ShieldCheck size={12} />导入时自动去重</span><span>PDF + Markdown</span></div></section>
    {!(listClosed || readingFocus) && <ResizableDivider containerRef={libraryRef} value={libraryRatio} onChange={setLibraryRatio} initial={35} label="文献列表与详情宽度" />}<section className="detail-pane" aria-label="文献详情">{!selected ? <div className="welcome-panel"><div className="welcome-illustration" aria-hidden="true"><div className="illustration-line line-a" /><div className="illustration-line line-b" /><div className="mini-note"><span># 灵感</span><i /><i /></div><div className="mini-paper"><BookOpen size={27} strokeWidth={1.2} /><i /><i /><i /></div><span className="illustration-spark"><Sparkles size={18} /></span></div><span className="eyebrow">A QUIET SPACE FOR BIG IDEAS</span><h2>阅读，记录，然后连接。</h2><p>选择一篇文献开始阅读，<br />让笔记成为下一次发现的起点。</p><div className="welcome-shortcuts"><span><kbd>Ctrl K</kbd> 搜索文献</span><span><kbd>Ctrl S</kbd> 保存笔记</span></div><button className="text-link" onClick={() => navigate('help')}>初次使用？看看简短指南 <ArrowUpRight size={13} /></button></div> : <><div className="detail-heading"><div className="detail-topline"><span className="detail-type">{isNote(selected) ? <FilePenLine size={13} /> : <FileText size={13} />}{isNote(selected) ? 'MARKDOWN NOTE' : 'RESEARCH PAPER'}</span><div><IconButton icon={Pencil} label="编辑标题与元数据" onClick={() => setEditPaper(selected)} /><IconButton icon={Trash2} label="删除文献" className="delete-button" onClick={() => setDeleting(selected)} /></div></div><h2 title={selected.title}>{selected.title}</h2><p className="detail-authors">{isNote(selected) ? '独立笔记' : authorsText(selected)}{selected.year ? <><span>·</span>{selected.year}</> : null}{selected.pages ? <><span>·</span>{selected.pages} 页</> : null}</p><div className="detail-meta"><div className="paper-tags">{(selected.tags || []).map(tag => <button className="tag" key={tag} onClick={() => setQuery(`#${tag}`)}>{tag}</button>)}<button className="tag-add" onClick={() => setEditPaper(selected)}><Plus size={11} />标签</button></div>{!isNote(selected) && <select value={selected.status || 'unread'} className={`status-select ${selected.status || 'unread'}`} aria-label="修改阅读状态" onChange={e => updatePaper(selected.id, { status: e.target.value }).catch(e => notify(e.message, 'error'))}>{Object.entries(STATUS).map(([v, label]) => <option key={v} value={v}>{label}</option>)}</select>}</div></div><div className="detail-tabs" role="tablist" aria-label="文献详情视图">{!isNote(selected) && <button role="tab" aria-selected={detailTab === 'pdf'} className={detailTab === 'pdf' ? 'active' : ''} onClick={() => changeDetailTab('pdf')}><BookOpen size={14} />阅读</button>}<button role="tab" aria-selected={detailTab === 'note'} className={detailTab === 'note' ? 'active' : ''} onClick={() => changeDetailTab('note')}><FilePenLine size={14} />笔记{noteDirty && <span className="unsaved-dot" />}</button>{!isNote(selected) && <button role="tab" aria-selected={detailTab === 'split'} className={detailTab === 'split' ? 'active' : ''} onClick={() => changeDetailTab('split')}><Columns2 size={14} />边读边记</button>}<button role="tab" aria-selected={detailTab === 'info'} className={detailTab === 'info' ? 'active' : ''} onClick={() => changeDetailTab('info')}><SlidersHorizontal size={14} />信息</button><div className="detail-tabs-spacer" />{!isNote(selected) && detailTab === 'pdf' && <a className="icon-button" href={`/api/papers/${encodeURIComponent(selected.id)}/pdf`} target="_blank" rel="noreferrer" title="在新窗口打开 PDF" aria-label="在新窗口打开 PDF"><ExternalLink size={14} /></a>}</div>
    {detailTab === 'info' ? <div className="info-panel"><div className="section-label">文献详情<Button icon={Pencil} onClick={() => setEditPaper(selected)}>编辑</Button></div><dl className="metadata-list"><dt>标题</dt><dd>{selected.title}</dd><dt>作者</dt><dd>{isNote(selected) ? '—' : authorsText(selected)}</dd><dt>年份</dt><dd>{selected.year || '—'}</dd><dt>DOI</dt><dd>{selected.doi ? <a href={`https://doi.org/${selected.doi}`} target="_blank" rel="noreferrer">{selected.doi}<ArrowUpRight size={12} /></a> : '—'}</dd><dt>文件名称</dt><dd className="mono">{selected.fileName || (isNote(selected) ? `${selected.title}.md` : '—')}</dd><dt>导入时间</dt><dd>{timeText(selected.createdAt)}</dd><dt>最近更新</dt><dd>{timeText(selected.updatedAt)}</dd></dl><div className="info-callout"><FileText size={17} /><p>导入后以识别的论文标题命名。编辑标题时，文件名会一起更新。</p></div><div className="section-label citation-label">引用到 Markdown<CopyButton value={`[${selected.title}](paperdesk://paper/${selected.id})`} label="复制链接" /></div><code className="note-link-code">[{selected.title}](paperdesk://paper/{selected.id})</code></div> : <div ref={readingRef} style={{'--reading-ratio': `${readingRatio}%`}} className={`reading-panels layout-${detailTab}`}>{!isNote(selected) && (detailTab === 'pdf' || detailTab === 'split') && (<div className="pdf-view"><iframe key={selected.id + pdfPage} src={`/api/papers/${encodeURIComponent(selected.id)}/pdf#page=${pdfPage}&view=FitH&toolbar=1`} title={selected.title} /><div className="pdf-footer"><span>原始 PDF · 本地文件</span><button className="text-link" onClick={() => changeDetailTab(detailTab === 'split' ? 'pdf' : 'split')}><FilePenLine size={12} />{detailTab === 'split' ? '收起笔记' : '边读边记'}</button></div></div>)}{!isNote(selected) && detailTab === 'split' && <ResizableDivider containerRef={readingRef} value={readingRatio} onChange={setReadingRatio} initial={52} label="PDF 与笔记宽度" />}{(isNote(selected) || detailTab === 'note' || detailTab === 'split') && (<div className="note-workspace"><div className="note-toolbar">{detailTab === 'split' && <IconButton icon={PanelLeftClose} label="收起 PDF，仅显示笔记" onClick={() => changeDetailTab('note')} />}<div className="mode-control">{[{ id: 'edit', label: '编辑', icon: Code2 }, { id: 'split', label: '分栏', icon: Columns2 }, { id: 'preview', label: '预览', icon: Eye }].map(({ id, label, icon: Icon }) => <button key={id} aria-label={label} title={label} className={noteMode === id ? 'active' : ''} onClick={() => setNoteMode(id)}><Icon size={14} /><span>{label}</span></button>)}</div><IconButton icon={CircleHelp} label="Markdown 语法与保存说明" onClick={() => setMarkdownHelpOpen(true)} /><Button icon={Save} variant={noteDirty ? 'primary' : 'secondary'} busy={noteSaving} disabled={noteLoading || !!noteError || !noteDirty} onClick={() => saveNote()}>{noteSaving ? '保存中' : '保存'}</Button></div>{noteLoading ? <div className="pane-loading"><LoaderCircle className="spin" size={20} />正在打开笔记…</div> : noteError ? <EmptyState compact icon={AlertCircle} title="笔记暂时无法读取">{noteError}</EmptyState> : <><div className={`editor-container mode-${noteMode}`}>{noteMode !== 'preview' && <div className="editor-half"><div className="markdown-tools"><IconButton icon={Heading2} label="插入标题" onClick={() => insertMarkdown('## ')} /><IconButton icon={Bold} label="粗体" onClick={() => insertMarkdown('**', '**')} /><IconButton icon={List} label="列表" onClick={() => insertMarkdown('- ')} /><IconButton icon={Quote} label="引用" onClick={() => insertMarkdown('> ')} /><IconButton icon={Link2} label="链接" onClick={() => insertMarkdown('[', '](https://)')} /><IconButton icon={Braces} label="代码" onClick={() => insertMarkdown('`', '`')} /><span>Markdown</span></div><textarea ref={noteInput} className="markdown-input" aria-label="Markdown 笔记编辑器" spellCheck={false} value={noteText} onCompositionStart={() => setNoteComposing(true)} onCompositionEnd={() => setNoteComposing(false)} onChange={e => { currentNoteRef.current.text = e.target.value; currentNoteRef.current.dirty = e.target.value !== currentNoteRef.current.base; setNoteText(e.target.value); }} onKeyDown={e => { if (e.key === 'Tab') { e.preventDefault(); insertMarkdown('  '); } }} placeholder={`# ${selected.title}\n\n## 核心观点\n\n这篇论文解决了什么问题？\n\n## 我的思考\n\n记录启发、疑问和下一步…`} /></div>}{noteMode !== 'edit' && <div className="preview-half">{noteText.trim() ? <Markdown text={noteText} onPaperLink={id => { if (papers.some(p => p.id === id)) selectPaper(id, 'note'); else notify('链接指向的文献不存在', 'error'); }} /> : <div className="preview-empty"><FilePenLine size={22} /><p>你的文字将在这里呈现。</p></div>}</div>}</div><div className="note-footer"><span role="status" className={noteSaveError ? "save-error" : ""}>{noteSaveError ? <><AlertCircle size={12} />保存失败，请点击保存重试</> : noteSaving ? <><LoaderCircle size={12} className="spin" />保存中…</> : noteDirty ? <><span className="unsaved-dot" />待保存 · 停止输入后自动保存</> : <><Check size={12} />已保存到本地 · 自动保存已开启</>}</span><span>{noteText.replace(/\s/g, '').length} 字符<span className="footer-separator">·</span><kbd>Ctrl S</kbd></span></div></>}</div>)}</div>}</> }</section></div></> : route === 'knowledge' ? <Knowledge onOpenPaper={async (id,page,kind) => { if (!(await saveNote(true))) return; const paper = papers.find(p => p.id === id); if (!paper) { notify('来源文献已不存在，请重新检索', 'error'); return; } const noteSource = page === 0 || kind === 'note' || kind === 'notes' || isNote(paper); setRoute(isNote(paper) ? 'notes' : 'library'); setSelectedId(id); setPdfPage(Number(page) > 0 ? Number(page) : 1); setDetailTab(noteSource ? 'note' : 'pdf'); setFocusMode(false); }} onSettings={() => navigate('settings')} notify={notify} onBuild={() => { loadPapers(); refreshSync(); }} /> : route === 'sync' ? <SyncPage auth={auth} status={syncStatus} refreshStatus={refreshSync} notify={notify} onSettings={() => navigate('settings')} onSynced={loadPapers} saveNote={saveNote} /> : route === 'settings' ? <SettingsPage auth={auth} notify={notify} onSaved={refreshSync} /> : <HelpPage onNavigate={navigate} />}
    </main>
    <input ref={fileInput} type="file" multiple accept="application/pdf,.pdf" className="hidden-input" onChange={e => importFiles(e.target.files)} />
    {dragOver && <div className="drop-overlay"><div><Upload size={42} strokeWidth={1.2} /><h2>把论文放进来。</h2><p>松开鼠标导入 PDF，自动识别标题并筛除重复文献。</p></div></div>}
    {importing && <div className="import-indicator" role="status"><LoaderCircle size={17} className="spin" /><div><strong>正在整理文献…</strong><span>识别标题、检查重复并提取全文</span></div></div>}
    {toast && <div className={`toast ${toast.type}`} role={toast.type === 'error' ? 'alert' : 'status'}>{toast.type === 'error' ? <AlertCircle size={17} /> : <CheckCircle2 size={17} />}<span>{toast.message}</span><IconButton icon={X} label="关闭提示" onClick={() => setToast(null)} /></div>}
    {markdownHelpOpen && <Modal title="Markdown 语法与保存说明" onClose={() => setMarkdownHelpOpen(false)}><div className="markdown-help"><Markdown text={markdownHelp} /></div></Modal>}
    {editPaper && <EditPaperModal paper={editPaper} onClose={() => setEditPaper(null)} onSave={async changes => { await updatePaper(editPaper.id, changes); setEditPaper(null); notify('文献信息已更新'); }} />}
    {deleting && <Modal title={isNote(deleting) ? '删除这篇笔记？' : '删除这篇文献？'} onClose={() => setDeleting(null)}><p className="modal-description"><strong>{deleting.title}</strong><br />{isNote(deleting) ? '笔记' : 'PDF 及关联笔记'}将从工作空间删除。下次同步时，其他设备也会收到这项删除。</p><div className="modal-actions"><Button onClick={() => setDeleting(null)}>保留</Button><Button variant="danger" icon={Trash2} onClick={removePaper}>确认删除</Button></div></Modal>}
    {newNote && <NewNoteModal onClose={() => setNewNote(false)} onCreate={async title => { if (!(await saveNote(true))) throw new Error('请先保存当前笔记'); const data = await api('/api/notes', { method: 'POST', body: { title, markdown: `# ${title}\n\n` } }); await loadPapers(); setNewNote(false); setRoute('notes'); setQuery(''); setFilter('all'); setSelectedId(data.paper.id); setDetailTab('note'); refreshSync(); }} />}
    {importReport && <Modal title="文献整理完成" onClose={() => setImportReport(null)}><div className="import-summary"><div><strong>{importReport.imported}</strong><span>新文献已归档</span></div><div><strong>{importReport.duplicates}</strong><span>重复文献已跳过</span></div></div>{(importReport.results || []).filter(r => r.duplicate).map((r, i) => <div className="import-result" key={i}><CheckCheck size={16} /><div><strong>{r.paper?.title || r.fileName || '重复文件'}</strong><span>{r.reason || '文献库中已存在这篇论文'}</span></div></div>)}{(importReport.results || []).filter(r => r.candidateMatches?.length || r.possibleDuplicates?.length || r.candidates?.length).map((r, i) => <div className="info-callout" key={`candidate-${i}`}><AlertCircle size={16} /><p>《{r.paper?.title}》存在相似标题，请打开文献检查是否属于不同版本。</p></div>)}{(importReport.errors || []).map((e, i) => <div className="inline-error" key={i}><AlertCircle size={15} /><span>{errorText(e)}</span></div>)}<div className="modal-actions"><Button variant="primary" onClick={() => setImportReport(null)}>完成</Button></div></Modal>}
    {quitModal && <Modal title="退出前，要同步一下吗？" subtitle="你的更改已保存在本地。选择一个目标同步，下一台设备就能继续工作。" onClose={quittingSync ? undefined : () => setQuitModal(false)}><div className="quit-note"><RefreshCw size={24} /><span>还有本地更改未同步。</span></div>{quitProfiles.length ? <label className="field">同步到<select value={quitProfileId} disabled={quittingSync} onChange={e => setQuitProfileId(e.target.value)}>{quitProfiles.map(profile => <option key={profile.id} value={profile.id}>{profile.name || profile.host || profile.folderPath}</option>)}</select><small>本次只同步所选目标。其他目标可在同步页面单独同步。</small></label> : <p className="pair-help">还没有同步目标。可以先退出，或到同步页面添加。</p>}<div className="modal-actions"><Button disabled={quittingSync} onClick={() => { setQuitModal(false); navigate('sync'); }}>前往同步</Button><Button disabled={quittingSync} onClick={() => window.paperdesk?.quit()}>仅退出</Button><Button variant="primary" icon={RefreshCw} busy={quittingSync} disabled={!quitProfileId} onClick={async () => { setQuittingSync(true); try { await api('/api/sync/run', { method: 'POST', body: {profileId:quitProfileId} }); window.paperdesk?.quit(); } catch (e) { if(e.code === 'PAIRING_REQUIRED' || e.code === 'AUTH_FAILED') { setQuitModal(false); setRoute('sync'); notify('请先在同步页面完成目标配对，再同步退出', 'error'); } else notify('同步未完成：'+e.message, 'error'); } finally { setQuittingSync(false); } }}>同步并退出</Button></div></Modal>}
  </div>;
}

function EditPaperModal({ paper, onClose, onSave }) {
  const [form, setForm] = useState({ title: paper.title || '', authors: Array.isArray(paper.authors) ? paper.authors.join(', ') : paper.authors || '', year: paper.year || '', doi: paper.doi || '', tags: (paper.tags || []).join(', '), status: paper.status || 'unread' });
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const set = (key, value) => setForm(prev => ({ ...prev, [key]: value }));
  return <Modal title={isNote(paper) ? '编辑笔记信息' : '编辑文献信息'} subtitle="标题会用于文件命名，你也可以随时修改。" onClose={busy ? undefined : onClose}><form onSubmit={async e => { e.preventDefault(); setBusy(true); setError(''); try { await onSave({ ...form, title: form.title.trim(), tags: [...new Set(form.tags.split(/[,，]/).map(t => t.trim()).filter(Boolean))] }); } catch (e) { setError(e.message); } finally { setBusy(false); } }}><label className="field">标题<textarea rows={3} value={form.title} onChange={e => set('title', e.target.value)} required /></label>{!isNote(paper) && <><label className="field">作者<input value={form.authors} onChange={e => set('authors', e.target.value)} placeholder="例如：A. Smith, B. Chen" /></label><div className="form-row"><label className="field">年份<input value={form.year} onChange={e => set('year', e.target.value)} placeholder="2024" inputMode="numeric" /></label><label className="field">阅读状态<select value={form.status} onChange={e => set('status', e.target.value)}>{Object.entries(STATUS).map(([v, label]) => <option key={v} value={v}>{label}</option>)}</select></label></div><label className="field">DOI<input value={form.doi} onChange={e => set('doi', e.target.value)} placeholder="10.xxxx/xxxxx" /></label></>}<label className="field">标签<input value={form.tags} onChange={e => set('tags', e.target.value)} placeholder="例如：机器学习, 重点阅读" /><small>用逗号分隔多个标签。</small></label>{error && <div className="inline-error">{error}</div>}<div className="modal-actions"><Button onClick={onClose} disabled={busy}>取消</Button><button type="submit" className="button primary" disabled={busy || !form.title.trim()}>{busy && <LoaderCircle size={15} className="spin" />}保存修改</button></div></form></Modal>;
}
function NewNoteModal({ onClose, onCreate }) {
  const [title, setTitle] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState('');
  return <Modal title="一篇新的笔记" subtitle="记录一个想法，或把多篇文献连接起来。" onClose={busy ? undefined : onClose}><form onSubmit={async e => { e.preventDefault(); setBusy(true); try { await onCreate(title.trim()); } catch (e) { setError(e.message); } finally { setBusy(false); } }}><label className="field">标题<input autoFocus value={title} onChange={e => setTitle(e.target.value)} required placeholder="给这个想法一个名字" /></label>{error && <div className="inline-error">{error}</div>}<div className="modal-actions"><Button onClick={onClose}>取消</Button><button type="submit" className="button primary" disabled={busy || !title.trim()}>{busy ? <LoaderCircle className="spin" size={15} /> : <Plus size={15} />}创建笔记</button></div></form></Modal>;
}

function Knowledge({ onOpenPaper, onSettings, notify, onBuild }) {
  const [mode, setMode] = useState('search');
  const [scope, setScope] = useState('all');
  const [question, setQuestion] = useState('');
  const [busy, setBusy] = useState(false), [building, setBuilding] = useState(false);
  const [result, setResult] = useState(null), [error, setError] = useState('');
  const [settings, setSettings] = useState(null), [submitted, setSubmitted] = useState('');
  useEffect(() => { api('/api/settings').then(setSettings).catch(() => {}); }, []);
  async function submit(e) {
    e?.preventDefault(); if (!question.trim() || busy) return;
    setBusy(true); setResult(null); setError(''); setSubmitted(question.trim());
    try {
      setResult(mode === 'ask'
        ? await api('/api/ask', { method: 'POST', body: { question: question.trim(), scope } })
        : await api('/api/search?q=' + encodeURIComponent(question.trim()) + '&scope=' + scope));
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  }
  function selectMode(next) { if (busy) return; setMode(next); setResult(null); setError(''); }
  const sources = result?.sources || result?.results || [];
  const configured = !!settings?.modelConfig?.tasks?.answer || (!!settings?.llm?.baseUrl && !!settings?.llm?.model);
  return <div className="scroll-page knowledge-page">
    <header className="page-header"><div><span className="eyebrow">FROM PAPERS TO PERSPECTIVES</span><h1>知识库</h1><p>在论文和笔记里，找到值得继续追问的线索。</p></div><Button icon={RefreshCw} busy={building} onClick={async () => { setBuilding(true); try { const data = await api('/api/knowledge/build', { method: 'POST' }); notify('知识库已更新：' + (data.papers ?? '全部') + ' 篇文献，' + (data.indexed ?? 0) + ' 个索引单元'); onBuild(); } catch (e) { notify(e.message, 'error'); } finally { setBuilding(false); } }}>{building ? '正在构建' : '更新知识库'}</Button></header>
    <div className="knowledge-inner"><div className="knowledge-intro"><div className="knowledge-emblem"><Network size={27} strokeWidth={1.3} /></div><h2>先找到线索，再连接想法。</h2><p>本地检索随时可用；需要综合分析时，再向文献提问。</p></div>
      <div className="knowledge-query"><div className="knowledge-modes"><button disabled={busy} className={mode === 'search' ? 'active' : ''} onClick={() => selectMode('search')}><Search size={15} />本地检索</button><button disabled={busy} className={mode === 'ask' ? 'active' : ''} onClick={() => selectMode('ask')}><Sparkles size={15} />文献问答</button><span>{mode === 'search' ? '本地运行 · 无需大模型' : '使用设置中的问答模型'}</span></div>
        <div className="search-scope" role="group" aria-label="检索范围"><span>范围</span>{[['all','全部'],['papers','论文'],['notes','笔记']].map(([value,label]) => <button key={value} disabled={busy} className={scope === value ? 'active' : ''} aria-pressed={scope === value} onClick={() => { setScope(value); setResult(null); setError(''); }}>{label}</button>)}</div>
        <form onSubmit={submit}><textarea aria-label={mode === 'ask' ? '向知识库提问' : '全文检索关键词'} value={question} onChange={e => setQuestion(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); submit(); } }} rows={3} placeholder={mode === 'ask' ? '例如：这些论文使用了哪些方法？它们有什么共同的局限？' : scope === 'notes' ? '查找阅读笔记与独立笔记中的想法…' : scope === 'papers' ? '输入关键词，查找论文原文…' : '输入关键词，检索论文全文与 Markdown 笔记…'} /><div className="query-footer"><span><kbd>Ctrl</kbd> + <kbd>Enter</kbd> 提交</span><button className="button primary" type="submit" disabled={busy || !question.trim()}>{busy ? <LoaderCircle size={15} className="spin" /> : mode === 'ask' ? <ArrowRight size={15} /> : <Search size={15} />}{busy ? '正在查阅' : mode === 'ask' ? '提问' : '检索'}</button></div></form>
      </div>
      {mode === 'ask' && settings && !configured && <div className="model-hint"><Sparkles size={16} /><p>先在设置中为文献问答指定一个模型，即可生成带来源的回答。</p><button className="text-link" onClick={onSettings}>配置模型 <ArrowUpRight size={13} /></button></div>}
      {error && <div className="inline-error" role="alert"><AlertCircle size={17} /><span>{error}</span></div>}
      {busy && <div className="answer-loading"><LoaderCircle className="spin" size={19} /><span>{mode === 'ask' ? '正在检索来源并整理回答…' : '正在搜索所选范围…'}</span></div>}
      {result && <div className="knowledge-result"><div className="result-question"><span>{mode === 'ask' ? '你的问题' : '检索词'} · {{all:'全部',papers:'论文',notes:'笔记'}[scope]}</span><h3>{submitted}</h3></div>{result.answer && <div className="answer-card"><div className="answer-heading"><Sparkles size={16} />基于文献的回答<CopyButton value={result.answer} /></div><Markdown text={result.answer} onPaperLink={onOpenPaper} />{result.warnings?.length > 0 && <p className="scope-note">{result.warnings.map(errorText).join('；')}</p>}</div>}<div className="sources-heading"><span>{mode === 'ask' ? '参考来源' : '匹配片段'}</span><span>{sources.length} 条</span></div>{sources.length ? <div className="source-list">{sources.map((source, i) => <button key={source.paperId + '-' + i} className="source-card" onClick={() => onOpenPaper(source.paperId, source.page, source.kind)}><span className="source-index">{String(i + 1).padStart(2, '0')}</span><div><h4>{source.title}</h4><span className="source-page">{source.page === 0 || source.kind === 'note' || source.kind === 'notes' ? '用户笔记' : source.page > 0 ? '论文 · 第 ' + source.page + ' 页' : '论文'}</span><p>{source.text}</p></div><ArrowUpRight size={15} /></button>)}</div> : <EmptyState compact icon={Search} title="没有找到相关片段">试试原文中出现的关键词，或调整检索范围。新导入的扫描版 PDF 需要先进行 OCR。</EmptyState>}</div>}
      {!result && !busy && !error && <div className="knowledge-notes"><div><FileText size={17} /><h3>分别查找论文与笔记</h3><p>搜索论文原文，也能只搜索你自己的阅读心得。</p></div><div><Link2 size={17} /><h3>直接回到来源</h3><p>点击结果打开原文页码；笔记结果直接打开笔记。</p></div><div><SlidersHorizontal size={17} /><h3>按任务选择模型</h3><p>问答、检索辅助与向量索引可分别配置。</p></div></div>}
    </div>
  </div>;
}

function SyncPage({ auth, status, refreshStatus, notify, onSynced, saveNote }) {
  const [profiles, setProfiles] = useState([]), [devices, setDevices] = useState([]);
  const [loading, setLoading] = useState(true), [busy, setBusy] = useState(null);
  const [editing, setEditing] = useState(null), [removing, setRemoving] = useState(null);
  const [pairing, setPairing] = useState(null), [result, setResult] = useState(null), [error, setError] = useState('');
  const [revokeDevice, setRevokeDevice] = useState(null);
  const [deviceError, setDeviceError] = useState('');
  const load = useCallback(async () => {
    try { const data = await api('/api/settings'); setProfiles(data.syncProfiles || []); }
    catch (e) { setError(e.message); }
    finally { setLoading(false); }
    try { const data = await api('/api/sync/paired-devices'); setDevices(data.devices || []); setDeviceError(''); }
    catch (e) { setDeviceError(e.message); }
    refreshStatus();
  }, [refreshStatus]);
  useEffect(() => { load(); }, [load]);
  async function saveProfiles(next) {
    await api('/api/settings', { method: 'PUT', body: { syncProfiles: next } });
    setProfiles(next); await load();
  }
  async function run(action, profile) {
    if (!(await saveNote(true))) return;
    setBusy({id:profile.id,action}); setError(''); setResult(null);
    try {
      const data = await api('/api/sync/' + action, { method: 'POST', body: { profileId: profile.id } });
      if (data.ok === false) throw new Error(data.error || data.message || '操作未完成');
      setResult({ action, profile, data });
      if (action === 'run') { await onSynced(); notify('已与「' + profile.name + '」同步'); }
      else notify('「' + profile.name + '」连接测试完成');
      await load();
    } catch (e) {
      if (e.code === 'PAIRING_REQUIRED' || e.code === 'AUTH_FAILED') setPairing({ profile, action, message: e.message });
      else setError(e.message);
    } finally { setBusy(null); }
  }
  const addProfile = () => setEditing({ id: crypto.randomUUID(), name: '', type: 'ssh', host: '', port: 22, remoteAppDir: 'D:/Apps/PaperDesk', remoteDataDir: 'D:/PaperDeskData', folderPath: '' });
  return <div className="scroll-page sync-devices-page">
    <header className="page-header"><div><span className="eyebrow">YOUR WORK, WHEREVER YOU ARE</span><h1>手动同步</h1><p>连接你的其他设备，每次同步由你发起。</p></div><Button variant="primary" icon={Plus} disabled={!!busy} onClick={addProfile}>添加同步目标</Button></header>
    <div className="content-column sync-column">
      <div className="sync-overview"><span className={status.dirty ? 'status-orb pending' : 'status-orb'} /><div><strong>{status.dirty ? '有本地更改等待同步' : '所有编辑已保存在本地'}</strong><p>PDF、文献信息和 Markdown 笔记双向合并；API 密钥与模型配置保留在本机。</p></div><span className="manual-badge">仅手动同步</span></div>
      {error && <div className="inline-error" role="alert"><AlertCircle size={17} /><span>{error}</span></div>}
      {loading ? <div className="pane-loading"><LoaderCircle size={18} className="spin" />正在读取同步目标…</div> : profiles.length ? <div className="sync-profile-list">{profiles.map(profile => {
        const peerState = (status.profiles || []).find(item => item.id === profile.id) || profile;
        const running = busy?.id === profile.id;
        return <section className="sync-profile-card" key={profile.id}><div className="sync-profile-heading"><span className="profile-icon">{profile.type === 'folder' ? <FolderOpen size={23} /> : <Laptop size={23} />}</span><div><h2>{profile.name || '未命名设备'}</h2><span>{profile.type === 'folder' ? '加密同步文件夹' : 'SSH 设备'} · {peerState.pendingChanges ? '有更改待同步' : '已同步当前本地更改'}</span></div><span className={peerState.paired ? 'pair-state paired' : 'pair-state'}>{peerState.paired ? '已配对' : '需要配对'}</span><IconButton icon={Pencil} label={'编辑同步目标：' + profile.name} disabled={!!busy} onClick={() => setEditing({...profile})} /><IconButton icon={Trash2} label={'移除同步目标：' + profile.name} disabled={!!busy} onClick={() => setRemoving(profile)} /></div>
          <dl className="profile-paths">{profile.type === 'folder' ? <><dt>共享目录</dt><dd>{profile.folderPath}</dd></> : <><dt>设备地址</dt><dd>{profile.host}{Number(profile.port) !== 22 ? ' · 端口 ' + profile.port : ''}</dd><dt>远程安装</dt><dd>{profile.remoteAppDir}</dd><dt>远程文献库</dt><dd>{profile.remoteDataDir}</dd></>}</dl>
          <div className="profile-footer"><span><Clock3 size={12} />{peerState.lastSync ? '上次同步：' + timeText(peerState.lastSync) : peerState.paired ? peerState.remembered ? '配对凭据已记住' : '本次会话已配对' : '首次使用时输入你的应用用户名和密码'}</span><div>{peerState.paired && <button className="text-link" disabled={!!busy} onClick={async () => { setBusy({id:profile.id,action:'revoke'}); try { await api('/api/sync/revoke', {method:'POST',body:{profileId:profile.id}}); await load(); notify('此设备的已记住配对已撤销'); } catch(e) { setError(e.message); } finally { setBusy(null); } }}>取消配对</button>}<Button icon={Wifi} busy={running && busy.action === 'test'} disabled={!!busy} onClick={() => run('test', profile)}>测试连接</Button><Button variant="primary" icon={RefreshCw} busy={running && busy.action === 'run'} disabled={!!busy} onClick={() => run('run', profile)}>同步</Button></div></div>
        </section>;
      })}</div> : <EmptyState icon={RefreshCw} title="把研究带到另一台设备" action={<Button icon={Plus} variant="primary" onClick={addProfile}>添加第一个同步目标</Button>}>通过 SSH 连接另一台电脑，或使用 OneDrive、NAS、U 盘中的共享文件夹。</EmptyState>}
      {result && <div className="sync-result"><div className="section-label"><span><CheckCircle2 size={17} />{result.profile.name} · {result.action === 'test' ? '连接测试完成' : '同步完成'}</span></div><p>{result.data.message || (result.action === 'test' ? '已收到目标设备或共享文件夹的响应。' : '文献与笔记已重新加载，可以继续工作。')}</p>{Number(result.data.conflicts) > 0 && <div className="info-callout"><AlertCircle size={16} /><p>有 {result.data.conflicts} 处并发修改，双方内容均已保留，请检查并整理笔记。</p></div>}<details><summary>查看同步详情</summary><pre>{JSON.stringify(result.data, null, 2)}</pre></details></div>}
      <section className="incoming-devices"><div className="section-label"><span><ShieldCheck size={17} />允许访问本机的设备</span><Button icon={RefreshCw} disabled={!!busy} onClick={load}>刷新</Button></div><p>这里管理其他设备对当前文献库的访问。撤销后，对方需要再次输入应用密码配对。</p>{deviceError ? <p className="inline-error">{deviceError}</p> : devices.length ? devices.map(device => <div className="incoming-device" key={device.id}><Laptop size={16} /><div><strong>{device.name || device.deviceName || device.username || '已配对设备'}</strong><small>{device.lastUsedAt ? '最近使用：' + timeText(device.lastUsedAt) : device.pairedAt ? '配对时间：' + timeText(device.pairedAt) : device.id}</small></div><Button disabled={!!busy} onClick={() => setRevokeDevice(device)}>撤销访问</Button></div>) : <p className="muted-small">尚无其他设备获准访问。</p>}</section>
      <div className="sync-facts"><div><LockKeyhole size={19} /><h3>使用同一个账户</h3><p>每台电脑第一次打开应用，都填写相同的用户名与密码；同步目标还需完成一次配对。</p></div><div><FolderOpen size={19} /><h3>可用已有共享文件夹</h3><p>文件夹目标需能从本机访问；云盘负责传递文件，PaperDesk 在你点击同步时合并。</p></div><div><FilePenLine size={19} /><h3>保留双方改动</h3><p>两端同时修改时保留冲突内容；删除操作也会同步，重要资料请保留独立备份。</p></div></div>
    </div>
    {editing && <SyncProfileModal profile={editing} onClose={() => setEditing(null)} onSave={async profile => { const next = profiles.some(p => p.id === profile.id) ? profiles.map(p => p.id === profile.id ? profile : p) : [...profiles, profile]; await saveProfiles(next); setEditing(null); notify('同步目标已保存'); }} />}
    {removing && <Modal title="移除这个同步目标？" subtitle="只移除当前设备的连接配置，不删除任何一端的文献。" onClose={() => setRemoving(null)}><p className="modal-description">{removing.name}</p><div className="modal-actions"><Button onClick={() => setRemoving(null)}>保留</Button><Button variant="danger" onClick={async () => { try { await saveProfiles(profiles.filter(p => p.id !== removing.id)); setRemoving(null); notify('同步目标已移除'); } catch(e) { setError(e.message); } }}>移除目标</Button></div></Modal>}
    {pairing && <SyncPairModal username={auth.username} pairing={pairing} onClose={() => setPairing(null)} onPair={async credentials => { const target = pairing; await api('/api/sync/pair', {method:'POST',body:{profileId:target.profile.id,...credentials}}); setPairing(null); await load(); await run(target.action,target.profile); }} />}
    {revokeDevice && <Modal title="撤销设备访问？" subtitle="这台设备需要重新输入应用用户名和密码，才能再次同步。" onClose={() => setRevokeDevice(null)}><p className="modal-description">{revokeDevice.name || revokeDevice.deviceName || revokeDevice.username || revokeDevice.id}</p><div className="modal-actions"><Button onClick={() => setRevokeDevice(null)}>保留访问</Button><Button variant="danger" onClick={async () => { try { await api('/api/sync/revoke-device',{method:'POST',body:{id:revokeDevice.id}}); setRevokeDevice(null); await load(); notify('设备访问已撤销'); } catch(e) { setError(e.message); } }}>撤销访问</Button></div></Modal>}
  </div>;
}

function SyncProfileModal({profile,onClose,onSave}) {
  const [form,setForm]=useState({...profile}),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const set=(key,value)=>setForm(previous=>({...previous,[key]:value}));
  return <Modal title={profile.name ? '编辑同步目标' : '添加同步目标'} subtitle="给另一台电脑或共享文件夹起一个容易辨认的名字。" onClose={busy?undefined:onClose}><form onSubmit={async event=>{event.preventDefault();setBusy(true);setError('');try{await onSave({id:form.id,name:form.name.trim(),type:form.type,host:form.host?.trim()||'',port:Number(form.port)||22,remoteAppDir:form.remoteAppDir?.trim()||'',remoteDataDir:form.remoteDataDir?.trim()||'',folderPath:form.folderPath?.trim()||''})}catch(e){setError(e.message)}finally{setBusy(false)}}}>
    <label className="field">目标名称<input value={form.name} required maxLength={80} placeholder="例如：工位电脑、家中电脑、研究云盘" onChange={e=>set('name',e.target.value)}/></label><label className="field">同步方式<select value={form.type} onChange={e=>set('type',e.target.value)}><option value="ssh">SSH 连接电脑</option><option value="folder">共享文件夹 / OneDrive / NAS / U 盘</option></select></label>
    {form.type==='folder'?<label className="field">本机可访问的共享目录<input value={form.folderPath||''} required placeholder="例如：D:/OneDrive/PaperDeskSync" onChange={e=>set('folderPath',e.target.value)}/><small>在其他设备选择同一共享目录对应的本地路径。配对时使用相同的应用用户名与密码。</small></label>:<><div className="form-row"><label className="field">SSH 地址<input value={form.host||''} required placeholder="系统用户名@IP，或 SSH 配置别名" onChange={e=>set('host',e.target.value)}/></label><label className="field">端口<input type="number" min="1" max="65535" value={form.port||22} required onChange={e=>set('port',e.target.value)}/></label></div><label className="field">远程安装目录<input value={form.remoteAppDir||''} required placeholder="例如：D:/Apps/PaperDesk" onChange={e=>set('remoteAppDir',e.target.value)}/></label><label className="field">远程文献库目录<input value={form.remoteDataDir||''} required placeholder="在另一台设备的设置中查看" onChange={e=>set('remoteDataDir',e.target.value)}/><small>SSH 用于连接电脑；应用用户名与密码用于首次文献库配对。远程需先打开新版 PaperDesk 并创建账户。</small></label></>}
    {error&&<div className="inline-error" role="alert">{error}</div>}<div className="modal-actions"><Button disabled={busy} onClick={onClose}>取消</Button><button type="submit" className="button primary" disabled={busy||!form.name.trim()}>{busy&&<LoaderCircle size={15} className="spin"/>}保存目标</button></div>
  </form></Modal>;
}

function SyncPairModal({username,pairing,onClose,onPair}) {
  const [form,setForm]=useState({username:username||'',password:'',remember:true}),[busy,setBusy]=useState(false),[error,setError]=useState('');
  return <Modal title={'连接「'+pairing.profile.name+'」'} subtitle="使用此文献库的应用用户名与密码完成首次配对。选择记住后，无需每次输入。" onClose={busy?undefined:onClose}><form onSubmit={async event=>{event.preventDefault();setBusy(true);setError('');try{await onPair(form)}catch(e){setError(e.message)}finally{setBusy(false)}}}>{pairing.message&&<p className="pair-help">{pairing.message}</p>}<label className="field">应用用户名<input autoComplete="username" required value={form.username} onChange={e=>setForm({...form,username:e.target.value})}/></label><label className="field">应用密码<input type="password" autoComplete="current-password" required value={form.password} onChange={e=>setForm({...form,password:e.target.value})} placeholder="与另一台设备首次设置时相同的密码"/></label><label className="checkbox-label"><input type="checkbox" checked={form.remember} onChange={e=>setForm({...form,remember:e.target.checked})}/>在本机记住这项配对</label>{error&&<div className="inline-error" role="alert">{error}</div>}<div className="modal-actions"><Button disabled={busy} onClick={onClose}>取消</Button><button type="submit" className="button primary" disabled={busy}>{busy?<LoaderCircle size={15} className="spin"/>:<LockKeyhole size={15}/>}配对并继续</button></div></form></Modal>;
}


function HelpPage({onNavigate}){
 return <div className="scroll-page"><header className="page-header"><div><span className="eyebrow">A SMALL GUIDE TO GET STARTED</span><h1>使用说明</h1><p>从第一篇论文，到跨设备继续研究。</p></div><span className="tag">PaperDesk 1.0</span></header><div className="content-column"><p className="help-intro">你的文献保存在本地，笔记使用普通 Markdown。系统不会自动同步。</p>
 {[
 ['导入文献','点击“导入文献”或拖入 PDF。系统复制文件、提取标题和 DOI、建立全文索引；原始文件保持原样。相同文件或 DOI 自动跳过，仅同名的不同文件会保留。'],
 ['阅读与记录','顶部按钮可分别收起主侧栏和文献列表；F11 全屏，Esc 退出。“阅读”“笔记”“边读边记”切换单独阅读、独立写作和左右并排。Ctrl+S 保存，Markdown 支持编辑、分栏和预览。'],
 ['建立知识库','可选全部、论文或笔记范围，本地全文搜索无需模型。设置中先连接服务商，再添加模型，最后分配文献问答、检索词扩展与语义检索用途。扫描 PDF 先用外部 OCR。'],
 ['在两台电脑继续','每台电脑都安装 1.1 或更新版本，分别设置相同名字和密码。同步可添加多个 SSH 目标，或选择 OneDrive、NAS、U 盘的加密同步文件夹。首次均需应用账号密码配对，之后可记住；各目标分别手动同步。'],
 ['处理同步冲突','同步会双向合并文献与笔记。两边同时修改的笔记会保留冲突段落；整理后保存即可。同步期间如仍有编辑，会保留待同步状态。一次快照上限为 1 GB，适合个人文献库。'],
 ['通过 Hermes 讨论灵感','工位机 Hermes 通过 MCP 读取文献库，可搜索论文、读取某页或追加笔记。在 QQ 向 Hermes 提出请求即可；PaperDesk 不会主动发送 QQ 消息。具体配置见安装目录 docs/HERMES.md。'],
 ['退出、备份与迁移','退出窗口时有未同步更改会提醒。后台服务继续运行以供 Hermes 使用；重启后需打开程序或设置随登录启动服务。备份时先停止后台服务，再复制整个资料库；不要遗漏 papers、notes 与 objects。']
 ].map(([title,description],i)=><div className="help-step" key={title}><span>{String(i+1).padStart(2,'0')}</span><div><h3>{title}</h3><p>{description}</p></div></div>)}
 <section className="settings-section"><Markdown text={markdownHelp} /></section><div className="help-grid"><section className="settings-section"><h3>安装到其他电脑</h3><p>将安装程序分享给别人，选择自己的安装目录。免安装 ZIP 须整体解压，不能单独复制 exe。当前支持 Windows x64，不需要预装 Node 或 Python。</p></section><section className="settings-section"><h3>常用快捷键</h3><p><kbd>Ctrl K</kbd> 搜索文献<br/><kbd>Ctrl S</kbd> 保存当前笔记<br/><kbd>Ctrl Enter</kbd> 提交检索或问题<br/><kbd>F11</kbd> 切换全屏<br/><kbd>Esc</kbd> 退出全屏、专注模式或关闭弹窗</p></section></div><div className="settings-footer" style={{marginTop:25}}><Button icon={Library} onClick={()=>onNavigate('library')}>回到文献库</Button><Button icon={Settings} onClick={()=>onNavigate('settings')}>打开设置</Button></div></div></div>
}

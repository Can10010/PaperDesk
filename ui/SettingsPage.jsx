import React, { useEffect, useMemo, useState } from 'react';
import { Plus, Trash2, Save, LoaderCircle, CheckCircle2, AlertCircle, Server, BrainCircuit, Waypoints, Terminal, Copy, Check, LockKeyhole, HardDrive, ChevronRight, Play } from 'lucide-react';
import './settings.css';

async function api(url, options = {}) {
  let response;
  try { response = await fetch(url, { credentials: 'same-origin', ...options, headers: { 'Content-Type': 'application/json', ...options.headers }, ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }) }); }
  catch { throw new Error('无法连接本地 PaperDesk 服务，请确认程序仍在运行。'); }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error?.message || data.error || `请求失败（${response.status}）`);
  return data;
}
const freshConfig = () => ({ version: 1, providers: [], models: [], tasks: { answer: '', query: '', embedding: '' } });
const uid = prefix => `${prefix}-${crypto.randomUUID()}`;
const taskDetails = [
  { id: 'answer', name: '文献问答', kind: 'chat', label: '需要时启用', description: '阅读检索到的文献和笔记，整合回答并附上来源。选择擅长推理与长文本理解的对话模型。', empty: '暂不启用问答' },
  { id: 'query', name: '检索词扩展', kind: 'chat', label: '可选', description: '问答前将问题转成中英文检索词，帮助找到英文论文。可选较快的对话模型，每次问答额外调用一次。', empty: '使用原始问题检索' },
  { id: 'embedding', name: '语义检索', kind: 'embedding', label: '可选', description: '用向量匹配含义相近的文献与笔记。选择支持相应语言的嵌入模型，保存后在知识库点击“更新知识库”。', empty: '只使用关键词索引' },
];
function Button({ children, icon: Icon, busy, className = '', ...props }) { return <button type="button" className={`button ${className}`} {...props} disabled={busy || props.disabled}>{busy ? <LoaderCircle size={15} className="spin" /> : Icon ? <Icon size={15} /> : null}{children}</button>; }
function CopyButton({ value, children = '复制' }) {
  const [copied, setCopied] = useState(false), [error, setError] = useState('');
  return <span className="pd-copy"><Button icon={copied ? Check : Copy} disabled={!value} onClick={async () => { try { await navigator.clipboard.writeText(value); setCopied(true); setError(''); setTimeout(() => setCopied(false), 1800); } catch { setError('复制失败，请手动选择文本。'); } }}>{copied ? '已复制' : children}</Button>{error && <small role="alert">{error}</small>}</span>;
}
function SectionHeading({ number, icon: Icon, title, children, action }) { return <div className="pd-section-heading"><span className="pd-step-number">{number || <Icon size={18} />}</span><div><h2>{title}</h2><p>{children}</p></div>{action}</div>; }

export default function SettingsPage({ auth, notify = () => {}, onSaved = () => {} }) {
  const [settings, setSettings] = useState(null), [config, setConfig] = useState(freshConfig), [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [testing, setTesting] = useState(''), [testResults, setTestResults] = useState({});
  const [tokenBusy, setTokenBusy] = useState(false), [token, setToken] = useState(''), [password, setPassword] = useState({ currentPassword: '', password: '' }), [passwordBusy, setPasswordBusy] = useState(false);
  async function load() {
    const data = await api('/api/settings');
    setSettings(data); setConfig(data.modelConfig || freshConfig()); setDirty(false);
  }
  useEffect(() => { load().catch(e => setError(e.message)); }, []);
  const update = fn => { setConfig(current => fn(current)); setDirty(true); setError(''); setTestResults({}); };
  const setProvider = (id, patch) => update(current => ({ ...current, providers: current.providers.map(provider => provider.id === id ? { ...provider, ...patch } : provider) }));
  const setModel = (id, patch) => update(current => {
    const tasks = { ...current.tasks };
    if (patch.kind) for (const role of taskDetails) if (tasks[role.id] === id && role.kind !== patch.kind) tasks[role.id] = '';
    return { ...current, tasks, models: current.models.map(model => model.id === id ? { ...model, ...patch } : model) };
  });
  function removeModels(current, ids) { return { ...current, models: current.models.filter(model => !ids.includes(model.id)), tasks: Object.fromEntries(Object.entries(current.tasks).map(([role, id]) => [role, ids.includes(id) ? '' : id])) }; }
  async function save() {
    setBusy(true); setError('');
    try { await api('/api/settings', { method: 'PUT', body: { modelConfig: config } }); await load(); notify('模型连接与任务分配已保存'); onSaved(); }
    catch (e) { setError(e.message); notify(e.message, 'error'); } finally { setBusy(false); }
  }
  async function test(modelId) {
    setTesting(modelId); setTestResults(current => ({ ...current, [modelId]: null }));
    try { const result = await api('/api/models/test', { method: 'POST', body: { config, modelId } }); setTestResults(current => ({ ...current, [modelId]: { ok: true, message: `${result.message} 耗时 ${(result.latencyMs / 1000).toFixed(1)} 秒。` } })); }
    catch (e) { setTestResults(current => ({ ...current, [modelId]: { ok: false, message: e.message } })); } finally { setTesting(''); }
  }
  const hermes = settings?.hermes;
  const mcpConfig = useMemo(() => hermes?.command && hermes?.scriptPath && hermes?.tokenFile ? [
    'mcp_servers:', '  paperdesk:', `    command: ${JSON.stringify(hermes.command)}`, '    args:', `      - ${JSON.stringify(hermes.scriptPath)}`, '    env:', `      PAPERDESK_URL: ${JSON.stringify(hermes.url)}`, `      PAPERDESK_TOKEN_FILE: ${JSON.stringify(hermes.tokenFile)}`,
  ].join('\n') : '', [hermes]);
  if (!settings) return <div className="pane-loading">{error ? <div role="alert">{error}<Button onClick={() => load().catch(e => setError(e.message))}>重新加载</Button></div> : <><LoaderCircle size={18} className="spin" />正在读取设置…</>}</div>;
  return <div className="scroll-page pd-settings">
    <header className="page-header"><div><span className="eyebrow">YOUR RESEARCH WORKSPACE</span><h1>设置</h1><p>连接模型，让工具适应你的研究方式。</p></div><Button icon={Save} busy={busy} className="primary" onClick={save} disabled={!dirty}>保存模型设置</Button></header>
    <div className="pd-settings-body">
      <div className="pd-settings-intro"><BrainCircuit size={21} /><div><strong>先连接服务，再添加模型，最后分配任务。</strong><p>只想整理与全文搜索时，可以全部留空。一个服务商可添加多个模型，同一模型也能承担多个任务。</p></div></div>
      {dirty && <div className="pd-unsaved" role="status">模型设置有未保存的更改。测试连接不会保存；完成后点击“保存模型设置”。</div>}
      {error && <div className="pd-feedback error" role="alert"><AlertCircle size={16} />{error}</div>}

      <section className="pd-setting-section">
        <SectionHeading number="1" title="连接服务商" action={<Button icon={Plus} onClick={() => update(current => ({ ...current, providers: [...current.providers, { id: uid('provider'), name: '我的模型服务', baseUrl: '', apiKey: '' }] }))}>添加服务商</Button>}>服务商决定“请求发到哪里”，API Key 是这个服务的访问凭证。</SectionHeading>
        {!config.providers.length && <div className="pd-config-empty"><Server size={23} /><p>还没有模型服务。点击“添加服务商”，填入你已有服务的兼容接口地址。</p></div>}
        {config.providers.map((provider, index) => <article className="pd-config-card" key={provider.id}>
          <div className="pd-card-top"><span>服务商 {index + 1}</span><button className="icon-button" title="移除此服务商及关联模型，保存后生效" aria-label={`移除服务商 ${provider.name}`} onClick={() => update(current => { const next = removeModels(current, current.models.filter(model => model.providerId === provider.id).map(model => model.id)); return { ...next, providers: next.providers.filter(item => item.id !== provider.id) }; })}><Trash2 size={16} /></button></div>
          <div className="pd-form-grid"><label className="pd-field">显示名称<input value={provider.name} maxLength={100} onChange={e => setProvider(provider.id, { name: e.target.value })} placeholder="例如：我的云端服务" /><small>自己起的名字，便于区分多个服务。</small></label><label className="pd-field">Base URL · 接口地址<input type="url" value={provider.baseUrl} onChange={e => setProvider(provider.id, { baseUrl: e.target.value })} placeholder="https://api.example.com/v1" spellCheck={false} /><small>从服务商的兼容 OpenAI 文档复制，通常以 /v1 结尾。</small></label></div>
          <label className="pd-field">API Key<input type="password" autoComplete="new-password" value={provider.apiKey || ''} onChange={e => setProvider(provider.id, { apiKey: e.target.value, clearApiKey: false })} placeholder={provider.hasApiKey && !provider.clearApiKey ? '已保存；留空保留现有密钥' : '填写服务商密钥；无需鉴权的本地服务可留空'} spellCheck={false} /><small>密钥只保存在当前设备，不通过文献同步。请填写 API 密钥，不是网页登录密码。</small></label>
          {provider.hasApiKey && <label className="pd-checkbox"><input type="checkbox" checked={!!provider.clearApiKey} onChange={e => setProvider(provider.id, { clearApiKey: e.target.checked, ...(e.target.checked ? { apiKey: '' } : {}) })} />保存时清除这个服务商的已有密钥</label>}
        </article>)}
        <details className="pd-explainer"><summary>第一次配置：接口地址、密钥和模型 ID 怎么找？</summary><ol><li>登录你选择的模型服务商网站，进入 API 或开发者控制台。</li><li>在“API Key / 密钥”中创建密钥；回到这里填入密钥栏。</li><li>打开该服务的“兼容 OpenAI / Chat Completions”接入文档，复制 Base URL。不要复制聊天网页地址。</li><li>在服务商模型列表中复制可用的模型 ID，下一步填写。显示名称可自己起，模型 ID 必须与服务商一致。</li></ol><p>当前支持兼容 OpenAI 的 chat/completions 与 embeddings 接口。仅提供其它协议的服务需要兼容网关；这里不要求额外安装服务。</p></details>
      </section>

      <section className="pd-setting-section">
        <SectionHeading number="2" title="添加模型实例" action={<Button icon={Plus} disabled={!config.providers.length} onClick={() => update(current => ({ ...current, models: [...current.models, { id: uid('model'), name: '我的模型', providerId: current.providers[0].id, model: '', kind: 'chat' }] }))}>添加模型</Button>}>模型 ID 决定“调用哪一个模型”。同一服务商下可添加问答模型和嵌入模型。</SectionHeading>
        {!config.models.length && <div className="pd-config-empty"><BrainCircuit size={23} /><p>{config.providers.length ? '添加你准备使用的模型，再用“测试模型”检查地址、密钥和模型 ID。' : '先完成上面的服务商连接信息。'}</p></div>}
        {config.models.map((model, index) => <article className="pd-config-card" key={model.id}>
          <div className="pd-card-top"><span>模型 {index + 1}</span><button className="icon-button" title="移除此模型，保存后生效" aria-label={`移除模型 ${model.name}`} onClick={() => update(current => removeModels(current, [model.id]))}><Trash2 size={16} /></button></div>
          <div className="pd-form-grid"><label className="pd-field">显示名称<input value={model.name} maxLength={100} onChange={e => setModel(model.id, { name: e.target.value })} placeholder="例如：研究问答、快速检索、多语言向量" /></label><label className="pd-field">所属服务商<select value={model.providerId} onChange={e => setModel(model.id, { providerId: e.target.value })}>{config.providers.map(provider => <option key={provider.id} value={provider.id}>{provider.name || '未命名服务商'}</option>)}</select></label></div>
          <div className="pd-form-grid"><label className="pd-field">模型 ID<input value={model.model} maxLength={300} onChange={e => setModel(model.id, { model: e.target.value })} placeholder="复制服务商列出的精确模型 ID" spellCheck={false} /><small>同一名称在不同服务商上可能有不同 ID。</small></label><label className="pd-field">模型类型<select value={model.kind} onChange={e => setModel(model.id, { kind: e.target.value })}><option value="chat">对话模型 · 问答／检索词</option><option value="embedding">嵌入模型 · 向量检索</option></select><small>嵌入模型返回向量，不能直接用来回答问题。</small></label></div>
          <div className="pd-test-row"><span>发送一条简短测试请求，可能产生少量 API 费用。</span><Button icon={Play} busy={testing === model.id} disabled={!!testing || !model.model} onClick={() => test(model.id)}>测试模型</Button></div>
          {testResults[model.id] && <div className={`pd-feedback ${testResults[model.id].ok ? 'success' : 'error'}`} role="status">{testResults[model.id].ok ? <CheckCircle2 size={16} /> : <AlertCircle size={16} />}{testResults[model.id].message}</div>}
        </article>)}
      </section>

      <section className="pd-setting-section">
        <SectionHeading number="3" title="分配研究任务">按用途选择，不必填满。问答和检索词扩展可以使用同一个模型。</SectionHeading>
        <div className="pd-role-list">{taskDetails.map(task => <div className="pd-role" key={task.id}><div><h3>{task.name}<span>{task.label}</span></h3><p>{task.description}</p></div><select aria-label={`${task.name}使用的模型`} value={config.tasks[task.id] || ''} onChange={e => update(current => ({ ...current, tasks: { ...current.tasks, [task.id]: e.target.value } }))}><option value="">{task.empty}</option>{config.models.filter(model => model.kind === task.kind).map(model => <option key={model.id} value={model.id}>{model.name || '未命名模型'}</option>)}</select></div>)}</div>
        <div className="pd-settings-footnote"><Waypoints size={16} /><p>全文搜索始终可离线使用。文献问答会按分配调用模型；语义知识库构建会把分块发送给嵌入服务。扫描版 PDF 请先用外部 OCR 转为带文字层的 PDF，再导入。</p></div>
        <div className="pd-save-row"><span>{dirty ? '更改尚未保存' : '设置已保存'}</span><Button className="primary" icon={Save} busy={busy} onClick={save} disabled={!dirty}>保存模型设置</Button></div>
      </section>

      <section className="pd-setting-section" id="hermes-settings">
        <SectionHeading icon={Terminal} title="让 Hermes 使用文献库">在 QQ 想到一个问题时，让你现有的 Hermes 帮你查论文、读原文、记下灵感。</SectionHeading>
        <div className="pd-scenarios"><div><strong>查资料</strong><p>“查一下文献库中关于 DOA estimation 的论文，给我页码。”</p></div><div><strong>讨论后保存</strong><p>“把我们刚才讨论的实验想法，追加到这篇论文的笔记。”</p></div></div>
        <ol className="pd-hermes-steps"><li><div><h3>在 Hermes 所在电脑打开 PaperDesk</h3><p>先导入或手动同步资料。Hermes 与 QQ 的连接沿用你已有的配置，这里不需要 QQ 密码或密钥。</p></div></li><li><div><h3>生成文献库访问令牌</h3><p>令牌允许 Hermes 读写当前文献库，与登录密码不同。自动保存到下方文件，不必把令牌粘进配置。</p><div className="pd-token-row"><span>{settings.apiTokenPreview ? `已生成：${settings.apiTokenPreview}` : '尚未生成'}</span><Button icon={LockKeyhole} busy={tokenBusy} onClick={async () => { setTokenBusy(true); try { const result = await api('/api/integrations/token', { method: 'POST', body: {} }); setToken(result.token); setSettings(current => ({ ...current, apiTokenPreview: result.token.slice(0, 6) + '…' + result.token.slice(-4) })); notify('Hermes 令牌已保存到本机文件'); } catch (e) { notify(e.message, 'error'); } finally { setTokenBusy(false); } }}>{settings.apiTokenPreview ? '更新令牌' : '生成令牌'}</Button></div>{hermes?.tokenFile && <code className="pd-path">{hermes.tokenFile}</code>}{token && <details className="pd-explainer"><summary>需要手动提供令牌时</summary><p>仅交给你自己的 Hermes，不要发到群聊。</p><CopyButton value={token}>复制当前令牌</CopyButton></details>}</div></li><li><div><h3>把这段连接信息加入 Hermes</h3><p>在 Hermes 的 MCP 服务设置中加入下面的配置，保留已有服务，然后重新加载 MCP 连接。路径属于当前这台电脑。</p>{mcpConfig ? <><pre className="pd-code">{mcpConfig}</pre><CopyButton value={mcpConfig}>复制 MCP 配置</CopyButton></> : <p>当前服务尚未返回安装路径，请更新 PaperDesk 后重新打开设置。</p>}<details className="pd-explainer"><summary>Hermes 在另一台电脑或 Docker 里？</summary><p>最简单的方式是在 Hermes 所在电脑安装 PaperDesk，再同步文献。Docker 中的命令和脚本必须是容器可访问的路径，不能直接使用 Windows 路径。跨设备即时调用可使用 SSH 隧道，详见安装目录 docs/HERMES.md。</p></details></div></li><li><div><h3>让 Hermes 验证一次</h3><p>对 Hermes 说“调用 PaperDesk 的 list_papers，列出我的论文”。能读到论文后，再试“搜索论文并引用页码”。PaperDesk 未配置问答模型时，Hermes 也可用自己的模型分析检索资料。</p></div></li></ol>
      </section>

      <section className="pd-setting-section"><SectionHeading icon={HardDrive} title="本地资料库">文献、Markdown 笔记与本机配置保存在这里。</SectionHeading><code className="pd-path">{settings.dataDir}</code><p className="pd-small">跨设备工作可用左侧“同步”。备份时先停止后台服务，再复制整个资料库目录。</p></section>
      <section className="pd-setting-section"><SectionHeading icon={LockKeyhole} title={`账户 · ${auth?.username || ''}`}>允许简单密码。已记住登录时无需每次输入。修改密码会撤销本机同步配对；请在其他设备分别改成相同新密码，再重新配对。加密文件夹同步须改用一个新的空文件夹，重新发布文献，旧同步包请保留作备份。</SectionHeading><div className="pd-form-grid"><label className="pd-field">当前密码<input type="password" autoComplete="current-password" value={password.currentPassword} onChange={e => setPassword(current => ({ ...current, currentPassword: e.target.value }))} /></label><label className="pd-field">新密码<input type="password" autoComplete="new-password" value={password.password} onChange={e => setPassword(current => ({ ...current, password: e.target.value }))} /></label></div><div className="pd-save-row"><Button busy={passwordBusy} disabled={!password.password || !password.currentPassword} onClick={async () => { setPasswordBusy(true); try { await api('/api/auth/change-password', { method: 'POST', body: password }); setPassword({ currentPassword: '', password: '' }); notify('当前设备的密码已更新'); } catch (e) { notify(e.message, 'error'); } finally { setPasswordBusy(false); } }}>更新密码</Button></div></section>
    </div>
  </div>;
}

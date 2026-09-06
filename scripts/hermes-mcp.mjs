#!/usr/bin/env node
// MCP stdio bridge. Keep stdout exclusively for JSON-RPC messages.
import { readFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { pathToFileURL } from 'node:url';

const schema = (properties, required = []) => ({ type: 'object', properties, required, additionalProperties: false });
const text = description => ({ type: 'string', description });
const id = text('PaperDesk 文献 ID，由 list_papers 或 search_papers 返回。');
const readonly = { readOnlyHint: true, destructiveHint: false, openWorldHint: false };
export const MCP_TOOLS = [
  { name: 'list_papers', description: '列出当前用户文献库中的论文元数据，了解可用资料。', inputSchema: schema({}), annotations: readonly },
  { name: 'search_papers', description: '离线全文检索已导入论文与 Markdown 笔记；返回原文片段、论文 ID 与页码。请以结果为依据引用。', inputSchema: schema({ query: text('查询词，英文论文优先用英文关键词。'), limit: { type: 'integer', minimum: 1, maximum: 30 } }, ['query']), annotations: readonly },
  { name: 'read_paper', description: '读取一篇论文的元数据和按页分块的全文；可指定 page 仅取该页。', inputSchema: schema({ paperId: id, page: { type: 'integer', minimum: 1 } }, ['paperId']), annotations: readonly },
  { name: 'read_note', description: '读取一篇论文的 Markdown 笔记。', inputSchema: schema({ paperId: id }, ['paperId']), annotations: readonly },
  { name: 'write_note', description: '把用户要求保存的想法写入论文 Markdown 笔记。默认追加；只有用户明确要求覆盖整篇笔记时使用 replace。不要擅自记录或改写用户笔记。', inputSchema: schema({ paperId: id, markdown: text('Markdown 格式内容。'), mode: { type: 'string', enum: ['append', 'replace'], default: 'append' } }, ['paperId', 'markdown']), annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false } },
  { name: 'ask_library', description: '调用 PaperDesk 配置的大模型基于文献片段回答，并附论文和页码。此操作会向用户设置的模型服务发送问题及检索片段。若未配置模型，应改用 search_papers/read_paper 由 Hermes 分析。', inputSchema: schema({ question: text('研究问题。') }, ['question']), annotations: { ...readonly, openWorldHint: true } },
  { name: 'import_paper', description: '把用户明确指定的、PaperDesk 所在电脑上的一个 PDF 文件导入文献库，自动去重、识别标题并建立全文索引。文件路径必须来自用户的要求。', inputSchema: schema({ path: text('PaperDesk 所在电脑可访问的 PDF 绝对路径。') }, ['path']), annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false } },
];

export function createBridge({ baseUrl = process.env.PAPERDESK_URL || 'http://127.0.0.1:47821', token = process.env.PAPERDESK_TOKEN, tokenFile = process.env.PAPERDESK_TOKEN_FILE, fetchImpl = fetch } = {}) {
  const base = new URL(baseUrl);
  if (!['http:', 'https:'].includes(base.protocol)) throw new Error('PAPERDESK_URL 必须是 http 或 https 地址。');
  const getToken = () => {
    if (token) return token.trim();
    if (tokenFile) return readFileSync(tokenFile, 'utf8').trim();
    throw new Error('未设置 PAPERDESK_TOKEN 或 PAPERDESK_TOKEN_FILE。请在 PaperDesk 设置中生成 Hermes 访问令牌。');
  };
  const api = async (route, method = 'GET', body) => {
    const response = await fetchImpl(new URL(route, base), {
      method, headers: { Authorization: `Bearer ${getToken()}`, 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(130000),
    });
    const payload = await response.json().catch(() => ({ error: 'PaperDesk API 返回的不是 JSON。' }));
    if (!response.ok) throw new Error(payload.error || payload.message || `PaperDesk 请求失败（HTTP ${response.status}）。`);
    return payload;
  };
  const callTool = async (name, args = {}) => {
    const definition = MCP_TOOLS.find(tool => tool.name === name);
    if (!definition) throw new Error(`未知工具：${name}`);
    for (const key of definition.inputSchema.required) if (typeof args[key] !== 'string' || !args[key].trim()) throw new Error(`参数 ${key} 不能为空。`);
    const paperPath = `/api/papers/${encodeURIComponent(args.paperId || '')}`;
    switch (name) {
      case 'list_papers': return api('/api/papers');
      case 'search_papers': return api(`/api/search?q=${encodeURIComponent(args.query)}&limit=${Math.min(30, Math.max(1, Number(args.limit) || 10))}`);
      case 'read_paper': {
        const data = await api(paperPath + '/text' + (args.page ? '?page=' + encodeURIComponent(args.page) : ''));
        if (args.page) {
          const paper = data.paper || data;
          const filtered = { ...paper, chunks: (paper.chunks || []).filter(chunk => chunk.page === Number(args.page)) };
          return data.paper ? { ...data, paper: filtered } : filtered;
        }
        return data;
      }
      case 'read_note': return api(paperPath + '/note');
      case 'write_note': {
        if (args.mode && !['append', 'replace'].includes(args.mode)) throw new Error('mode 应为 append 或 replace。');
        let markdown = args.markdown;
        const current = await api(paperPath + '/note');
        if (args.mode !== 'replace') {
          if (current.markdown?.trim()) markdown = current.markdown.trimEnd() + '\n\n' + markdown;
        }
        return api(paperPath + '/note', 'PUT', { markdown, baseMarkdown:current.markdown || '' });
      }
      case 'ask_library': return api('/api/ask', 'POST', { question: args.question });
      case 'import_paper': return api('/api/papers/import-path', 'POST', { path: args.path });
    }
  };
  return async function handle(request) {
    if (!request || request.jsonrpc !== '2.0' || typeof request.method !== 'string') return { jsonrpc: '2.0', id: request?.id ?? null, error: { code: -32600, message: 'Invalid JSON-RPC request' } };
    if (request.id === undefined) return null;
    const result = value => ({ jsonrpc: '2.0', id: request.id, result: value });
    switch (request.method) {
      case 'initialize': {
        const supported = ['2024-11-05', '2025-03-26', '2025-06-18', '2025-11-25'];
        return result({ protocolVersion: supported.includes(request.params?.protocolVersion) ? request.params.protocolVersion : '2025-03-26', capabilities: { tools: { listChanged: false } }, serverInfo: { name: 'paperdesk', version: '1.0.0' }, instructions: 'PaperDesk 是用户的个人文献库。先检索与阅读，再基于原文回答。引用论文标题和页码。只有用户要求保存时才写笔记。' });
      }
      case 'ping': return result({});
      case 'tools/list': return result({ tools: MCP_TOOLS });
      case 'tools/call':
        try {
          const data = await callTool(request.params?.name, request.params?.arguments || {});
          return result({ content: [{ type: 'text', text: JSON.stringify(data) }], isError: false });
        } catch (error) {
          let message = error.message;
          if (error.cause?.code === 'ECONNREFUSED') message = '无法连接 PaperDesk。请启动工位机上的 PaperDesk 或后台服务。';
          return result({ content: [{ type: 'text', text: message }], isError: true });
        }
      default: return { jsonrpc: '2.0', id: request.id, error: { code: -32601, message: `Method not found: ${request.method}` } };
    }
  };
}

export function runStdio() {
  const handle = createBridge();
  const input = createInterface({ input: process.stdin, crlfDelay: Infinity });
  let queue = Promise.resolve();
  input.on('line', line => {
    queue = queue.then(async () => {
      let result;
      try {
        if (line.length > 4 * 1024 * 1024) throw new Error('Message too large');
        const request = JSON.parse(line);
        result = Array.isArray(request) ? (await Promise.all(request.map(handle))).filter(Boolean) : await handle(request);
        if (Array.isArray(result) && !result.length) result = null;
      } catch {
        result = { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } };
      }
      if (result) process.stdout.write(JSON.stringify(result) + '\n');
    }).catch(error => process.stderr.write(`PaperDesk MCP: ${error.message}\n`));
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) runStdio();


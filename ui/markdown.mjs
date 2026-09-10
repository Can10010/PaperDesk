import {Marked} from 'marked';
import katex from 'katex';

const escape = text => text.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function formula(source, display) {
  try {
    return katex.renderToString(source, {displayMode: display, throwOnError: true, trust: false, strict: 'ignore', maxExpand: 1000, maxSize: 20, output: 'htmlAndMathml'});
  } catch {
    return `<code class="math-error" title="公式语法或命令暂不支持；请查看 Markdown 语法帮助">${escape(source)}</code>`;
  }
}
const markdown = new Marked({gfm: true, breaks: true});
// Tokenize math before Markdown so backslashes, underscores and matrix rows survive.
markdown.use({extensions: [{
  name: 'displayMath', level: 'block',
  start(src) { return src.search(/(?:^|\n) {0,3}(?:\$\$|\\\[)/); },
  tokenizer(src) {
    const match = /^(?: {0,3}\$\$([\s\S]+?)\$\$| {0,3}\\\[([\s\S]+?)\\\])(?:[ \t]*(?:\n|$))/.exec(src);
    if (match) return {type:'displayMath', raw:match[0], text:match[1] ?? match[2]};
  },
  renderer(token) { return formula(token.text, true) + '\n'; }
}, {
  name: 'inlineMath', level: 'inline',
  start(src) { return src.search(/\$|\\[([]/); },
  tokenizer(src) {
    const match = /^(?:\$\$([^\n]+?)\$\$|\\\[([^\n]+?)\\\]|\\\(([^\n]+?)\\\)|\$(?!\s|\$)((?:\\.|[^$\\\n])+?)(?<!\s)\$(?!\d))/.exec(src);
    if (match) return {type:'inlineMath', raw:match[0], text:match[1] ?? match[2] ?? match[3] ?? match[4], display:match[1] !== undefined || match[2] !== undefined};
  },
  renderer(token) { return formula(token.text, token.display); }
}]});
export const renderMarkdown = text => markdown.parse(text || '');
export const markdownHelp = String.raw`## 编辑与预览
“编辑”显示 Markdown 源码；“分栏”边写边看渲染；“预览”只显示排版。预览不是自动改写原文。

### 常用语法
- 标题：行首写 \`# 标题\` 或 \`## 小标题\`，井号后留一个半角空格。
- 列表：\`- 条目\`；任务：\`- [ ] 待办\`、\`- [x] 完成\`。
- 粗体：\`**重点**\`；斜体：\`*说明*\`；引用：行首写 \`> 引文\`。
- 链接：\`[名称](https://example.com)\`；本库文献链接可在“信息”中复制。
- 表格必须包含表头分隔行，例如 \`| --- | --- |\`。
- 空一行开始新段落。行首四个空格会成为代码块；代码块中的语法不会渲染。
- 使用英文半角标点；\`＃\`、\`＊\` 等全角符号是普通文字。

### 科研公式
行内写 \`$E=mc^2$\` 或 \`\(E=mc^2\)\`；独立公式用两行 \`$$\` 包住公式，或使用 \`\[ ... \]\`。公式在本机离线渲染。

$$
\frac{1}{N}\sum_{i=1}^{N} x_i
$$

矩阵可写 \`\begin{bmatrix}a & b \\ c & d\end{bmatrix}\`。不要把公式放在反引号代码块里；普通金额可写 \`\$100\`。公式有错误或不支持的命令时保留源码并标红，可悬停查看提示。

### 保存
停止输入约 1 秒自动保存到本机；中文输入法组词时不提交。Ctrl+S 可立即保存，切换文献和退出前也会等待保存。底部显示待保存、保存中、已保存或失败状态。失败后原文留在编辑器中，可点击保存重试；浏览器关闭时会提醒未保存内容。同步仍需手动发起。

### 与 Obsidian 的区别
支持常见 Markdown、表格、任务列表和公式；暂不支持 Obsidian 插件、\`[[双链]]\`、\`==高亮==\`、callout 和 Mermaid 图。可用普通链接、粗体和引用替代。
`.replace(/\\`/g, '\x60');

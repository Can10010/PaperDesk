import test from 'node:test';
import assert from 'node:assert/strict';
import {renderMarkdown, markdownHelp} from '../ui/markdown.mjs';
test('Markdown renders headings, tables, tasks and all four math delimiters', () => {
  const text = String.raw`# 标题

| A | B |
| --- | --- |
| x | y |

- [x] 完成

$x_i^2$ 与 \(\frac{a}{b}\)

$$
\begin{bmatrix}a & b \\ c & d\end{bmatrix}
$$

\[
\sum_{i=1}^{N} x_i
\]
`;
  const html = renderMarkdown(text);
  for (const tag of ['<h1>', '<table>', 'type="checkbox"', 'katex-mathml', '<msub>', '<mfrac>', '<mtable']) assert.ok(html.includes(tag), tag);
  assert.equal((html.match(/class="katex"/g) || []).length, 4);
  assert.ok(!html.includes('math-error'));
});
test('code examples and escaped money stay literal; errors do not crash preview', () => {
  assert.ok(!renderMarkdown('`$x$`\n\n```tex\n\\(x\\)\n```\n\n\\$100').includes('class="katex"'));
  assert.ok(renderMarkdown('$\\unknowncommand$').includes('math-error'));
  assert.ok(!renderMarkdown('$\\href{javascript:alert(1)}{X}$').includes('href="javascript:'));
  assert.ok(renderMarkdown(markdownHelp).includes('<code>'));
});


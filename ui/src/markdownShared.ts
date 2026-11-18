import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeHighlight from 'rehype-highlight';
import rehypeKatex from 'rehype-katex';
import rehypeRaw from 'rehype-raw';
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize';
import type { PluggableList } from 'unified';

export const markdownSanitizeSchema = {
  ...defaultSchema,
  attributes: {
    ...defaultSchema.attributes,
    code: [['className', /^language-./, 'math-inline', 'math-display']],
  },
};

export const REMARK_PLUGINS: PluggableList = [remarkGfm, remarkMath];

const KATEX_OPTIONS = { trust: false, maxExpand: 1000, maxSize: 10 };

const HIGHLIGHT_SUBSET = [
  'bash', 'c', 'cpp', 'csharp', 'css', 'diff', 'go', 'html',
  'java', 'javascript', 'json', 'kotlin', 'markdown', 'php',
  'powershell', 'python', 'rust', 'shell', 'sql', 'typescript',
  'xml', 'yaml',
];

const HIGHLIGHT_OPTIONS = { detect: false, subset: HIGHLIGHT_SUBSET };

export const BASE_REHYPE_PLUGINS: PluggableList = [
  rehypeRaw,
  [rehypeSanitize, markdownSanitizeSchema],
  [rehypeKatex, KATEX_OPTIONS],
  [rehypeHighlight, HIGHLIGHT_OPTIONS],
];

export function scrollToMarkdownAnchor(href: string) {
  try {
    const id = decodeURIComponent(href.slice(1));
    const target = document.getElementById(id) || document.getElementById(`user-content-${id}`);
    target?.scrollIntoView({ block: 'nearest' });
  } catch {
    // Malformed percent-encoding in anchor href: ignore safely.
  }
}

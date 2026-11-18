import { memo } from 'react';
import Markdown, { type Components } from 'react-markdown';
import MarkdownImage from './MarkdownImage';
import { send } from './bridge';
import { t, useLang } from './i18n';
import { BASE_REHYPE_PLUGINS, REMARK_PLUGINS, scrollToMarkdownAnchor } from './markdownShared';
import 'katex/dist/katex.min.css';
import './markdown.css';

const defaultOpen = (url: string) => send({ type: 'tab.open', url });

const MarkdownContent = memo(function MarkdownContent({
  text,
  onOpen = defaultOpen,
}: {
  text: string;
  onOpen?: (url: string) => void;
}) {
  useLang();
  const components: Components = {
    a: ({ href, children, node: _node, ...props }) => (
      <a
        {...props}
        href={href}
        onClick={e => {
          e.preventDefault();
          if (href?.startsWith('#')) scrollToMarkdownAnchor(href);
          else if (href && /^https?:\/\//i.test(href)) onOpen(href);
        }}
      >
        {children}
      </a>
    ),
    img: ({ src, alt }) => <MarkdownImage src={src} alt={alt} />,
    table: ({ children }) => (
      <div className="markdown-table" tabIndex={0}>
        <table>{children}</table>
      </div>
    ),
  };

  return (
    <div className="sol-markdown">
      <Markdown
        remarkPlugins={REMARK_PLUGINS}
        remarkRehypeOptions={{
          footnoteLabel: t('Notes', 'Notes'),
          footnoteBackLabel: t('Retour à la référence', 'Back to reference'),
        }}
        rehypePlugins={BASE_REHYPE_PLUGINS}
        components={components}
      >
        {text}
      </Markdown>
    </div>
  );
});

export default MarkdownContent;

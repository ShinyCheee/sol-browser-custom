import { createContext, memo, useContext, useMemo, type ComponentPropsWithoutRef } from 'react';
import Markdown, { type Components, type ExtraProps } from 'react-markdown';
import type { Root, RootContent } from 'hast';
import type { PluggableList } from 'unified';
import { Checkbox } from '@/components/motion/checkbox';
import { send } from './bridge';
import { t, useLang } from './i18n';
import MarkdownImage from './MarkdownImage';
import { BASE_REHYPE_PLUGINS, REMARK_PLUGINS, scrollToMarkdownAnchor } from './markdownShared';
import { references, titleOf, toggleTask, type Note } from './notesModel';
import 'katex/dist/katex.min.css';
import './markdown.css';

const TaskContext = createContext<{ note: Note; change?: (text: string) => void } | null>(null);

function indexTasks() {
  return (tree: Root) => {
    let index = 0;
    const visit = (node: Root | RootContent) => {
      if (node.type === 'element' && node.tagName === 'input' && node.properties.type === 'checkbox') {
        node.properties['data-task-index'] = index++;
      }
      if ('children' in node) node.children.forEach(visit);
    };
    visit(tree);
  };
}

const NOTE_REHYPE_PLUGINS: PluggableList = [...BASE_REHYPE_PLUGINS, indexTasks];

// A stable renderer keeps keyboard focus and the check animation through autosave echoes.
function TaskCheckbox({ checked, node }: ComponentPropsWithoutRef<'input'> & ExtraProps) {
  const { note, change } = useContext(TaskContext)!;
  const index = Number(node?.properties['data-task-index']);
  return (
    <Checkbox
      className="sol-checkbox note-task-checkbox"
      checked={!!checked}
      disabled={!change}
      aria-label={t(`Tâche ${index + 1}`, `Task ${index + 1}`)}
      onCheckedChange={next => change?.(toggleTask(note.text, index, next))}
    />
  );
}

const NoteMarkdownContent = memo(function NoteMarkdownContent({
  note,
  all,
  change,
  edit,
}: {
  note: Note;
  all: Note[];
  change?: (text: string) => void;
  edit: (id: string) => void;
}) {
  useLang();
  const text = useMemo(() => {
    const links = references(note, all);
    return note.text.replace(/\[\[([^\]]+)\]\]/g, (full, name: string) => {
      const target = links.find(
        n => n.id === name || titleOf(n).toLocaleLowerCase() === name.toLocaleLowerCase(),
      );
      return target ? `[${name.replace(/[[\]\\]/g, '\\$&')}](#sol-note-${target.id})` : full;
    });
  }, [note, all]);

  const components: Components = useMemo(
    () => ({
      a: ({ href, children, node: _node, ...props }) => (
        <a
          {...props}
          href={href}
          onClick={e => {
            e.preventDefault();
            if (href?.startsWith('#sol-note-')) edit(href.slice(10));
            else if (href && /^https?:\/\//i.test(href)) send({ type: 'notes.link', url: href });
            else if (href?.startsWith('#')) scrollToMarkdownAnchor(href);
          }}
        >
          {children}
        </a>
      ),
      input: TaskCheckbox,
      img: ({ src, alt }) => <MarkdownImage src={src} alt={alt} />,
      table: ({ children }) => (
        <div className="markdown-table" tabIndex={0}>
          <table>{children}</table>
        </div>
      ),
    }),
    [edit],
  );

  return (
    <TaskContext value={{ note, change }}>
      <div className="sol-markdown">
        <Markdown
          remarkPlugins={REMARK_PLUGINS}
          remarkRehypeOptions={{
            footnoteLabel: t('Notes', 'Notes'),
            footnoteBackLabel: t('Retour à la référence', 'Back to reference'),
          }}
          rehypePlugins={NOTE_REHYPE_PLUGINS}
          components={components}
        >
          {text}
        </Markdown>
      </div>
    </TaskContext>
  );
});

export default NoteMarkdownContent;

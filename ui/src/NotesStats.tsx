import { t } from './i18n';
import { createdOf, type Note } from './notesModel';

export default function NotesStats({ items }: { items: Note[] }) {
  const active = items.filter(n => !n.deleted);
  const days = Array.from({ length: 84 }, (_, i) => {
    const date = new Date();
    date.setDate(date.getDate() - 83 + i);
    return date;
  });
  const count = (date: Date) => active.filter(n => new Date(createdOf(n)).toDateString() === date.toDateString()).length;
  const tags = [...new Set(active.flatMap(n => n.tags))]
    .map(tag => ({ tag, count: active.filter(n => n.tags.includes(tag)).length }))
    .sort((a, b) => b.count - a.count);

  const statNumbers: [string, number][] = [
    [t('Notes et idées', 'Notes and ideas'), active.length],
    [t('Tâches terminées', 'Completed tasks'), active.filter(n => n.kind === 'task' && n.reviewed).length],
    ['Tags', tags.length],
  ];

  return (
    <section className="notes-stats">
      <h2>{t('Votre carnet', 'Your notebook')}</h2>
      <div className="note-stat-numbers">
        {statNumbers.map(([label, total]) => (
          <div key={label}>
            <strong>{total}</strong>
            <span>{label}</span>
          </div>
        ))}
      </div>
      <h3>{t('Activité des 12 dernières semaines', 'Activity over the last 12 weeks')}</h3>
      <div className="note-heatmap">
        {days.map(date => {
          const dayCount = count(date);
          const unit = dayCount === 1 ? t('note', 'note') : t('notes', 'notes');
          return (
            <span
              key={date.toISOString()}
              title={`${date.toLocaleDateString()} · ${dayCount} ${unit}`}
              style={{ opacity: 0.15 + Math.min(dayCount, 5) * 0.17 }}
            />
          );
        })}
      </div>
      <h3>{t('Tags les plus utilisés', 'Most used tags')}</h3>
      {tags.slice(0, 15).map(({ tag, count: tagCount }) => (
        <div className="note-tag-stat" key={tag}>
          <span>#{tag}</span>
          <progress value={tagCount} max={active.length} />
          <span>{tagCount}</span>
        </div>
      ))}
    </section>
  );
}

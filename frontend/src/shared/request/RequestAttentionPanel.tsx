import { sectionClass, sectionHeadClass } from './format';

export default function RequestAttentionPanel({ items }: { items: string[] }) {
  if (!items.length) return null;

  return (
    <section className={sectionClass} aria-label="Attention" data-section="attention">
      <div className={sectionHeadClass}>
        <h2 className="text-sm font-semibold text-slate-900">Attention</h2>
      </div>
      <div className="divide-y divide-amber-100">
        {items.map((item) => (
          <p key={item} className="bg-amber-50/70 px-4 py-2.5 text-xs text-amber-800">
            {item}
          </p>
        ))}
      </div>
    </section>
  );
}

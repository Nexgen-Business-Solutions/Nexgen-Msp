import { TriangleAlert } from 'lucide-react';
import { sectionHeadClass } from './format';

export default function RequestAttentionPanel({ items }: { items: string[] }) {
  if (!items.length) return null;

  return (
    <section
      className="overflow-hidden rounded-2xl bg-amber-50/70 ring-1 ring-amber-200"
      aria-label="Attention"
      data-section="attention"
    >
      <div className={`${sectionHeadClass} border-amber-100`}>
        <h2 className="flex items-center gap-2 text-base font-semibold text-amber-900">
          <TriangleAlert size={16} className="text-amber-600" strokeWidth={1.75} />
          Attention
        </h2>
      </div>
      <div className="divide-y divide-amber-100">
        {items.map((item) => (
          <p key={item} className="px-5 py-3 text-[13px] text-amber-800">
            {item}
          </p>
        ))}
      </div>
    </section>
  );
}

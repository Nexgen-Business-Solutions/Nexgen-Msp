type Props = {
  page?: { rows: unknown[]; total: number; truncated: boolean } | null;
};

export default function TruncatedNote({ page }: Props) {
  if (!page?.truncated) return null;

  return (
    <p className="px-3 py-2 text-xs text-slate-500">
      Showing the first {page.rows.length} of {page.total}. Refine your search.
    </p>
  );
}

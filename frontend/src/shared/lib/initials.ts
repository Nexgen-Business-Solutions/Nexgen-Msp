/** The initials of a name, which is what a row has when it has no photograph. */
export const initialsOf = (name?: string | null, fallback = '?') => {
  const parts = (name ?? '').trim().split(/\s+/).filter(Boolean);

  if (parts.length === 0) return fallback;

  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
};

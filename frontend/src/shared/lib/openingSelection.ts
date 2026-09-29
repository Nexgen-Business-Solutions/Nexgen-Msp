export const recall = <T>(key: string): T | null => {
  try {
    const kept = window.localStorage.getItem(key);

    return kept ? (JSON.parse(kept) as T) : null;
  } catch {
    return null;
  }
};

export const remember = (key: string, value: unknown) => {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    return;
  }
};

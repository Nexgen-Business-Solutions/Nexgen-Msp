/** A return address is navigation data, never an arbitrary URL. */
export const safeMspRedirect = (value: unknown) => {
  if (typeof value !== 'string') return '/msp';

  const path = value.trim();
  const isMspPath = /^\/msp(?:[/?#]|$)/.test(path);
  const hasUnsafeCharacters = [...path].some((character) => {
    const code = character.charCodeAt(0);
    return character === '\\' || code < 32 || code === 127;
  });

  return isMspPath && !hasUnsafeCharacters ? path : '/msp';
};

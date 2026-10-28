/**
 * A MAC as it is being typed, punctuated the one way Parallels RAS reads it. Only
 * hexadecimal digits are kept, six octets at most, and the hyphens are put in as the
 * digits arrive — so a pasted `0a:ea:31:1a:95:bb` lands as `0A-EA-31-1A-95-BB` and nobody
 * has to type a separator. There is never a trailing hyphen, which is what lets a
 * backspace keep deleting. The server still decides what is valid; this only spares the
 * typist the punctuation.
 */
export const macAsTyped = (written: string) =>
  written
    .replace(/[^0-9A-Fa-f]/g, '')
    .slice(0, 12)
    .toUpperCase()
    .replace(/(.{2})(?=.)/g, '$1-');

import type { AccentId, Theme } from './types';

/** Picker order: Nexgen Blue (the DeployOps blue) first. Swatches are Tailwind's 500 shades. */
export const ACCENTS: Record<AccentId, Theme> = {
  blue: { id: 'blue', name: 'Nexgen Blue', swatch: '#2b7fff' },
  indigo: { id: 'indigo', name: 'Indigo', swatch: '#615fff' },
  violet: { id: 'violet', name: 'Violet', swatch: '#8e51ff' },
  emerald: { id: 'emerald', name: 'Emerald', swatch: '#00bc7d' },
  teal: { id: 'teal', name: 'Teal', swatch: '#00bba7' },
  amber: { id: 'amber', name: 'Amber', swatch: '#fe9a00' },
  rose: { id: 'rose', name: 'Rose', swatch: '#ff2056' },
  slate: { id: 'slate', name: 'Slate', swatch: '#62748e' },
};

export const DEFAULT_ACCENT: AccentId = 'blue';

/** Themes saved before the accent picker, mapped to the nearest accent. */
const LEGACY: Record<string, AccentId> = {
  light: 'blue',
  cool: 'blue',
  darkBlue: 'blue',
  lavender: 'violet',
  darkPurple: 'violet',
  mint: 'emerald',
  darkGreen: 'emerald',
  gray: 'slate',
  twilight: 'slate',
  warm: 'amber',
};

/** The accent for a saved value: an id, or a saved theme object of the old or new shape. */
export function resolveThemeId(saved: unknown): AccentId {
  const id =
    typeof saved === 'string'
      ? saved
      : saved && typeof saved === 'object' && typeof (saved as { id?: unknown }).id === 'string'
        ? (saved as { id: string }).id
        : '';
  if (id in ACCENTS) return id as AccentId;
  return LEGACY[id] ?? DEFAULT_ACCENT;
}

/** @deprecated the old name; kept so existing imports keep working. */
export const LOCAL_THEMES = ACCENTS;

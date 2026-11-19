export type AccentId = 'blue' | 'indigo' | 'violet' | 'emerald' | 'teal' | 'amber' | 'rose' | 'slate';

/** A theme is an accent colour over the same clean surfaces (see `[data-theme]` in index.css). */
export interface Theme {
  id: AccentId;
  name: string;
  /** The accent's 500 shade, for the picker swatch. */
  swatch: string;
}

export interface ThemeState {
  currentTheme: Theme;
  availableThemes: Theme[];
  applyTheme: (theme: Theme) => void;
  changeLocalTheme: (themeId: string) => void;
  /** Kept for older callers: the app background is always the clean one now. */
  getBackgroundClass: () => string;
  getDecorativeBlobs: () => string[];
  isDark: () => boolean;
  getPreviewClass: () => string;
}

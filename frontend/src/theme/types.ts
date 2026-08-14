export interface Theme {
  id: string;
  name: string;
  background?: string;
  decorativeBlobs?: string[];
  isDark?: boolean;
  preview?: string;
  loaderColor?: string;
}

export interface ThemeState {
  currentTheme: Theme;
  availableThemes: Theme[];
  applyTheme: (theme: Theme) => void;
  changeLocalTheme: (themeId: string) => void;
  getBackgroundClass: () => string;
  getDecorativeBlobs: () => string[];
  isDark: () => boolean;
  getPreviewClass: () => string;
}

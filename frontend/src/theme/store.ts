import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { Theme, ThemeState } from './types';
import { LOCAL_THEMES } from './constants';

const defaultTheme: Theme = LOCAL_THEMES.light;

export const useThemeStore = create<ThemeState>()(
  persist(
    (set, get) => ({
      currentTheme: defaultTheme,
      availableThemes: Object.values(LOCAL_THEMES),

      applyTheme: (theme: Theme) => {
        set({ currentTheme: theme });
        if (theme.isDark) {
          document.documentElement.classList.add('dark');
        } else {
          document.documentElement.classList.remove('dark');
        }
      },

      changeLocalTheme: (themeId: string) => {
        const theme = LOCAL_THEMES[themeId];
        if (theme) get().applyTheme(theme);
      },

      getBackgroundClass: () => get().currentTheme.background || 'bg-slate-50',

      getDecorativeBlobs: () => get().currentTheme.decorativeBlobs || [],

      isDark: () => Boolean(get().currentTheme.isDark),

      getPreviewClass: () => get().currentTheme.preview || 'bg-slate-200',
    }),
    {
      name: 'nexgen-msp-theme',
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({ currentTheme: state.currentTheme }),
    }
  )
);

export const initializeTheme = () => {
  const { currentTheme, applyTheme } = useThemeStore.getState();
  applyTheme(currentTheme);
};

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { Theme, ThemeState } from './types';
import { ACCENTS, DEFAULT_ACCENT, resolveThemeId } from './constants';

export const useThemeStore = create<ThemeState>()(
  persist(
    (set, get) => ({
      currentTheme: ACCENTS[DEFAULT_ACCENT],
      availableThemes: Object.values(ACCENTS),

      applyTheme: (theme: Theme) => {
        const accent = ACCENTS[resolveThemeId(theme)];
        set({ currentTheme: accent });
        // one light look; the old dark themes only ever toggled this class
        document.documentElement.classList.remove('dark');
        document.documentElement.dataset.theme = accent.id;
      },

      changeLocalTheme: (themeId: string) => {
        if (themeId in ACCENTS) get().applyTheme(ACCENTS[themeId as keyof typeof ACCENTS]);
      },

      getBackgroundClass: () => 'bg-slate-50',
      getDecorativeBlobs: () => [],
      isDark: () => false,
      getPreviewClass: () => 'bg-brand-500',
    }),
    {
      name: 'nexgen-msp-theme',
      version: 1,
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({ currentTheme: state.currentTheme }),
      // whatever was saved (an old gradient theme included) becomes the nearest accent
      migrate: (persisted) => ({
        currentTheme: ACCENTS[resolveThemeId((persisted as { currentTheme?: unknown } | null)?.currentTheme)],
      }),
      merge: (persisted, current) => ({
        ...current,
        currentTheme: ACCENTS[resolveThemeId((persisted as { currentTheme?: unknown } | null)?.currentTheme)],
      }),
    }
  )
);

export const initializeTheme = () => {
  const { currentTheme, applyTheme } = useThemeStore.getState();
  applyTheme(currentTheme);
};

import { beforeEach, describe, expect, it } from 'vitest';
import { ACCENTS, resolveThemeId, useThemeStore, initializeTheme } from './index';

describe('resolveThemeId', () => {
  it('maps the old theme ids to the nearest accent', () => {
    expect(resolveThemeId('light')).toBe('blue');
    expect(resolveThemeId('cool')).toBe('blue');
    expect(resolveThemeId('darkBlue')).toBe('blue');
    expect(resolveThemeId('lavender')).toBe('violet');
    expect(resolveThemeId('darkPurple')).toBe('violet');
    expect(resolveThemeId('mint')).toBe('emerald');
    expect(resolveThemeId('darkGreen')).toBe('emerald');
    expect(resolveThemeId('gray')).toBe('slate');
    expect(resolveThemeId('twilight')).toBe('slate');
    expect(resolveThemeId('warm')).toBe('amber');
  });

  it('accepts a saved theme object of the old or new shape', () => {
    expect(resolveThemeId({ id: 'mint', name: 'Mint Green', background: 'bg-x' })).toBe('emerald');
    expect(resolveThemeId({ id: 'rose', name: 'Rose' })).toBe('rose');
  });

  it('falls back to blue for anything unknown', () => {
    expect(resolveThemeId('nope')).toBe('blue');
    expect(resolveThemeId(null)).toBe('blue');
    expect(resolveThemeId(42)).toBe('blue');
  });
});

describe('theme store', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.className = 'dark';
    delete document.documentElement.dataset.theme;
    useThemeStore.getState().changeLocalTheme('blue');
  });

  it('offers every accent, Nexgen Blue first', () => {
    const ids = useThemeStore.getState().availableThemes.map((t) => t.id);
    expect(ids).toEqual(['blue', 'indigo', 'violet', 'emerald', 'teal', 'amber', 'rose', 'slate']);
    expect(ACCENTS.blue.swatch).toBe('#2b7fff');
  });

  it('applies a theme on the page and clears the old dark class', () => {
    useThemeStore.getState().changeLocalTheme('emerald');
    expect(document.documentElement.dataset.theme).toBe('emerald');
    expect(document.documentElement.classList.contains('dark')).toBe(false);
    expect(useThemeStore.getState().currentTheme.id).toBe('emerald');
  });

  it('ignores an unknown id', () => {
    useThemeStore.getState().changeLocalTheme('violet');
    useThemeStore.getState().changeLocalTheme('nope');
    expect(useThemeStore.getState().currentTheme.id).toBe('violet');
  });

  it('loads an old saved theme as the nearest accent', async () => {
    localStorage.setItem(
      'nexgen-msp-theme',
      JSON.stringify({ state: { currentTheme: { id: 'darkGreen', name: 'Dark Green', isDark: true } }, version: 0 })
    );
    await useThemeStore.persist.rehydrate();
    initializeTheme();
    expect(useThemeStore.getState().currentTheme.id).toBe('emerald');
    expect(document.documentElement.dataset.theme).toBe('emerald');
  });

  it('keeps the old helpers harmless', () => {
    const s = useThemeStore.getState();
    expect(s.getBackgroundClass()).toBe('bg-slate-50');
    expect(s.getDecorativeBlobs()).toEqual([]);
    expect(s.isDark()).toBe(false);
  });
});

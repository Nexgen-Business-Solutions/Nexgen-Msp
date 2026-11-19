# Nexgen MSP DeployOps-style UI (foundation) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Re-skin the Nexgen MSP frontend in the DeployOps style and turn the theme store into a working accent-colour picker, without changing behaviour.

**Architecture:** Tokens live in `src/index.css`. Tailwind's `--color-blue-*` palette is remapped to `--brand-*` CSS variables, so every existing `blue-*` class (≈650 uses) follows the chosen theme with no page edits; `<html data-theme>` swaps the brand scale. Shared components and the app frame are restyled in place with unchanged props, text and roles.

**Tech Stack:** React 18, Tailwind 4 (`@tailwindcss/vite`), zustand, lucide-react, vitest + Testing Library (jsdom).

**Spec:** `docs/superpowers/specs/2026-11-18-ui-deployops-style-design.md`

## Global Constraints

- Styling only: no change to API calls, routes, guards, query keys, data or business logic.
- Keep every visible text, label, aria-label, role and `data-*` attribute that tests or e2e rely on (e.g. labels "Email or username", "Password", button "Sign in", "Enter your code").
- Keep `slate-*` classes that tests assert (`text-slate-400`).
- Default theme = Nexgen Blue, brand-500 `#2b7fff`; Poppins; lucide icons.
- Theme storage key stays `nexgen-msp-theme`.
- No commit or push without the owner's approval. Branch `new-features`.
- Checks: `cd frontend && yarn test && yarn lint && npx tsc -b && yarn build`. Baseline: 73 files / 775 tests pass.

## Review Focus

1. A saved old theme id (`mint`, `darkBlue`, …) in localStorage: the app must load with the nearest new theme, not crash or show no colour. Pinned in Task 1.
2. A saved theme object (the store persists the whole object) from the old shape: same as 1. Pinned in Task 1.
3. Modals with long content on a short screen: must still scroll, close on Esc and backdrop. Pinned in Task 4 (existing tests + manual).
4. The login's two-factor steps (code, setup) after the restyle: same flow and texts. Pinned by `LoginScreen.deskLanding.test.tsx`.
5. Phone width (390px): sidebar drawer, header, login fit with no horizontal scroll. Checked by screenshots in Task 5.

---

### Task 1: Tokens and theme engine

**Files:** Modify `src/index.css`, `src/theme/{types,constants,store,index}.ts`. Test: `src/theme/store.test.ts`.

**Interfaces — Produces:**
- `ACCENTS: Record<AccentId, Accent>` with ids `blue | indigo | violet | emerald | teal | amber | rose | slate`; `Accent = {id, name, swatch: string /* hex of 500 */}`.
- `resolveThemeId(saved: unknown): AccentId` — accepts an id string or an old theme object; maps `light|cool|darkBlue → blue`, `lavender|darkPurple → violet`, `mint|darkGreen → emerald`, `gray|twilight → slate`, `warm → amber`; unknown → `blue`.
- Store: `currentTheme: Accent`, `availableThemes: Accent[]`, `changeLocalTheme(id)`, `applyTheme(accent)` sets `document.documentElement.dataset.theme = id` and removes the `dark` class. Keep `getBackgroundClass()` → `'bg-slate-50'`, `getDecorativeBlobs()` → `[]`, `isDark()` → `false`, `getPreviewClass()` so nothing that imports them breaks.
- CSS: `@theme` maps `--color-blue-50…950` to `var(--brand-50)…`, defines `--color-brand-*`, `--color-ink`, `--color-muted-ink`, `--color-line`, `--color-soft`; `[data-theme=…]` blocks set the `--brand-*` scale from Tailwind's matching palette (`--color-indigo-500` etc. raw values, defined as `--palette-*` so the remap doesn't recurse).

- [ ] Step 1: tests: `resolves old ids`, `resolves old theme objects`, `unknown falls back to blue`, `applyTheme sets data-theme and clears dark`, `persisted old shape loads as nearest accent`.
- [ ] Step 2: run `yarn test src/theme` → FAIL.
- [ ] Step 3: implement; store `merge`/`migrate` in persist uses `resolveThemeId`.
- [ ] Step 4: run → PASS; full suite still 775+.

### Task 2: Appearance picker in the user menu

**Files:** Modify `src/shared/layout/UserMenu.tsx`. Test: `src/shared/layout/UserMenu.test.tsx` (add).

- Menu gets an "Appearance" section: a row of round swatch buttons, `role="radio"` in a `role="radiogroup" aria-label="Theme"`, `aria-label` = accent name, check icon on the current one; click → `changeLocalTheme`.
- [ ] Tests: `shows a swatch per accent`, `choosing a swatch applies it` (data-theme changes). RED → GREEN.

### Task 3: Sign-in screens

**Files:** `src/features/auth/pages/LoginScreen.tsx`, `src/features/auth/components/AuthShell.tsx`, `src/shared/components/appLogo.tsx` (and the two-factor components' wrappers only if they carry their own gradients).

- DeployOps sign-in: plain white page (`bg-white`), content `max-w-sm` centred, logo at top, `text-[32px] font-semibold` title, muted one-liner, inputs `h-12 rounded-xl bg-zinc-100/70 border-0 focus:ring-2 ring-brand-500`, primary button full-width `rounded-full bg-brand-500 h-12`, quiet footer line "Nexgen MSP · Secure sign-in". Remove blobs, diagonal and gradients. Keep visible labels (tests use `getByLabelText`) styled small and muted.
- [ ] Existing `LoginScreen.deskLanding.test.tsx` stays green; screenshots of login/forgot/reset at 1280 and 390.

### Task 4: App frame and shared components

**Files:** `src/shared/layout/{AppHeader,AppSidebar,AppLayout,Breadcrumb,UserMenu}.tsx`; `src/shared/components/{Modal,ConfirmModal,DataTable,TablePagination,KpiCard,StatusBadge,FilterBar,Select,MultiSelect,RowActionsMenu,LoadingScreen,Avatar}.tsx`.

- Header: white, `border-line`, h-16, logo + name in ink, tagline muted (not blue).
- Sidebar: active item `bg-brand-50 text-brand-700 font-semibold`, no gradient/shadow; icons muted; section labels `text-[11px] uppercase tracking-wider text-zinc-400`.
- Modal/ConfirmModal: overlay `items-start pt-[8vh]` (top-centred), `rounded-2xl ring-1 ring-zinc-900/5 shadow-xl`, hairline header/footer; still scrolls, Esc and backdrop close.
- Buttons in these components: primary `rounded-full bg-brand-500 hover:bg-brand-600 text-white`, secondary `rounded-full ring-1 ring-line`.
- Tables: header row `text-[12px] uppercase tracking-wide text-zinc-500 bg-zinc-50/60`, rows hairline `divide-line`, hover `bg-zinc-50`.
- KpiCard: white, `rounded-2xl ring-1 ring-line`, value `text-2xl font-semibold text-ink`.
- Gradients (`bg-linear-to-*`) in these files replaced with flat brand colours.
- [ ] Full suite green after each file group; no text/role changes.

### Task 5: Verify

- [ ] `yarn test && yarn lint && npx tsc -b && yarn build` all pass.
- [ ] Screenshots at 1280/390: login, forgot, reset; with an owner-provided session: dashboard, a list, a detail, a modal, portal dashboard, each theme swatch once.

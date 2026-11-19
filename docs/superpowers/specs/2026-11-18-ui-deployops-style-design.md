# Nexgen MSP UI in the DeployOps style — foundation

Status: draft for owner approval (2026-11-18). Branch: `new-features`.

## Intent

Make the Nexgen MSP frontend (`frontend/`, served at `/msp`) look and feel like the DeployOps app:
clean white surfaces, near-black type, hairline dividers, one blue accent used only for actions,
selection and progress, Poppins, lucide icons, top-centred dialogs, rounded-full primary buttons
and soft grey inputs. It should read as a product a customer would be happy to use.

This is the **foundation** pass. Page-by-page fixes come after the owner reviews it.

## Decisions (owner)

1. One brand now — Nexgen logo, DeployOps blue `#2b7fff`, Poppins, lucide — with colours and logo
   kept in a few tokens so a customer brand is a small change later.
2. **Keep the theme picker and make it better** (see Themes).
3. Foundation first: tokens, login/forgot/reset screens, app frame, shared components. Then pages.
4. Work on the current branch `new-features`; nothing is committed or pushed without approval.

## Goals

- Design tokens in `src/index.css`: `--color-brand-*`, `ink`, `muted`, `line`, `soft`, `danger`,
  `success`, `warning`, the same names DeployOps uses, so classes like `text-ink`, `border-line`,
  `bg-brand-500` work everywhere. Existing shadcn tokens (`primary`, `border`, …) stay and point at
  the new values, so no current class breaks.
- Login, Forgot password, Reset password: the DeployOps sign-in layout — a plain page, logo, large
  "Sign in" title, one muted line, soft grey inputs without labels-above clutter, full-width
  rounded-full blue button, quiet footer. No gradients, blobs or diagonal shape.
- App frame: white header with hairline border, flat sidebar (active item = soft brand tint and
  brand text, not a gradient), DeployOps-style user menu, slate-50 content background, white page
  panels.
- Shared components restyled in place, same props: Modal and ConfirmModal (top-centred, DeployOps
  dialog), DataTable and TablePagination, KpiCard, StatusBadge, FilterBar, Select and MultiSelect,
  RowActionsMenu, Breadcrumb, buttons.

## Non-goals

- No changes to API calls, routes, guards, data, permissions, query keys or business logic.
- No page rewrites in this pass; pages only get what flows from tokens and shared components.
- No dark mode in this pass (only one page uses `dark:` classes today; a real dark mode is its own
  project).
- No white-label settings screen.

## Anti-goals

- Anything that changes behaviour: a form that submits differently, a filter that stops working,
  a hidden button. Styling only.
- Breaking the existing unit tests (`vitest`) or e2e selectors (`playwright`): keep text, roles,
  labels and `data-*` attributes the tests use.

## Themes (picker kept, made better)

Today: a store with 11 themes (gradient backgrounds plus decorative blobs; three "dark" ones that
only toggle a `dark` class) is initialised in `App.tsx`, but **no screen shows a picker**, and no
component reads the theme's background or blobs.

Better:
- Each theme is an **accent colour** over the same clean surfaces, applied through CSS variables on
  `<html data-theme="…">`, so every button, focus ring, active nav item, link and badge follows it.
  Themes: Nexgen Blue (default, `#2b7fff`), Indigo, Violet, Emerald, Teal, Amber, Rose, Slate.
- An **Appearance** section in the user menu: a row of colour swatches with a check on the current
  one; choosing one applies instantly and is remembered (same `nexgen-msp-theme` storage key).
- Old saved theme ids map to the nearest new one (e.g. `mint` → Emerald, `gray`/`twilight` → Slate,
  dark themes → the matching light accent), so nobody gets a broken screen after the update.

## Approaches

- **A. Re-skin through tokens and shared components, same props (chosen).** Most screens change for
  free; risk stays low because no page logic moves. Pages with hard-coded gradients (8 files) get a
  small follow-up in the page pass.
- B. Port DeployOps' component kit and rewrite pages onto it: the closest match, but touches every
  page and their tests — too much risk for "don't break anything".
- C. Global CSS overrides of Tailwind classes: quick but fragile and fights the utility classes.

## Verification

- `yarn lint`, `tsc -b`, `yarn test` (vitest) and `yarn build` pass.
- Screenshots before/after at 1280px and 390px: login, forgot, reset, and — with a test login from
  the owner — the internal dashboard, a list page, a detail page, a modal, and the portal dashboard.
- Playwright e2e suites are not run without the owner's say-so (they may need a seeded site).

## Left to the builder

- Exact shades for the non-blue themes (Tailwind 500/600 of each hue).
- Small spacing/radius choices that follow DeployOps (`rounded-xl` cards, `rounded-2xl` dialogs,
  `rounded-full` primary buttons, `h-11` inputs).

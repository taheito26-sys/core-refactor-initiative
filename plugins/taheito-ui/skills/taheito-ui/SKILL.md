---
name: taheito-ui
description: Taheito's phone-first card dashboard design. A dark gradient hero with a curved edge, a white main card floating over it, pill filter chips, pastel KPI tiles with icon circles, and white list cards with a coloured status stripe. Palette switchable by tokens, RTL-ready, sized with one scale unit. Use when building or restyling any page, panel or list so it matches the Orders, Cash and Shipments pages, in this or any other project.
---

# Taheito UI

The look of the customer portal's Orders, Cash and Shipments pages: calm blue (or palette) hero, one white
"main" card with the controls and the headline numbers, then a list of white cards each with a coloured stripe
for its status. It is dense, readable one-handed on a phone, and works the same in Arabic (RTL) and English.

Source of truth is the CSS in `assets/` (copied from the Tracker repo: `src/styles/customer-*.css`). Copy those
files into a project rather than rewriting them. `references/examples.md` has the markup to copy.

## What a page is made of, in order

1. **Hero** (phone only, `co-hero2`): zoom, bell and AR/EN pill on top, the user's name, then the page title with
   an icon and one line of subtitle, and a small status card (`co-grow`) with one headline fact.
2. **Main card** (`ch-card co-main` inside `co-mainwrap`): a label row with the page's one primary button
   (`co-new`), filter chips (`co-months` / `co-chip`), a tools row (`co-tools` / `co-tool`, search field) and
   KPI tiles (`co-tiles` / `co-t t1..t4`, each tile is a filter when it makes sense).
3. **Section heading** (`cs-head`) with the count, then the **list** (`cs-list`) of cards (`co-card`).
4. **Empty and loading states** in the same card language: `cs-empty` with an icon tile, one sentence, and the
   same buttons; `cs-skel` shimmer blocks while loading.
5. **Detail panel** (side sheet): gradient header (`cs-dh`) and white boxes (`cs-box`), see examples.

## Rules that keep it consistent

- **One unit.** Every length is `calc(N * var(--q))`, where N is the px on a 411px-wide phone. `--q` is set on
  `.ch-root` (clamped, so tablets do not balloon). Never mix in raw px or rem for layout.
- **Colours come from tokens.** `--th-ink`, `--th-a` (accent), `--th-ad`, `--th-page`, `--th-h1/h2` (hero),
  `--th-b1..b4` and `--th-i1..i4` (tile tints and icon circles), `--th-bad`, `--th-badl`. Four palettes ship
  (emerald default, gold, ocean, navy) via `html[data-portal-palette]`. Status colours are fixed and semantic:
  amber waiting, blue in progress, green done, red problem, grey void. Do not hardcode other hex values.
- **Cards are light even when the app theme is dark.** Inside `.co-root` use the fixed ink and muted colours of the
  stylesheet (`#0f1f5e` / token ink, `#6b7a9c`, `#4d5d88`), not the app's theme-aware Tailwind classes such as
  `text-muted-foreground`, which turn pale on white in a dark theme.
- **Status is never colour alone.** Every stripe and tag also carries words, and a state change shows an icon or a
  different marker shape.
- **RTL by construction.** Use logical properties (`margin-inline-start`, `inset-inline-end`, `padding-inline`),
  set `dir` on the page root, keep numbers and coordinates `direction: ltr` inside their own element, and flip
  chevrons with the page direction. Write both languages for every string.
- **Touch targets** are at least 28q tall for chips and tools, 34q for the primary button, whole cards are
  tappable (a `div` with `role="button"`, `tabIndex`, Enter and Space handling, because it holds block content).
- **One primary action per page**, top of the main card. Secondary actions are `co-tool` buttons in the tools row.
- **Numbers**: tabular figures, amounts big and bold (`co-amt b`), units small and muted beside them.
- **Phone first, desktop second.** The hero shows only on phones; the main card and cards are the same on desktop,
  where the list becomes two columns from 1024px.

## Starting a feature in a project

1. Copy `assets/customer-home.css`, `customer-orders.css`, `customer-theme.css` into the project's styles and
   import them in that order. Add a small feature CSS (like `customer-shipments.css`) for anything page-specific,
   built from the same tokens, prefixed with the feature's own letters.
2. Wrap the page in `ch-root co-root <feature>-root` with `dir`.
3. Build the main card, then the cards, from `references/examples.md`. Reuse `co-*` classes before adding new ones.
4. If the page opens a panel or dialog, wrap its content in `ch-root co-root` as well (portals sit outside the root).
5. Check a phone width (411px) in Arabic and a desktop width in English, with at least one empty, one loading and
   one alert state, before calling it done.

## Pitfalls seen before

- Pasting a `.co-hero2` without its `ch-*` avatar, bell and pill rules: the header collapses. Copy
  `customer-home.css` too.
- Forgetting `ch-root` on a portal: `--q` is undefined and every length computes to nothing.
- Loading `customer-theme.css` before the other two: palette overrides lose to the base rules.
- Tiles are `div`s on the Orders page and `button`s on filterable pages; a `button` needs `text-align: start` and
  `border: 0` (already in `customer-shipments.css`).
- The hero's zoom control and notifications are Tracker components; in another project replace them with that
  project's equivalents or drop them and keep the layout.

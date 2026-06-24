# Design

Visual system for MFP App. Calm, trustworthy, precise — a quiet financial tool.
Light theme, restrained neutrals, **one** accent, colour reserved for meaning.
Legible for mixed/less-technical users (high contrast, comfortable sizing, obvious
controls). Implemented with Tailwind v4 tokens in `app/globals.css`.

## Color

Light, restrained. A neutral slate ramp + one indigo accent + semantic status.

| Role | Token | Value | Use |
|------|-------|-------|-----|
| App background | `--color-canvas` | `#f4f5f7` | page background (cool off-white, not cream) |
| Surface | `--color-surface` | `#ffffff` | cards, content, table body |
| Panel | `--color-panel` | `#f7f8fa` | toolbars, table header zone, insets |
| Shell | `--color-shell` | `#1b2436` | top app bar (deep slate, brand/trust) |
| Ink | `--color-ink` | `#0f172a` | primary text |
| Muted | `--color-muted` | `#475569` | secondary text (≥7:1 on white) |
| Faint | `--color-faint` | `#64748b` | meta/labels (≥4.5:1 on white) |
| Line | `--color-line` | `#e3e7ec` | hairline borders, dividers |
| Accent | `--color-accent` | `#4f46e5` | focus, links, current selection, key CTAs |
| Accent-hover | `--color-accent-hover` | `#4338ca` | |
| Accent-soft | `--color-accent-soft` | `#eef2ff` | selected-row tint, accent chips |

Status (semantic only, always paired with a word/badge — never colour alone):
- success / full → emerald `#059669` on `#ecfdf5`
- warning / partial → amber `#b45309` on `#fffbeb`
- error → rose `#e11d48` on `#fff1f2`
- info / new → accent indigo on `--color-accent-soft`

Primary buttons are **ink** (near-black), not coloured — keeps the surface calm.
Accent carries interaction (focus ring, links, selected state), not decoration.

## Typography

- **Geist Sans** for everything (fix: it was loaded but overridden by Arial).
  **Geist Mono** for numbers — MF numbers, amounts, dates — with `tabular-nums`.
- Fixed rem scale (product UI, not fluid). Base **15px**, ratio ~1.2.

| Step | Size | Use |
|------|------|-----|
| meta | 0.75rem / 12px | timestamps, hints |
| sm | 0.8125rem / 13px | table cells, secondary |
| base | 0.9375rem / 15px | body, controls |
| md | 1.0625rem / 17px | card titles |
| lg | 1.25rem / 20px | section headings |
| xl | 1.5rem / 24px | page titles |
| 2xl | 1.875rem / 30px | connect/empty-state headings |

Weights: 400 body, 500 labels/buttons, 600 headings, 700 big titles. Headings
`text-wrap: balance`. Line length 65–75ch for prose.

## Spacing & Layout

- 4px base scale. **Generous, not cramped**: card padding 24px; section gaps
  16–24px; table cells `py-3 px-4` (comfortable). Content in a max-width container.
- App shell: deep-slate top bar + light content. Workflow = page header + content.
- Responsive is structural (stack actions, scroll tables), not fluid type.

## Radii & Elevation

- Radii: `sm` 8px (badges), `md` 10px (controls), `lg` 12px (buttons/inputs),
  `xl` 16px (cards), `2xl` 20px (modals/big cards). Consistent everywhere.
- Soft, low shadows (no drop-shadow soup):
  - card: `0 1px 3px rgb(15 23 42 / .06), 0 1px 2px rgb(15 23 42 / .04)`
  - pop/modal: `0 12px 32px rgb(15 23 42 / .14)`

## Components

Every interactive element ships default / hover / focus(ring accent) / active /
disabled. One consistent vocabulary across all screens.

- **Buttons**: primary = ink bg / white text; secondary = white / line border / ink;
  ghost = transparent / hover panel; danger = rose. Radius 12px, `px-4 py-2.5`,
  weight 500. Visible focus ring (`ring-2` accent at ~40%).
- **Inputs/selects**: white, `line` border, radius 12px, comfortable padding;
  focus = accent border + ring. Placeholder ≥4.5:1.
- **Badges/status**: tinted bg + dark-of-hue text, radius 8px, 12px text, with a word.
- **Table**: panel header zone, hairline row dividers, hover `panel`, selected row
  `accent-soft`; sticky header; amounts right-aligned mono `tabular-nums`.
- **Cards**: surface, `line` border, radius 16px, card shadow, `p-6`.
- **Modal**: surface card, radius 20px, pop shadow, backdrop `ink/50`, fade+scale in.

## Motion

150–200ms `ease-out` on hover/colour/transform; modals fade+scale subtly. Motion
conveys state only — no decorative gradients/bounce. All animation has a
`prefers-reduced-motion: reduce` fallback (crossfade/instant).

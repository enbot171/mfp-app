# Product

## Register

product

## Users

Church/ministry finance administrators — a small team, plus some less tech-savvy
volunteers. They work from a Master Google Sheet shared with a service account.
Two recurring jobs:
- **Pledges** (seasonal, every ~6 months): import Pabbly form exports, reconcile
  each person against the master, fix mismatches, push updates.
- **Payments** (ongoing, weekly): import bank statements, match each transaction
  to a member + month, push the amounts in.

Context of use: focused reconciliation sessions, handling real people's pledges
and money. Accuracy and confidence matter more than speed; a wrong push mis-credits
someone. Users are not all power users, so the interface must be legible and
forgiving.

## Product Purpose

Turn messy bank/form exports into clean, auditable updates to the Master Sheet —
matching, de-duping, and writing values for the admin, with a clear review step
before anything is written. Success = the admin trusts what they're about to push,
can see exactly what changed, and can undo it.

## Brand Personality

Calm, trustworthy, precise. Three words: **dependable, clear, unhurried.** The
voice is plain and reassuring — labels say what they mean, numbers are exact,
nothing is flashy. It should feel like a well-made financial tool that quietly
gets out of the way (Stripe Dashboard / Mercury), not a marketing site.

## Anti-references

- **Not heavy or colourful** — no colour-everywhere dashboards; colour is reserved
  for status/meaning (matched/error, full/partial, new/pushed).
- **Not cramped or overwhelming** — no dense walls of data with no breathing room;
  generous spacing and clear hierarchy, even in tables.
- **Not generic-corporate** — avoid the bland Bootstrap-admin / template look:
  stock card grids, gradient headers, drop-shadow soup, default blue everything.
- No decorative motion, gradients, or display fonts in UI.

## Design Principles

- **Trust through precision.** Consistent spacing, exact numbers, one calm accent,
  zero visual noise in the review/push flow. Every value is labelled.
- **Legible for everyone.** High contrast, comfortable text size, obvious buttons —
  designed so a non-technical volunteer can use it without hesitation.
- **Show what will change.** The preview/review step is the heart of the product;
  make before→after, new vs already-pushed, and full vs partial unmistakable.
- **Calm density.** Tables can be information-rich but never cramped; breathing room
  and clear grouping over packing more in.
- **Familiar, not clever.** Standard affordances (tables, modals only when needed,
  plain forms). The tool disappears into the task.

## Accessibility & Inclusion

WCAG AA: body text ≥ 4.5:1, large/UI text ≥ 3:1; visible keyboard focus on every
control; status never conveyed by colour alone (pair with a word/badge). Respect
`prefers-reduced-motion`. Comfortable base font size and tap targets for mixed,
less-tech-savvy users.

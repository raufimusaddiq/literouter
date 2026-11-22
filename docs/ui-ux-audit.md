# LiteRouter UI/UX audit

## Product reading

LiteRouter is a local-first AI routing control plane. The UI should optimize for
fast configuration, safe operational changes, readable telemetry, and keyboard
navigation—not marketing conversion or decorative motion.

## Findings

- Shared navigation exposed seven workspace destinations with weak grouping and
  inconsistent action density.
- Icon-only actions were often below a comfortable keyboard/touch target and
  lacked a shared focus treatment.
- `Input` and `Select` rendered labels without guaranteed `for`/`id` wiring;
  validation text was not consistently announced.
- Long transitions and hover transforms made a dense admin surface feel slower
  than the underlying API.
- Decorative Material Symbols could leak ligature text to assistive technology.

## Refactor shipped

- IBM Plex Sans + JetBrains Mono for UI/code separation.
- Shared focus-visible ring, reduced-motion fallback, and scroll focus offset.
- Stable 40–44px controls, keyboard-visible list actions, accessible labels,
  `aria-invalid`, `aria-describedby`, and alert errors.
- Lower-motion shell, buttons, cards, and sidebar interactions; no layout-shift
  hover transforms.
- Decorative icons marked `aria-hidden`; active navigation exposes
  `aria-current="page"`.

## Verification matrix

- Widths: 375px, 768px, 1024px, 1440px.
- Modes: light, dark, `prefers-reduced-motion: reduce`.
- Input path: keyboard-only tab order, visible focus, inline error announcement.
- Operational safety: endpoint/API-key security warnings remain unchanged.

## Deliberate scope

Page-specific information architecture remains unchanged because endpoint,
provider, System One, usage, and quota workflows are independently functional.
Revisit navigation grouping after usage telemetry identifies the most-used path.

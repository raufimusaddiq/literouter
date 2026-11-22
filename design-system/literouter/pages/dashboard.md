# Dashboard override

LiteRouter dashboard pages are an operations control plane, not a landing page.

## Direction

- Keep the existing indigo brand as the primary action color.
- Reserve green, amber, red, and blue for operational status semantics.
- Use IBM Plex Sans for UI copy and JetBrains Mono for URLs, keys, JSON, and
  telemetry values.
- Prefer quiet surfaces, 1px semantic borders, and one clear primary action per
  card. Avoid decorative gradients, parallax, and layout-shifting hover effects.

## Layout

- Desktop: persistent 17–18rem navigation, one scrollable content surface.
- Mobile: off-canvas navigation, 16px content gutter, no horizontal overflow.
- Content widths: readable single-column forms; two-column layouts only when the
  comparison is meaningful, such as request/response or endpoint/key setup.
- Minimum interactive target: 40px desktop, 44px touch/compact mobile.

## Interaction

- Every interactive control gets a visible `:focus-visible` ring.
- Icon-only controls require an accessible name and a 32px visual target inside
  a 40px hit area.
- Inline validation stays beside the field; errors use `role="alert"` and
  `aria-invalid`.
- Motion is limited to 150–250ms color/opacity changes and respects
  `prefers-reduced-motion`.

## Page priorities

1. Endpoint safety and copyable connection details.
2. Provider health and actionable configuration.
3. System One request/response inspection.
4. Usage and quota trends.

Do not add dashboard-wide abstractions until repeated page-specific friction is
measured. Reuse the existing shared components first.

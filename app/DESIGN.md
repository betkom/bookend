# Bookend design system

Based on the supplied Playful style reference. The app uses a light oat canvas,
white elevated surfaces, black navigation, and one hot magenta accent. Reading
history and reviews remain the primary content; marketing sections and decorative
illustrations are not part of the product screens.

- Canvas: #f6f2ee. Surfaces: #ffffff. Ink: #111111. Accent: #ff2e95.
- Secondary text: #414040. Dividers: #e8e5e0. Small links: #a70050 for contrast.
- Primary actions use black text on magenta for readable contrast.
- Inter Variable is self-hosted through @fontsource-variable/inter (OFL-1.1).
  Display headings use 900 italic; body uses 400, supporting labels use 500/600.
- Cards have 44px corners, images 16px, controls 99px. Mobile navigation opens from a hamburger button into a disclosure panel
  with 28px corners; desktop keeps its horizontal navigation. Dropdown chevrons
  sit 20px from the pill edge, with space reserved beside the selected text.
- Card elevation uses the reference's two-layer shadow. Controls have no shadows.
- Headings scale from 40px on phones to 79px on desktop. Controls remain at least
  44px high, and dates stack at the narrowest phone width.
- The app stays light regardless of system appearance, matching the reference.
  Recaps offer Playful and an optional monochrome Ink palette with the same accent.
- Recap SVGs embed the local font files so previews and 1080×1920 PNG exports
  match offline. Cards have no calculation notes or footer wordmark.

Shared UI tokens live in src/styles.css; font definitions in src/fonts.css.
Recap colours live in themes/paper and themes/midnight, and card layouts in
src/recap/cards.ts. The theme IDs remain stable for compatibility.

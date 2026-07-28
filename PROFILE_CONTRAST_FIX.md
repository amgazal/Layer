# Mobile profile contrast fix

The profile sheet is rendered through a React portal under `document.body`. CSS custom properties defined on `.lyr` do not automatically inherit into that portal. The primary cloud-sync button used `background: var(--ink)`, so on mobile the missing variable caused the background declaration to be discarded while the text remained white.

This update:

- Defines the profile colour tokens directly on `.profile-overlay`.
- Gives the cloud-sync action an explicit navy background and white text.
- Gives the close button an explicit navy circular background and white icon.
- Adds larger mobile tap targets, focus rings, pressed states, and clear disabled styling.
- Keeps the secondary personalization action visually distinct.

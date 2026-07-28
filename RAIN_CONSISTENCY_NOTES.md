# Rain consistency fix

Layer now distinguishes between:

- **Current condition** — shown beside the date and time.
- **Worst condition during the selected outing** — used to prepare the outfit and future-condition warning.

This prevents a future heavy-rain peak from being described as though it is already happening.

Examples:

- Current light rain, no worsening: `Light rain now — take a packable shell or umbrella.`
- Current light rain, heavy rain later: the header remains `Light rain`, the outfit prepares for the full outing, and the alert says `Heavy rain may develop before you return.`
- Current heavy rain: the header and protection message both say heavy rain is happening now.

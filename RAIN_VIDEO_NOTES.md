# Rain video background

Layer now uses `public/backgrounds/rain-loop.mp4` whenever the live weather category is `rain`.

Implementation details:

- The video is muted, loops, autoplays, and uses `playsInline` for iPhone/iPad support.
- The existing `rain.webp` remains underneath as the poster and failure fallback.
- Users with `prefers-reduced-motion: reduce` see the static rainy image instead of moving footage.
- Light, moderate, and heavy rain apply progressively darker video treatment.
- The former CSS streak animation has been removed.

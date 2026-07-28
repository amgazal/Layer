# Rain video resume fix

This update fixes mobile browsers pausing the rain background after Layer is sent to the background.

## Behaviour

- Returning to Layer via visibility, focus, or Safari's `pageshow` event resumes the video immediately.
- The weather refresh button now refreshes weather data **and** restarts the rain video.
- The video is replayed after a new weather payload keeps the scene in the rain category.
- Temporary media errors fall back to the existing static rain image; a manual refresh retries the video.
- The refresh icon spins while the weather request is running.

No database migration or new environment variable is required.

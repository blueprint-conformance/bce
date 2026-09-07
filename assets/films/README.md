# Film collection

The catalog is the durable index. It records ten films, their provenance boundaries, source-video identities, durations, dimensions, captions and readable descriptions. The original binaries and frame-derived posters live in the dated `media-2026-09-07` GitHub media release. This is a media collection, not an engine release; it does not change the registry version or release-state ledger.

The homepage features the context spectrum; `/films/` preserves every selected cut; the repository README carries a short preview that plays once. The full interactive view is under `assets/films/context-spectrum/index.html`. Website players use native controls and `preload="none"`; they never autoplay or fetch all videos on arrival. The readable descriptions also work with scripting disabled.

The media manifest pins every downloaded byte. After downloading the media release assets, verify them with:

```sh
node scripts/verify-film-assets.mjs /path/to/downloads
```

Do not overwrite a released asset when replacing a film. Add a new dated media release and catalog entry so older cuts remain recoverable. Do not promote reference architecture or historical product demos into claims about released BCE behavior.

The interactive scene is a presentation of a reference design, not an engine implementation. Its Three.js 0.180.0 dependency is bundled into `context-spectrum/spectrum.js`; the upstream MIT license is preserved in `THREE-LICENSE.txt`. `scene.js` and `story.js` are the editable inputs. Rebundling requires Three.js 0.180.0 and esbuild 0.25.12, with `scene.js` as the entry, IIFE format, ES2022 target, minification and end-of-file legal comments. Core and npm package dependencies are unchanged.

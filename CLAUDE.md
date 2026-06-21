# Purlina Matrix — PRD + Build Lore

Status: building against the real client brief (extracted from `Purlina Site.pdf`, a Canva mockup — see `/assets/brief/` for the source images). This file is the canonical context for every Claude Code session on this repo — read it before touching the blob deformation, the scroll timeline, or the material.

## 1. The brief

Client/brand: **Purlina Matrix** — a material/coating product that's positioned as adaptable across 900+ industries (automotive, pharma/medical, cosmetics, etc., per the regulatory/benefits framing). This is NOT a literal multi-SKU e-commerce reveal site — there are no individual physical products to render. The hero visual is a single continuous liquid chrome/glass blob that never fully disappears; it idles, then twists into a coiled spiral shape, while flat sector icons (not 3D models) appear to represent the industries it serves.

### The 5 scroll sections (from the mockup)

1. **Intro.** Logo "PURLINA MATRIX" + headline "Yeni Nesil ....." (client hasn't finished this tagline — keep as a placeholder ellipsis, don't invent the rest). Blob idles with ambient wobble.
2. **Faydalar (Benefits).** Four bullets: regulatory adaptation, ease, cost, speed. Blob continues idling/drifting.
3. **Scale.** Headline "900+ sektöre uyumlanabilen yapı..." ("Structure adaptable to 900+ sectors..."). Blob begins shifting — this is where the twirl starts ramping up.
4. **Sectors.** No headline. The blob is now visibly twirled into an elongated spiral/rope. Flat sector icons (automotive wheel, a regulation/compliance icon, a cosmetics bottle) sit along the spiral, as if riding it.
5. **CTA.** Blob stays in its coiled state. A search-style input: "Purlina Matrix Oluştur" ("Create Purlina Matrix").

**Important distinction from the original generic PRD this project started from:** the red annotations in the mockup ("As you scroll down the site, the shape also moves down and changes position...", "It shifts its form to show the products of each sector it enters...", "The liquid shape continues in the background, while examples of the sectors it can enter rotate above it.") are designer notes describing the *animation behavior*, not on-screen copy. Don't render them as text.

### Success criteria

Same as before: 55-60fps on a mid M-series Mac / decent Windows laptop, graceful mobile degradation, Astro shell stays static, no layout shift tied to scroll.

## 2. Stack (locked)

| Layer | Choice | Why |
|---|---|---|
| Shell / SSG | Astro 5 | Static everything except the canvas. |
| 3D | Three.js + React Three Fiber + drei | Declarative scene graph, raw Three.js escape hatches for the deformation. |
| Blob material | drei's `MeshTransmissionMaterial` + `Environment` | This is the standard pmndrs technique for exactly this "liquid chrome/glass blob" look — physically-based transmission/refraction with env map reflections. Don't hand-roll a refraction shader. |
| Blob shape | Deformed icosphere, CPU-side per-frame displacement | See section 3 — there is no second baked shape to morph into, so GPGPU position-texture morphing (the previous approach) doesn't apply here. |
| Scroll | GSAP + ScrollTrigger | Per-section scrub timelines. |
| Smooth scroll | Lenis | Syncs with ScrollTrigger. |
| Hosting | Cloudflare Pages | Same as usual. |

## 3. The Core Technique (read this before touching the blob)

### Why not GPGPU point-cloud morphing (the old plan)

That technique exists to morph between two *different* baked shapes with no shared topology (e.g. blob → water bottle silhouette). The real brief has no second shape — it's the same continuous blob the whole time, just increasingly twisted into a spiral. A sparse point cloud also doesn't read as "glassy/chrome" — the brief's reference images are a smooth continuous reflective surface. So: one mesh, deformed, rendered with a transmission material. `scripts/bake-positions.mjs` and `/assets/products/*.glb` are leftover infrastructure from before the real brief surfaced — they still work if a future feature needs literal product-shape morphing, but nothing on the page currently uses them.

### The actual pattern: per-frame vertex displacement on a transmission-shaded mesh

1. Start from a moderately-subdivided `IcosahedronGeometry` (detail ~4, ~2.5k vertices — enough to look smooth under a glass material without being expensive to redisplace every frame).
2. Each frame, for every base vertex `p` (the undisplaced unit-sphere position, cached once):
   - **Idle wobble** (always on): low-frequency 3D simplex noise perturbing the radius. Keep the frequency low — the reference blob has a couple of broad lobes, not a bumpy/noisy surface.
   - **Twirl** (driven by `uTwirl`, 0→1, tied to scroll progress through sections 3-5, see below): elongate along one axis, twist around it (classic twist-deformer: rotate `(x,z)` by an angle proportional to position along the axis), then bend that axis into a helical path (offset `x`/`z` by `sin`/`cos` of position along the axis). This turns the round blob into the coiled spiral rope shown in sections 4-5. Composing elongate → twist → coil-bend, in that order, is what gets the rope look — twisting before elongating just spins a ball in place.
   - Write the displaced positions back into the geometry's position attribute, set `needsUpdate = true`, and call `geometry.computeVertexNormals()` so the transmission material's lighting stays correct.
3. `uTwirl` is NOT a per-transition envelope that resolves back to zero (unlike a typical morph-twirl) — per the mockup, the spiral deepens progressively through sections 3→5 and stays coiled at the CTA. Drive it with a monotonic scroll-progress mapping across that range, not a peak-at-0.5 envelope.

### Sector icons (section 4)

Flat, simple SVGs (automotive wheel, a regulation/compliance mark, a cosmetics bottle) — not 3D models, not photoreal renders. Position them as absolutely-positioned DOM elements layered over the canvas, faded/scaled in during section 4's scroll range, same DOM-overlay approach as the text. Don't try to bake them into the blob mesh or texture.

### Text sync

Same as before: real DOM elements, opacity/transform driven by ScrollTrigger, never baked into the shader.

### Performance gotchas

- Recomputing normals every frame for ~2.5k vertices in JS is fine on a mid-range laptop; if perf testing says otherwise, drop subdivision detail before reaching for a GPU-side displacement shader.
- `MeshTransmissionMaterial` samples a backbuffer for refraction — there's only one blob instance on screen, so this is cheap, but don't add a second transmissive mesh without checking the frame cost.
- Respect `prefers-reduced-motion`: fall back to a static crossfade between section states instead of continuous wobble/twirl.

## 4. Repo structure

```
/src
  /experience
    Experience.jsx        <- R3F canvas root, scroll timeline wiring, icon overlay
    blobDeform.js          <- the noise/twist/coil math from section 3, pure functions
    useScrollTimeline.js   <- GSAP/Lenis setup, exposes per-section scroll progress
    experience.css
  /content
    scroll-script.json     <- the 5 sections' real copy + timing cues
  /pages                   <- Astro routes, SEO, layout chrome
/scripts
  bake-positions.mjs       <- legacy GPGPU point-cloud bake pipeline, unused by the current page (see section 3)
/public/textures/positions <- legacy baked output from bake-positions.mjs, unused by the current page
/assets/products            <- legacy Khronos sample GLBs (WaterBottle, BoomBox, etc.), unused by the current page
```

## 5. Open items

- "Yeni Nesil ....." tagline is incomplete in the client brief — confirm the rest of the headline before launch copy is final.
- Section 5's "Purlina Matrix Oluştur" search input — confirm what it actually does (search/filter by sector? lead-gen form? static for now?) before wiring real behavior.
- Site language: brief mixes Turkish (headlines/copy) and English (designer annotations). Confirm final site language — currently scaffolded with the Turkish copy as given.

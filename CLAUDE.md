# Purlina Matrix — PRD + Build Lore

Status: building against the real client brief (extracted from `Purlina Site.pdf`, a Canva mockup — see `/assets/brief/`) using a Vertex Animation Texture (VAT) morph. This file is the canonical context for every Claude Code session on this repo — read section 3 in full before touching the blob, the shader, or the bake script.

## 1. The brief

Client/brand: **Purlina Matrix** — a material/coating product positioned as adaptable across 900+ industries (automotive, pharma/medical, cosmetics, etc.). There are no individual physical SKUs to render; the hero visual is a single liquid chrome blob that idles, then twirls and literally becomes the silhouette of whichever sector is being demonstrated, then twirls back to blob for the next one.

**Placeholder sector models:** no Purlina-specific 3D assets exist yet. The project reuses the 5 Khronos sample GLBs it started with (`/assets/products/`), reframed by silhouette:

| Sector (VAT row) | Stand-in GLB |
|---|---|
| `automotive` | ToyCar.glb |
| `cosmetics` | WaterBottle.glb |
| `footwear` | MaterialsVariantsShoe.glb |
| `electronics` | BoomBox.glb |
| `manufacturing` | AntiqueCamera.glb |

Swap these for real Purlina sector assets whenever they're available — nothing downstream cares where the GLB came from, the bake script just needs a file path per sector name in `scripts/bake-positions.mjs`'s `SECTOR_FILES` map.

### Scroll structure (per-product sections, decided over generic "one continuous scroll")

Each sector gets its own full-height section. Within that section's own scroll range: blob → twirl → resolves into that sector's conformed shape → holds → twirl → resolves back into blob, before the next section repeats the cycle for the next sector. The blob never stays "mid-morph" across a section boundary — see `RAMP_IN_END`/`RAMP_OUT_START` in `Experience.jsx`.

Current section order (`src/content/scroll-script.json`): intro → benefits (Faydalar) → automotive → cosmetics → footwear → electronics → manufacturing → outro (scale statement + CTA). Sections without a `sector` field don't drive the blob — it just stays at whatever the last sector section resolved to (blob, at rest, by construction).

### Success criteria

55-60fps on a mid M-series Mac / decent Windows laptop, graceful mobile degradation (lower-poly VAT tier), Astro shell stays static, no layout shift tied to scroll.

## 2. Stack (locked)

| Layer | Choice | Why |
|---|---|---|
| Shell / SSG | Astro 5 | Static everything except the canvas. |
| 3D | Three.js + React Three Fiber + drei | Declarative scene graph, raw Three.js escape hatches for the VAT shader injection. |
| Blob material | `THREE.MeshPhysicalMaterial` + `onBeforeCompile` | Real PBR lighting and env-map reflections — required for a believable mirror-chrome look. Custom GLSL is injected into the standard vertex shader, not built from scratch. |
| Blob topology | Shared master icosphere (`blobTopology.js`) | One vertex count/order reused by every VAT state — see section 3. |
| Conform step | `three-mesh-bvh` nearest-surface-point projection | Programmatic stand-in for Blender's Shrinkwrap "Nearest Surface Point" mode — there's no Blender in this environment. Swappable later for real Blender-conformed exports through the same bake pipeline if quality demands it (this matters most on concave geometry, e.g. the inside curve of the shoe). |
| Scroll | GSAP + ScrollTrigger | One per product section, scrubbed. |
| Smooth scroll | Lenis | `useLenisScroll()` wires it into GSAP's ticker once; per-section choreography lives in each section's own ScrollTrigger. |
| Hosting | Cloudflare Pages | Same as usual. |

**Rejected approaches (don't re-litigate these without a real reason):**
- *GPGPU point-cloud morphing* — points have no continuous surface, can't hold a mirror-chrome specular highlight.
- *MeshTransmissionMaterial / glass* — that's a transmission/refraction look, not opaque mirror chrome. Use `MeshPhysicalMaterial` with `metalness: 1`.
- *A separate flat-icon overlay layer* — earlier drafts of this brief had sector icons rotating near the blob. The current, final read of the brief is that the blob itself becomes each shape; there is no second icon layer. Don't resurrect `SectorIcons.jsx`-style scaffolding.
- *Literal Blender Shrinkwrap* — not available in this environment; see "Conform step" above.

## 3. The Core Technique — Vertex Animation Texture (VAT) morph

This is the part most likely to be reinvented badly if this section isn't read first. The blocker on "just morph between the blob and each product" is topology mismatch — solved here, not avoided.

### Step 1 — Master topology (`src/experience/blobTopology.js`)

One subdivided icosphere, reused as-is for **every** state (idle blob + every conformed sector). Two tiers, each its own vertex budget, each baked separately:

- desktop: `IcosahedronGeometry(1, 30)` → merged ≈ 9705 verts
- mobile: `IcosahedronGeometry(1, 15)` → merged ≈ 2619 verts

`mergeVertices()` (from `three/examples/jsm/utils/BufferGeometryUtils.js`) is required — `IcosahedronGeometry` duplicates vertices at its UV seams, so without merging, normals come out faceted no matter how high the detail. **Note:** three.js's `detail` parameter is not the recursive-subdivision frequency it looks like; the values above were found empirically by checking merged vertex counts directly, not derived from a formula. If you need a different vertex budget, re-check empirically rather than guessing a `detail` value.

This module is imported by **both** the Node bake script and the browser runtime. That's deliberate — it's the only way to guarantee the conformed exports and the live mesh agree on vertex order without serializing/loading an extra index buffer asset.

### Step 2 — Conform the blob to each sector (`scripts/bake-positions.mjs`)

For each sector GLB: load its triangles, rescale/recenter them to roughly the master blob's own scale (skip this and a tiny product collapses every blob vertex onto the same few points instead of tracing its silhouette), build a `MeshBVH` (three-mesh-bvh) over them, then for every master-blob vertex find its nearest point on that surface via `bvh.closestPointToPoint()`. The result has the sector's silhouette but the blob's exact vertex count/order — that shared topology is what makes the morph possible. Normalize the conformed result (recenter, rescale to unit bounding-sphere radius) so all sectors land at a consistent on-screen scale regardless of the real-world size of the source GLB.

Also conform the resting "blob" pose — that's just the unmodified master positions, run through the same normalize step for consistency.

### Step 3 — Bake VAT textures

For each tier: combine the blob + 5 conformed sectors into one position texture and one normal texture, each `width = vertexCount`, `height = 6` (one row per state, RGBA float, alpha unused padding). Normals are recomputed per state via `geometry.computeVertexNormals()` using the shared index buffer — much simpler than deriving them at runtime. Output: `public/textures/vat/{positions,normals}-{tier}.bin`, raw `Float32Array` buffers (not PNG — these need full float precision, not 8-bit channels).

`VAT_STATES` in `blobTopology.js` (`['blob', 'automotive', 'cosmetics', 'footwear', 'electronics', 'manufacturing']`) is the single source of truth for row order — both the bake script and the runtime import it, so they can't drift out of sync with each other.

### Step 4 — Runtime shader (`LiquidBlobMaterial.js`, applied via `LiquidBlob.jsx`)

One mesh, one index buffer (the master topology's), reused for every state — never swapped. `onBeforeCompile` injects custom GLSL into `MeshPhysicalMaterial`'s vertex shader, replacing `<beginnormal_vertex>` and `<begin_vertex>`:

1. Sample the position VAT texture at the current `uFromRow`/`uToRow`, `mix()` by `uProgress`.
2. Add a pseudo-curl-noise twirl displacement on top — additive, enveloped by `sin(uProgress * PI) * uTwirlStrength`, peaking mid-transition, resolving to zero at both ends so it settles cleanly into the resolved shape. (It's three independently-offset simplex noise samples used as a vector field — a cheap, standard shader-art approximation of curl noise, not a true divergence-free field. Said so directly in the code; don't relabel it as literal curl noise.)
3. Always add a separate, much lower-amplitude continuous wobble (`uIdleAmount`) so the blob never looks static, including while fully resolved into a sector shape.
4. Normals are derived by finite-differencing the displaced surface along two tangents off the mixed VAT normal — a mirror material is sensitive enough to normal quality that skipping this and reusing the static VAT normal reads as visibly wrong once the wobble/twirl displacement is moving the surface.

Why inject into `MeshPhysicalMaterial` rather than hand-write a `ShaderMaterial`: hand-rolling PBR lighting from scratch would throw away the exact thing that makes this material look right (real lighting response, real env-map reflections). `onBeforeCompile` keeps all of that and only touches vertex position/normal.

Uniforms are created up front in `createLiquidBlobMaterial()` (`material.userData.uniforms`), not inside `onBeforeCompile` — `onBeforeCompile` only runs once the renderer first compiles the material, so creating uniform objects there would leave nothing to write to before the first compile. `onBeforeCompile` just points `shader.uniforms` at the same pre-created objects.

A per-vertex `aVatU` attribute (`(index + 0.5) / vertexCount`, built once in `LiquidBlob.jsx`) is how the shader looks up its row — not `gl_VertexID`, which needs GLSL3 and would require rewriting the fragment shader's output handling too for no real benefit here.

### Choreography (`Experience.jsx`)

Each sector section gets its own `ScrollTrigger` (`start: 'top top', end: 'bottom top'`, scrubbed across that section's own height). `computeSectionState(localProgress, sectorRow)` maps local progress to `{fromRow, toRow, progress, twirlStrength}`:

- `< 0.2`: ramping blob → sector, twirl on.
- `0.2–0.8`: holding at the resolved sector shape, twirl off (idle wobble still runs, separately).
- `> 0.8`: ramping sector → blob, twirl on.

Adjacent sections hand off cleanly because both sides resolve to "blob" at the shared boundary by construction — no explicit synchronization needed between sections.

## 4. Repo structure

```
/src
  /experience
    Experience.jsx          <- R3F canvas root, per-section ScrollTriggers, text sections
    LiquidBlob.jsx           <- loads tier VAT textures, builds geometry+aVatU, drives uniforms
    LiquidBlobMaterial.js    <- MeshPhysicalMaterial + onBeforeCompile VAT/twirl/wobble injection
    blobTopology.js          <- shared (Node+browser) master geometry + VAT_STATES ordering
    noiseGLSL.js             <- Ashima simplex noise GLSL snippet
    useScrollTimeline.js     <- useLenisScroll(): Lenis <-> GSAP ticker <-> ScrollTrigger wiring
    experience.css
  /content
    scroll-script.json       <- section copy + which `sector` (if any) each section drives
  /pages                    <- Astro routes, SEO, layout chrome
/scripts
  bake-positions.mjs        <- conform + bake VAT textures, per tier (see section 3)
/public/textures/vat        <- baked position/normal VAT textures, per tier
/assets/products             <- placeholder sector GLBs (see section 1's mapping table)
/assets/brief                <- the source Purlina_Site.pdf + extracted reference images
```

## 5. Open items

- Real Purlina sector models/branding — the automotive/cosmetics/footwear/electronics/manufacturing GLBs are silhouette stand-ins, not Purlina assets.
- "Yeni Nesil ....." tagline is incomplete in the client brief — confirm the rest before launch copy is final.
- Outro's "Purlina Matrix Oluştur" search input — confirm what it actually does (sector search/filter? lead-gen form? static for now?) before wiring real behavior.
- Conform quality on concave geometry (nearest-surface-point can produce uneven coverage there, e.g. the inside curve of the shoe) — re-check visually per sector; swap in a real Blender Shrinkwrap export through the same bake pipeline if it looks rough.

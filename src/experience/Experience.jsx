// Owns the scroll-driven canvas and the DOM text sections. The blob lives for
// the whole page; sections that name a `sector` drive it through a
// blob -> twirl -> conformed shape -> twirl -> blob cycle local to that
// section's own scroll range, per CLAUDE.md section 3. Sections without a
// `sector` (intro/outro) leave the blob at whatever it last resolved to.
import { useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { Environment, MeshReflectorMaterial } from '@react-three/drei';
import { EffectComposer, Bloom, Vignette, ChromaticAberration } from '@react-three/postprocessing';
import { BlendFunction } from 'postprocessing';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import LiquidBlob, { useBlobTier } from './LiquidBlob';
import Header from './Header';
import { useLenisScroll } from './useScrollTimeline';
import { VAT_STATES } from './blobTopology';
import './experience.css';
import scrollScript from '../content/scroll-script.json';

gsap.registerPlugin(ScrollTrigger);

const BLOB_ROW = VAT_STATES.indexOf('blob');

// Local-progress curve within a sector section: ramp blob->sector, hold
// resolved, ramp sector->blob. Twirl is enveloped (sin(progress*PI)) only
// during the ramps, per CLAUDE.md — never while holding at rest. Narrowed
// from 0.2/0.8 so more of each section's scroll range is spent at the
// readable, fully-formed shape rather than mid-transition.
const RAMP_IN_END = 0.12;
const RAMP_OUT_START = 0.88;

function computeSectionState(localProgress, sectorRow) {
  if (localProgress < RAMP_IN_END) {
    return { fromRow: BLOB_ROW, toRow: sectorRow, progress: localProgress / RAMP_IN_END, twirlStrength: 1 };
  }
  if (localProgress > RAMP_OUT_START) {
    return {
      fromRow: sectorRow,
      toRow: BLOB_ROW,
      progress: (localProgress - RAMP_OUT_START) / (1 - RAMP_OUT_START),
      twirlStrength: 1,
    };
  }
  return { fromRow: sectorRow, toRow: sectorRow, progress: 0, twirlStrength: 0 };
}

// The blob sits opposite whichever side the text occupies, so it never
// covers the copy it's morphing next to.
function xSignFor(side) {
  if (side === 'left') return 1;
  if (side === 'right') return -1;
  return 0;
}

// The tent function crossfades into/out of neighboring sections — but the
// very first section has nothing before it to fade in from, and the last
// has nothing after it to fade out to, so they hold at full opacity past
// their own midpoint instead of fading back toward 0.
function computeFade(progress, isFirst, isLast) {
  if (isFirst && progress <= 0.5) return 1;
  if (isLast && progress >= 0.5) return 1;
  return 1 - Math.abs(progress - 0.5) * 2;
}

// The blob already changes shape per industry — this extends that same
// "adapts to every sector" idea to color/mood. Each sector tints the page's
// ambient glow with its own accent as you scroll into it, instead of every
// section sharing one flat dark palette. Picked for a cinematic, moody
// saturation rather than candy-bright.
const SECTOR_ACCENTS = {
  automotive: '#3aa0ff',
  cosmetics: '#f0879c',
  footwear: '#e8893f',
  electronics: '#9b6bff',
  manufacturing: '#c2703f',
};

// Nothing on the page hints that there's more below the fold on first paint —
// a small bouncing cue gives first-time visitors a reason to scroll. Hides
// itself as soon as the user actually does, via plain native scroll (Lenis
// drives real window.scrollY here, confirmed separately), not tied into the
// GSAP/ScrollTrigger machinery driving the section choreography.
function ScrollCue() {
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const onScroll = () => setVisible(window.scrollY < 80);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <div className={`experience__scroll-cue${visible ? '' : ' experience__scroll-cue--hidden'}`} aria-hidden="true">
      <span>Kaydır</span>
      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </div>
  );
}

// Covers the otherwise-blank flash before GPU-tier detection + VAT textures
// finish loading (typically 1-2s) with a branded screen instead of nothing.
function LoadingScreen({ visible }) {
  return (
    <div className={`experience__loading${visible ? '' : ' experience__loading--hidden'}`} aria-hidden="true">
      <span className="experience__wordmark">PURLINA MATRIX</span>
    </div>
  );
}

// A thin hairline of dots, one per section — orientation/pacing cue so the
// scroll reads as a deliberate journey with a known length, not an
// infinite-scroll void. Clicking one jumps there, same Lenis-driven smooth
// scroll as the header nav.
function ProgressDots({ scenes, activeSection, lenisRef }) {
  const handleClick = (event, id) => {
    event.preventDefault();
    lenisRef.current?.scrollTo(`#${id}`, { duration: 1.2 });
  };

  return (
    <nav className="experience__progress" aria-label="Sayfa içinde gezinme">
      {scenes.map((scene) => (
        <a
          key={scene.id}
          href={`#${scene.id}`}
          className={`experience__progress-dot${scene.id === activeSection ? ' experience__progress-dot--active' : ''}`}
          onClick={(event) => handleClick(event, scene.id)}
          aria-label={scene.heading || scene.id}
        />
      ))}
    </nav>
  );
}

function TextScenes({ scenes, blobStateRef, lenisRef, onActiveSectionChange }) {
  // Avoids re-running the whole trigger-setup effect below on every
  // Experience render just because it passes a fresh inline callback.
  const onActiveSectionChangeRef = useRef(onActiveSectionChange);
  onActiveSectionChangeRef.current = onActiveSectionChange;

  useEffect(() => {
    const sections = gsap.utils.toArray('.experience__scene');
    const isFirst = (i) => i === 0;
    const isLast = (i) => i === sections.length - 1;
    // Whichever section currently has the highest fade is the one most "in
    // view" — drives the nav highlight and progress indicator. Compared
    // across all sections' fades since each section's own ScrollTrigger
    // only knows its own progress, not its neighbors'.
    const fades = new Array(sections.length).fill(0);
    let activeIndex = -1;
    const reportActiveSection = () => {
      let bestIndex = 0;
      for (let j = 1; j < fades.length; j += 1) {
        if (fades[j] > fades[bestIndex]) bestIndex = j;
      }
      if (bestIndex !== activeIndex) {
        activeIndex = bestIndex;
        onActiveSectionChangeRef.current?.(scenes[bestIndex].id);
      }
    };

    const triggers = sections.map((section, i) => {
      const scene = scenes[i];
      const sectorRow = scene.sector ? VAT_STATES.indexOf(scene.sector) : -1;
      const xSign = xSignFor(scene.side);
      const textEl = section.querySelector('.experience__text');
      const glowEl = scene.sector ? document.getElementById(`sector-glow-${scene.sector}`) : null;

      // Shared by onUpdate and the initial-apply call below it, so the two
      // can never drift out of sync with each other.
      const applyFade = (fade) => {
        const clamped = Math.max(0, fade);
        section.style.opacity = String(clamped);
        // Text settles into place rather than just appearing — same fade
        // value already being computed, no extra scroll tracking needed.
        if (textEl) textEl.style.transform = `translateY(${(1 - clamped) * 16}px)`;
        // Tints the shared ambient glow with this sector's accent while its
        // section is in view, crossfading for free at section boundaries
        // since `fade` itself already crosses smoothly there.
        if (glowEl) glowEl.style.opacity = String(clamped);
        fades[i] = clamped;
        reportActiveSection();
      };

      const trigger = ScrollTrigger.create({
        trigger: section,
        start: 'top top',
        end: 'bottom top',
        scrub: true,
        onUpdate: (self) => {
          applyFade(computeFade(self.progress, isFirst(i), isLast(i)));
          blobStateRef.current = {
            ...(sectorRow >= 0 ? computeSectionState(self.progress, sectorRow) : blobStateRef.current),
            xSign,
            accentHex: scene.sector ? SECTOR_ACCENTS[scene.sector] : '#ffffff',
          };
        },
      });
      // onUpdate only fires on an actual scroll event, never at creation —
      // without applying it once from the trigger's already-computed initial
      // progress, every section sits at the CSS default opacity:0 (the intro
      // heading would be invisible on first paint) until the user scrolls.
      applyFade(computeFade(trigger.progress, isFirst(i), isLast(i)));
      return trigger;
    });
    // Async asset loading (GPU detection, VAT textures, HDRI) and Lenis's own
    // height recalculation can both shift page layout after these triggers'
    // start/end were first measured, leaving the last section's "end" stale
    // and short of where the page actually stops scrolling. Refreshing once
    // the page has had a moment to settle re-measures against final layout.
    const refreshTimer = setTimeout(() => ScrollTrigger.refresh(), 1000);

    // Magnetic scroll: once scrolling actually stops (no scroll events at
    // all for 200ms — covers both the user releasing input and Lenis's own
    // inertia settling), ease the remaining short distance to the nearest
    // section's "formed" midpoint (local progress 0.5, the middle of the
    // hold zone) instead of leaving the user resting wherever they happened
    // to stop, including mid-transition. Goes through lenis.scrollTo()
    // directly rather than GSAP's own snap config — Lenis already owns real
    // scroll position here (confirmed earlier), so a second library trying
    // to also drive it would fight for control.
    const nearestSnapTarget = (currentY) => {
      let best = null;
      let bestDist = Infinity;
      for (const section of sections) {
        const rect = section.getBoundingClientRect();
        const top = rect.top + currentY;
        const end = top + rect.height - window.innerHeight;
        const target = top + 0.5 * (end - top);
        const dist = Math.abs(target - currentY);
        if (dist < bestDist) {
          bestDist = dist;
          best = target;
        }
      }
      return best;
    };

    let snapTimer = null;
    const handleScroll = () => {
      clearTimeout(snapTimer);
      snapTimer = setTimeout(() => {
        const current = window.scrollY;
        const target = nearestSnapTarget(current);
        if (target !== null && Math.abs(target - current) > 4) {
          lenisRef.current?.scrollTo(target, { duration: 1.1 });
        }
      }, 200);
    };
    lenisRef.current?.on('scroll', handleScroll);

    return () => {
      clearTimeout(refreshTimer);
      clearTimeout(snapTimer);
      lenisRef.current?.off('scroll', handleScroll);
      triggers.forEach((t) => t.kill());
    };
  }, [scenes, blobStateRef, lenisRef]);

  return (
    <div className="experience__scroll">
      {scenes.map((scene) => (
        <section
          key={scene.id}
          id={scene.id}
          className={`experience__scene${scene.side ? ` experience__scene--${scene.side}` : ''}`}
        >
          <div className="experience__text">
            {scene.heading && <h2>{scene.heading}</h2>}
            {scene.benefits && (
              <>
                <h3>{scene.benefitsLabel}</h3>
                <ul>
                  {scene.benefits.map((benefit) => (
                    <li key={benefit}>{benefit}</li>
                  ))}
                </ul>
              </>
            )}
            {scene.body && <p>{scene.body}</p>}
            {scene.cta && (
              <form className="experience__cta" onSubmit={(e) => e.preventDefault()}>
                <input type="text" placeholder={scene.cta} aria-label={scene.cta} />
                <button type="submit" aria-label="search">
                  <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2">
                    <circle cx="11" cy="11" r="7" />
                    <line x1="21" y1="21" x2="16.65" y2="16.65" />
                  </svg>
                </button>
              </form>
            )}
            {scene.footer && (
              <footer className="experience__footer">
                <p>{scene.footer.copyright}</p>
                <p>{scene.footer.contact}</p>
              </footer>
            )}
          </div>
        </section>
      ))}
    </div>
  );
}

// Dark mirror plane beneath the blob — reflects the chrome's bloom-lit
// highlights in navy. Without a ground the object floats in void; with it
// the object exists in a *place*.
function GroundMirror() {
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -1.4, 0]}>
      <planeGeometry args={[22, 22]} />
      <MeshReflectorMaterial
        resolution={256}
        mixStrength={8}
        depthScale={1}
        minDepthThreshold={0.9}
        color="#07091a"
        metalness={0.5}
        roughness={1}
      />
    </mesh>
  );
}

// Floating light-motes drifting through the 3D scene. They slowly rotate so
// the depth plane shifts over time — gives the scene a living atmosphere even
// when the blob is idle. Small enough to read as dust/stars, bright enough to
// pick up the bloom pass and scatter a faint halo.
function AmbientParticles() {
  const count = 280;
  const positions = useMemo(() => {
    const arr = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const r = 2.5 + Math.random() * 7;
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      arr[i * 3] = r * Math.sin(phi) * Math.cos(theta);
      arr[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
      arr[i * 3 + 2] = (Math.random() - 0.5) * 5 - 1;
    }
    return arr;
  }, []);

  const ref = useRef();
  useFrame(({ clock }) => {
    if (ref.current) {
      ref.current.rotation.y = clock.elapsedTime * 0.014;
      ref.current.rotation.x = Math.sin(clock.elapsedTime * 0.007) * 0.08;
    }
  });

  return (
    <points ref={ref}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" count={count} array={positions} itemSize={3} />
      </bufferGeometry>
      <pointsMaterial size={0.022} color="#c0c8ff" transparent opacity={0.55} sizeAttenuation />
    </points>
  );
}

export default function Experience() {
  const tier = useBlobTier();
  const [blobReady, setBlobReady] = useState(false);
  const [activeSection, setActiveSection] = useState(scrollScript.scenes[0]?.id);
  const blobStateRef = useRef({ fromRow: BLOB_ROW, toRow: BLOB_ROW, progress: 0, twirlStrength: 0, xSign: 0, accentHex: '#ffffff' });
  const lenisRef = useLenisScroll();

  // R3F measures its container via react-use-measure on mount; on this page
  // that occasionally races the fixed-position container's layout and locks
  // the canvas at the browser's 300x150 default. A `resize` event after
  // react-use-measure's listener is attached kicks it into re-measuring, but
  // the exact mount timing isn't predictable, so retry across the first
  // second rather than relying on a single well-timed dispatch.
  useEffect(() => {
    const delays = [0, 100, 300, 600, 1000];
    const ids = delays.map((delay) => setTimeout(() => window.dispatchEvent(new Event('resize')), delay));
    return () => ids.forEach(clearTimeout);
  }, []);

  return (
    <div className="experience">
      {/* Purely decorative warm glow behind the canvas — the flat dark void
          otherwise has zero color or motion anywhere on the page. Sits at a
          negative z-index so it shows through the canvas's transparent
          background instead of covering it. */}
      <div className="experience__ambient" aria-hidden="true" />
      {/* One per sector, opacity-driven by that section's own scroll fade
          (see TextScenes' applyFade) — tints the glow with the active
          industry's accent color instead of every section sharing the same
          flat palette. */}
      {Object.entries(SECTOR_ACCENTS).map(([sector, color]) => (
        <div
          key={sector}
          id={`sector-glow-${sector}`}
          className="experience__sector-glow"
          style={{ '--glow-color': color }}
          aria-hidden="true"
        />
      ))}
      {/* Inline position/size so the Canvas measures a correctly-sized container on its
          very first commit — waiting on experience.css to apply raced R3F's resize
          observer and left the canvas stuck at the browser's 300x150 default. */}
      <div className="experience__canvas" style={{ position: 'fixed', inset: 0 }}>
        <Canvas
          camera={{ position: [0, 0, 4.5], fov: 38 }}
          dpr={[1, 1.5]}
          gl={{ antialias: true, alpha: true }}
          // "night" is intentionally dark (see Environment below) — nudge exposure up
          // a bit past the renderer default of 1 so it stays readable, not just moody.
          onCreated={(state) => {
            state.gl.toneMappingExposure = 1.6;
          }}
        >
          {/* "night" reads as moody/cinematic — a few sharp pinpoint highlights on a
              dark field — instead of "studio", whose softbox panels are clearly
              recognizable in the reflection and read as a product-photography rig. */}
          <Environment preset="night" />
          <GroundMirror />
          <AmbientParticles />
          {tier && <LiquidBlob tier={tier} stateRef={blobStateRef} onReady={() => setBlobReady(true)} />}
          <EffectComposer>
            <Bloom luminanceThreshold={0.15} luminanceSmoothing={0.85} intensity={2.0} mipmapBlur />
            <ChromaticAberration blendFunction={BlendFunction.NORMAL} offset={[0.0018, 0.0018]} />
            <Vignette offset={0.12} darkness={0.75} />
          </EffectComposer>
        </Canvas>
      </div>
      <Header lenisRef={lenisRef} activeSection={activeSection} />
      <TextScenes
        scenes={scrollScript.scenes}
        blobStateRef={blobStateRef}
        lenisRef={lenisRef}
        onActiveSectionChange={setActiveSection}
      />
      <ProgressDots scenes={scrollScript.scenes} activeSection={activeSection} lenisRef={lenisRef} />
      <ScrollCue />
      <LoadingScreen visible={!tier || !blobReady} />
      {/* Subtle film grain over the whole page, ties to CLAUDE.md's existing
          "cinematic film" brand language — breaks up the flat-digital feel
          everywhere, not just near the blob. */}
      <div className="experience__grain" aria-hidden="true" />
    </div>
  );
}

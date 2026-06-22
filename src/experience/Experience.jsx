// Owns the scroll-driven canvas and the DOM text sections. The blob lives for
// the whole page; sections that name a `sector` drive it through a
// blob -> twirl -> conformed shape -> twirl -> blob cycle local to that
// section's own scroll range, per CLAUDE.md section 3. Sections without a
// `sector` (intro/outro) leave the blob at whatever it last resolved to.
import { useEffect, useRef } from 'react';
import { Canvas } from '@react-three/fiber';
import { Environment } from '@react-three/drei';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import LiquidBlob, { useBlobTier } from './LiquidBlob';
import { useLenisScroll } from './useScrollTimeline';
import { VAT_STATES } from './blobTopology';
import './experience.css';
import scrollScript from '../content/scroll-script.json';

gsap.registerPlugin(ScrollTrigger);

const BLOB_ROW = VAT_STATES.indexOf('blob');

// Local-progress curve within a sector section: ramp blob->sector, hold
// resolved, ramp sector->blob. Twirl is enveloped (sin(progress*PI)) only
// during the ramps, per CLAUDE.md — never while holding at rest.
const RAMP_IN_END = 0.2;
const RAMP_OUT_START = 0.8;

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

function TextScenes({ scenes, blobStateRef }) {
  useEffect(() => {
    const sections = gsap.utils.toArray('.experience__scene');
    const triggers = sections.map((section, i) => {
      const scene = scenes[i];
      const sectorRow = scene.sector ? VAT_STATES.indexOf(scene.sector) : -1;

      return ScrollTrigger.create({
        trigger: section,
        start: 'top top',
        end: 'bottom top',
        scrub: true,
        onUpdate: (self) => {
          const fade = 1 - Math.abs(self.progress - 0.5) * 2;
          section.style.opacity = String(Math.max(0, fade));
          if (sectorRow >= 0) {
            blobStateRef.current = computeSectionState(self.progress, sectorRow);
          }
        },
      });
    });
    return () => triggers.forEach((t) => t.kill());
  }, [scenes, blobStateRef]);

  return (
    <div className="experience__scroll">
      {scenes.map((scene) => (
        <section key={scene.id} className="experience__scene">
          {scene.logo && <div className="experience__logo">{scene.logo}</div>}
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
          </div>
        </section>
      ))}
    </div>
  );
}

export default function Experience() {
  const tier = useBlobTier();
  const blobStateRef = useRef({ fromRow: BLOB_ROW, toRow: BLOB_ROW, progress: 0, twirlStrength: 0 });
  useLenisScroll();

  return (
    <div className="experience">
      {/* Inline position/size so the Canvas measures a correctly-sized container on its
          very first commit — waiting on experience.css to apply raced R3F's resize
          observer and left the canvas stuck at the browser's 300x150 default. */}
      <div className="experience__canvas" style={{ position: 'fixed', inset: 0 }}>
        <Canvas camera={{ position: [0, 0, 4.5], fov: 45 }} dpr={[1, 2]} gl={{ antialias: true, alpha: true }}>
          <Environment preset="studio" />
          <ambientLight intensity={0.5} />
          <directionalLight position={[3, 3, 3]} intensity={1.5} />
          <directionalLight position={[-3, -2, -2]} intensity={0.5} />
          {tier && <LiquidBlob tier={tier} stateRef={blobStateRef} />}
        </Canvas>
      </div>
      <TextScenes scenes={scrollScript.scenes} blobStateRef={blobStateRef} />
    </div>
  );
}

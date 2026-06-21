// Owns the whole scroll-driven canvas: a single deformable chrome/glass blob,
// the 5 DOM text sections, and the sector icon overlay. See CLAUDE.md sections
// 1 and 3 before changing the deformation math or the section timing — this
// follows the real Purlina Matrix brief, not a generic product-reveal morph.
import { useEffect, useMemo, useRef } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { MeshTransmissionMaterial, Environment } from '@react-three/drei';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { useScrollTimeline } from './useScrollTimeline';
import { createBlobGeometry, createBlobNoise, deformBlob } from './blobDeform';
import { SECTOR_ICONS } from './sectorIcons.jsx';
import './experience.css';
import scrollScript from '../content/scroll-script.json';

gsap.registerPlugin(ScrollTrigger);

const SECTION_COUNT = scrollScript.scenes.length;
const TWIRL_START = (SECTION_COUNT - 2) / SECTION_COUNT; // ramps from the start of the icons section...
const TWIRL_END = 1; // ...to the end of the CTA section, per the mockup (it never untwirls).
const ICON_FADE_START = TWIRL_START - 0.02;
const ICON_FADE_IN_END = TWIRL_START + 0.06;
const ICON_FADE_OUT_START = 1 - 1 / SECTION_COUNT - 0.04;
const ICON_FADE_OUT_END = 1 - 1 / SECTION_COUNT + 0.04;

function clamp01(v) {
  return Math.min(1, Math.max(0, v));
}

function BlobMesh({ twirlRef }) {
  const { geometry, basePositions } = useMemo(() => createBlobGeometry(), []);
  const noise3D = useMemo(() => createBlobNoise(), []);

  useFrame((state) => {
    deformBlob(geometry, basePositions, noise3D, {
      time: state.clock.elapsedTime,
      twirl: twirlRef.current,
    });
  });

  return (
    <mesh geometry={geometry}>
      <MeshTransmissionMaterial
        thickness={0.6}
        roughness={0.04}
        ior={1.15}
        chromaticAberration={0.04}
        anisotropy={0.1}
        distortion={0}
        temporalDistortion={0}
        clearcoat={1}
        color="#dfe8ee"
        background={null}
      />
    </mesh>
  );
}

function SectorIconOverlay({ iconRef }) {
  return (
    <div ref={iconRef} className="experience__icons" style={{ opacity: 0 }}>
      {SECTOR_ICONS.map(({ id, label, Icon }) => (
        <div key={id} className={`experience__icon experience__icon--${id}`} title={label}>
          <Icon />
        </div>
      ))}
    </div>
  );
}

function TextScenes({ scenes }) {
  useEffect(() => {
    const sections = gsap.utils.toArray('.experience__scene');
    const triggers = sections.map((section) =>
      ScrollTrigger.create({
        trigger: section,
        start: 'top bottom',
        end: 'bottom top',
        scrub: true,
        onUpdate: (self) => {
          const fade = 1 - Math.abs(self.progress - 0.5) * 2;
          section.style.opacity = String(Math.max(0, fade));
        },
      }),
    );
    return () => triggers.forEach((t) => t.kill());
  }, []);

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
  const twirlRef = useRef(0);
  const iconRef = useRef(null);

  useScrollTimeline({
    scrollerSelector: '.experience__scroll',
    onUpdate: (progress) => {
      twirlRef.current = clamp01((progress - TWIRL_START) / (TWIRL_END - TWIRL_START));

      const iconEl = iconRef.current;
      if (iconEl) {
        const fadeIn = clamp01((progress - ICON_FADE_START) / (ICON_FADE_IN_END - ICON_FADE_START));
        const fadeOut = 1 - clamp01((progress - ICON_FADE_OUT_START) / (ICON_FADE_OUT_END - ICON_FADE_OUT_START));
        iconEl.style.opacity = String(Math.min(fadeIn, fadeOut));
      }
    },
  });

  return (
    <div className="experience">
      {/* Inline position/size so the Canvas measures a correctly-sized container on its
          very first commit — waiting on experience.css to apply raced R3F's resize
          observer and left the canvas stuck at the browser's 300x150 default. */}
      <div className="experience__canvas" style={{ position: 'fixed', inset: 0 }}>
        <Canvas camera={{ position: [0, 0, 4.5], fov: 45 }} dpr={[1, 2]} gl={{ antialias: true, alpha: true }}>
          <Environment preset="studio" />
          <ambientLight intensity={0.4} />
          <directionalLight position={[3, 3, 3]} intensity={1.2} />
          <BlobMesh twirlRef={twirlRef} />
        </Canvas>
        <SectorIconOverlay iconRef={iconRef} />
      </div>
      <TextScenes scenes={scrollScript.scenes} />
    </div>
  );
}

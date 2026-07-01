// Renders the master blob topology with LiquidBlobMaterial, sampling whichever
// tier's VAT textures match the detected device. All animation state (which
// two rows to blend, how far, how much twirl) comes from `stateRef`, written
// by Experience.jsx's per-section ScrollTriggers — this component only reads
// it once per frame and pushes it into uniforms. See CLAUDE.md section 3.
import { useEffect, useMemo, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { getGPUTier } from 'detect-gpu';
import { createMasterBlobGeometry, VAT_STATES } from './blobTopology';
import { createLiquidBlobMaterial } from './LiquidBlobMaterial';

export function useBlobTier() {
  const [tier, setTier] = useState(null);

  useEffect(() => {
    let cancelled = false;
    getGPUTier()
      .then((result) => {
        if (!cancelled) setTier(result.isMobile || result.tier <= 1 ? 'mobile' : 'desktop');
      })
      .catch(() => {
        if (!cancelled) setTier('desktop');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return tier;
}

function buildVatUAttribute(vertexCount) {
  const array = new Float32Array(vertexCount);
  for (let i = 0; i < vertexCount; i++) array[i] = (i + 0.5) / vertexCount;
  return new THREE.BufferAttribute(array, 1);
}

async function loadVATTexture(url, vertexCount, rowCount) {
  const res = await fetch(url);
  const buffer = await res.arrayBuffer();
  const data = new Float32Array(buffer);
  const texture = new THREE.DataTexture(data, vertexCount, rowCount, THREE.RGBAFormat, THREE.FloatType);
  texture.minFilter = THREE.NearestFilter;
  texture.magFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  return texture;
}

export default function LiquidBlob({ tier, stateRef, onReady }) {
  const [ready, setReady] = useState(false);
  const meshRef = useRef();
  // Damped rather than assigned directly from stateRef each frame — scroll
  // (even through Lenis) still ultimately drives progress 1:1, which reads
  // as mechanical. Lagging slightly behind the target gives the morph itself
  // a sense of weight, like the material has actual viscosity.
  const smoothedRef = useRef({ progress: 0, twirlStrength: 0 });
  // Sector accent color — damped so switching sections fades the iridescence
  // hue instead of snapping. Stored as separate r/g/b for per-channel damp.
  const accentRef = useRef({ r: 1, g: 1, b: 1 });
  const accentTargetRef = useRef(new THREE.Color(1, 1, 1));
  // Avoids re-running the load effect below if the caller passes a fresh
  // inline callback on every render — only `tier` changing should refetch.
  const onReadyRef = useRef(onReady);
  onReadyRef.current = onReady;

  const geometry = useMemo(() => {
    const geo = createMasterBlobGeometry(tier);
    geo.setAttribute('aVatU', buildVatUAttribute(geo.attributes.position.count));
    return geo;
  }, [tier]);

  const material = useMemo(() => createLiquidBlobMaterial(), []);

  useEffect(() => {
    let cancelled = false;
    const vertexCount = geometry.attributes.position.count;
    const rowCount = VAT_STATES.length;

    Promise.all([
      loadVATTexture(`/textures/vat/positions-${tier}.bin`, vertexCount, rowCount),
      loadVATTexture(`/textures/vat/normals-${tier}.bin`, vertexCount, rowCount),
    ]).then(([positions, normals]) => {
      if (cancelled) return;
      material.userData.uniforms.uPositionsVAT.value = positions;
      material.userData.uniforms.uNormalsVAT.value = normals;
      material.userData.uniforms.uRowCount.value = rowCount;
      setReady(true);
      onReadyRef.current?.();
    });

    return () => {
      cancelled = true;
    };
  }, [geometry, material, tier]);

  useFrame((state, delta) => {
    const uniforms = material.userData.uniforms;
    uniforms.uTime.value = state.clock.elapsedTime;
    const s = stateRef.current;
    uniforms.uFromRow.value = s.fromRow;
    uniforms.uToRow.value = s.toRow;

    // Damped rather than assigned straight from scroll — fromRow/toRow are
    // discrete row indices so they jump, but the blend between them now
    // lags slightly, reading as the material having actual weight/viscosity
    // instead of mechanically tracking the scrollbar 1:1. Safe to lag even
    // across a row change: both sides of every section boundary resolve to
    // "blob" by construction, so a half-frame of stale progress still shows
    // a continuous shape, never a visible snap.
    const sm = smoothedRef.current;
    sm.progress = THREE.MathUtils.damp(sm.progress, s.progress, 10, delta);
    sm.twirlStrength = THREE.MathUtils.damp(sm.twirlStrength, s.twirlStrength, 7, delta);
    uniforms.uProgress.value = sm.progress;
    uniforms.uTwirlStrength.value = sm.twirlStrength;

    // Idle intensity varies per section — X1 is near-laminar (calm fluid),
    // X3 is convective turbulence (high thermal load). Damped so the surface
    // character transitions fluidly rather than snapping between scenes.
    uniforms.uIdleAmount.value = THREE.MathUtils.damp(
      uniforms.uIdleAmount.value,
      s.idleIntensity ?? 0.012,
      2,
      delta,
    );

    // Damp accent color per-channel toward the active sector's hue
    accentTargetRef.current.set(s.accentHex || '#ffffff');
    const ac = accentRef.current;
    ac.r = THREE.MathUtils.damp(ac.r, accentTargetRef.current.r, 3, delta);
    ac.g = THREE.MathUtils.damp(ac.g, accentTargetRef.current.g, 3, delta);
    ac.b = THREE.MathUtils.damp(ac.b, accentTargetRef.current.b, 3, delta);
    uniforms.uAccentColor.value.setRGB(ac.r, ac.g, ac.b);

    if (meshRef.current) {
      // Offset is a fraction of the live viewport width (in world units at the
      // blob's depth), not a fixed number, so the same "glide toward the edge"
      // feel holds on any aspect ratio instead of clipping off-screen on mobile.
      const targetX = (s.xSign ?? 0) * (state.viewport.width / 2) * 0.45;
      meshRef.current.position.x = THREE.MathUtils.damp(meshRef.current.position.x, targetX, 4, delta);
    }

    // Camera choreography: dolly in slightly while a shape is held/resolved
    // (twirlStrength 0), ease back out during the twirl transition — gives
    // the scroll journey a felt sense of motion rather than a locked-off
    // static shot. A faint lateral drift during transitions only (scaled by
    // twirlStrength) reads as a subtle handheld parallax, not a distraction.
    // A tiny always-on breathing motion (independent of twirlStrength) means
    // the camera is never perfectly frozen even at full rest. Mouse position
    // (R3F's state.pointer, no extra listener needed) adds a soft parallax
    // tilt on top — the one thing that made the page feel inert rather than
    // alive: nothing on screen responded to the user except scroll.
    const targetZ = 4.5 - (1 - s.twirlStrength) * 0.3;
    state.camera.position.z = THREE.MathUtils.damp(state.camera.position.z, targetZ, 2, delta);
    const idleBreathe = Math.sin(state.clock.elapsedTime * 0.4) * 0.03;
    const twirlDrift = Math.sin(state.clock.elapsedTime * 0.3) * 0.08 * s.twirlStrength;
    const mouseX = state.pointer.x * 0.18;
    const mouseY = state.pointer.y * 0.1;
    state.camera.position.y = THREE.MathUtils.damp(
      state.camera.position.y,
      idleBreathe + twirlDrift + mouseY,
      2,
      delta,
    );
    state.camera.position.x = THREE.MathUtils.damp(state.camera.position.x, mouseX, 2, delta);
  });

  if (!ready) return null;

  return <mesh ref={meshRef} geometry={geometry} material={material} scale={[1.3, 1.3, 1.3]} />;
}

// Renders the master blob topology with LiquidBlobMaterial, sampling whichever
// tier's VAT textures match the detected device. All animation state (which
// two rows to blend, how far, how much twirl) comes from `stateRef`, written
// by Experience.jsx's per-section ScrollTriggers — this component only reads
// it once per frame and pushes it into uniforms. See CLAUDE.md section 3.
import { useEffect, useMemo, useState } from 'react';
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

export default function LiquidBlob({ tier, stateRef }) {
  const [ready, setReady] = useState(false);

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
    });

    return () => {
      cancelled = true;
    };
  }, [geometry, material, tier]);

  useFrame((state) => {
    const uniforms = material.userData.uniforms;
    uniforms.uTime.value = state.clock.elapsedTime;
    const s = stateRef.current;
    uniforms.uFromRow.value = s.fromRow;
    uniforms.uToRow.value = s.toRow;
    uniforms.uProgress.value = s.progress;
    uniforms.uTwirlStrength.value = s.twirlStrength;
  });

  if (!ready) return null;

  return <mesh geometry={geometry} material={material} />;
}

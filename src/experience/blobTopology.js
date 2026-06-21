// Master blob topology shared by the bake script (Node) and the runtime
// (browser) — pure three.js math, no DOM. Every VAT state (idle blob + every
// conformed sector shape) reuses this exact vertex count/order, which is the
// whole point of the VAT technique: same mesh, same index buffer, every
// frame — only the sampled position/normal differ. Desktop and mobile use
// different subdivision levels, each baked as its own VAT texture pair.
import * as THREE from 'three';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

// three.js's IcosahedronGeometry "detail" isn't the recursive-subdivision
// frequency it looks like — these values were picked empirically (see CLAUDE.md
// section 3) to land in the desired post-merge vertex ranges.
export const TIERS = {
  desktop: { detail: 30 }, // ~9705 verts
  mobile: { detail: 15 }, // ~2619 verts
};

// Single source of truth for VAT row order — the bake script and the runtime
// both import this so they can never drift out of sync with each other.
export const VAT_STATES = ['blob', 'automotive', 'cosmetics', 'footwear', 'electronics', 'manufacturing'];

export function createMasterBlobGeometry(tier) {
  const { detail } = TIERS[tier];
  // IcosahedronGeometry duplicates vertices at its UV seams; merge them so
  // vertex count/order is stable and every conformed state shares one index buffer.
  return mergeVertices(new THREE.IcosahedronGeometry(1, detail));
}

// VAT (Vertex Animation Texture) bake: conforms the master blob topology onto
// each sector GLB's surface via nearest-surface-point projection (the same
// algorithm as Blender's Shrinkwrap "Nearest Surface Point" mode — there's no
// Blender in this pipeline, three-mesh-bvh does the projection), then writes
// every state's positions/normals into shared VAT textures. Runtime never
// touches a GLB or does any projection — it only samples these textures and
// mixes between two rows. See CLAUDE.md section 3.
//
// Every state (the resting blob pose + every conformed sector shape) reuses
// the SAME master topology (vertex count and index buffer), which is what
// makes a literal shape-to-shape morph possible without matching topology
// between the blob and the product GLBs.

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { NodeIO } from '@gltf-transform/core';
import * as THREE from 'three';
import { MeshBVH } from 'three-mesh-bvh';
import { createMasterBlobGeometry, TIERS, VAT_STATES } from '../src/experience/blobTopology.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const OUT_DIR = join(ROOT, 'public', 'textures', 'vat');

// Placeholder mapping: stand-ins for Purlina's real sectors until brand-specific
// models are available (see CLAUDE.md section 1). Same Khronos sample GLBs the
// project started with, reframed by silhouette: a car (automotive), a bottle
// (cosmetics), a shoe (footwear), a boombox (electronics), a camera (precision
// manufacturing). Keyed by name so this can only ever be read in VAT_STATES order.
const SECTOR_FILES = {
  automotive: 'ToyCar.glb',
  cosmetics: 'WaterBottle.glb',
  footwear: 'MaterialsVariantsShoe.glb',
  electronics: 'BoomBox.glb',
  manufacturing: 'AntiqueCamera.glb',
};
const SECTORS = VAT_STATES.slice(1).map((name) => ({ name, file: SECTOR_FILES[name] }));

/** Reads a GLB and returns world-space triangles: [{ a, b, c }]. */
async function loadTriangles(glbPath) {
  const io = new NodeIO();
  const document = await io.read(glbPath);
  const triangles = [];
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();

  for (const scene of document.getRoot().listScenes()) {
    scene.traverse((node) => {
      const mesh = node.getMesh();
      if (!mesh) return;

      const worldMatrix = new THREE.Matrix4().fromArray(node.getWorldMatrix());

      for (const prim of mesh.listPrimitives()) {
        if (prim.getMode() !== 4 /* TRIANGLES */) continue;
        const position = prim.getAttribute('POSITION');
        if (!position) continue;
        const indices = prim.getIndices();
        const vertexCount = indices ? indices.getCount() : position.getCount();

        for (let i = 0; i < vertexCount; i += 3) {
          const ia = indices ? indices.getScalar(i) : i;
          const ib = indices ? indices.getScalar(i + 1) : i + 1;
          const ic = indices ? indices.getScalar(i + 2) : i + 2;

          a.fromArray(position.getElement(ia, [])).applyMatrix4(worldMatrix);
          b.fromArray(position.getElement(ib, [])).applyMatrix4(worldMatrix);
          c.fromArray(position.getElement(ic, [])).applyMatrix4(worldMatrix);

          triangles.push({ a: a.clone(), b: b.clone(), c: c.clone() });
        }
      }
    });
  }

  return triangles;
}

/** Recenter triangle soup on its centroid and rescale to a target bounding-sphere radius. */
function normalizeTriangles(triangles, targetRadius = 1) {
  const centroid = new THREE.Vector3();
  let vertexCount = 0;
  for (const tri of triangles) {
    centroid.add(tri.a).add(tri.b).add(tri.c);
    vertexCount += 3;
  }
  centroid.divideScalar(vertexCount);

  let maxDist = 0;
  for (const tri of triangles) {
    maxDist = Math.max(
      maxDist,
      tri.a.distanceTo(centroid),
      tri.b.distanceTo(centroid),
      tri.c.distanceTo(centroid),
    );
  }
  const scale = maxDist > 0 ? targetRadius / maxDist : 1;

  return triangles.map((tri) => ({
    a: tri.a.clone().sub(centroid).multiplyScalar(scale),
    b: tri.b.clone().sub(centroid).multiplyScalar(scale),
    c: tri.c.clone().sub(centroid).multiplyScalar(scale),
  }));
}

function buildBVH(triangles) {
  const positions = new Float32Array(triangles.length * 9);
  triangles.forEach((tri, i) => {
    positions.set(
      [tri.a.x, tri.a.y, tri.a.z, tri.b.x, tri.b.y, tri.b.z, tri.c.x, tri.c.y, tri.c.z],
      i * 9,
    );
  });
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  return new MeshBVH(geometry);
}

/** Projects every master-blob vertex to its nearest point on the BVH surface. */
function conformToSurface(masterPositions, bvh) {
  const count = masterPositions.length / 3;
  const conformed = new Float32Array(masterPositions.length);
  const point = new THREE.Vector3();
  const target = {};

  for (let i = 0; i < count; i++) {
    point.set(masterPositions[i * 3], masterPositions[i * 3 + 1], masterPositions[i * 3 + 2]);
    bvh.closestPointToPoint(point, target);
    conformed[i * 3] = target.point.x;
    conformed[i * 3 + 1] = target.point.y;
    conformed[i * 3 + 2] = target.point.z;
  }
  return conformed;
}

/** Recenter on centroid and rescale so the bounding sphere has radius `targetRadius`. */
function normalizePoints(points, targetRadius = 1) {
  const count = points.length / 3;
  const centroid = new THREE.Vector3();
  for (let i = 0; i < count; i++) {
    centroid.x += points[i * 3];
    centroid.y += points[i * 3 + 1];
    centroid.z += points[i * 3 + 2];
  }
  centroid.divideScalar(count);

  let maxDist = 0;
  for (let i = 0; i < count; i++) {
    const dx = points[i * 3] - centroid.x;
    const dy = points[i * 3 + 1] - centroid.y;
    const dz = points[i * 3 + 2] - centroid.z;
    maxDist = Math.max(maxDist, Math.sqrt(dx * dx + dy * dy + dz * dz));
  }
  const scale = maxDist > 0 ? targetRadius / maxDist : 1;

  const out = new Float32Array(points.length);
  for (let i = 0; i < count; i++) {
    out[i * 3] = (points[i * 3] - centroid.x) * scale;
    out[i * 3 + 1] = (points[i * 3 + 1] - centroid.y) * scale;
    out[i * 3 + 2] = (points[i * 3 + 2] - centroid.z) * scale;
  }
  return out;
}

/** Smooth per-vertex normals for a given state, using the shared master index buffer. */
function computeSmoothNormals(indexArray, positions) {
  const geometry = new THREE.BufferGeometry();
  geometry.setIndex(new THREE.BufferAttribute(indexArray, 1));
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.computeVertexNormals();
  return geometry.attributes.normal.array;
}

async function bakeTier(tierName) {
  const masterGeometry = createMasterBlobGeometry(tierName);
  const masterPositions = masterGeometry.attributes.position.array;
  const indexArray = masterGeometry.index.array;
  const vertexCount = masterGeometry.attributes.position.count;

  const states = [];

  const blobPositions = normalizePoints(masterPositions.slice());
  states.push({ name: 'blob', positions: blobPositions, normals: computeSmoothNormals(indexArray, blobPositions) });

  for (const sector of SECTORS) {
    const glbPath = join(ROOT, 'assets', 'products', sector.file);
    const rawTriangles = await loadTriangles(glbPath);
    if (rawTriangles.length === 0) throw new Error(`${sector.file}: no triangles found`);

    // Rescale the product to roughly the master blob's own scale before
    // projecting, or every blob vertex collapses onto whichever tiny/huge
    // region happens to be closest instead of tracing the full silhouette.
    const triangles = normalizeTriangles(rawTriangles, 1);
    const bvh = buildBVH(triangles);
    const conformed = normalizePoints(conformToSurface(masterPositions, bvh));
    const normals = computeSmoothNormals(indexArray, conformed);

    states.push({ name: sector.name, positions: conformed, normals });
    console.log(`conformed ${sector.name} (tier=${tierName}, verts=${vertexCount})`);
  }

  const rowCount = states.length;
  const posVAT = new Float32Array(vertexCount * rowCount * 4);
  const normVAT = new Float32Array(vertexCount * rowCount * 4);

  states.forEach((state, row) => {
    for (let i = 0; i < vertexCount; i++) {
      const dst = (row * vertexCount + i) * 4;
      posVAT[dst] = state.positions[i * 3];
      posVAT[dst + 1] = state.positions[i * 3 + 1];
      posVAT[dst + 2] = state.positions[i * 3 + 2];
      posVAT[dst + 3] = 1;
      normVAT[dst] = state.normals[i * 3];
      normVAT[dst + 1] = state.normals[i * 3 + 1];
      normVAT[dst + 2] = state.normals[i * 3 + 2];
      normVAT[dst + 3] = 1;
    }
  });

  await writeFile(join(OUT_DIR, `positions-${tierName}.bin`), Buffer.from(posVAT.buffer));
  await writeFile(join(OUT_DIR, `normals-${tierName}.bin`), Buffer.from(normVAT.buffer));
  console.log(`wrote VAT textures for tier=${tierName}: ${vertexCount}x${rowCount}`);

  return { vertexCount, rowCount, states: states.map((s) => s.name) };
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });

  const manifest = { tiers: {} };
  for (const tierName of Object.keys(TIERS)) {
    manifest.tiers[tierName] = await bakeTier(tierName);
  }

  await writeFile(join(OUT_DIR, 'manifest.json'), JSON.stringify(manifest, null, 2));
  console.log('wrote manifest.json');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

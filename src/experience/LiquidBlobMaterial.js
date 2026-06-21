// Chrome liquid blob material: a real MeshPhysicalMaterial (real PBR
// lighting, real env-map reflections) with the VAT sampling/morph/twirl
// math injected into its vertex shader via onBeforeCompile. This is
// deliberately NOT a from-scratch ShaderMaterial — hand-rolling PBR lighting
// would throw away the exact thing that makes this material correct for a
// mirror-chrome look. See CLAUDE.md section 3.
import * as THREE from 'three';
import { SIMPLEX_NOISE_3D } from './noiseGLSL.js';

const VERTEX_DECLARATIONS = /* glsl */ `
uniform sampler2D uPositionsVAT;
uniform sampler2D uNormalsVAT;
uniform float uRowCount;
uniform float uFromRow;
uniform float uToRow;
uniform float uProgress;
uniform float uTwirlStrength;
uniform float uIdleAmount;
uniform float uTime;

attribute float aVatU;

${SIMPLEX_NOISE_3D}

vec2 vatUV(float row) {
  return vec2(aVatU, (row + 0.5) / uRowCount);
}

vec3 vatDisplacement(vec3 p) {
  // Pseudo-curl noise: three independently-offset noise samples used as a
  // vector field. Not a true divergence-free curl, but the standard cheap
  // approximation for "swirly, never-settling" motion in shader work.
  float twirlEnvelope = sin(uProgress * 3.14159265) * uTwirlStrength;
  vec3 twirl = vec3(
    snoise(p * 1.8 + vec3(0.0, 0.0, uTime * 0.6)),
    snoise(p * 1.8 + vec3(37.0, 17.0, uTime * 0.6)),
    snoise(p * 1.8 + vec3(71.0, 53.0, uTime * 0.6))
  ) * twirlEnvelope * 0.35;

  vec3 idle = vec3(
    snoise(p * 2.4 + vec3(0.0, 0.0, uTime * 0.25)),
    snoise(p * 2.4 + vec3(11.0, 5.0, uTime * 0.25)),
    snoise(p * 2.4 + vec3(23.0, 31.0, uTime * 0.25))
  ) * uIdleAmount;

  return twirl + idle;
}
`;

// Replaces <beginnormal_vertex>. Runs before <begin_vertex> in three's chunk
// order, so basePos/vatDisp are computed here and reused there. Normals are
// derived by finite-differencing the displaced surface along two tangents —
// a mirror material is sensitive enough to normal quality that just reusing
// the undisplaced VAT normal would read as visibly wrong during the wobble/twirl.
const NORMAL_BLOCK = /* glsl */ `
vec3 vatNormalFrom = texture2D(uNormalsVAT, vatUV(uFromRow)).xyz;
vec3 vatNormalTo = texture2D(uNormalsVAT, vatUV(uToRow)).xyz;
vec3 vatBaseNormal = normalize(mix(vatNormalFrom, vatNormalTo, uProgress));

vec3 vatFromPos = texture2D(uPositionsVAT, vatUV(uFromRow)).xyz;
vec3 vatToPos = texture2D(uPositionsVAT, vatUV(uToRow)).xyz;
vec3 basePos = mix(vatFromPos, vatToPos, uProgress);
vec3 vatDisp = vatDisplacement(basePos);

vec3 vatHelper = abs(vatBaseNormal.y) < 0.99 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0);
vec3 vatTangent1 = normalize(cross(vatBaseNormal, vatHelper));
vec3 vatTangent2 = normalize(cross(vatBaseNormal, vatTangent1));
float vatEps = 0.015;
vec3 vatDispT1 = vatDisplacement(basePos + vatTangent1 * vatEps);
vec3 vatDispT2 = vatDisplacement(basePos + vatTangent2 * vatEps);
vec3 vatDPdT1 = vatTangent1 * vatEps + (vatDispT1 - vatDisp);
vec3 vatDPdT2 = vatTangent2 * vatEps + (vatDispT2 - vatDisp);
vec3 objectNormal = normalize(cross(vatDPdT1, vatDPdT2));
if (dot(objectNormal, vatBaseNormal) < 0.0) objectNormal = -objectNormal;
`;

const POSITION_BLOCK = /* glsl */ `
vec3 transformed = basePos + vatDisp;
`;

export function createLiquidBlobMaterial() {
  const material = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color('#dfe3e6'),
    metalness: 1,
    roughness: 0.08,
    clearcoat: 0.3,
    clearcoatRoughness: 0.2,
  });

  // Created up front (not inside onBeforeCompile, which only runs once the
  // renderer first compiles this material) so callers can write uniform
  // values from frame one — onBeforeCompile below just points the shader's
  // own uniforms at these same value-holder objects.
  const uniforms = {
    uPositionsVAT: { value: null },
    uNormalsVAT: { value: null },
    uRowCount: { value: 6 },
    uFromRow: { value: 0 },
    uToRow: { value: 0 },
    uProgress: { value: 0 },
    uTwirlStrength: { value: 0 },
    uIdleAmount: { value: 0.012 },
    uTime: { value: 0 },
  };
  material.userData.uniforms = uniforms;

  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);

    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${VERTEX_DECLARATIONS}`)
      .replace('#include <beginnormal_vertex>', NORMAL_BLOCK)
      .replace('#include <begin_vertex>', POSITION_BLOCK);
  };
  material.customProgramCacheKey = () => 'liquid-blob-vat';

  return material;
}

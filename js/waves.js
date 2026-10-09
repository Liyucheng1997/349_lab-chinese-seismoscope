// 地面上的地震波传播可视化（P 波蓝、S 波橙）与震中标记
import * as THREE from 'three';

export function createWaves() {
  const geo = new THREE.PlaneGeometry(140, 140, 1, 1);
  geo.rotateX(-Math.PI / 2);
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: {
      uEpi: { value: new THREE.Vector2(-30, 0) },
      uT: { value: -1 },
      uVp: { value: 25 },
      uVs: { value: 10.7 },
      uAmp: { value: 1 },
      uOn: { value: 1 },
    },
    vertexShader: /* glsl */ `
      varying vec2 vXZ;
      void main(){
        vec4 wp = modelMatrix * vec4(position,1.0);
        vXZ = wp.xz;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec2 uEpi; uniform float uT, uVp, uVs, uAmp, uOn;
      varying vec2 vXZ;
      float train(float x, float k, float decay){
        if (x < 0.0) return 0.0;
        float w = sin(x * k) * exp(-x * decay);
        float front = exp(-x * 3.0);
        return abs(w) * 0.7 + front * 0.9;
      }
      void main(){
        if (uT < 0.0) discard;
        float d = distance(vXZ, uEpi);
        float p = train(uVp * uT - d, 1.4, 0.16);
        float s = train(uVs * uT - d, 2.1, 0.11) * 1.25;
        float fadeOut = 1.0 - smoothstep(9.0, 13.0, uT);
        float near = 1.0 - smoothstep(26.0, 52.0, length(vXZ));
        float src = exp(-d * 0.6) * (0.6 + 0.4 * sin(uT * 12.0));
        vec3 col = vec3(0.32, 0.72, 1.0) * p + vec3(1.0, 0.46, 0.16) * s + vec3(1.0, 0.25, 0.15) * src * 1.5;
        gl_FragColor = vec4(col * 0.4 * uAmp * fadeOut * near * uOn, 1.0);
      }`,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.y = 0.004;
  mesh.renderOrder = 2;

  // 震中标记
  const marker = new THREE.Group();
  const pillar = new THREE.Mesh(
    new THREE.CylinderGeometry(0.18, 0.18, 6, 24, 1, true),
    new THREE.MeshBasicMaterial({ color: 0xff4b2b, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }),
  );
  pillar.position.y = 3;
  marker.add(pillar);
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.5, 0.7, 48),
    new THREE.MeshBasicMaterial({ color: 0xff6a3d, transparent: true, opacity: 0.8, depthWrite: false, side: THREE.DoubleSide }),
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.01;
  marker.add(ring);

  return {
    mesh, marker, mat,
    setEpicenter(az, dist) {
      const x = Math.sin(az) * dist, z = -Math.cos(az) * dist;
      mat.uniforms.uEpi.value.set(x, z);
      marker.position.set(x, 0, z);
      mat.uniforms.uVp.value = dist / 1.2;
      mat.uniforms.uVs.value = dist / 2.8;
    },
    update(t, time) {
      mat.uniforms.uT.value = t;
      const s = 1 + 0.25 * Math.sin(time * 4);
      ring.scale.setScalar(s);
      pillar.material.opacity = 0.25 + 0.15 * Math.sin(time * 4);
    },
  };
}

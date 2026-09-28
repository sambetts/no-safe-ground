import * as THREE from 'three';

/** Gradient sky dome with a sun glow, stars at night and Kessra's ringed gas-giant companion. */
export class Sky {
  readonly mesh: THREE.Mesh;
  readonly uniforms = {
    uHorizon: { value: new THREE.Color(0x8a6a6a) },
    uZenith: { value: new THREE.Color(0x2a2a4a) },
    uSunDir: { value: new THREE.Vector3(0, 1, 0) },
    uSunColor: { value: new THREE.Color(0xffe0c0) },
    uNight: { value: 0 },
    uPlanetDir: { value: new THREE.Vector3(0.45, 0.42, -0.78).normalize() },
  };

  constructor(scene: THREE.Scene) {
    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: /* glsl */ `
        varying vec3 vDir;
        void main() {
          vDir = normalize(position);
          vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          gl_Position = p.xyww;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 uHorizon, uZenith, uSunDir, uSunColor, uPlanetDir;
        uniform float uNight;
        varying vec3 vDir;
        float hash(vec3 p) { return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }
        float noise(vec2 p) {
          vec2 i = floor(p); vec2 f = fract(p);
          float a = fract(sin(dot(i, vec2(127.1, 311.7))) * 43758.5453);
          float b = fract(sin(dot(i + vec2(1.0, 0.0), vec2(127.1, 311.7))) * 43758.5453);
          float c = fract(sin(dot(i + vec2(0.0, 1.0), vec2(127.1, 311.7))) * 43758.5453);
          float d = fract(sin(dot(i + vec2(1.0, 1.0), vec2(127.1, 311.7))) * 43758.5453);
          vec2 u = f * f * (3.0 - 2.0 * f);
          return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
        }
        void main() {
          vec3 d = normalize(vDir);
          float h = d.y;
          vec3 col = mix(uHorizon, uZenith, smoothstep(0.0, 0.55, h));
          col = mix(col, uHorizon * 0.7, smoothstep(0.0, -0.3, h));
          float s = max(dot(d, normalize(uSunDir)), 0.0);
          col += uSunColor * (pow(s, 400.0) * 6.0 + pow(s, 24.0) * 0.35 + pow(s, 4.0) * 0.12) * (1.0 - uNight);
          // stars
          vec3 sp = floor(d * 420.0);
          float st = step(0.9982, hash(sp)) * (0.5 + 0.5 * hash(sp + 3.0));
          col += vec3(st) * uNight * smoothstep(0.02, 0.35, h) * 2.0;
          // gas giant
          vec3 pd = normalize(uPlanetDir);
          float cosA = dot(d, pd);
          float R = 0.16;
          float ang = acos(clamp(cosA, -1.0, 1.0));
          vec3 right = normalize(cross(pd, vec3(0.0, 1.0, 0.0)));
          vec3 up = normalize(cross(right, pd));
          vec2 uv = vec2(dot(d, right), dot(d, up)) / R;
          // rings (tilted ellipse)
          vec2 ruv = vec2(uv.x * 0.94 + uv.y * 0.34, (uv.y * 0.94 - uv.x * 0.34) * 4.2);
          float rr = length(ruv);
          float ring = smoothstep(1.35, 1.4, rr) * smoothstep(2.25, 2.1, rr) * (0.55 + 0.45 * sin(rr * 40.0));
          float front = step(0.0, ruv.y);
          if (ang < R) {
            float r = ang / R;
            float lat = uv.y * 6.0 + noise(uv * 3.0) * 1.2;
            vec3 band = mix(vec3(0.85, 0.62, 0.45), vec3(0.55, 0.32, 0.3), 0.5 + 0.5 * sin(lat * 3.0));
            band = mix(band, vec3(0.9, 0.8, 0.65), smoothstep(0.6, 0.9, noise(uv * 8.0 + lat)) * 0.3);
            vec3 n = normalize(vec3(uv, sqrt(max(0.0, 1.0 - dot(uv, uv)))));
            float lit = clamp(dot(n, normalize(vec3(-0.6, 0.35, 0.7))), 0.0, 1.0);
            vec3 pc = band * (0.12 + lit * 1.1);
            pc *= 1.0 - pow(r, 6.0) * 0.6;
            col = mix(col, pc * mix(1.0, 0.55, uNight), 0.97 * smoothstep(1.0, 0.985, r));
            col = mix(col, vec3(0.8, 0.7, 0.6) * mix(0.9, 0.45, uNight), ring * front * 0.8);
          } else {
            col = mix(col, vec3(0.8, 0.7, 0.6) * mix(0.9, 0.45, uNight), ring * 0.8);
            col += vec3(1.0, 0.7, 0.5) * pow(max(0.0, 1.0 - (ang - R) * 12.0), 3.0) * 0.12;
          }
          gl_FragColor = vec4(col, 1.0);
        }
      `,
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
    });
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(600, 48, 24), mat);
    this.mesh.renderOrder = -10;
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);
  }

  follow(pos: THREE.Vector3): void {
    this.mesh.position.copy(pos);
  }
}

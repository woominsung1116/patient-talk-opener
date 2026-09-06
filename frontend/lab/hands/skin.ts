/**
 * 접촉 압박 표현 — 스펙 §3 프로토타입.
 *
 * 촉각이 없으니 "닿았다 / 누르고 있다"를 눈으로 알려줘야 한다. 스펙이 싼 것부터 셋을 제시한다:
 *   1) 접촉 그림자·음영 — 접촉점 주변이 어두워진다   (uShade)
 *   2) 홀드 침강        — 손이 법선 방향으로 들어간다 (PRESS_DEPTH, 배치는 main.ts)
 *   3) 피부 변형        — 접촉 반경 안이 눌려 들어간다 (uDepth)
 * 1·3 은 **재질 하나에 같이 주입**한다. 손 발자국까지의 부호거리(SDF)를 정점에서 한 번 구해
 * 변위·법선·음영이 전부 같은 거리에서 파생되므로 셋이 어긋나지 않는다.
 * 다만 **번지는 폭은 다르다** — 변형은 좁고(uSoft), 그림자는 넓다(uSoftShade). 이유는 아래 참조.
 *
 * 왜 별도 데칼 메시가 아닌가 (실측으로 버렸다):
 *   평면 원판 데칼을 접촉점에 놓으면 **곡면 피부와 교차**해서 가장자리가 칼로 자른 듯 잘린다.
 *   눌린 자국은 특히 심하다 — 데칼은 평평한데 피부는 파여 있어 타원으로 잘려 나온다.
 *   (캡처: hands_qa/lab5/both_deep.png 의 딱딱한 타원) 셰이더 항은 어떤 곡면이든 그대로 따라간다.
 *
 * ⚠ `anisotropy` 는 어디에도 쓰지 않는다 — UV 없는 메시에서 탄젠트 NaN → 전체 블랙아웃 전례.
 *   노멀맵도 안 쓴다. 눌린 면의 법선은 **해석적으로** 다시 계산한다.
 */
import * as THREE from 'three'

/** 눌림 깊이(m). 얕게/깊게가 **눈에 띄게** 달라야 한다는 것이 스펙 요구다. */
export const PRESS_DEPTH = { none: 0, shallow: 0.010, deep: 0.024 } as const

/**
 * 접촉 **발자국 반크기**(m) — (손끝 방향, 가로). 손이 눌러 앉는 사각 영역의 절반.
 *
 * 가우시안 원 하나로는 안 된다. 손은 18cm × 9cm 인데 반경 5cm 원으로 누르면
 * 손바닥 밑만 파이고 **손가락은 안 파인 피부를 뚫고 나온다** — 누르는 게 아니라
 * 관통으로 읽힌다(팀리드 지적, hands_qa/final/sheet_press.png).
 * 게다가 자국이 전부 손 밑에 깔려 **접촉 그림자가 아예 안 보인다.**
 *
 * 그래서 손 발자국 모양(둥근 사각)의 SDF 로 잡고, 그 **바깥으로 PRESS_SOFT 만큼 번지게** 한다.
 * 그림자가 손 실루엣 밖으로 삐져나와야 "닿았다"가 읽힌다.
 *
 * ⚠ 재질 속성 `anisotropy` 와 무관하다(그건 금지 항목). 감쇠 모양일 뿐이다.
 */
export const PRESS_HALF = {
  none: [0.080, 0.040], shallow: [0.082, 0.041], deep: [0.088, 0.045],
} as const
/** 발자국 바깥으로 **변형**이 잦아드는 거리(m). 눌린 자국의 테두리 폭. */
export const PRESS_SOFT = { none: 0.022, shallow: 0.026, deep: 0.036 } as const

/**
 * 발자국 바깥으로 **그림자**가 번지는 거리(m) — 변형보다 훨씬 넓다.
 *
 * 변형과 같은 폭을 쓰면 그림자의 진한 부분이 전부 손 밑에 깔리고
 * 손 밖으로는 꼬리만 나와서 화면상 −11% 밖에 안 어두워진다(실측). 그래서 안 보인다.
 * 접촉 그림자는 실제로도 접촉선에서 가장 진하고 바깥으로 서서히 퍼지므로,
 * 손 실루엣 밖에 **넓은 띠**로 남아야 "닿았다"가 읽힌다.
 */
export const PRESS_SHADE_SOFT = { none: 0.030, shallow: 0.055, deep: 0.075 } as const
/** 접촉 음영 최대 농도(알베도 감쇠 비율). 깊게가 확실히 진해야 한다. */
export const PRESS_SHADE = { none: 0, shallow: 0.42, deep: 0.72 } as const

export type PressId = keyof typeof PRESS_DEPTH

export type PressUniforms = {
  uContact: { value: THREE.Vector3 }
  /** 접촉면에서 **손끝이 향하는 방향**(월드). 발자국의 긴 축. */
  uAxis: { value: THREE.Vector3 }
  uDepth: { value: number }
  /** 발자국 반크기 (손끝 방향, 가로) */
  uHalf: { value: THREE.Vector2 }
  /** 발자국 바깥 변형 번짐 거리 */
  uSoft: { value: number }
  /** 발자국 바깥 **그림자** 번짐 거리 (uSoft 보다 넓다) */
  uSoftShade: { value: number }
  /** 발자국 모서리 반지름 — 0 이면 직각 모서리가 자국에 계단으로 남는다 */
  uRound: { value: number }
  uShade: { value: number }
}

/**
 * 피부 재질에 접촉 압박(변형 + 음영)을 주입한다.
 *
 * 왜 법선을 다시 계산하는가: 정점만 밀어 넣으면 실루엣은 들어가지만 **음영이 그대로**라
 * 정면에서 보면 눌린 게 거의 안 보인다. 눌림은 대부분 음영으로 읽힌다.
 * z = −d(r) 함몰면의 법선은 (d'(r)·û_radial, 1) 방향이므로 그대로 쓴다
 * (û_radial = 접평면 안에서 접촉점 반대 방향 단위벡터).
 *
 * 감쇠 모양은 **손 발자국(둥근 사각) SDF + smoothstep** 이다.
 * 원형 가우시안을 먼저 써 봤는데, 손은 18×9cm 인데 자국은 지름 10cm 원이라
 * 손가락이 안 파인 피부를 뚫고 나왔다(관통으로 읽힘). 발자국 모양이어야 손 전체가 얹힌다.
 */
export function applySkinPress(mat: THREE.Material): PressUniforms {
  const u: PressUniforms = {
    uContact: { value: new THREE.Vector3(0, 999, 0) },
    uAxis: { value: new THREE.Vector3(1, 0, 0) },
    uDepth: { value: 0 },
    uHalf: { value: new THREE.Vector2(0.08, 0.04) },
    uSoft: { value: 0.026 },
    uSoftShade: { value: 0.055 },
    uRound: { value: 0.028 },
    uShade: { value: 0 },
  }
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uContact = u.uContact
    shader.uniforms.uAxis = u.uAxis
    shader.uniforms.uDepth = u.uDepth
    shader.uniforms.uHalf = u.uHalf
    shader.uniforms.uSoft = u.uSoft
    shader.uniforms.uSoftShade = u.uSoftShade
    shader.uniforms.uRound = u.uRound
    shader.uniforms.uShade = u.uShade

    // 주입 위치가 중요하다. three 의 정점 셰이더는
    //   beginnormal_vertex → defaultnormal_vertex → normal_vertex(vNormal) → begin_vertex
    // 순서라, 법선은 **begin_vertex 보다 앞에서** 고쳐야 vNormal 에 반영된다.
    // 두 청크는 같은 main() 스코프라 여기서 만든 지역변수(dentD)를 아래에서 그대로 쓴다.
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        uniform vec3 uContact;
        uniform vec3 uAxis;
        uniform float uDepth;
        uniform vec2 uHalf;
        uniform float uSoft;
        uniform float uSoftShade;
        uniform float uRound;
        varying float vPress;
        varying float vShade;`)
      .replace('#include <beginnormal_vertex>', `#include <beginnormal_vertex>
        vec3 wpos = (modelMatrix * vec4(position, 1.0)).xyz;
        vec3 wnrm = normalize(mat3(modelMatrix) * objectNormal);
        vec3 toC = wpos - uContact;
        vec3 tang = toC - wnrm * dot(toC, wnrm);        // 접평면 성분

        // 접평면을 손 방향(긴 축)/가로 축으로 분해해 **손 발자국 모양**으로 누른다
        vec3 ax = normalize(uAxis - wnrm * dot(uAxis, wnrm));
        vec3 bx = cross(wnrm, ax);
        vec2 p = vec2(dot(tang, ax), dot(tang, bx));

        // 둥근 사각 SDF — 발자국 안쪽이 음수, 바깥이 양수(경계까지의 거리).
        // 모서리 반지름(uRound)이 0 이면 직각 모서리가 그대로 자국에 남아
        // 메시 격자와 만나 **계단 모양 각짐**이 보인다(실측: 자국 우상단 노치). 손 자국은 둥글다.
        vec2 qd = abs(p) - uHalf + uRound;
        float sd = length(max(qd, 0.0)) + min(max(qd.x, qd.y), 0.0) - uRound;

        // 발자국 안 1 → 바깥 uSoft 에서 0. 안쪽 경계를 살짝 먹여(-0.6·uSoft) 테두리를 부드럽게.
        float e0 = -uSoft * 0.6, e1 = uSoft;
        float t = clamp((sd - e0) / (e1 - e0), 0.0, 1.0);
        vPress = 1.0 - (t * t * (3.0 - 2.0 * t));       // 변위·법선이 쓰는 감쇠
        float dentD = uDepth * vPress;

        // 그림자는 **더 넓게** 번진다 — 손 실루엣 밖에서도 남아야 보인다
        float ts = clamp((sd - e0) / (uSoftShade - e0), 0.0, 1.0);
        vShade = 1.0 - (ts * ts * (3.0 - 2.0 * ts));

        // 해석적 법선. dt/dsd = 1/(e1-e0), d(vPress)/dt = -6t(1-t)
        // SDF 기울기는 발자국 안/밖 모두에서 정의된다 (밖: 가장 가까운 변, 안: 가장 가까운 축)
        vec2 gp = (max(qd.x, qd.y) > 0.0)
                  ? normalize(max(qd, 0.0)) * sign(p)
                  : (qd.x > qd.y ? vec2(sign(p.x), 0.0) : vec2(0.0, sign(p.y)));
        float dPress = -6.0 * t * (1.0 - t) / (e1 - e0);
        vec3 grad = uDepth * dPress * (gp.x * ax + gp.y * bx);
        vec3 wDent = normalize(wnrm + grad);
        objectNormal = normalize(inverse(mat3(modelMatrix)) * wDent);`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        transformed -= normal * dentD;`)

    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform float uShade;
        varying float vShade;`)
      // 알베도를 눌린 정도만큼 어둡게 — 접촉면 주변에 고이는 그늘.
      // 조명 계산 **전에** 넣어야 반사광까지 같이 죽어 "눌려서 그늘졌다"로 읽힌다.
      .replace('#include <color_fragment>', `#include <color_fragment>
        diffuseColor.rgb *= 1.0 - uShade * vShade;`)
  }
  mat.needsUpdate = true
  return u
}

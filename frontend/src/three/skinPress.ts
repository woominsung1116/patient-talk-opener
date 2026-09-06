/**
 * 접촉 압박 표현 (스펙 §3) — `frontend/lab/hands/skin.ts` 프로토타입을 본 씬용으로 옮긴 것.
 *
 * 촉각이 없으니 "닿았다 / 누르고 있다"를 눈으로 알려줘야 한다:
 *   1) 접촉 그림자·음영 — 접촉점 주변이 어두워진다   (uShade)
 *   2) 홀드 침강        — 손이 법선 방향으로 들어간다 (ClinicScene 의 PalpationRig 가 담당)
 *   3) 피부 변형        — 접촉 반경 안이 눌려 들어간다 (uDepth)
 * 1·3 은 **재질 하나에 같이 주입**한다. 손 발자국까지의 부호거리(SDF)를 한 번 구해
 * 변위·법선·음영이 전부 같은 거리에서 파생되므로 셋이 어긋나지 않는다.
 * 다만 **번지는 폭은 다르다** — 변형은 좁고(uSoft), 그림자는 넓다(uSoftShade).
 *
 * ── 랩 프로토타입에서 **바꾼 것** (환자는 정적 구가 아니라 SkinnedMesh 다) ──
 *  · 랩은 `beginnormal_vertex` 에서 `position` 을 월드로 올려 썼다. 스킨드 메시에서는 그 시점의
 *    `position` 이 **바인드 포즈**라 몸이 움직이면 자국이 딴 데 찍힌다. 그래서 스키닝이 끝난
 *    `project_vertex` **뒤**에서 `transformed` 를 쓴다.
 *  · 그 자리는 이미 `normal_vertex` 를 지나 vNormal 이 확정된 뒤라 정점에서 법선을 못 고친다.
 *    → 눌린 면의 법선은 **프래그먼트**에서 기울기를 더해 만든다(뷰 공간 벡터를 varying 으로 넘긴다).
 *  · 침강도 오브젝트 공간이 아니라 `mvPosition`(뷰 공간)에서 민다 — `inverse()` 를 쓰지 않기 위해서다.
 *    (three 기본 셰이더는 GLSL ES 1.00 이라 `inverse()` 가 없는 드라이버가 있다)
 *  · 접평면 기준을 정점 법선이 아니라 **접촉면 법선 uniform**(부위 앵커의 normal)으로 잡는다.
 *    곡면 어디서나 같은 발자국이 나오고, 탄젠트를 만들 필요가 없다.
 *
 * ⚠ `anisotropy` 는 어디에도 쓰지 않는다 — UV 없는 메시에서 탄젠트 NaN → 전체 블랙아웃 전례.
 *   노멀맵도 안 쓴다. 눌린 면의 법선은 **해석적으로** 계산한다.
 * ⚠ 평면 원판 데칼은 쓰지 않는다 — 곡면 피부와 교차해 가장자리가 칼로 자른 듯 잘린다(실측 폐기).
 */
import * as THREE from 'three'

/** 눌림 깊이(m). 얕게/깊게가 **눈에 띄게** 달라야 한다는 것이 스펙 요구다. */
export const PRESS_DEPTH = { none: 0, shallow: 0.010, deep: 0.024 } as const

/**
 * 접촉 **발자국 반크기**(m) — (손끝 방향, 가로).
 *
 * 가우시안 원 하나로는 안 된다. 손은 18cm × 9cm 인데 반경 5cm 원으로 누르면
 * 손바닥 밑만 파이고 **손가락은 안 파인 피부를 뚫고 나온다** — 누르는 게 아니라 관통으로 읽힌다.
 * 게다가 자국이 전부 손 밑에 깔려 접촉 그림자가 아예 안 보인다.
 * 그래서 손 발자국 모양(둥근 사각)의 SDF 로 잡고 그 **바깥으로 번지게** 한다.
 */
export const PRESS_HALF = {
  none: [0.080, 0.040], shallow: [0.082, 0.041], deep: [0.088, 0.045],
} as const
/** 발자국 바깥으로 **변형**이 잦아드는 거리(m). 눌린 자국의 테두리 폭. */
export const PRESS_SOFT = { none: 0.022, shallow: 0.026, deep: 0.036 } as const
/**
 * 발자국 바깥으로 **그림자**가 번지는 거리(m) — 변형보다 훨씬 넓다.
 * 같은 폭이면 진한 부분이 전부 손 밑에 깔려 화면상 −11% 밖에 안 어두워진다(실측).
 */
export const PRESS_SHADE_SOFT = { none: 0.030, shallow: 0.055, deep: 0.075 } as const
/** 접촉 음영 최대 농도(알베도 감쇠 비율). 깊게가 확실히 진해야 한다. */
export const PRESS_SHADE = { none: 0, shallow: 0.42, deep: 0.72 } as const
/** 발자국 모서리 반지름(m) — 0 이면 직각 모서리가 자국에 **계단 노치**로 남는다. */
export const PRESS_ROUND = 0.028

export type PressId = keyof typeof PRESS_DEPTH

export type PressUniforms = {
  /** 접촉점(월드). **눌리기 전** 체표 위치를 준다 */
  uContact: { value: THREE.Vector3 }
  /** 접촉면 법선(월드) — 부위 앵커의 normal. 발자국이 놓이는 평면을 정한다 */
  uPressNormal: { value: THREE.Vector3 }
  /** 접촉면에서 **손끝이 향하는 방향**(월드). 발자국의 긴 축 */
  uAxis: { value: THREE.Vector3 }
  uDepth: { value: number }
  /** 발자국 반크기 (손끝 방향, 가로) */
  uHalf: { value: THREE.Vector2 }
  /** 발자국 바깥 변형 번짐 거리 */
  uSoft: { value: number }
  /** 발자국 바깥 **그림자** 번짐 거리 (uSoft 보다 넓다) */
  uSoftShade: { value: number }
  uRound: { value: number }
  uShade: { value: number }
}

/** 눌린 자국을 지운다. 재질은 환자 쪽에 캐시돼 살아남으므로, 리그가 사라질 때 값을 되돌려야
 *  다음 화면에 **자국만 남은 배**가 나오지 않는다. */
export function clearSkinPress(u: PressUniforms): void {
  u.uDepth.value = 0
  u.uShade.value = 0
  u.uContact.value.set(0, 999, 0)
}

function makeUniforms(): PressUniforms {
  return {
    // 아무 데도 닿지 않은 초기값 — 환자에게서 멀리 떨어뜨려 둔다
    uContact: { value: new THREE.Vector3(0, 999, 0) },
    uPressNormal: { value: new THREE.Vector3(0, 1, 0) },
    uAxis: { value: new THREE.Vector3(1, 0, 0) },
    uDepth: { value: 0 },
    uHalf: { value: new THREE.Vector2(0.08, 0.04) },
    uSoft: { value: 0.026 },
    uSoftShade: { value: 0.055 },
    uRound: { value: PRESS_ROUND },
    uShade: { value: 0 },
  }
}

/** 이미 주입된 재질인지 표시 + uniform 보관. 같은 재질을 여러 메시가 공유하므로 필요하다. */
type PressMaterial = THREE.Material & { userData: { skinPress?: PressUniforms } }

/**
 * 피부 재질에 접촉 압박(변형 + 음영)을 주입한다. 같은 재질에 두 번 걸어도 안전하다.
 *
 * ⚠ 환자 재질은 **이미 `onBeforeCompile` 과 `customProgramCacheKey` 를 쓰고 있다**
 *   (RealisticPatient 의 표정·리그 주입). 덮어쓰면 그쪽이 죽으므로 반드시 **이어 붙인다.**
 *   캐시 키도 같이 늘려야 한다 — 안 그러면 three 가 주입 전에 컴파일해 둔 프로그램을 그대로 재사용해
 *   uniform 이 영영 안 먹는다(같은 키 = 같은 프로그램).
 */
export function applySkinPress(mat: THREE.Material): PressUniforms {
  const m = mat as PressMaterial
  const existing = m.userData.skinPress
  if (existing) return existing
  const u = makeUniforms()

  const prevCompile = m.onBeforeCompile
  m.onBeforeCompile = (shader, renderer) => {
    prevCompile?.call(m, shader, renderer)
    shader.uniforms.uContact = u.uContact
    shader.uniforms.uPressNormal = u.uPressNormal
    shader.uniforms.uAxis = u.uAxis
    shader.uniforms.uDepth = u.uDepth
    shader.uniforms.uHalf = u.uHalf
    shader.uniforms.uSoft = u.uSoft
    shader.uniforms.uSoftShade = u.uSoftShade
    shader.uniforms.uRound = u.uRound
    shader.uniforms.uShade = u.uShade

    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        uniform vec3 uContact;
        uniform vec3 uPressNormal;
        uniform vec3 uAxis;
        uniform float uDepth;
        uniform vec2 uHalf;
        uniform float uSoft;
        uniform float uSoftShade;
        uniform float uRound;
        varying float vSkinShade;
        varying vec3 vSkinGrad;`)
      /* 스키닝·모프가 끝난 뒤라야 `transformed` 가 실제로 화면에 서는 위치다.
         project_vertex 가 만든 `mvPosition` 을 그대로 밀어 gl_Position 을 다시 쓴다. */
      .replace('#include <project_vertex>', `#include <project_vertex>
        {
          vec3 wpos = (modelMatrix * vec4(transformed, 1.0)).xyz;
          vec3 n = normalize(uPressNormal);
          vec3 d = wpos - uContact;
          vec3 tang = d - n * dot(d, n);          // 접평면 성분

          // 접평면을 손 방향(긴 축)/가로 축으로 분해해 **손 발자국 모양**으로 누른다
          vec3 ax = uAxis - n * dot(uAxis, n);
          ax = length(ax) > 1e-5 ? normalize(ax) : vec3(1.0, 0.0, 0.0);
          vec3 bx = cross(n, ax);
          vec2 p = vec2(dot(tang, ax), dot(tang, bx));

          // 둥근 사각 SDF — 발자국 안쪽이 음수, 바깥이 양수(경계까지의 거리)
          vec2 qd = abs(p) - uHalf + uRound;
          float sd = length(max(qd, 0.0)) + min(max(qd.x, qd.y), 0.0) - uRound;

          // 발자국 안 1 → 바깥 uSoft 에서 0. 안쪽 경계를 살짝 먹여 테두리를 부드럽게
          float e0 = -uSoft * 0.6;
          float e1 = max(uSoft, e0 + 1e-4);
          float t = clamp((sd - e0) / (e1 - e0), 0.0, 1.0);
          float press = 1.0 - (t * t * (3.0 - 2.0 * t));

          // 그림자는 **더 넓게** 번진다 — 손 실루엣 밖에서도 남아야 보인다
          float ts = clamp((sd - e0) / max(uSoftShade - e0, 1e-4), 0.0, 1.0);
          vSkinShade = 1.0 - (ts * ts * (3.0 - 2.0 * ts));

          /* 해석적 법선 기울기. z = −d(r) 함몰면의 법선은 (d'(r)·û_radial, 1) 방향이다.
             SDF 기울기는 발자국 안/밖 모두에서 정의된다(밖: 가장 가까운 변, 안: 가장 가까운 축).
             ⚠ 정점에서 objectNormal 을 고치는 길은 막혀 있다 — 여기는 normal_vertex 이후라
               vNormal 이 이미 확정됐다. 그래서 **뷰 공간 기울기**를 넘겨 프래그먼트에서 더한다. */
          vec2 gp = (max(qd.x, qd.y) > 0.0)
                    ? normalize(max(qd, 0.0)) * sign(p)
                    : (qd.x > qd.y ? vec2(sign(p.x), 0.0) : vec2(0.0, sign(p.y)));
          float dPress = -6.0 * t * (1.0 - t) / (e1 - e0);
          vSkinGrad = mat3(viewMatrix) * (uDepth * dPress * (gp.x * ax + gp.y * bx));

          // 침강 — 접촉면 법선 반대(몸 안쪽)로 밀어 넣는다
          mvPosition.xyz += mat3(viewMatrix) * (-n * (uDepth * press));
          gl_Position = projectionMatrix * mvPosition;
        }`)

    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform float uShade;
        varying float vSkinShade;
        varying vec3 vSkinGrad;`)
      // 알베도를 눌린 정도만큼 어둡게 — 접촉면 주변에 고이는 그늘.
      // 조명 계산 **전에** 넣어야 반사광까지 같이 죽어 "눌려서 그늘졌다"로 읽힌다.
      .replace('#include <color_fragment>', `#include <color_fragment>
        diffuseColor.rgb *= 1.0 - uShade * vSkinShade;`)
      // 눌린 면의 음영. 변위만으로는 정면에서 거의 안 보인다 — 눌림은 대부분 음영으로 읽힌다.
      .replace('#include <normal_fragment_begin>', `#include <normal_fragment_begin>
        normal = normalize(normal + vSkinGrad);`)
  }

  /* 캐시 키를 늘리지 않으면 three 가 **주입 전에 컴파일해 둔 프로그램**을 그대로 돌려준다. */
  const prevKey = m.customProgramCacheKey
  m.customProgramCacheKey = () => `${prevKey ? prevKey.call(m) : ''}|skinpress1`
  m.needsUpdate = true
  m.userData.skinPress = u
  return u
}

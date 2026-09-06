/**
 * 헤어 대비 검증 리그. **src/ 를 수정하지 않는다** — 게임의 RealisticPatient 를 그대로 import 해
 * 헤어 머티리얼 처리(회색 블렌드·이방성·가닥 셰이더)와 ACES 톤매핑을 실제와 동일하게 태운다.
 * 조명·카메라는 src/three/AvatarLab.tsx 의 face 뷰와 같은 값을 쓴다.
 *
 * 쿼리
 *   ?av=mh_f60_ob         아바타 (쉼표로 여러 개 → 나란히 배치)
 *   &age=65               chronologicalAge (회색 블렌드 세기를 결정한다)
 *   &fixed=/lab/hair/out/fixed   헤어 map 을 이 디렉터리의 <텍스처이름>.png 로 런타임 교체
 *   &cam=face|interview   interview = 문진 화면의 카메라 거리
 */
import { Suspense, useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import { Canvas, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { RealisticPatient } from '../../src/three/RealisticPatient'
import type { MpfbVariant } from '../../src/three/avatarVariant'
import type { Emotion } from '../../src/types'

const q = new URLSearchParams(location.search)
const AVS = (q.get('av') ?? 'mh_f60_ob').split(',')
// 아바타별 나이 (쉼표 구분, av 순서와 짝). 회색 블렌드 세기를 결정하므로 반드시 실제 케이스 나이를 준다.
const AGES = (q.get('age') ?? '').split(',').map((v) => (v ? Number(v) : undefined))
const FIXED = q.get('fixed')
const CAM = q.get('cam') ?? 'face'
// head 본에서 카메라까지 거리(m). 0.62≈머리가 화면을 채움, 1.6≈문진 화면에서 보이는 크기
const FIT = Number(q.get('fit') ?? '0.78')

type RigEntry = { av: string; scene: THREE.Scene; hairs: THREE.Mesh[]; framed?: boolean; headY?: number }
const W = window as unknown as Record<string, unknown>
W.__rigs = [] as RigEntry[]

/** 헤어 재질을 모아 전역 레지스트리에 걸고, 요청 시 텍스처를 교체한다. */
function Rig({ av }: { av: string }) {
  const { scene, gl, camera } = useThree()
  useEffect(() => {
    const rigs = W.__rigs as RigEntry[]
    const collect = () => {
      const hairs: THREE.Mesh[] = []
      scene.traverse((o) => {
        const m = o as THREE.Mesh
        if (!m.isMesh) return
        const mat = m.material as THREE.MeshStandardMaterial
        const tag = `${m.name}|${mat?.name ?? ''}`.toLowerCase()
        if (/hair|bob|wig|ponytail|grump/.test(tag)) hairs.push(m)
      })
      return hairs
    }
    const entry: RigEntry = { av, scene, hairs: [] }
    rigs.push(entry)

    // 런타임 텍스처 교체 — GLB 파일은 그대로다.
    W.__swap = async (prefix: string, byAvatar: Record<string, string>) => {
      const out: unknown[] = []
      for (const r of W.__rigs as RigEntry[]) {
        for (const h of r.hairs) {
          const mat = h.material as THREE.MeshStandardMaterial
          if (!mat.map) { out.push({ av: r.av, mesh: h.name, err: 'no map' }); continue }
          const key = byAvatar[r.av] ?? mat.map.name
          if (!key) { out.push({ av: r.av, mesh: h.name, err: 'no name' }); continue }
          const url = `${prefix}/${key}.png`
          try {
            const tex = await new THREE.TextureLoader().loadAsync(url)
            tex.colorSpace = THREE.SRGBColorSpace
            tex.flipY = mat.map.flipY
            tex.wrapS = mat.map.wrapS
            tex.wrapT = mat.map.wrapT
            tex.anisotropy = mat.map.anisotropy
            tex.channel = mat.map.channel
            tex.needsUpdate = true
            mat.map = tex
            mat.needsUpdate = true
            out.push({ av: r.av, mesh: h.name, mat: mat.name, url, size: `${tex.image.width}x${tex.image.height}` })
          } catch (e) { out.push({ av: r.av, mesh: h.name, url, err: String(e) }) }
        }
      }
      return out
    }
    W.__hide = (v: boolean) => {
      for (const r of W.__rigs as RigEntry[]) for (const h of r.hairs) h.visible = !v
    }
    // GLB 가 12MB 라 첫 프레임엔 아직 씬에 없다. 붙을 때까지 폴링한다.
    const t = setInterval(() => {
      entry.hairs = collect()
      if (entry.hairs.length && !entry.framed) {
        entry.framed = true
        // 아바타마다 키가 달라 고정 카메라로는 남성 정수리가 잘린다.
        // 스킨드메시 바운딩박스는 바인드포즈 기준이라 못 믿는다 → head 본의 월드 위치로 맞춘다.
        scene.updateMatrixWorld(true)
        let head: THREE.Object3D | null = null
        scene.traverse((o) => { if ((o as THREE.Bone).isBone && /^head$/i.test(o.name)) head = o })
        const p = new THREE.Vector3()
        if (head) (head as THREE.Object3D).getWorldPosition(p)
        else p.set(0, 1.45, 0)
        const eye = p.clone()
        eye.y += 0.105                      // head 본은 턱 근처 → 정수리를 넣으려면 올린다
        camera.position.set(p.x, eye.y, p.z + FIT)
        camera.lookAt(eye)
        camera.updateProjectionMatrix()
        entry.headY = p.y
      }
      const rs = W.__rigs as RigEntry[]
      W.__ready = rs.length === AVS.length && rs.every((r) => r.hairs.length > 0)
      if (W.__ready) clearInterval(t)
    }, 400)
    return () => {
      clearInterval(t)
      const i = rigs.indexOf(entry)
      if (i >= 0) rigs.splice(i, 1)
    }
  }, [scene, gl, camera, av])
  return null
}

const CAMS: Record<string, { pos: [number, number, number]; fov: number; look: [number, number, number] }> = {
  // AvatarLab.tsx 의 faceView 와 동일
  face: { pos: [0, 1.48, 0.72], fov: 32, look: [0, 1.43, 0] },
  // 문진 화면(ClinicScene 착석 대화)에 가까운 거리 — 얼굴이 화면의 약 1/4
  interview: { pos: [0, 1.46, 1.55], fov: 34, look: [0, 1.38, 0] },
}

function Scene({ av, age }: { av: string; age?: number }) {
  return (
    <>
      <color attach="background" args={['#23282f']} />
      <hemisphereLight args={['#eef5ff', '#403a35', 0.72]} />
      <directionalLight position={[2.2, 3.1, 3.2]} intensity={2.05} color="#fff1e7" />
      <directionalLight position={[-2.4, 1.8, 1.4]} intensity={0.82} color="#d9e7ff" />
      <pointLight position={[0, 1.55, 1.3]} intensity={0.36} distance={2.4} color="#ffffff" />
      <Suspense fallback={null}>
        <RealisticPatient
          emotion={'neutral' as Emotion}
          speaking={false}
          variant={av as MpfbVariant}
          pose="walk"
          walkSpeed={0}
          debugFreezePose
          chronologicalAge={age}
        />
      </Suspense>
      <Rig av={av} />
    </>
  )
}

function App() {
  const cam = CAMS[CAM] ?? CAMS.face
  return (
    <div style={{ display: 'flex', height: '100%' }}>
      {AVS.map((av, i) => (
        <div key={av} style={{ flex: 1, position: 'relative', borderRight: '1px solid #000' }}>
          <Canvas
            camera={{ position: cam.pos, fov: cam.fov, near: 0.05, far: 20 }}
            gl={{
              antialias: true,
              toneMapping: THREE.ACESFilmicToneMapping,
              toneMappingExposure: 1.02,
              outputColorSpace: THREE.SRGBColorSpace,
              preserveDrawingBuffer: true,
            }}
            dpr={2}
            onCreated={({ camera }) => camera.lookAt(...cam.look)}
          >
            <Scene av={av} age={AGES[i] ?? AGES[0]} />
          </Canvas>
          <div style={{
            position: 'absolute', left: 8, top: 8, font: '12px ui-monospace,monospace',
            color: '#fff', background: '#0009', padding: '3px 7px', borderRadius: 4,
          }}>{av}{AGES[i] ?? AGES[0] ? ` · ${AGES[i] ?? AGES[0]}세` : ''}{FIXED ? ' · fixed' : ' · orig'}</div>
        </div>
      ))}
    </div>
  )
}

// StrictMode 는 쓰지 않는다 — 이펙트 이중 실행이 GLTFLoader 의 blob URL 조기 revoke 를 유발해
// 임베드 텍스처가 통째로 안 뜬다("Couldn't load texture blob:").
createRoot(document.getElementById('root')!).render(<App />)

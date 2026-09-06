/**
 * 환자 말문 열기 — Electron 데스크톱 래퍼 (맥 로컬 전용).
 * run.sh와 동일하게 백엔드(:8000)·Supertonic(:8009)·프론트 preview(:5173)를
 * 자식 프로세스로 띄우고, 준비되면 창에 http://localhost:5173 을 로드한다.
 * 앱 종료 시 자식 프로세스 그룹을 모두 종료한다.
 */
const { app, BrowserWindow } = require('electron')
const { spawn, execSync } = require('child_process')
const path = require('path')
const fs = require('fs')
const http = require('http')

const ROOT = path.join(__dirname, '..')
const BACKEND = path.join(ROOT, 'backend')
const FRONTEND = path.join(ROOT, 'frontend')
const TTS = path.join(ROOT, 'tts_local')

// 사용자의 로그인 셸 PATH를 그대로 가져온다 (uv·npx·node·codex·ollama 위치 확보).
let userPath = process.env.PATH || ''
try {
  userPath = execSync('zsh -lc \'printf %s "$PATH"\'', { encoding: 'utf8' }).trim() || userPath
} catch {
  /* 실패 시 기존 PATH 유지 */
}
const ENV = { ...process.env, PATH: userPath }

const children = []
function run(cmd, args, cwd) {
  const p = spawn(cmd, args, { cwd, env: ENV, detached: true, stdio: 'ignore' })
  p.on('error', (e) => console.error(`[spawn ${cmd}] ${e.message}`))
  children.push(p)
  return p
}

function killAll() {
  for (const p of children) {
    try {
      process.kill(-p.pid, 'SIGTERM') // 프로세스 그룹 전체 종료 (uvicorn/vite 자식 포함)
    } catch {
      /* 이미 종료됨 */
    }
  }
}

// 포트가 이미 응답하는지 확인 (이미 켜진 서버는 다시 안 띄움)
function portUp(port) {
  return new Promise((resolve) => {
    const req = http.get({ host: '127.0.0.1', port, path: '/', timeout: 700 }, (res) => {
      res.destroy()
      resolve(true)
    })
    req.on('error', () => resolve(false))
    req.on('timeout', () => { req.destroy(); resolve(false) })
  })
}

// url이 응답할 때까지 폴링 후 콜백
function waitFor(url, cb, tries = 180) {
  const tick = () => {
    const req = http.get(url, (res) => {
      res.destroy()
      cb()
    })
    req.on('error', () => {
      if (--tries <= 0) return cb(new Error('서버 시작 시간 초과'))
      setTimeout(tick, 1000)
    })
  }
  tick()
}

async function startServers() {
  // Ollama (빠른 폴백 응답기에 사용 — best-effort, 없어도 진행)
  try {
    spawn('open', ['-a', 'Ollama'], { env: ENV, detached: true, stdio: 'ignore' }).unref()
  } catch {
    /* Ollama 미설치 — 무시 */
  }

  // Supertonic TTS 사이드카 (있고, 아직 안 떠 있을 때만)
  const ttsPy = path.join(TTS, '.venv/bin/python')
  if (fs.existsSync(ttsPy) && !(await portUp(8009))) {
    run(ttsPy, ['-m', 'uvicorn', 'server:app', '--port', '8009'], TTS)
  }

  // 백엔드 (FastAPI) — 아직 안 떠 있을 때만
  if (!(await portUp(8000))) {
    run('uv', ['run', 'uvicorn', 'app.main:app', '--port', '8000'], BACKEND)
  }

  // 프론트엔드: 이미 5173이 떠 있으면 그대로 사용, 아니면 빌드 후 preview
  if (!(await portUp(5173))) {
    const build = spawn('npm', ['run', 'build'], { cwd: FRONTEND, env: ENV, detached: true, stdio: 'ignore' })
    children.push(build)
    build.on('close', () => {
      run('npx', ['vite', 'preview', '--port', '5173', '--strictPort'], FRONTEND)
    })
    build.on('error', (e) => console.error(`[build] ${e.message}`))
  }
}

let win = null
function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 960,
    minHeight: 640,
    title: '환자 말문 열기',
    backgroundColor: '#1a1c1e',
    webPreferences: { contextIsolation: true },
  })
  // 로딩 화면
  win.loadURL(
    'data:text/html;charset=utf-8,' +
      encodeURIComponent(
        '<body style="background:#1a1c1e;color:#e7e2d6;font-family:-apple-system,sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0">' +
          '<div style="text-align:center"><div style="font-size:20px;margin-bottom:8px">🩺 환자 말문 열기</div>' +
          '<div style="opacity:.6;font-size:14px">진료실 준비 중… (서버 시작, 첫 실행은 모델 로딩으로 시간이 걸려요)</div></div></body>',
      ),
  )
  waitFor('http://localhost:5173', (err) => {
    if (!win) return
    if (err) {
      win.loadURL(
        'data:text/html;charset=utf-8,' +
          encodeURIComponent('<body style="background:#1a1c1e;color:#e0857a;font-family:sans-serif;padding:40px">서버 시작 실패. 터미널에서 ./run.sh 로 먼저 확인해보세요.</body>'),
      )
      return
    }
    win.loadURL('http://localhost:5173')
  })
  win.on('closed', () => { win = null })
}

// 단일 인스턴스
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.whenReady().then(() => {
    startServers()
    createWindow()
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })
}

app.on('window-all-closed', () => {
  killAll()
  app.quit()
})
app.on('before-quit', killAll)
process.on('exit', killAll)

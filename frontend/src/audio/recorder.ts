/**
 * 16kHz mono WAV 녹음기.
 * Qwen3-ASR이 16kHz mono를 원하므로 브라우저에서 바로 그 형식으로 인코딩한다
 * (서버 측 ffmpeg 변환 불필요).
 */

export class WavRecorder {
  private ctx: AudioContext | null = null
  private stream: MediaStream | null = null
  private source: MediaStreamAudioSourceNode | null = null
  private processor: ScriptProcessorNode | null = null
  private chunks: Float32Array[] = []
  private _level = 0

  /** 현재 입력 레벨 0~1 (마이크 시각화용) */
  get level() {
    return this._level
  }

  async start(): Promise<void> {
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    })
    this.ctx = new AudioContext({ sampleRate: 16000 })
    this.source = this.ctx.createMediaStreamSource(this.stream)
    // ScriptProcessor는 deprecated지만 모든 브라우저에서 안정적으로 동작하고
    // 짧은 발화 녹음 용도로 충분하다.
    this.processor = this.ctx.createScriptProcessor(4096, 1, 1)
    this.chunks = []
    this.processor.onaudioprocess = (e) => {
      const data = e.inputBuffer.getChannelData(0)
      this.chunks.push(new Float32Array(data))
      let sum = 0
      for (let i = 0; i < data.length; i += 16) sum += data[i] * data[i]
      this._level = Math.min(1, Math.sqrt(sum / (data.length / 16)) * 8)
    }
    this.source.connect(this.processor)
    this.processor.connect(this.ctx.destination)
  }

  async stop(): Promise<Blob> {
    const sampleRate = this.ctx?.sampleRate ?? 16000
    this.processor?.disconnect()
    this.source?.disconnect()
    this.stream?.getTracks().forEach((t) => t.stop())
    await this.ctx?.close()
    const blob = encodeWav(this.chunks, sampleRate)
    this.ctx = null
    this.stream = null
    this.source = null
    this.processor = null
    this.chunks = []
    this._level = 0
    return blob
  }
}

function encodeWav(chunks: Float32Array[], sampleRate: number): Blob {
  const total = chunks.reduce((n, c) => n + c.length, 0)
  const pcm = new Int16Array(total)
  let offset = 0
  for (const c of chunks) {
    for (let i = 0; i < c.length; i++) {
      const s = Math.max(-1, Math.min(1, c[i]))
      pcm[offset++] = s < 0 ? s * 0x8000 : s * 0x7fff
    }
  }
  const header = new ArrayBuffer(44)
  const v = new DataView(header)
  const writeStr = (pos: number, s: string) => {
    for (let i = 0; i < s.length; i++) v.setUint8(pos + i, s.charCodeAt(i))
  }
  writeStr(0, 'RIFF')
  v.setUint32(4, 36 + pcm.length * 2, true)
  writeStr(8, 'WAVE')
  writeStr(12, 'fmt ')
  v.setUint32(16, 16, true)
  v.setUint16(20, 1, true) // PCM
  v.setUint16(22, 1, true) // mono
  v.setUint32(24, sampleRate, true)
  v.setUint32(28, sampleRate * 2, true)
  v.setUint16(32, 2, true)
  v.setUint16(34, 16, true)
  writeStr(36, 'data')
  v.setUint32(40, pcm.length * 2, true)
  return new Blob([header, pcm.buffer], { type: 'audio/wav' })
}

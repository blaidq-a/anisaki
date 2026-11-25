// Automatic subtitle sync.
// 1. Silero VAD (small neural speech detector, any language, robust to music and effects) marks
//    where people talk in a few minutes of audio.
// 2. The subtitle cues are slid over that speech map; the shift where line starts best meet speech wins.
// Silero VAD model: github.com/snakers4/silero-vad (MIT), file taken from @ricky0123/vad-web.
import * as ort from 'onnxruntime-web/wasm'
import wasmUrl from 'onnxruntime-web/ort-wasm-simd-threaded.wasm?url'
import mjsUrl from 'onnxruntime-web/ort-wasm-simd-threaded.mjs?url'
import modelUrl from '../assets/silero_vad_v5.onnx?url'

const RATE = 16000
const FRAME = 512 // samples per Silero frame = 32 ms
const CONTEXT = 64
export const FRAME_SEC = FRAME / RATE

ort.env.wasm.wasmPaths = { wasm: wasmUrl, mjs: mjsUrl }
ort.env.wasm.numThreads = 1

let session: Promise<ort.InferenceSession> | null = null
const getSession = () => (session ??= ort.InferenceSession.create(modelUrl, { executionProviders: ['wasm'] }))

/** Speech probability (0..1) for every 32 ms frame of 16 kHz mono audio. */
export async function speechProbabilities(pcm: Float32Array, onProgress?: (p: number) => void): Promise<Float32Array> {
  const s = await getSession()
  const frames = Math.floor(pcm.length / FRAME)
  const out = new Float32Array(frames)
  let state: ort.Tensor = new ort.Tensor('float32', new Float32Array(2 * 128), [2, 1, 128])
  const sr = new ort.Tensor('int64', BigInt64Array.from([BigInt(RATE)]), [])
  let context = new Float32Array(CONTEXT)
  for (let f = 0; f < frames; f++) {
    const frame = pcm.subarray(f * FRAME, (f + 1) * FRAME)
    const input = new Float32Array(CONTEXT + FRAME)
    input.set(context, 0)
    input.set(frame, CONTEXT)
    context = frame.slice(-CONTEXT)
    const r = await s.run({ input: new ort.Tensor('float32', input, [1, input.length]), state, sr })
    state = r.stateN as ort.Tensor
    out[f] = (r.output.data as Float32Array)[0]
    if (onProgress && f % 500 === 0) onProgress(f / frames)
    // Thousands of model runs back to back never let the page draw (the player froze): let it breathe.
    if (f % 40 === 39) await new Promise(r => setTimeout(r, 0))
  }
  return out
}

export interface Cue {
  start: number
  end: number
}

export interface AlignResult {
  /** Seconds to add to the current sub-delay */
  shift: number
  /** 0..1: how clearly the best shift beats the runner-up elsewhere */
  confidence: number
  /** How much better the best shift is than leaving it as is (0 = no better) */
  gain: number
  /** Match quality at the best shift: how much more speech falls inside the cues than around them */
  score: number
  /** Standard deviations the best shift stands above the other shifts */
  z: number
  cues: number
}

/**
 * Score every shift in ±range around the current delay.
 * + speech in the first 70 % of each cue (lines start when speech starts; they often linger after)
 * − speech in the 0.4 s just before each cue (cue placed after the line already began)
 * − speech level outside cues
 */
export function align(speech: Float32Array, from: number, cues: Cue[], delay: number, range = 30): AlignResult {
  const n = speech.length
  const local = cues.filter(c => c.end + delay > from - range && c.start + delay < from + n * FRAME_SEC + range)
  if (local.length < 8) throw new Error('Bu kısımda eşleştirmeye yetecek kadar konuşma satırı yok; konuşmanın bol olduğu bir yere gidip tekrar dene.')
  const prefix = new Float64Array(n + 1)
  for (let i = 0; i < n; i++) prefix[i + 1] = prefix[i] + speech[i]
  const sum = (a: number, b: number) => {
    a = Math.max(0, Math.min(n, a))
    b = Math.max(0, Math.min(n, b))
    return b > a ? prefix[b] - prefix[a] : 0
  }
  const pre = Math.round(0.4 / FRAME_SEC)
  const maxK = Math.round(range / FRAME_SEC)
  const scores = new Float32Array(maxK * 2 + 1).fill(-Infinity)
  for (let k = -maxK; k <= maxK; k++) {
    const shift = delay + k * FRAME_SEC
    let inside = 0, len = 0, before = 0, beforeLen = 0, covered = 0, coveredLen = 0
    for (const c of local) {
      const a = Math.floor((c.start + shift - from) / FRAME_SEC)
      const e = Math.ceil((c.end + shift - from) / FRAME_SEC)
      const core = a + Math.max(1, Math.round((e - a) * 0.7))
      const ca = Math.max(0, a), cb = Math.min(n, core)
      if (cb > ca) {
        inside += sum(ca, cb)
        len += cb - ca
      }
      before += sum(a - pre, a)
      beforeLen += Math.max(0, Math.min(n, a) - Math.max(0, a - pre))
      covered += sum(a, e)
      coveredLen += Math.max(0, Math.min(n, e) - Math.max(0, a))
    }
    if (len < 60) continue
    const outside = (prefix[n] - covered) / Math.max(1, n - coveredLen)
    scores[k + maxK] = inside / len - 0.5 * (beforeLen ? before / beforeLen : 0) - 0.5 * outside
  }
  let best = maxK
  for (let i = 0; i < scores.length; i++) if (scores[i] > scores[best]) best = i
  if (!isFinite(scores[best])) throw new Error('Altyazı satırları bu kısımla örtüşmüyor; başka bir yerde tekrar dene.')
  // Runner-up: best score at least 1.5 s away from the winner. A clear winner stands well above it.
  const away = Math.round(1.5 / FRAME_SEC)
  let second = -Infinity
  for (let i = 0; i < scores.length; i++) if (Math.abs(i - best) > away && scores[i] > second) second = scores[i]
  const finite = Array.from(scores).filter(isFinite).sort((a, b) => a - b)
  const median = finite[Math.floor(finite.length / 2)]
  const peak = scores[best]
  const confidence = peak > median ? Math.max(0, Math.min(1, (peak - Math.max(second, median)) / (peak - median))) : 0
  const atZero = scores[maxK]
  // How far the best shift stands out from all other shifts (in standard deviations). A subtitle of the
  // right episode lines up somewhere and stands out even when nearby shifts score almost as well.
  const mean = finite.reduce((a, b) => a + b, 0) / finite.length
  const sd = Math.sqrt(finite.reduce((a, b) => a + (b - mean) ** 2, 0) / finite.length) || 1e-9
  const z = (peak - mean) / sd
  return { shift: Math.round((best - maxK) * FRAME_SEC * 100) / 100, confidence, gain: isFinite(atZero) ? peak - atZero : peak, score: peak, cues: local.length, z }
}

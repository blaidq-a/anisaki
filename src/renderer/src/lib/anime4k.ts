// Anime4K on WebGPU: video frame → preset pipeline → canvas.
// Unlike anime4k-webgpu's render(), this one can be stopped and rebuilt when the mode or size changes.
import { Anime4KPipeline, ModeA, ModeAA, ModeB, ModeBB, ModeC, ModeCA } from 'anime4k-webgpu'
import type { Anime4KMode } from '../../../shared/types'

export const MODES: { id: Anime4KMode; label: string; hint: string }[] = [
  { id: 'off', label: 'Kapalı', hint: 'Orijinal görüntü' },
  { id: 'A', label: 'Mod A', hint: '1080p kaynaklar · bulanıklık ve sıkıştırma izi' },
  { id: 'B', label: 'Mod B', hint: '720p kaynaklar · hafif iyileştirme' },
  { id: 'C', label: 'Mod C', hint: 'Düşük çözünürlük · en az bozulma' },
  { id: 'A+A', label: 'Mod A+A', hint: 'Daha güçlü A · daha çok GPU' },
  { id: 'B+B', label: 'Mod B+B', hint: 'Daha güçlü B · daha çok GPU' },
  { id: 'C+A', label: 'Mod C+A', hint: 'C ardından A' }
]

const CLASSES = { A: ModeA, B: ModeB, C: ModeC, 'A+A': ModeAA, 'B+B': ModeBB, 'C+A': ModeCA } as const

const BLIT = /* wgsl */ `
@group(0) @binding(0) var tex: texture_2d<f32>;
@group(0) @binding(1) var samp: sampler;
struct V { @builtin(position) pos: vec4f, @location(0) uv: vec2f };
@vertex fn vs(@builtin(vertex_index) i: u32) -> V {
  var p = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
  var o: V;
  o.pos = vec4f(p[i], 0.0, 1.0);
  o.uv = vec2f((p[i].x + 1.0) * 0.5, (1.0 - p[i].y) * 0.5);
  return o;
}
@fragment fn fs(v: V) -> @location(0) vec4f { return vec4f(textureSample(tex, samp, v.uv).rgb, 1.0); }
`

export const webgpuSupported = () => 'gpu' in navigator

export class Anime4KRenderer {
  private device!: GPUDevice
  private ctx!: GPUCanvasContext
  private format!: GPUTextureFormat
  private input?: GPUTexture
  private pipeline?: Anime4KPipeline
  private blit?: GPURenderPipeline
  private bind?: GPUBindGroup
  private sampler?: GPUSampler
  private frameHandle = 0
  private stopped = false

  constructor(private video: HTMLVideoElement, private canvas: HTMLCanvasElement) {}

  async init(): Promise<void> {
    const adapter = await navigator.gpu?.requestAdapter({ powerPreference: 'high-performance' })
    if (!adapter) throw new Error('Bu cihazda WebGPU yok, Anime4K kullanılamıyor.')
    this.device = await adapter.requestDevice()
    this.ctx = this.canvas.getContext('webgpu')!
    this.format = navigator.gpu.getPreferredCanvasFormat()
    this.ctx.configure({ device: this.device, format: this.format, alphaMode: 'opaque' })
    this.sampler = this.device.createSampler({ magFilter: 'linear', minFilter: 'linear' })
    this.blit = this.device.createRenderPipeline({
      layout: 'auto',
      vertex: { module: this.device.createShaderModule({ code: BLIT }), entryPoint: 'vs' },
      fragment: { module: this.device.createShaderModule({ code: BLIT }), entryPoint: 'fs', targets: [{ format: this.format }] },
      primitive: { topology: 'triangle-list' }
    })
  }

  /** (Re)build the pipeline for the current video size, canvas size and mode. */
  build(mode: Exclude<Anime4KMode, 'off'>): void {
    const w = this.video.videoWidth
    const h = this.video.videoHeight
    if (!w || !h) return
    const rect = this.canvas.getBoundingClientRect()
    const scale = Math.min((rect.width * devicePixelRatio) / w, (rect.height * devicePixelRatio) / h)
    this.canvas.width = Math.max(1, Math.round(w * scale))
    this.canvas.height = Math.max(1, Math.round(h * scale))

    this.input?.destroy()
    this.input = this.device.createTexture({
      size: [w, h, 1],
      format: 'rgba16float',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT
    })
    const Preset = CLASSES[mode]
    this.pipeline = new Preset({
      device: this.device,
      inputTexture: this.input,
      nativeDimensions: { width: w, height: h },
      targetDimensions: { width: this.canvas.width, height: this.canvas.height }
    })
    this.bind = this.device.createBindGroup({
      layout: this.blit!.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: this.pipeline.getOutputTexture().createView() },
        { binding: 1, resource: this.sampler! }
      ]
    })
    this.draw(true)
  }

  /**
   * Render loop. requestVideoFrameCallback is not used on purpose: Chromium stops firing it
   * for a video element that is hidden behind the canvas (opacity 0).
   */
  start(): void {
    this.stopped = false
    let last = -1
    const loop = () => {
      if (this.stopped) return
      const t = this.video.currentTime
      if (t !== last) {
        last = t
        this.draw(true)
      }
      this.frameHandle = requestAnimationFrame(loop)
    }
    this.frameHandle = requestAnimationFrame(loop)
  }

  /** Draw the current frame (also used after seeking while paused). */
  draw(force = false): void {
    if (!this.pipeline || !this.input || this.video.readyState < 2) return
    if (this.video.paused && !force) return
    const w = this.video.videoWidth
    const h = this.video.videoHeight
    if (w !== this.input.width || h !== this.input.height) return
    this.device.queue.copyExternalImageToTexture({ source: this.video }, { texture: this.input }, [w, h])
    const enc = this.device.createCommandEncoder()
    this.pipeline.pass(enc)
    const pass = enc.beginRenderPass({
      colorAttachments: [{ view: this.ctx.getCurrentTexture().createView(), loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 1] }]
    })
    pass.setPipeline(this.blit!)
    pass.setBindGroup(0, this.bind!)
    pass.draw(3)
    pass.end()
    this.device.queue.submit([enc.finish()])
  }

  stop(): void {
    this.stopped = true
    cancelAnimationFrame(this.frameHandle)
  }

  destroy(): void {
    this.stop()
    this.input?.destroy()
    this.device?.destroy()
  }
}

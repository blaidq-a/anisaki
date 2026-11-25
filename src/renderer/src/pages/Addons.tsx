import { useState } from 'react'
import { useStore } from '../store'

/**
 * Anisaki's own sources (installed on the first run, src/main/addons.ts): not listed, always there. One the
 * viewer adds with the same id (their own configured Torrentio) takes its place; removing that brings ours back.
 */
const BUILTIN = [
  { base: 'https://torrentio.strem.fun', url: 'https://torrentio.strem.fun/manifest.json' },
  { base: 'https://opensubtitles-v3.strem.io', url: 'https://opensubtitles-v3.strem.io/manifest.json' }
]
const isBuiltin = (base: string) => BUILTIN.some(b => b.base === base.replace(/\/+$/, ''))

const SUGGESTED = [
  { name: 'Torrentio (kendi ayarlarınla)', url: '', note: 'Kendi ayarlarınla (dil, kalite, debrid) yapılandırdığın Torrentio, Anisaki’nin yerleşik Torrentio’sunun yerine geçer.', configure: 'https://torrentio.strem.fun/configure' },
  { name: 'Comet', url: '', note: 'Debrid odaklı hızlı torrent eklentisi. Sitesinde yapılandırıp oluşan linki yapıştır.', configure: 'https://comet.elfhosted.com/configure' },
  { name: 'MediaFusion', url: '', note: 'Birçok kaynaktan torrent ve doğrudan link. Yapılandırma gerekir.', configure: 'https://mediafusion.elfhosted.com/configure' },
  { name: 'AIOStreams', url: '', note: 'Birden fazla eklentiyi tek yerde toplar ve filtreler.', configure: 'https://aiostreams.elfhosted.com/stremio/configure' }
]

export function Addons() {
  const { settings, refresh, toast } = useStore()
  const [url, setUrl] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const install = async (u: string) => {
    setErr(null)
    setBusy(true)
    try {
      const a = await window.api.installAddon(u)
      toast(`${a.manifest.name} kuruldu`)
      setUrl('')
      await refresh()
    } catch (e: any) {
      setErr(String(e.message ?? e).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''))
    } finally {
      setBusy(false)
    }
  }

  // only the ones the viewer added: Anisaki's own sources aren't listed
  const installed = (settings?.addons ?? []).filter(a => !isBuiltin(a.base))

  return (
    <div className="page narrow">
      <div className="row-head">
        <h2>Eklentiler</h2>
        <p>Stremio uyumlu her eklenti çalışır. Bilgisayarında çalışan yerel eklentileri de http://127.0.0.1 adresiyle ekleyebilirsin.</p>
      </div>

      <form
        className="panel addform"
        onSubmit={e => {
          e.preventDefault()
          if (url.trim()) install(url)
        }}
      >
        <label htmlFor="addonUrl">Eklenti adresi (manifest.json veya stremio:// linki)</label>
        <div className="addrow">
          <input id="addonUrl" value={url} onChange={e => setUrl(e.target.value)} placeholder="https://…/manifest.json" />
          <button className="btn" disabled={busy || !url.trim()}>{busy ? 'Kuruluyor…' : 'Kur'}</button>
        </div>
        {err && <div className="error">{err}</div>}
      </form>

      <p className="muted">Anisaki kendi kaynakları ve altyazılarıyla gelir; eklenti eklemek isteğe bağlıdır.</p>
      {installed.length > 0 && <h3 className="sub">Eklediklerin ({installed.length})</h3>}
      <div className="addons">
        {installed.map(a => (
          <div key={a.manifest.id} className="addon">
            {a.manifest.logo ? <img src={a.manifest.logo} alt="" /> : <div className="addon-logo">{a.manifest.name[0]}</div>}
            <div className="addon-body">
              <strong>{a.manifest.name}</strong> <span className="muted">v{a.manifest.version}</span>
              <p>{a.manifest.description?.slice(0, 180)}</p>
              <code className="addon-url">{a.base.replace(/\/[^/]{40,}(?=\/|$)/g, '/••••')}</code>
            </div>
            <div className="addon-actions">
              <label className="switch">
                <input
                  type="checkbox"
                  checked={a.enabled}
                  onChange={async e => {
                    await window.api.toggleAddon(a.manifest.id, e.target.checked)
                    refresh()
                  }}
                />
                <span>{a.enabled ? 'Açık' : 'Kapalı'}</span>
              </label>
              <button
                className="btn ghost sm"
                onClick={async () => {
                  await window.api.removeAddon(a.manifest.id)
                  // it had taken the place of one of Anisaki's own sources: that one comes back
                  const who = (a.manifest.id + ' ' + a.manifest.name).toLowerCase()
                  const own = who.includes('torrentio') ? BUILTIN[0] : who.includes('opensubtitles') ? BUILTIN[1] : null
                  if (own) await window.api.installAddon(own.url).catch(() => {})
                  toast(`${a.manifest.name} kaldırıldı`)
                  refresh()
                }}
              >
                Kaldır
              </button>
            </div>
          </div>
        ))}
      </div>

      <h3 className="sub">Topluluk eklentileri</h3>
      <div className="addons">
        {SUGGESTED.map(s => {
          const has = installed.some(a => a.manifest.name.toLowerCase().startsWith(s.name.toLowerCase()))
          return (
            <div key={s.name} className="addon">
              <div className="addon-logo">{s.name[0]}</div>
              <div className="addon-body">
                <strong>{s.name}</strong>
                <p>{s.note}</p>
              </div>
              <div className="addon-actions">
                {has ? (
                  <span className="muted">Kurulu</span>
                ) : s.url ? (
                  <button className="btn sm" disabled={busy} onClick={() => install(s.url)}>Kur</button>
                ) : null}
                {s.configure && <a className="btn ghost sm" href={s.configure} target="_blank" rel="noreferrer">Yapılandır ↗</a>}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

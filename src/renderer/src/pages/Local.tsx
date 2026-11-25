import { useEffect, useMemo, useState } from 'react'
import type { LocalFile } from '../../../shared/types'
import { useStore } from '../store'

const gb = (n: number) => (n > 1e9 ? (n / 1e9).toFixed(2) + ' GB' : (n / 1e6).toFixed(0) + ' MB')

export function Local() {
  const { settings, setSettings, setPlay, toast } = useStore()
  const [files, setFiles] = useState<LocalFile[] | null>(null)
  const [open, setOpen] = useState<string | null>(null)

  const scan = () => {
    setFiles(null)
    window.api.scanLocal().then(setFiles)
  }
  useEffect(scan, [settings?.localFolders.join('|')])

  const groups = useMemo(() => {
    const map = new Map<string, LocalFile[]>()
    files?.forEach(f => map.set(f.title || 'Diğer', [...(map.get(f.title || 'Diğer') ?? []), f]))
    return [...map.entries()]
  }, [files])

  const play = async (f: LocalFile) => {
    // mpv reads the file directly; the browser player needs the loopback URL.
    const src = settings?.engine === 'builtin' ? await window.api.localUrl(f.path) : f.path
    setPlay({ src, title: f.title || f.name, subtitle: f.episode ? `${f.episode}. bölüm` : f.name, source: { addon: 'Yerel dosya', label: f.name } })
  }

  return (
    <div className="page">
      <div className="row-head">
        <h2>Yerel dosyalar</h2>
        <p>Bilgisayarındaki anime klasörleri. Dosyalar bölüm numarasına göre gruplanır.</p>
      </div>
      <div className="panel">
        <div className="folders">
          {settings?.localFolders.length === 0 && <div className="muted">Henüz klasör eklenmedi.</div>}
          {settings?.localFolders.map(f => (
            <div key={f} className="folder">
              <code>{f}</code>
              <button className="btn ghost sm" onClick={async () => setSettings(await window.api.removeFolder(f))}>Kaldır</button>
            </div>
          ))}
        </div>
        <div className="row-btns">
          <button className="btn" onClick={async () => setSettings(await window.api.addFolder())}>Klasör ekle</button>
          <button className="btn ghost" onClick={scan}>Yeniden tara</button>
        </div>
      </div>

      {files === null && settings?.localFolders.length ? <div className="state">Taranıyor…</div> : null}
      {files?.length === 0 && settings?.localFolders.length ? <div className="state">Bu klasörlerde video dosyası bulunamadı.</div> : null}
      <div className="localgroups">
        {groups.map(([title, list]) => (
          <div key={title} className="lgroup">
            <button className="lgroup-head" onClick={() => setOpen(open === title ? null : title)} aria-expanded={open === title}>
              <strong>{title}</strong>
              <span className="muted">{list.length} dosya</span>
            </button>
            {open === title && (
              <div className="lfiles">
                {list.map(f => (
                  <button key={f.path} className="lfile" onClick={() => play(f)}>
                    <span className="lep">{f.episode ?? '—'}</span>
                    <span className="lname">{f.name}</span>
                    <span className="muted">{gb(f.size)}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

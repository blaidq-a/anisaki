import { useEffect, useState } from 'react'
import type { PublicSettings } from '../../../shared/types'
import { langName } from '../lib/subtitles'
import { useStore } from '../store'

const clean = (e: any) => String(e?.message ?? e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
const LANGS = ['tr', 'en', 'ja', 'de', 'fr', 'es', 'pt', 'it', 'ru', 'ar', 'zh', 'ko', 'id', 'pl']

type SetFn = (patch: Parameters<typeof window.api.setSettings>[0]) => Promise<void>

/* --------------------------------- languages --------------------------------- */
function LangPair({ label, value, onChange }: { label: string; value: string[]; onChange: (v: string[]) => void }) {
  const [main, backup] = [value[0] ?? '', value[1] ?? '']
  const opts = (exclude?: string) => LANGS.filter(l => l !== exclude).map(l => <option key={l} value={l}>{langName(l)}</option>)
  return (
    <div className="langpair">
      <strong>{label}</strong>
      <label htmlFor={label + '-main'}>
        Ana dil
        <select id={label + '-main'} value={main} onChange={e => onChange([e.target.value, backup === e.target.value ? '' : backup].filter(Boolean))}>
          {opts()}
        </select>
      </label>
      <label htmlFor={label + '-backup'}>
        Yedek dil
        <select id={label + '-backup'} value={backup} onChange={e => onChange([main, e.target.value].filter(Boolean))}>
          <option value="">— Yok —</option>
          {opts(main)}
        </select>
      </label>
    </div>
  )
}

export function LanguageSettings({ settings, set }: { settings: PublicSettings; set: SetFn }) {
  return (
    <section className="panel">
      <h3>Dil tercihleri</h3>
      <LangPair label="Ses" value={settings.audioLangs} onChange={v => set({ audioLangs: v })} />
      <LangPair label="Altyazı" value={settings.subLangs} onChange={v => set({ subLangs: v })} />
      <label className="switch">
        <input id="autoSubs" type="checkbox" checked={settings.autoSubs} onChange={e => set({ autoSubs: e.target.checked })} />
        <span>Altyazıyı otomatik seç (internetteki altyazıları sesle karşılaştırıp videoya uyanı açar)</span>
      </label>
      <p className="muted">
        Sıra: dosyadaki ana dil altyazısı → internetteki ana dil altyazısı (videoya uyanı, gerekirse kaydırılarak) → ana dil İngilizce değilse İngilizceden çeviri → yedek dil. “Signs &amp; Songs” gibi yalnızca tabela/şarkı içeren parçalar ana altyazı olarak seçilmez.
      </p>
    </section>
  )
}

/* -------------------------------- profiles -------------------------------- */
export function ProfileSettings({ settings, set }: { settings: PublicSettings; set: SetFn }) {
  const { setSettings, toast } = useStore()
  const [busy, setBusy] = useState<string | null>(null)
  const [waiting, setWaiting] = useState<string | null>(null) // profile waiting for the browser login
  const [err, setErr] = useState<string | null>(null)
  const [newName, setNewName] = useState('')
  const [editing, setEditing] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [clientId, setClientId] = useState(settings.anilistClientId)
  const [ready, setReady] = useState(true)
  const [malReady, setMalReady] = useState(false)
  const [malWaiting, setMalWaiting] = useState<string | null>(null)
  useEffect(() => {
    window.api.aniListReady().then(setReady)
    ;(window.api as any).malReady?.().then(setMalReady, () => {})
  }, [settings.anilistClientId])
  const api = window.api as any
  // MAL sign-in the app missed (a phone put it to sleep while the browser was open): the browser's
  // "127.0.0.1…" address can be pasted to finish it. Checked again when the app comes back.
  const [malPaste, setMalPaste] = useState('')
  const [, recheck] = useState(0)
  useEffect(() => {
    const f = () => document.visibilityState === 'visible' && recheck(n => n + 1)
    document.addEventListener('visibilitychange', f)
    return () => document.removeEventListener('visibilitychange', f)
  }, [])
  const malMissed = !!api.malPending?.()
  // syncs in progress (they run in the app, not this page: they go on if the page is left)
  const [syncing, setSyncing] = useState<string[]>([])
  useEffect(() => {
    api.syncState?.().then(setSyncing, () => {})
    return api.onSyncState?.(setSyncing)
  }, [])
  const isSyncing = (service: string, id: string) => syncing.includes(service + ':' + id)

  const run = async (id: string, fn: () => Promise<unknown>) => {
    setBusy(id)
    setErr(null)
    try {
      await fn()
      setSettings(await window.api.getSettings())
    } catch (e) {
      const msg = clean(e)
      if (msg !== 'Giriş iptal edildi.') setErr(msg)
    } finally {
      setBusy(null)
      setWaiting(null)
    }
  }

  const connect = (id: string) =>
    run(id, async () => {
      setWaiting(id)
      await window.api.aniListLogin(id)
    })

  return (
    <section className="panel">
      <h3>Profiller ve hesaplar</h3>
      <p className="muted">Her profilin kendi listesi olur; AniList’e, MyAnimeList’e ya da ikisine birden bağlanabilir. Bölümün %{Math.round(settings.watchedAt * 100)}’i izlenince bağlı hesaplarda ilerleme otomatik güncellenir.</p>
      {/* the share of an episode that counts as watched: it is about the list and the linked accounts */}
      <label className="field" htmlFor="watchedAt">
        İzlendi sayılma oranı · %{Math.round(settings.watchedAt * 100)}
        <input id="watchedAt" type="range" min={50} max={95} step={5} value={Math.round(settings.watchedAt * 100)} onChange={e => set({ watchedAt: Number(e.target.value) / 100 })} />
        <small className="muted">Bölümün bu kadarı izlenince izlendi sayılır; listen ve bağlı hesaplardaki ilerleme güncellenir.</small>
      </label>
      <div className="profiles">
        {settings.profiles.map(p => {
          const active = p.id === settings.activeProfile
          return (
            <div key={p.id} className={'profile' + (active ? ' active' : '')}>
              <div className="pavatar">{p.avatar ? <img src={p.avatar} alt="" /> : p.name[0]?.toUpperCase()}</div>
              <div className="pinfo2">
                {editing === p.id ? (
                  <form className="rename" onSubmit={e => { e.preventDefault(); run(p.id, () => window.api.renameProfile(p.id, editName)).then(() => setEditing(null)) }}>
                    <input autoFocus value={editName} onChange={e => setEditName(e.target.value)} onKeyDown={e => e.key === 'Escape' && setEditing(null)} aria-label="Profil adı" />
                    <button className="btn sm" disabled={!editName.trim()}>Kaydet</button>
                  </form>
                ) : (
                  <strong>
                    {p.name}
                    <button className="editname" onClick={() => { setEditing(p.id); setEditName(p.name) }} title="Adı değiştir" aria-label="Profil adını değiştir">✎</button>
                    {active && <span className="pill ok">Etkin</span>}
                  </strong>
                )}
                <small>
                  {waiting === p.id
                    ? 'Tarayıcında AniList açıldı: giriş yapıp “Approve”a bas, gerisi otomatik.'
                    : malWaiting === p.id
                      ? 'Tarayıcında MyAnimeList açıldı: giriş yapıp “Allow”a bas, gerisi otomatik.'
                      : [p.anilist ? `AniList: ${p.anilist.name}` : 'AniList bağlı değil', p.mal ? `MyAnimeList: ${p.mal.name}` : 'MyAnimeList bağlı değil'].join(' · ')}
                </small>
              </div>
              <div className="pactions">
                {!active && <button className="btn ghost sm" disabled={!!busy} onClick={() => run(p.id, () => window.api.switchProfile(p.id))}>Geç</button>}
                {p.anilist ? (
                  <>
                    <button className="btn ghost sm" disabled={isSyncing('anilist', p.id)} onClick={() => window.api.aniListSync(p.id).catch(() => {})}>
                      {isSyncing('anilist', p.id) ? 'AniList eşitleniyor…' : 'AniList eşitle'}
                    </button>
                    {isSyncing('anilist', p.id) ? (
                      <button className="btn ghost sm" onClick={() => api.cancelSync('anilist:' + p.id)}>İptal</button>
                    ) : (
                      <button className="btn ghost sm" disabled={!!busy} onClick={() => run(p.id, () => window.api.aniListLogout(p.id))}>AniList çıkış</button>
                    )}
                  </>
                ) : waiting === p.id ? (
                  <button className="btn ghost sm" onClick={() => window.api.aniListCancel()}>Vazgeç</button>
                ) : (
                  <button className="btn sm" disabled={!!busy || !ready} title={!ready ? 'AniList Client ID tanımlı değil' : ''} onClick={() => connect(p.id)}>
                    AniList ile bağla
                  </button>
                )}
                {malReady && (p.mal ? (
                  <>
                    <button className="btn ghost sm" disabled={isSyncing('mal', p.id)} onClick={() => api.malSync(p.id).catch(() => {})}>{isSyncing('mal', p.id) ? 'MAL eşitleniyor…' : 'MAL eşitle'}</button>
                    {isSyncing('mal', p.id) ? (
                      <button className="btn ghost sm" onClick={() => api.cancelSync('mal:' + p.id)}>İptal</button>
                    ) : (
                      <button className="btn ghost sm" disabled={!!busy} onClick={() => run(p.id, () => api.malLogout(p.id))}>MAL çıkış</button>
                    )}
                  </>
                ) : malWaiting === p.id ? (
                  <button className="btn ghost sm" onClick={() => window.api.aniListCancel()}>Vazgeç</button>
                ) : (
                  <button className="btn sm" disabled={!!busy} onClick={() => run(p.id, async () => { setMalWaiting(p.id); try { await api.malLogin(p.id) } finally { setMalWaiting(null) } })}>
                    MyAnimeList ile bağla
                  </button>
                ))}
                {settings.profiles.length > 1 && <button className="btn ghost sm" disabled={!!busy} onClick={() => run(p.id, () => window.api.removeProfile(p.id))}>Sil</button>}
              </div>
              {malReady && !p.mal && (malWaiting === p.id || (malMissed && p.id === settings.activeProfile)) && (
                <form
                  className="addrow malpaste"
                  onSubmit={e => {
                    e.preventDefault()
                    run(p.id, () => api.malPaste(p.id, malPaste)).then(() => setMalPaste(''))
                  }}
                >
                  <input
                    value={malPaste}
                    onChange={e => setMalPaste(e.target.value)}
                    placeholder="Tarayıcı “127.0.0.1 … bağlanmayı reddetti” dediyse oradaki adresi buraya yapıştır"
                    aria-label="MyAnimeList giriş adresi"
                  />
                  <button className="btn ghost sm" disabled={!!busy || !/code=/.test(malPaste)}>Bağla</button>
                </form>
              )}
            </div>
          )
        })}
      </div>
      {settings.profiles.length > 1 && (
        <label className="field" htmlFor="startProfile">
          Uygulama açılınca
          <select id="startProfile" value={settings.startProfile ?? ''} onChange={e => set({ startProfile: e.target.value || null })}>
            <option value="">Profil seçme ekranını göster</option>
            {settings.profiles.map(p => <option key={p.id} value={p.id}>{p.name} ile aç</option>)}
          </select>
        </label>
      )}
      <form className="addrow" onSubmit={e => { e.preventDefault(); run('new', () => window.api.addProfile(newName)).then(() => setNewName('')) }}>
        <input id="newProfile" value={newName} onChange={e => setNewName(e.target.value)} placeholder="Yeni profil adı" />
        <button className="btn ghost" disabled={!!busy}>Profil ekle</button>
      </form>
      {err && <div className="error">{err}</div>}
      <p className="muted">Giriş AniList’in ve MyAnimeList’in kendi sitesinde, varsayılan tarayıcında yapılır; şifren bu uygulamaya hiç girilmez. Uygulama yalnızca sitenin verdiği erişim anahtarını saklar.</p>

      {!ready && (
        <details className="howto" open>
          <summary>Geliştirici: AniList Client ID tanımlı değil</summary>
          <p className="muted">Uygulamanın içine gömülü bir Client ID yok. <a href="https://anilist.co/settings/developer" target="_blank" rel="noreferrer">anilist.co/settings/developer</a> sayfasında “Create New Client” ile bir tane oluştur (Redirect URL: <code>{'https://blaidq-a.github.io/anisaki/giris.html'}</code>) ve ID’yi buraya gir.</p>
          <form className="addrow" onSubmit={e => { e.preventDefault(); set({ anilistClientId: clientId.trim() }).then(() => toast('Client ID kaydedildi')) }}>
            <input id="anilistClientId" value={clientId} onChange={e => setClientId(e.target.value)} placeholder="Client ID (ör. 12345)" inputMode="numeric" />
            <button className="btn" disabled={!/^\d+$/.test(clientId.trim())}>Kaydet</button>
          </form>
        </details>
      )}
    </section>
  )
}

/* ------------------------------ source choice ------------------------------ */
export function SourceSettings({ settings, set }: { settings: PublicSettings; set: SetFn }) {
  const hasDebrid = settings.debridProvider !== 'none' && settings.debridKeys[settings.debridProvider]
  return (
    <>
      <section className="panel">
        <h3>Kaynak seçimi</h3>
        <label className="switch">
          <input id="autoSource" type="checkbox" checked={settings.autoSource} onChange={e => set({ autoSource: e.target.checked })} />
          <span>
            Bölüme tıklayınca en iyi kaynağı otomatik seç ve oynat
            <small>Kaynağı kendin seçmek için bölüme sağ tıkla ya da basılı tut.</small>
          </span>
        </label>
        <span className="field">Tercih edilen kalite</span>
        <div className="seg">
          {(['2160p', '1080p', '720p'] as const).map(q => (
            <button key={q} aria-pressed={settings.preferredQuality === q} onClick={() => set({ preferredQuality: q })}>{q === '2160p' ? '4K' : q}</button>
          ))}
        </div>
      </section>

      <section className="panel">
        <h3>Torrent kaynakları nasıl açılsın?</h3>
        <div className="modes">
          {([
            ['auto', 'Otomatik', 'Debrid önbelleğinde varsa debrid (anında), yoksa doğrudan torrent.'],
            ['debrid', 'Sadece debrid', 'Her şey debrid üzerinden. Önbellekte olmayan kaynakta debrid indirene kadar beklenir.'],
            ['torrent', 'Sadece torrent', 'Debrid kullanılmaz; bölüm doğrudan eşlerden indirilerek oynatılır.']
          ] as const).map(([v, l, h]) => (
            <button key={v} className="mode" aria-pressed={settings.streamMode === v} onClick={() => set({ streamMode: v })}>
              <strong>{l}</strong>
              <small>{h}</small>
            </button>
          ))}
        </div>
        {!hasDebrid && <p className="hint">Debrid anahtarı yok: torrent kaynakları doğrudan torrentle açılır.</p>}
        <p className="muted">
          Doğrudan torrentte hız seed sayısına bağlıdır; otomatik seçim bu yüzden çok seed’li kaynakları öne alır. İzlerken kendi bağlantınla eşlere bağlanır ve başkalarına da yükleme yaparsın (IP adresin görünür).
        </p>
        <label className="field" htmlFor="upl">
          Yükleme hızı sınırı
          <select id="upl" value={settings.torrentUploadLimit} onChange={e => set({ torrentUploadLimit: Number(e.target.value) })}>
            {[[100, '100 KB/sn'], [300, '300 KB/sn'], [1000, '1 MB/sn'], [0, 'Sınırsız']].map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </label>
        <label className="switch">
          <input id="torrentKeep" type="checkbox" checked={settings.torrentKeep} onChange={e => set({ torrentKeep: e.target.checked })} />
          <span>
            İndirilen dosyaları sakla
            <small>Kapalıyken oynatıcı kapanınca indirilen parçalar silinir ve yükleme durur.</small>
          </span>
        </label>
      </section>
    </>
  )
}

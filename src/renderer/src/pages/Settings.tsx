import { getUiLang, setUiLang } from '../lib/i18n'
import { useEffect, useRef, useState } from 'react'
import { LanguageSettings, ProfileSettings, SourceSettings } from '../components/SettingsExtra'
import type { Anime4KMode, DebridProvider } from '../../../shared/types'
import { MODES, webgpuSupported } from '../lib/anime4k'
import { useStore, type SettingsTab } from '../store'
import { Addons } from './Addons'
import { Local } from './Local'
import { checkUpdate, installUpdate, updatesOn, VERSION_LABEL, type Release } from '../lib/update'

const MOBILE = !!(window as any).ANISAKI_MOBILE

/** Phone: the app's own player or an installed one (choice kept on the device). */
function PhonePlayerSettings() {
  const [v, setV] = useState(() => (localStorage.getItem('phonePlayer') === 'external' ? 'external' : 'internal'))
  const set = (x: string) => {
    localStorage.setItem('phonePlayer', x)
    setV(x)
  }
  const [autoSkipOp, setAutoSkipOp] = useState(() => (localStorage.getItem('player.autoSkipOp') ?? localStorage.getItem('player.autoSkip')) === 'on')
  const [autoSkipEd, setAutoSkipEd] = useState(() => (localStorage.getItem('player.autoSkipEd') ?? localStorage.getItem('player.autoSkip')) === 'on')
  const [autoNext, setAutoNext] = useState(() => localStorage.getItem('player.autoNext') !== 'off')
  const toggle = (key: string, value: string, setter: (b: boolean) => void, b: boolean) => {
    localStorage.setItem(key, value)
    setter(b)
  }
  return (
    <section className="panel">
      <h3>Oynatıcı</h3>
      <div className="modes">
        <button className="mode" aria-pressed={v === 'internal'} onClick={() => set('internal')}>
          <strong>Uygulama içi</strong>
          <small>Altyazılar (Türkçe çeviri dahil) otomatik eklenir, kaldığın yer ve izlendi bilgisi tutulur.</small>
        </button>
        <button className="mode" aria-pressed={v === 'external'} onClick={() => set('external')}>
          <strong>Harici (mpv / VLC)</strong>
          <small>Telefondaki oynatıcı açılır. Süslü ASS altyazılar ve her ses formatı için en iyisi mpv.</small>
        </button>
      </div>
      <p className="muted">Bir video uygulama içinde açılmazsa harici oynatıcıyı seç.</p>
      <label className="switch">
        <input type="checkbox" checked={autoSkipOp} onChange={e => toggle('player.autoSkipOp', e.target.checked ? 'on' : 'off', setAutoSkipOp, e.target.checked)} />
        <span>
          Openingi otomatik atla
          <small>Kapalıyken opening sırasında "Atla" düğmesi çıkar.</small>
        </span>
      </label>
      <label className="switch">
        <input type="checkbox" checked={autoSkipEd} onChange={e => toggle('player.autoSkipEd', e.target.checked ? 'on' : 'off', setAutoSkipEd, e.target.checked)} />
        <span>
          Endingi otomatik atla
          <small>Kapalıyken ending sırasında "Atla" düğmesi çıkar.</small>
        </span>
      </label>
      <label className="switch">
        <input type="checkbox" checked={autoNext} onChange={e => toggle('player.autoNext', e.target.checked ? 'on' : 'off', setAutoNext, e.target.checked)} />
        <span>
          Otomatik sonraki bölüm
          <small>Bölüm bitince sıradaki kendiliğinden açılır.</small>
        </span>
      </label>
    </section>
  )
}

const THEMES = [
  { id: 'grafit', label: 'Grafit', hint: 'Düz koyu gri, beyaz vurgu', bg: '#0a0a0d', s: '#1d1d25', a: '#f3f3f6' },
  { id: 'grafit-isik', label: 'Grafit ışıklı', hint: 'Grafit + ışık hüzmesi', bg: '#0a0a0d', s: '#1d1d25', a: '#b9d4ff' },
  { id: 'oled', label: 'OLED siyahı', hint: 'Tam siyah, ekran parlamaz', bg: '#000000', s: '#141414', a: '#f5f5f5' },
  { id: 'mono', label: 'Saf mono', hint: 'Sadece siyah ve beyaz', bg: '#000000', s: '#161616', a: '#ffffff' },
  { id: 'kagit', label: 'Kâğıt', hint: 'Açık: kırık beyaz, siyah yazı', bg: '#f4f2ee', s: '#ffffff', a: '#17161a' },
  { id: 'sakura', label: 'Sakura', hint: 'Açık: kiraz çiçeği pembesi', bg: '#fbf1f4', s: '#ffffff', a: '#e2557f' }
] as const

const TABS: { id: SettingsTab; label: string; hint: string }[] = [
  { id: 'general', label: 'Profil ve hesap', hint: 'Profiller, AniList' },
  { id: 'appearance', label: 'Görünüm', hint: 'Dil, tema rengi' },
  { id: 'sources', label: 'Kaynaklar', hint: 'Otomatik seçim, debrid' },
  { id: 'languages', label: 'Dil ve altyazı', hint: 'Ses, altyazı, çeviri' },
  { id: 'player', label: 'Oynatıcı', hint: 'Spoiler, filler, Anime4K' },
  { id: 'addons', label: 'Eklentiler', hint: 'Stremio eklentileri' },
  ...(MOBILE ? [] : [{ id: 'local' as const, label: 'Yerel dosyalar', hint: 'Bilgisayardaki klasörler' }])
]

const clean = (e: any) => String(e?.message ?? e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')

function DebridKey({ provider, label, link }: { provider: Exclude<DebridProvider, 'none'>; label: string; link: string }) {
  const { settings, refresh, toast } = useStore()
  const [key, setKey] = useState('')
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const saved = settings?.debridKeys[provider]
  // The key built into this copy: usable, but not shown or deletable
  const builtin = provider === 'torbox' && !!settings?.builtinDebrid

  const run = async (fn: () => Promise<string>) => {
    setBusy(true)
    setStatus(null)
    try {
      const account = await fn()
      setStatus({ ok: true, text: account })
      await refresh()
      return true
    } catch (e) {
      setStatus({ ok: false, text: clean(e) })
      return false
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="keyrow">
      <div className="keyhead">
        <strong>{label}</strong>
        <span className={saved ? 'pill ok' : 'pill'}>{builtin ? 'Uygulamaya gömülü anahtar' : saved ? 'Anahtar kayıtlı' : 'Anahtar yok'}</span>
        <a href={link} target="_blank" rel="noreferrer">API anahtarını al ↗</a>
      </div>
      <form
        className="addrow"
        onSubmit={async e => {
          e.preventDefault()
          if (await run(() => window.api.setDebridKey(provider, key.trim()))) {
            setKey('')
            toast(`${label} anahtarı kaydedildi`)
          }
        }}
      >
        <input id={'key-' + provider} type="password" autoComplete="off" value={key} onChange={e => setKey(e.target.value)} placeholder={saved ? 'Yeni anahtar girerek değiştir' : 'API anahtarı'} />
        <button className="btn" disabled={busy || !key.trim()}>Kaydet ve doğrula</button>
        {saved && !builtin && (
          <>
            <button type="button" className="btn ghost" disabled={busy} onClick={() => run(() => window.api.testDebrid(provider))}>Test et</button>
            <button type="button" className="btn ghost" disabled={busy} onClick={() => run(async () => (await window.api.setDebridKey(provider, ''), 'Anahtar silindi'))}>Sil</button>
          </>
        )}
      </form>
      {status && <div className={status.ok ? 'okmsg' : 'error'}>{status.text}</div>}
    </div>
  )
}

/** On-device AI translation (NLLB): switch, one-time model download with progress, removal. */
function LocalTranslate({ on, set, lang }: { on: boolean; set: (on: boolean) => void; lang: string }) {
  type St = Awaited<ReturnType<typeof window.api.mtStatus>>
  const [st, setSt] = useState<St | null>(null)
  const [err, setErr] = useState('')
  // The model depends on the main subtitle language: Turkish → Töz-Çevir (small), others → NLLB.
  useEffect(() => {
    window.api.mtStatus().then(setSt)
  }, [lang])
  useEffect(() => window.api.onMtProgress(p => setSt(s => (s ? { ...s, state: p >= 1 ? 'ready' : 'downloading', progress: p } : s))), [])
  const download = async () => {
    setErr('')
    setSt(s => (s ? { ...s, state: 'downloading', progress: 0 } : s))
    try {
      setSt(await window.api.mtDownload())
      set(true)
    } catch (e: any) {
      setErr(String(e?.message ?? e).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''))
      setSt(await window.api.mtStatus())
    }
  }
  const ready = st?.state === 'ready'
  const toz = st?.model === 'toz'
  const mb = st?.mb ?? (toz ? 110 : 890)
  return (
    <>
      <label className="switch">
        <input id="localTranslate" type="checkbox" checked={on && ready} disabled={!ready} onChange={e => set(e.target.checked)} />
        <span>
          Yapay zekayla çevir (cihazda, internetsiz)
          <small>
            {toz
              ? 'Türkçe çeviri bu cihazda, anime altyazılarıyla eğitilmiş yapay zekâ modeliyle yapılır: internet, kota ya da engel yok. İzlediğin yerden başlar, ilk satırlar birkaç saniyede gelir. Model uygulamayla birlikte gelir.'
              : `Çeviri bu bilgisayarda NLLB modeliyle yapılır: kota ya da engel yok. Bir bölüm yaklaşık 2–3 dakikada çevrilir, ilk satırlar hemen gelir. Model bir kez indirilir (yaklaşık ${mb} MB).`}
          </small>
        </span>
      </label>
      <div className="row-btns" style={{ marginTop: 4 }}>
        {st?.state === 'downloading' ? (
          <span className="hint">{`Model indiriliyor… %${Math.round((st.progress ?? 0) * 100)}`}</span>
        ) : ready && toz ? (
          <span className="hint">Model hazır.</span>
        ) : ready ? (
          <>
            <span className="hint">Model hazır.</span>
            {st?.other && <button className="btn ghost" onClick={async () => setSt(await window.api.mtDelete(true))}>Kullanılmayan modeli sil</button>}
            <button className="btn ghost" onClick={async () => (set(false), setSt(await window.api.mtDelete()))}>Modeli sil</button>
          </>
        ) : (
          <button className="btn" onClick={download}>{`Modeli indir (${mb} MB)`}</button>
        )}
        {err && <span className="hint">{`İndirilemedi: ${err}`}</span>}
      </div>
      {ready && toz && <TozTry />}
    </>
  )
}

/** Version, and the one-click update (PC, phone and TV: lib/update.ts). */
function UpdateSettings() {
  const [state, setState] = useState<{ busy?: boolean; msg?: string; rel?: Release | null }>({})
  const check = async () => {
    setState({ busy: true })
    try {
      const rel = await checkUpdate()
      setState({ rel, msg: rel ? undefined : 'Anisaki güncel.' })
    } catch (e: any) {
      setState({ msg: String(e?.message ?? e) })
    }
  }
  const install = async (rel: Release) => {
    setState({ busy: true, rel, msg: 'Yeni sürüm indiriliyor…' })
    try {
      await installUpdate(rel)
    } catch (e: any) {
      setState({ rel, msg: String(e?.message ?? e) })
    }
  }
  return (
    <section className="panel">
      <h3>Sürüm ve güncellemeler</h3>
      <p className="muted">Anisaki {VERSION_LABEL}</p>
      {updatesOn() ? (
        <div className="addrow">
          {state.rel ? (
            <button className="btn" disabled={state.busy} onClick={() => install(state.rel!)}>{`${state.rel.version} sürümünü kur`}</button>
          ) : (
            <button className="btn ghost" disabled={state.busy} onClick={check}>Güncellemeleri denetle</button>
          )}
        </div>
      ) : (
        <p className="hint">Güncelleme sunucusu henüz ayarlanmadı: yeni sürümler şimdilik elle kurulur.</p>
      )}
      {state.rel?.notes && <p className="muted">{state.rel.notes}</p>}
      {state.msg && <p className="muted">{state.msg}</p>}
    </section>
  )
}

/** "Töz'ü dene": one English line through the model, with how long it took (the first one loads it). */
function TozTry() {
  const [text, setText] = useState("I'll never forgive you for what you did to her!")
  const [out, setOut] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const go = async () => {
    setBusy(true)
    setOut(null)
    const t0 = performance.now()
    try {
      const r = await window.api.mtTry(text)
      setOut(`${r} · ${((performance.now() - t0) / 1000).toFixed(1)} sn`)
    } catch (e: any) {
      setOut('Hata: ' + String(e?.message ?? e))
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="toztry">
      <span className="pmenu2-label">Çeviriyi dene</span>
      <div className="row-btns">
        <input value={text} onChange={e => setText(e.target.value)} onKeyDown={e => e.key === 'Enter' && go()} aria-label="İngilizce cümle" />
        <button className="btn" disabled={busy || !text.trim()} onClick={go}>{busy ? 'Çevriliyor…' : 'Çevir'}</button>
      </div>
      {out && <p className="hint">{out}</p>}
    </div>
  )
}

export function Settings({ tab: initial }: { tab?: SettingsTab }) {
  const { settings, setSettings } = useStore()
  const [tab, setTab] = useState<SettingsTab>(initial ?? 'general')
  if (!settings) return null
  const set = async (patch: Parameters<typeof window.api.setSettings>[0]) => { setSettings(await window.api.setSettings(patch)) }

  // On a phone the tabs are one sideways strip: keep the chosen one in view
  const nav = useRef<HTMLElement>(null)
  useEffect(() => {
    nav.current?.querySelector('[aria-current="true"]')?.scrollIntoView({ inline: 'center', block: 'nearest' })
  }, [tab])
  return (
    <div className="settings">
      <aside className="settings-nav" ref={nav}>
        <h1>Ayarlar</h1>
        {TABS.map(t => (
          <button key={t.id} aria-current={tab === t.id} onClick={() => setTab(t.id)}>
            <strong>{t.label}</strong>
            <small>{t.hint}</small>
          </button>
        ))}
      </aside>
      <div className="settings-main">
        {tab === 'general' && <ProfileSettings settings={settings} set={set} />}
        {tab === 'general' && <UpdateSettings />}

        {tab === 'appearance' && (
          <section className="panel">
            <h3>Uygulama dili</h3>
            <p className="muted">Arayüzün dili. Değiştirince uygulama yenilenir.</p>
            <div className="seg" data-noi18n>
              <button aria-pressed={getUiLang() === 'tr'} onClick={() => getUiLang() !== 'tr' && setUiLang('tr')}>Türkçe</button>
              <button aria-pressed={getUiLang() === 'en'} onClick={() => getUiLang() !== 'en' && setUiLang('en')}>English</button>
            </div>
          </section>
        )}

        {tab === 'appearance' && (
          <section className="panel">
            <h3>Tema</h3>
            <p className="muted">Seçince hemen uygulanır. Oynatıcı her temada koyu kalır.</p>
            <div className="themes">
              {THEMES.map(t => (
                <button key={t.id} className="themecard" aria-pressed={settings.theme === t.id} onClick={() => set({ theme: t.id })}>
                  <span className="themeswatch" style={{ background: t.bg }}>
                    <i style={{ background: t.s }} />
                    <b style={{ background: t.a }} />
                  </span>
                  <strong>{t.label}</strong>
                  <small className="muted">{t.hint}</small>
                </button>
              ))}
            </div>
          </section>
        )}

        {tab === 'sources' && (
          <>
            <SourceSettings settings={settings} set={set} />
            <section className="panel">
              <h3>Debrid hizmeti</h3>
              <p className="muted">Eklentilerden gelen torrent kaynakları seçtiğin hizmet üzerinden doğrudan linke çevrilir. Anahtarlar yalnızca bu bilgisayarda, uygulamanın kendi verisinde saklanır.</p>
              <div className="seg">
                {([['none', 'Kullanma'], ['realdebrid', 'Real-Debrid'], ['torbox', 'TorBox']] as const).map(([v, l]) => (
                  <button key={v} aria-pressed={settings.debridProvider === v} onClick={() => set({ debridProvider: v })}>{l}</button>
                ))}
              </div>
              <DebridKey provider="realdebrid" label="Real-Debrid" link="https://real-debrid.com/apitoken" />
              <DebridKey provider="torbox" label="TorBox" link="https://torbox.app/settings" />
            </section>
          </>
        )}

        {tab === 'languages' && (
          <>
            <LanguageSettings settings={settings} set={set} />
            <section className="panel">
              <h3>Altyazı kaynakları</h3>
              <label className="switch">
                <input id="preferEmbedded" type="checkbox" checked={settings.preferEmbedded} onChange={e => set({ preferEmbedded: e.target.checked })} />
                <span>
                  Videonun içindeki altyazıyı otomatik aç
                  <small>Dosyada tercih ettiğin dillerden birinde altyazı varsa doğrudan o açılır; internetten aranan ya da çevrilen altyazıya geçilmez. Gömülü altyazı videoyla her zaman uyumludur.</small>
                </span>
              </label>
              <label className="switch">
                <input id="builtinSubs" type="checkbox" checked={settings.builtinSubs} onChange={e => set({ builtinSubs: e.target.checked })} />
                <span>
                  OpenSubtitles’tan da ara
                  <small>Eklenti kurulu olmasa da Türkçe ve İngilizce altyazılar aranır.</small>
                </span>
              </label>
              <label className="switch">
                <input id="autoTranslate" type="checkbox" checked={settings.autoTranslate} onChange={e => set({ autoTranslate: e.target.checked })} />
                <span>
                  Ana dilde altyazı yoksa İngilizceden çevir
                  <small>Bölünmüş cümleler birleştirilerek çevrilir, karakter isimleri korunur. Çeviri hazırlanırken İngilizce gösterilir.</small>
                </span>
              </label>
              {!!(window.api as any).mtStatus && <LocalTranslate on={!!settings.localTranslate} set={v => set({ localTranslate: v })} lang={settings.subLangs[0] ?? 'tr'} />}
            </section>
          </>
        )}

        {tab === 'player' && MOBILE && <PhonePlayerSettings />}

        {tab === 'player' && (
          <>
          <section className="panel">
            <h3>Oynatma</h3>
            <label className="switch">
              <input id="hideSpoilers" type="checkbox" checked={!!settings.hideSpoilers} onChange={e => set({ hideSpoilers: e.target.checked })} />
              <span>
                Spoiler gizle
                <small>İzlemediğin bölümlerin resmi bulanıklaşır, adı ve özeti gizlenir. Sadece izlediğin bölümler açık görünür.</small>
              </span>
            </label>
            <label className="switch">
              <input id="skipFillers" type="checkbox" checked={settings.skipFillers} onChange={e => set({ skipFillers: e.target.checked })} />
              <span>
                Filler bölümleri atla
                <small>Sonraki bölüme geçerken hikâye dışı (filler) bölümler atlanır; oynatıcı kaç bölüm atlandığını söyler. Anime sayfasından ve oynatıcının ayarlarından da açılıp kapatılır.</small>
              </span>
            </label>
          </section>
          {!MOBILE && (<>
          <section className="panel">
            <h3>Anime4K</h3>
            <p className="muted">Animeyi ekran kartında gerçek zamanlı keskinleştirip büyütür. Oynatma sırasında <kbd>A</kbd> tuşuyla modlar arasında geçebilirsin.</p>
            <div className="modes">
              {MODES.map(m => (
                <button key={m.id} className="mode" aria-pressed={settings.anime4k === m.id} onClick={() => set({ anime4k: m.id as Anime4KMode })}>
                  <strong>{m.label}</strong>
                  <small>{m.hint}</small>
                </button>
              ))}
            </div>
            <div className="seg">
              <button aria-pressed={settings.anime4kQuality === 'hq'} onClick={() => set({ anime4kQuality: 'hq' })}>Yüksek kalite</button>
              <button aria-pressed={settings.anime4kQuality === 'fast'} onClick={() => set({ anime4kQuality: 'fast' })}>Hızlı</button>
            </div>
            {settings.anime4kQuality === 'hq' && settings.anime4k !== 'off' && (
              <p className="hint warn">Yüksek kalite güçlü bir ekran kartı ister. Dahili grafikli ya da eski bilgisayarlarda görüntü takılabilir, kare atlayabilir; öyle olursa “Hızlı”ya geç.</p>
            )}
            <label className="switch">
              <input id="anime4kOff4k" type="checkbox" checked={settings.anime4kOff4k} onChange={e => set({ anime4kOff4k: e.target.checked })} />
              <span>
                4K videolarda Anime4K’yı kapat
                <small>4K (2160p) görüntü zaten keskindir; Anime4K orada fark yaratmaz, ekran kartını boşuna yorar. 1080p ve altında çalışmaya devam eder.</small>
              </span>
            </label>
          </section>
          <section className="panel">
            <h3>Gelişmiş</h3>
            <label className="field" htmlFor="mpvArgs">
              Ek mpv ayarları (isteğe bağlı)
              <input id="mpvArgs" defaultValue={settings.mpvArgs} onBlur={e => set({ mpvArgs: e.target.value })} placeholder="--deband=yes" />
            </label>
          </section>
          </>)}
          </>
        )}

        {tab === 'addons' && <Addons />}
        {tab === 'local' && <Local />}
      </div>
    </div>
  )
}

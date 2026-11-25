# Geliştirme

## Yapı

| Klasör | Ne var |
|---|---|
| `src/renderer/` | Ortak React arayüzü (PC, telefon ve TV aynı arayüzü kullanır) |
| `src/main/` | Ayarlar, çeviri ve eklenti mantığı (arayüzle aynı süreçte çalışır) |
| `src-tauri/` | PC uygulaması: Tauri 2 + Rust (mpv, torrent, AI çeviri, AniList girişi, güncelleme) |
| `mobile/` | Telefon / TV uygulaması: Tauri 2 Android; `mobile/src` arayüz eklemeleri ve TV kumanda gezinmesi |
| `mobile/src-tauri/gen/android/.../anisaki/mobile/` | ExoPlayer oynatıcısı (`PlayerActivity`), önden okuyan altyazı bileşeni (`CueRenderer`), altyazı senkronu (`AutoSync`, `AudioTap`), eklenti köprüsü (`PlayerPlugin`) |
| `pages/` | AniList / MyAnimeList girişinin döndüğü sayfa (GitHub Pages, `gh-pages` dalı) |
| `latest.json` | Uygulamaların okuduğu güncelleme bilgisi (sürüm ve indirme adresleri) |

## Derleme

```powershell
npm install
npm run vendor     # mpv ve ffmpeg'i vendor/ klasörüne indirir (git'te tutulmaz; çeviri modeli vendor/toz-anime'ye ayrıca konur)
npm run dev        # PC, geliştirme modu
npm run build      # PC kurulum dosyası (.exe)
```

Telefon / TV (Android Studio JBR, Android SDK ve NDK gerekir):

```powershell
cd mobile
npm run apk        # telefon (arm64) ve TV (armv7) için APK
```

İstemci kimlikleri depoda tutulmaz: `scripts/embed-key.cjs` derlemeden önce yerel `*.gen.ts` dosyalarına yazar (bu dosyalar `.gitignore`'dadır).

## Yeni sürüm yayınlamak

1. `package.json`, `src-tauri/tauri.conf.json`, `mobile/src-tauri/tauri.conf.json` ve `src/renderer/src/lib/update.ts` içindeki sürümü artır.
2. exe ve APK'yı derleyip `vX.Y.Z` etiketli bir GitHub sürümüne (ön sürüm değil) yükle.
3. `latest.json`'daki sürümü ve indirme adreslerini güncelleyip gönder. Uygulamalar açılışta yeni sürümü görür.

## Lisanslar

mpv (GPL/LGPL), ffmpeg (GPL), ExoPlayer (Apache 2.0), ONNX Runtime (MIT), Silero VAD (MIT) ve Anime4K (MIT) ayrı lisanslıdır.

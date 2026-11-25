// App language (Ayarlar → Genel → Uygulama dili). The UI is written in Turkish; in English mode a small
// layer swaps the Turkish texts on screen for English ones as they appear (exact phrases from the table
// below, plus patterns for texts with numbers like "7. bölüm"). Anime titles / descriptions are left alone.
export type UiLang = 'tr' | 'en'

export function getUiLang(): UiLang {
  try {
    return localStorage.getItem('uiLang') === 'en' ? 'en' : 'tr'
  } catch {
    return 'tr'
  }
}
export function setUiLang(l: UiLang) {
  try {
    localStorage.setItem('uiLang', l)
  } catch {}
  location.reload()
}

const EN: Record<string, string> = {
  // shell / navigation
  'Ana sayfa': 'Home', 'Keşfet': 'Discover', 'Listem': 'My List', 'Ayarlar': 'Settings', 'Anime ara…': 'Search anime…',
  'Geri': 'Back', 'İleri': 'Forward', 'Geri (fare geri tuşu)': 'Back (mouse back button)', 'Profiller ve ayarlar': 'Profiles and settings',
  'Aramayı temizle': 'Clear search', 'Temizle (Esc)': 'Clear (Esc)', 'Simge durumuna küçült': 'Minimize', 'Ekranı kapla': 'Maximize',
  'Önceki boyut': 'Restore', 'Kapat': 'Close', 'Büyüt': 'Expand', 'Küçült': 'Shrink', 'Sola kaydır': 'Scroll left', 'Sağa kaydır': 'Scroll right',
  // home
  'İzle': 'Play', 'Detaylar': 'Details', 'Önceki': 'Previous', 'Sonraki': 'Next', 'İzlemeye devam et': 'Continue Watching', 'Tümü →': 'View all →',
  'Trend': 'Trending', 'Animeler': 'Animes', 'Şimdi': 'Now', 'Bu sezon': 'This season', 'Tüm zamanlar': 'All time',
  'Son yayınlanan bölümler': 'Latest episodes', 'Yakında': 'Coming soon', 'En çok beklenenler': 'Most anticipated',
  'Tüm zamanların en iyileri': 'Best of all time', 'Henüz eklenti yok.': 'No addons yet.', 'Eklenti ekle': 'Add addon',
  'Bölümleri izleyebilmek için bir Stremio eklentisi kur ve debrid anahtarını ekle.': 'To watch episodes, install a Stremio addon and add your debrid key.',
  // cards / list
  'Listeye ekle': 'Add to list', 'Listede': 'On list', 'Listeden çıkar': 'Remove from list', 'Listeyi düzenle': 'Edit list entry', 'Anime sayfasını aç': 'Open anime page',
  'İzliyorum': 'Watching', 'İzleyeceğim': 'Plan to watch', 'Bitirdim': 'Completed', 'Ara verdim': 'Paused', 'Bıraktım': 'Dropped',
  'Puanım': 'My score', 'İzlenen bölüm': 'Episodes watched', 'Artır': 'Increase', 'Azalt': 'Decrease', 'Vazgeç': 'Cancel', 'Kaydet': 'Save', 'Sil': 'Delete',
  'Tümü': 'All', 'Bu durumda anime yok.': 'No anime with this status.', 'anime · bu bilgisayarda saklanır': 'anime · stored on this computer',
  'Listen boş. Bir animenin sayfasında “Listem” kutusundan durum seçince burada görünür.': 'Your list is empty. Pick a status on an anime page and it shows up here.',
  // anime page
  'Bölümler': 'Episodes', 'Daha az göster': 'Show less', 'Devamı': 'More', 'Devamını oku': 'Read more', 'Henüz yayınlanmış bölüm yok.': 'No episodes aired yet.',
  'Hikâye': 'Canon', 'Karışık': 'Mixed', 'Filler': 'Filler', 'Oynat': 'Play', 'Kaynağı kendim seçeyim': 'Let me pick the source', 'Fragman': 'Trailer',
  'Bu anime eklentilerin kullandığı kimliklerle eşleşmiyor; kaynaklar adıyla aranıyor.': 'This show has no ids the addons use; sources are searched by name.',
  'Sağ tık / basılı tut: kaynağı kendin seç': 'Right click / hold: pick the source yourself', 'Öncesi': 'Earlier', 'İlişkili yapımlar': 'Related',
  'İzlendi': 'Watched', 'Film': 'Movie', 'TV': 'TV', 'Kısa TV': 'TV Short', 'Özel': 'Special', 'Müzik': 'Music', 'OVA': 'OVA', 'ONA': 'ONA',
  'Yayında': 'Airing', 'Tamamlandı': 'Finished', 'Yakında ': 'Upcoming', 'İptal': 'Cancelled', 'Ara verdi': 'On hiatus',
  'Kış': 'Winter', 'İlkbahar': 'Spring', 'Yaz': 'Summer', 'Sonbahar': 'Fall',
  'Aksiyon': 'Action', 'Macera': 'Adventure', 'Komedi': 'Comedy', 'Dram': 'Drama', 'Fantastik': 'Fantasy', 'Korku': 'Horror', 'Büyücü kız': 'Mahou Shoujo',
  'Gizem': 'Mystery', 'Psikolojik': 'Psychological', 'Romantik': 'Romance', 'Bilim kurgu': 'Sci-Fi', 'Gündelik yaşam': 'Slice of Life', 'Spor': 'Sports',
  'Doğaüstü': 'Supernatural', 'Gerilim': 'Thriller',
  // discover
  'Başlık': 'Title', 'Sıralama': 'Sort', 'En uygun': 'Best match', 'Popülerlik': 'Popularity', 'En yüksek puan': 'Highest score', 'En yeni': 'Newest',
  'En çok favori': 'Most favourited', 'Ada göre (A-Z)': 'By name (A-Z)', 'Türler': 'Genres', 'Tüm türler': 'All genres', 'Yıl': 'Year', 'Tüm yıllar': 'All years',
  'Sezon': 'Season', 'Tüm sezonlar': 'All seasons', 'Tür (format)': 'Format', 'Tüm formatlar': 'All formats', 'Durum': 'Status', 'Tüm durumlar': 'All statuses',
  'En az puan': 'Minimum score', 'Tüm puanlar': 'All scores', 'En yüksek puanlılar': 'Top rated', 'Stüdyo:': 'Studio:', 'Stüdyo filtresini kaldır': 'Remove studio filter',
  'Filtreleri temizle': 'Clear filters', 'Daha fazla': 'More',
  'Bu filtrelerle sonuç yok. Bir filtreyi kaldırmayı ya da romaji adıyla aramayı dene.': 'No results with these filters. Remove a filter or try the romaji title.',
  // source picker
  'Kaynak seç': 'Pick a source', 'Önerilen': 'Recommended', 'Başka anime': 'Other anime', 'Başka sezon': 'Other season', 'Paket': 'Batch',
  'Çift ses': 'Dual audio', 'Çoklu altyazı': 'Multi subs', 'Kaynaklar aranıyor…': 'Looking for sources…', 'Eklentilerden kaynaklar isteniyor…': 'Asking addons for sources…',
  'Bu bölüm için kaynak bulunamadı.': 'No sources found for this episode.', 'Bu kaynak oynatılamıyor.': 'This source can’t be played.',
  'Debrid önbelleğinde, anında açılır': 'In debrid cache, opens instantly', 'Hazırlanıyor…': 'Preparing…', 'Kendim seçeyim': 'I’ll pick',
  'Kurulu eklenti yok.': 'No addons installed.', 'Listeden başka bir kaynak seç.': 'Pick another source from the list.',
  'Otomatik seçilen kaynaklar açılamadı:': 'The automatically chosen sources failed:', 'Uygun kaynak bulunamadı; listeden kendin seç.': 'No suitable source; pick one from the list.',
  'Yanıt vermeyen eklentiler:': 'Addons not responding:', 'Link': 'Link',
  'Debrid bağlı değil: torrent kaynakları doğrudan eşlerden indirilerek oynatılır. Hız seed sayısına bağlıdır.': 'No debrid: torrents are streamed straight from peers. Speed depends on seeders.',
  // player
  'Yükleniyor…': 'Loading…', 'Geri dön': 'Go back', 'Geri (Esc)': 'Back (Esc)', 'Oynatıcıyı kapat': 'Close player', 'Video açılamadı': 'Video could not be opened',
  'Altyazı': 'Subtitles', 'Senkron': 'Sync', 'Ses': 'Audio', 'Kaynak': 'Source', 'Bilgi': 'Info', 'Paneli kapat': 'Close panel', 'Kapalı': 'Off', 'Açık': 'On',
  'Dosyadaki altyazılar': 'Subtitles in the file', 'İnternetten': 'Online', 'Zamanlama': 'Timing', 'Altyazılar aranıyor…': 'Searching subtitles…',
  'Tercih ettiğin dillerde başka altyazı yok.': 'No other subtitles in your languages.', 'Bu bölüm için internette altyazı bulunamadı.': 'No online subtitles for this episode.',
  'Bu yapımın IMDb eşlemesi yok, internetten altyazı aranamıyor.': 'No IMDb mapping for this title, online subtitles can’t be searched.',
  'otomatik çeviri': 'auto-translated', 'Zorunlu': 'Forced', 'Varsayılan': 'Default', 'Dosyada': 'In file', 'İndiriliyor…': 'Downloading…',
  'Videoya uymuyor': 'Doesn’t match the video', 'Sesle karşılaştırılıyor…': 'Comparing with the audio…', 'Başlıyor…': 'Starting…',
  'Altyazı senkronu': 'Subtitle sync', 'Otomatik eşleştir, duyduğun satırı yakala ya da elle kaydır': 'Auto-match, catch the line you hear, or shift by hand',
  'Openingi atla': 'Skip opening', 'Endingi atla': 'Skip ending', 'Özeti atla': 'Skip recap', 'Atla': 'Skip', 'Sonraki bölüm': 'Next episode', 'Önceki bölüm': 'Previous episode',
  'Sonraki bölüm (N)': 'Next episode (N)', 'Önceki bölüm (P)': 'Previous episode (P)', 'Opening atlandı.': 'Opening skipped.', 'Ending atlandı.': 'Ending skipped.',
  'Başka kaynak': 'Other source', 'Başka kaynak seç': 'Pick another source', 'Başka kaynak: ses bozuk, görüntü yanlış ya da takılıyorsa (R)': 'Other source: if audio is broken, the picture is wrong or it stutters (R)',
  'Tam ekrandan çık': 'Exit fullscreen', 'Tam ekrandan çık (Esc)': 'Exit fullscreen (Esc)', 'Tam ekran': 'Fullscreen', 'Tam ekran (F)': 'Fullscreen (F)',
  'Küçült: oynatıcı köşede açık kalır, uygulamada gezebilirsin': 'Mini player: keeps playing in a corner while you browse',
  'Oynatıcı ayarları': 'Player settings', 'Oynatma hızı': 'Playback speed', 'Altyazı gecikmesi': 'Subtitle delay', 'Altyazı görünümü': 'Subtitle style',
  'Altyazı dosyadaki zamanında': 'Subtitles at their original timing', 'Ses yükseltme': 'Volume boost', 'Ses düzeyi': 'Volume', 'Sesi kapat veya aç': 'Mute / unmute',
  'Küçük': 'Small', 'Büyük': 'Large', 'Çok büyük': 'Very large', 'Normal': 'Normal', 'Yukarı': 'Up', 'Biraz yukarı': 'A bit up', 'Aşağı': 'Down',
  'Görüntü': 'Video', 'Çözücü': 'Decoder', 'Yazılım': 'Software', 'Hazır': 'Ready', 'Kapsayıcı': 'Container', 'Bit hızı': 'Bitrate',
  'Yüksek (güçlü ekran kartı)': 'High (strong graphics card)', 'Hızlı': 'Fast', 'yüksek': 'high', 'hızlı': 'fast', 'düşük': 'low',
  'Orijinal görüntü': 'Original picture', 'Satırı yakala': 'Catch the line', 'Sesi dinleyerek eşleştir': 'Match by listening to the audio',
  'Geri al': 'Undo', 'Sıfırla': 'Reset', 'Önce bir altyazı seç.': 'Pick a subtitle first.', 'Altyazı zaten senkron görünüyor.': 'The subtitle already looks in sync.',
  'Ses alınıyor…': 'Getting the audio…', 'Konuşma aranıyor… %0': 'Looking for speech… 0%', 'Güven:': 'Confidence:', 'Yanıt vermeyen:': 'Not responding:',
  'Sonraki satır şimdi ›': 'Next line now ›', '‹ Önceki satır şimdi': '‹ Previous line now',
  'Bağlantı takıldı, yeniden bağlanılıyor…': 'Connection stalled, reconnecting…', 'Bağlantı takıldı. Kaynak menüsünden başka bir kaynak seçebilirsin.': 'Connection stalled. You can pick another source in the source menu.',
  'Yeniden bağlanılamadı:': 'Could not reconnect:', 'Oynatıcı beklenmedik şekilde kapandı.': 'The player closed unexpectedly.',
  'Bir cümleyi duyduğun anda o satıra tıkla; altyazı o ana kaydırılır.': 'Click a line the moment you hear it; the subtitle shifts to that moment.',
  'Bir cümleyi duyduğun anda, o cümlenin altyazısını şimdi göster:': 'The moment you hear a sentence, show its subtitle now:',
  'Bulunduğun yerin çevresindeki 5 dakikada konuşmayı yapay zekâ ile bulur (her dil, müzik ve efektlerin içinden) ve altyazı satırlarıyla eşleştirir (±30 sn).': 'Finds speech in the 5 minutes around you with AI (any language, through music and effects) and lines the subtitles up with it (±30 s).',
  'Otomatik senkron internetten ya da çeviriyle eklenen altyazılarda çalışır. Dosyanın içindeki altyazılar genelde videoyla zaten uyumludur.': 'Auto-sync works on online or translated subtitles. Subtitles inside the file usually already match the video.',
  'Ses ile altyazı arasında net bir eşleşme bulunamadı, altyazıya dokunmadım. Konuşmanın bol olduğu bir yerde tekrar dene ya da satırı yakala.': 'No clear match between audio and subtitle, left it as is. Try again where there is plenty of talking, or catch a line.',
  'Tercih ettiğin dillerde videoya uyan altyazı bulunamadı. Altyazı panelinden elle seçebilirsin.': 'No subtitle in your languages fits this video. You can pick one in the subtitle panel.',
  'Altyazı konuşmadan önce çıkıyorsa artır, sonra çıkıyorsa azalt. Kısayol:': 'Increase if subtitles appear before the speech, decrease if after. Shortcut:',
  'Dosyadaki süslü (ASS) altyazıların kendi stili korunur; boyut yine uygulanır.': 'Styled (ASS) subtitles in the file keep their own style; size still applies.',
  'Görüntü takılırsa “Hızlı”yı seç. Kısayol:': 'If the picture stutters pick “Fast”. Shortcut:', 'modlar arasında geçer.': 'switches modes.',
  'İngilizce altyazı bulunamadı.': 'No English subtitles found.', 'İngilizce altyazılar sesle karşılaştırılıyor…': 'Comparing English subtitles with the audio…',
  'İnternetteki İngilizce': 'English online', 'Yayın bilgisi': 'Stream info', 'Ses parçası': 'Audio track', 'Ses dönüştürülüyor': 'Converting audio',
  'Mb/sn görüntü': 'Mb/s video', 'Dosyaya gömülü fontlar kullanılıyor': 'Using fonts embedded in the file', 'Bölüm': 'Chapter', 'Özet': 'Recap',
  'Sonraki bölüm fragmanı': 'Next episode preview', 'PGS (görüntü)': 'PGS (image)', 'VobSub (görüntü)': 'VobSub (image)',
  '10 saniye geri': 'Back 10 seconds', '10 saniye ileri': 'Forward 10 seconds',
  // settings
  'Genel': 'General', 'Görünüm': 'Appearance', 'Kaynaklar': 'Sources', 'Dil ve altyazı': 'Language & subtitles', 'Oynatıcı': 'Player', 'Eklentiler': 'Addons',
  'Yerel dosyalar': 'Local files', 'Profil ve hesap': 'Profile & account', 'Uygulama dili': 'App language', 'Arayüzün dili. Değiştirince uygulama yenilenir.': 'Language of the interface. The app reloads when you change it.',
  'Tema': 'Theme', 'Tema rengi': 'Theme color', 'Dil, tema rengi': 'Language, theme color', 'Profiller, AniList': 'Profiles, AniList', 'mpv, Anime4K': 'mpv, Anime4K',
  'Stremio eklentileri': 'Stremio addons','Gümüş': 'Silver', 'Limon yeşili': 'Lime', 'Elektrik mavisi': 'Electric blue', 'Sakura': 'Sakura', 'Mor': 'Violet',
  'Düğmelerin, oynatma çubuğunun, seçili sekmelerin ve logonun rengi. Oynatıcı da aynı rengi kullanır.': 'Color of buttons, the seek bar and selected tabs. The player uses it too.',
  'Profiller ve AniList': 'Profiles & AniList', 'Profil ekle': 'Add profile', 'Profil adı': 'Profile name', 'Yeni profil adı': 'New profile name', 'Adı değiştir': 'Rename',
  'Profil adını değiştir': 'Rename profile', 'AniList ile bağla': 'Connect AniList', 'AniList bağlı değil': 'AniList not connected', 'Eşitle': 'Sync', 'Eşitleniyor…': 'Syncing…',
  'Çıkış': 'Sign out', 'Giriş iptal edildi.': 'Sign-in cancelled.', 'Tarayıcında AniList açıldı: giriş yapıp “Approve”a bas, gerisi otomatik.': 'AniList opened in your browser: sign in and press “Approve”, the rest is automatic.',
  'Giriş AniList’in kendi sitesinde, varsayılan tarayıcında yapılır; şifren bu uygulamaya hiç girilmez. Uygulama yalnızca AniList’in verdiği erişim anahtarını şifreli saklar.': 'You sign in on AniList’s own site in your default browser; your password never enters this app. Only the access token AniList gives is stored, encrypted.',
  'Dil tercihleri': 'Language preferences', 'Ana dil': 'Main language', 'Yedek dil': 'Backup language', '— Yok —': '— None —',
  'Altyazıyı otomatik seç (internetteki altyazıları sesle karşılaştırıp videoya uyanı açar)': 'Pick subtitles automatically (compares online subtitles with the audio and opens the one that fits)',
  'Videonun içindeki altyazıyı otomatik aç': 'Open the subtitles inside the video automatically', 'Türkçe yoksa İngilizceden çevir': 'Translate from English when there is none in the main language',
  'OpenSubtitles’tan da ara': 'Also search OpenSubtitles', 'Altyazı kaynakları': 'Subtitle sources', 'Ses, altyazı, çeviri': 'Audio, subtitles, translation',
  'Eklenti kurulu olmasa da Türkçe ve İngilizce altyazılar aranır.': 'Subtitles are searched even without an addon installed.',
  'Bölünmüş cümleler birleştirilerek çevrilir, karakter isimleri korunur. Çeviri hazırlanırken İngilizce gösterilir.': 'Split sentences are translated together and character names are kept. English is shown while the translation is prepared.',
  'Dosyada tercih ettiğin dillerden birinde altyazı varsa doğrudan o açılır; internetten aranan ya da çevrilen altyazıya geçilmez. Gömülü altyazı videoyla her zaman uyumludur.': 'If the file has subtitles in one of your languages they open right away; no online or translated subtitle is used. Embedded subtitles always match the video.',
  'Kaynak seçimi': 'Source selection', 'Bölüme tıklayınca en iyi kaynağı otomatik seç ve oynat': 'Pick the best source automatically and play when an episode is clicked',
  'Kaynağı kendin seçmek için bölüme sağ tıkla ya da basılı tut.': 'Right click or hold an episode to pick the source yourself.', 'Tercih edilen kalite': 'Preferred quality',
  'Torrent kaynakları nasıl açılsın?': 'How should torrent sources open?', 'Otomatik seçim, debrid': 'Automatic choice, debrid',
  'Debrid anahtarı yok: torrent kaynakları doğrudan torrentle açılır.': 'No debrid key: torrents open as straight torrents.',
  'Debrid kullanılmaz; bölüm doğrudan eşlerden indirilerek oynatılır.': 'Debrid is not used; the episode streams straight from peers.',
  'Debrid önbelleğinde varsa debrid (anında), yoksa doğrudan torrent.': 'Debrid when cached (instant), otherwise straight torrent.',
  'Her şey debrid üzerinden. Önbellekte olmayan kaynakta debrid indirene kadar beklenir.': 'Everything through debrid. Uncached sources wait until debrid has downloaded them.',
  'Yükleme hızı sınırı': 'Upload speed limit', 'Sınırsız': 'Unlimited', 'İndirilen dosyaları sakla': 'Keep downloaded files',
  'Kapalıyken oynatıcı kapanınca indirilen parçalar silinir ve yükleme durur.': 'When off, downloaded pieces are deleted and uploading stops when the player closes.',
  'API anahtarı': 'API key', 'API anahtarını al ↗': 'Get an API key ↗', 'Kaydet ve doğrula': 'Save and verify', 'Anahtar kayıtlı': 'Key saved', 'Anahtar silindi': 'Key deleted',
  'Anahtar yok': 'No key', 'Yeni anahtar girerek değiştir': 'Enter a new key to change it', 'Uygulamaya gömülü anahtar': 'Built-in key',
  'Eklentilerden gelen torrent kaynakları seçtiğin hizmet üzerinden doğrudan linke çevrilir. Anahtarlar Windows’un şifreli deposunda (DPAPI) saklanır.': 'Torrent sources from addons are turned into direct links through the service you choose. Keys are stored in Windows’ encrypted store (DPAPI).',
  'Oynatma sırasında': 'During playback', 'Otomatik sonraki bölüm': 'Auto next episode', 'Bölüm bitince sıradaki kendiliğinden açılır.': 'The next episode opens when one ends.',
  'Kapalıyken opening ve ending sırasında "Atla" düğmesi çıkar.': 'When off, a "Skip" button appears during the opening and ending.',
  'mpv (önerilen)': 'mpv (recommended)', 'Tarayıcı (yedek)': 'Browser (backup)', 'Uygulama içi': 'In-app', 'Yüksek kalite': 'High quality',
  'Ek mpv ayarları (isteğe bağlı)': 'Extra mpv options (optional)', 'tuşuyla modlar arasında geçebilirsin.': 'switches modes.',
  'Video uygulamanın içine gömülü mpv ile oynar: tüm ses formatları (EAC3, DTS, TrueHD), gömülü ASS altyazılar ve fontları, HDR ve dosyadaki bölüm işaretleri desteklenir.': 'Video plays in mpv embedded in the app: every audio format (EAC3, DTS, TrueHD), embedded ASS subtitles and fonts, HDR and chapter marks are supported.',
  'Tarayıcı oynatıcısı Chromium ile oynatır; desteklemediği sesleri ffmpeg ile dönüştürür. mpv sorun çıkarırsa yedek olarak kullan.': 'The browser player plays with Chromium and converts unsupported audio with ffmpeg. Use it as a backup if mpv has trouble.',
  'Bu cihazda WebGPU bulunamadı; tarayıcı oynatıcısında Anime4K çalışmaz.': 'No WebGPU on this device; Anime4K doesn’t work in the browser player.',
  'Bilgisayardaki klasörler': 'Folders on this computer', 'Klasör ekle': 'Add folder', 'Kaldır': 'Remove', 'Taranıyor…': 'Scanning…', 'Henüz klasör eklenmedi.': 'No folders added yet.',
  'Bu klasörlerde video dosyası bulunamadı.': 'No video files in these folders.', 'Diğer': 'Other',
  'Bilgisayarındaki anime klasörleri. Dosyalar bölüm numarasına göre gruplanır.': 'Anime folders on your computer. Files are grouped by episode number.',
  'Eklenti adresi (manifest.json veya stremio:// linki)': 'Addon URL (manifest.json or stremio:// link)', 'Yapılandır ↗': 'Configure ↗',
  'Henüz eklenti yok. Aşağıdaki önerilerden başlayabilirsin.': 'No addons yet. You can start with the suggestions below.',
  'Stremio uyumlu her eklenti çalışır. Bilgisayarında çalışan yerel eklentileri de http://127.0.0.1 adresiyle ekleyebilirsin.': 'Any Stremio-compatible addon works. Local addons on your computer can be added with http://127.0.0.1.',
  'İzlendi sayılma oranı · %': 'Counts as watched at · %', 'Geç': 'Skip', 'Client ID (ör. 12345)': 'Client ID (e.g. 12345)',
  'Ana dilde altyazı yoksa İngilizceden çevir': 'Translate from English when there is none in the main language',
  'Yapay zekayla çevir (cihazda, internetsiz)': 'Translate with AI (on this device, offline)',
  'Çeviri Google yerine bu bilgisayarda yapılır: kota ya da engel yok. Bir bölüm yaklaşık 1–3 dakikada çevrilir, ilk satırlar hemen gelir. Model bir kez indirilir (yaklaşık 890 MB).': 'Translation runs on this computer instead of Google: no quota, no blocking. An episode takes about 1–3 minutes, the first lines arrive right away. The model is downloaded once (about 890 MB).',
  'Model hazır.': 'Model ready.',
  'Kullanılmayan modeli sil': 'Delete unused model',
  'Karışık: hikâye + filler': 'Mixed: story + filler',
  'Filler: hikâye dışı': 'Filler: not in the story',
  'Bu animenin fragmanları ülkende engelli.': 'This show’s trailers are blocked in your country.',
  'YouTube’da ara': 'Search on YouTube',
  'Başka fragman aranıyor…': 'Looking for another trailer…',
  'Modeli sil': 'Delete model',
  'Modeli indir (890 MB)': 'Download model (890 MB)',
  'Her profilin kendi listesi ve kendi AniList hesabı olur. Bölümün %': 'Each profile has its own list and AniList account. Progress is updated on AniList automatically once %',
  '’i izlenince AniList’te ilerleme otomatik güncellenir.': ' of an episode is watched.',
  'Doğrudan torrentte hız seed sayısına bağlıdır; otomatik seçim bu yüzden çok seed’li kaynakları öne alır. İzlerken kendi bağlantınla eşlere bağlanır ve başkalarına da yükleme yaparsın (IP adresin görünür).': 'With straight torrents speed depends on seeders, so the automatic choice prefers well-seeded sources. While watching you connect to peers yourself and upload to others too (your IP address is visible).',
  'Sıra: dosyadaki ana dil altyazısı → internetteki ana dil altyazısı (videoya uyanı, gerekirse kaydırılarak) → ana dil İngilizce değilse İngilizceden çeviri → yedek dil. “Signs & Songs” gibi yalnızca tabela/şarkı içeren parçalar ana altyazı olarak seçilmez.': 'Order: main-language subtitles in the file → main-language subtitles online (the one that fits the video, shifted if needed) → translation from English if the main language isn’t English → backup language. Sign/song-only tracks like “Signs & Songs” are never picked as the main subtitle.',
  '1080p kaynaklar': '1080p sources', 'bulanıklık ve sıkıştırma izi': 'blur and compression artifacts', '720p kaynaklar': '720p sources', 'hafif iyileştirme': 'light enhancement',
  'Düşük çözünürlük': 'Low resolution', 'en az bozulma': 'fewest artifacts', 'Daha güçlü A': 'Stronger A', 'Daha güçlü B': 'Stronger B', 'daha çok GPU': 'more GPU', 'C ardından A': 'C then A',
  'Nyaa, AnimeTosho ve diğer kaynaklardan torrentler. Debrid’i uygulama ayarlarından kullanır.': 'Torrents from Nyaa, AnimeTosho and more. Uses the debrid set in the app settings.',
  'Altyazı eklentisi. Türkçe dahil birçok dilde altyazıyı oynatıcıya getirir.': 'Subtitle addon. Brings subtitles in many languages to the player.',
  'Debrid odaklı hızlı torrent eklentisi. Sitesinde yapılandırıp oluşan linki yapıştır.': 'Fast debrid-focused torrent addon. Configure it on its site and paste the link.',
  'Birçok kaynaktan torrent ve doğrudan link. Yapılandırma gerekir.': 'Torrents and direct links from many sources. Needs configuring.',
  'Birden fazla eklentiyi tek yerde toplar ve filtreler.': 'Combines and filters several addons in one place.',
  'Süre': 'Duration', 'Puan': 'Score', 'Stüdyo': 'Studio', 'İlerlemen': 'Your progress', 'Diğer adlar': 'Other titles', 'İlişkili': 'Related',
  'En eski': 'Oldest', 'Filler’ı gizle': 'Hide filler', 'Bölüm ara (numara ya da ad)': 'Search episodes (number or title)',
  'AniList’te aç': 'Open on AniList', 'MyAnimeList’te aç': 'Open on MyAnimeList', 'Yan hikâye': 'Side story', 'Ana seri': 'Parent', 'Spin-off': 'Spin-off',
  'Otomatik çeviri': 'Auto-translate', 'Başka İngilizce kaynaktan çevir': 'Translate from another English source',
  // misc / errors
  'Bilinmeyen dil': 'Unknown language', 'AniList istek sınırına takıldı, biraz sonra tekrar dene.': 'AniList rate limit reached, try again in a moment.',
  'Günlük ücretsiz çeviri kotası doldu; biraz sonra tekrar dene.': 'The free daily translation quota is used up; try again later.',
  'Çeviri hizmetine ulaşılamadı.': 'Translation service unreachable.', 'Altyazı indirilemedi': 'Subtitle download failed',
  'Bu klasör': 'This folder', 'Ara': 'Search'
}

// Language names (Intl gives Turkish names in the Turkish UI): used inside other texts.
const LANGS: Record<string, string> = {
  Türkçe: 'Turkish', İngilizce: 'English', Japonca: 'Japanese', Almanca: 'German', Fransızca: 'French', İspanyolca: 'Spanish', Portekizce: 'Portuguese',
  İtalyanca: 'Italian', Rusça: 'Russian', Arapça: 'Arabic', Çince: 'Chinese', Korece: 'Korean', Lehçe: 'Polish', Endonezce: 'Indonesian', Vietnamca: 'Vietnamese',
  Tayca: 'Thai', Hintçe: 'Hindi', Felemenkçe: 'Dutch', Ukraynaca: 'Ukrainian', İbranice: 'Hebrew', Yunanca: 'Greek', Macarca: 'Hungarian', Çekçe: 'Czech', Romence: 'Romanian'
}
Object.assign(EN, LANGS)
const L = (s: string) => LANGS[s] ?? EN[s] ?? s

const PATTERNS: [RegExp, (...m: string[]) => string][] = [
  [/^Model indiriliyor… %(\d+)$/, (_, n) => `Downloading model… ${n}%`],
  [/^Modeli indir \((\d+) MB\)$/, (_, n) => `Download model (${n} MB)`],
  [/^Türkçe çeviri bu bilgisayarda Töz-Çevir modeliyle yapılır.*\(yaklaşık (\d+) MB\)\.$/, (_, n) => `Turkish translation runs on this computer with the Töz-Çevir model: no quota, no blocking. An episode takes about 1 minute, the first lines arrive right away. The model is downloaded once (about ${n} MB).`],
  [/^Çeviri bu bilgisayarda NLLB modeliyle yapılır.*\(yaklaşık (\d+) MB\)\.$/, (_, n) => `Translation runs on this computer with the NLLB model: no quota, no blocking. An episode takes about 2–3 minutes, the first lines arrive right away. The model is downloaded once (about ${n} MB).`],
  [/^İndirilemedi: (.+)$/, (_, e) => `Download failed: ${e}`],
  [/^(\d+)\. bölüm$/i, (_, n) => `Episode ${n}`],
  [/^(\d+)\. BÖLÜM$/, (_, n) => `EPISODE ${n}`],
  [/^(\d+)\. bölümü izle$/, (_, n) => `Watch episode ${n}`],
  [/^(\d+)\. bölümden devam et$/, (_, n) => `Continue from episode ${n}`],
  [/^(\d+)\. bölümü oynat$/, (_, n) => `Play episode ${n}`],
  [/^(\d+)\. bölüm hazırlanıyor…$/, (_, n) => `Preparing episode ${n}…`],
  [/^(\d+\+?) bölüm$/, (_, n) => `${n} episodes`],
  [/^(\d+)\/(\S+) bölüm izlendi$/, (_, a, b) => `${a}/${b} episodes watched`],
  [/^(\d+)\/(\S+) izlendi$/, (_, a, b) => `${a}/${b} watched`],
  [/^(\d+) dk kaldı$/, (_, n) => `${n} min left`],
  [/^(\d+) dk$/, (_, n) => `${n} min`],
  [/^(\S+) altyazı seçildi · (.*)$/, (_, l, a) => `${L(l)} subtitles picked · ${a}`],
  [/^İnternetteki (\S+) altyazılar videoya uymadı$/, (_, l) => `Online ${L(l)} subtitles don’t fit the video`],
  [/^(\S+) altyazı hazırlanıyor…$/, (_, l) => `Preparing ${L(l)} subtitles…`],
  [/^(\S+) altyazı hazır$/, (_, l) => `${L(l)} subtitles ready`],
  [/^(\S+) altyazı hazırlanamadı: (.*)$/, (_, l, m) => `${L(l)} subtitles failed: ${tr(m) ?? m}`],
  [/^Senkron(.*) ›$/, (_, r) => `Sync${r.replace(' sn', ' s')} ›`],
  [/^(.*) · internetten$/, (_, a) => `${a} · online`],
  [/^→ (\S+)$/, (_, l) => `→ ${L(l)}`],
  [/^(\d+) dk önce$/, (_, n) => `${n} min ago`],
  [/^(\d+) sa önce$/, (_, n) => `${n} h ago`],
  [/^(\d+) gün önce$/, (_, n) => `${n} days ago`],
  [/^Bölüm (\d+)$/, (_, n) => `Chapter ${n}`],
  [/^Tümü (\d*)$/, (_, n) => `All ${n}`],
  [/^(\d+) bölüm$/, (_, n) => `${n} chapters`],
  [/^(Kış|İlkbahar|Yaz|Sonbahar) (\d{4})$/, (_, s, y) => `${EN[s]} ${y}`],
  [/^(\S+) altyazı$/, (_, l) => `${L(l)} subtitles`],
  [/^(\S+) altyazı aranıyor…$/, (_, l) => `Searching ${L(l)} subtitles…`],
  [/^(\S+) altyazı hazırlanıyor · (.*)$/, (_, l, m) => `Preparing ${L(l)} subtitles · ${tr(m) ?? m}`],
  [/^(\S+) altyazılar sesle karşılaştırılıyor…$/, (_, l) => `Comparing ${L(l)} subtitles with the audio…`],
  [/^(\S+) \(otomatik çeviri\)$/, (_, l) => `${L(l)} (auto-translated)`],
  [/^(\S+) \(çeviri\)$/, (_, l) => `${L(l)} (translated)`],
  [/^(\S+) · otomatik çeviri$/, (_, l) => `${L(l)} · auto-translated`],
  [/^(\S+) · Zorunlu$/, (_, l) => `${L(l)} · Forced`],
  [/^(\S+) #(\d+)$/, (_, l, n) => `${L(l)} #${n}`],
  [/^Hazır (\S+) altyazı yok\. Otomatik çeviri Google Çeviri ile yapılır; anime terimlerinde hatalar olabilir\.$/, (_, l) => `No ready-made ${L(l)} subtitles. Auto-translation uses Google Translate; anime terms may come out wrong.`],
  [/^(\S+) altyazı ya da çevrilebilecek İngilizce altyazı bulunamadı\.$/, (_, l) => `No ${L(l)} subtitles or English subtitles to translate.`],
  [/^Dosyadaki İngilizce(.*)$/, (_, r) => `English in the file${r}`],
  [/^İnternetteki İngilizce #(\d+) \((.*)\)$/, (_, n, a) => `English online #${n} (${a})`],
  [/^(.*) → (\S+)$/, (_, a, l) => `${tr(a) ?? a} → ${L(l)}`],
  [/^İnternetten · (.*)$/, (_, a) => `Online · ${a}`],
  [/^Çevriliyor… (.*)’a kadar hazır$/, (_, t) => `Translating… ready up to ${t}`],
  [/^Çevriliyor… %(\d+)$/, (_, n) => `Translating… ${n}%`],
  [/^Dosyadan okunuyor… ?(.*)$/, (_, n) => `Reading from the file… ${n}`],
  [/^Konuşma aranıyor… %(\d+)$/, (_, n) => `Looking for speech… ${n}%`],
  [/^Arabellek %(\d+)$/, (_, n) => `Buffering ${n}%`],
  [/^Videoya uyuyor(.*)$/, (_, r) => `Matches the video${r.replace(/ sn kaydırıldı/, ' s shifted')}`],
  [/^Altyazı ([\d.]+) sn geç gösteriliyor$/, (_, n) => `Subtitles shown ${n} s late`],
  [/^Altyazı ([\d.]+) sn erken gösteriliyor$/, (_, n) => `Subtitles shown ${n} s early`],
  [/^En iyi kaynak açılıyor \((\d+)\/(\d+)\)$/, (_, a, b) => `Opening the best source (${a}/${b})`],
  [/^(.*) kaldırıldı$/, (_, a) => `${a} removed`],
  [/^AniList eşitlendi: (\d+) anime$/, (_, n) => `AniList synced: ${n} anime`],
  [/^(.*) · popülerliğe göre$/, (_, a) => `${tr(a) ?? a} · by popularity`]
]

// Texts added after the first table (accounts, calendar, themes, player menus, spoilers, hidden list)
Object.assign(EN, {
  'Bu profile AniList ya da MyAnimeList hesabı bağlı değil. İzleme ilerlemen yalnızca bu cihazda tutuluyor, uygulama silinirse kaybolabilir.': 'No AniList or MyAnimeList account is linked to this profile. Your progress is only kept on this device and may be lost if the app is removed.',
  'Hesap bağla': 'Link account', 'Bir daha uyarma': "Don't warn again", 'Tümünü temizle': 'Clear all', 'aramasını sil': 'remove search',
  'AniList çok sık istek aldı, kısa bir ara istiyor.': 'AniList got too many requests and asks for a short break.', 'AniList’e şu an ulaşılamıyor.': "AniList can't be reached right now.",
  'sonra kendiliğinden tekrar denenecek.': 'then it will be retried automatically.', 'Bekleyen yüklemeleri bırak': 'Drop pending loads', 'İptal': 'Cancel',
  'Sarı': 'Yellow', 'Açık mavi': 'Light blue', 'Açık yeşil': 'Light green', 'Beyaz': 'White', 'Dosya': 'File', 'Yok': 'None', 'Normal': 'Normal',
  'Opening atlandı': 'Opening skipped', 'Ending atlandı': 'Ending skipped', '4K video: Anime4K bu videoda kapalı': '4K video: Anime4K is off for this video',
  '· tekrar denemek için tıkla': '· click to try again', 'Otomatik çeviri bu bilgisayarda yapay zekâ ile yapılır.': 'Auto-translation runs on this computer with AI.',
  'Otomatik çeviri internetteki çeviri hizmetleriyle yapılır.': 'Auto-translation uses online translation services.', 'Otomatik çeviri': 'Auto-translate',
  'İnce': 'Thin', 'Kalın': 'Thick', 'Yarı saydam kutu': 'See-through box', 'Koyu kutu': 'Dark box', 'Yazı tipi': 'Font', 'Kalın yazı': 'Bold text', 'Varsayılana dön': 'Reset to default',
  'Altyazı görünümü': 'Subtitle look', 'Boyut': 'Size', 'Renk': 'Colour', 'Kenar': 'Outline', 'Arka plan': 'Background', 'Varsayılan': 'Default', 'Özel': 'Custom',
  '“Dosya” seçenekleri altyazı dosyasının kendi stilini korur. Oynatıcı düğmeleri açıkken altyazı otomatik olarak çubuğun üstüne çıkar.': '“File” keeps the subtitle file’s own style. While the player controls show, subtitles move above the bar.',
  'Şu an oynatılıyor': 'Now playing', 'Filler bölümleri atla': 'Skip filler episodes', 'Openingi otomatik atla': 'Skip openings automatically', 'Endingi otomatik atla': 'Skip endings automatically',
  'Otomatik sonraki bölüm': 'Autoplay next episode', 'Oynatma hızı': 'Playback speed', 'Açık': 'On', 'Kapalı': 'Off', 'Yüksek kalite': 'High quality', 'Hızlı': 'Fast',
  'Yüksek kalite güçlü ekran kartı ister; zayıf donanımda görüntü takılabilir.': 'High quality needs a strong graphics card; video may stutter on weak hardware.',
  'Bu video 4K: Anime4K otomatik kapatıldı. Bir mod seçersen yine açılır.': 'This video is 4K: Anime4K was switched off. Pick a mode to turn it back on.',
  'Altyazı (C)': 'Subtitles (C)', 'Altyazı': 'Subtitles', 'Senkron': 'Sync', 'Ses': 'Audio', 'Kaynak': 'Source', 'Bilgi': 'Info',
  'Altyazı indiriliyor…': 'Downloading subtitles…', 'Altyazı dosyadan okunuyor…': 'Reading subtitles from the file…', 'Altyazı yükleniyor… (ileri kısımlar birkaç saniye içinde gelir)': 'Loading subtitles… (later parts follow in a few seconds)',
  'Video yüklenemedi. Link süresi dolmuş olabilir; kaynağı tekrar seç.': "The video couldn't load. The link may have expired; pick the source again.",
  'Ses bu oynatıcıda çözülemediği için anında AAC’ye dönüştürülüyor': "This player can't decode the audio, so it is converted to AAC on the fly",
  'Bu dosyada gömülü altyazı yok.': 'This file has no embedded subtitles.', 'görüntü tabanlı, desteklenmiyor': 'image based, not supported',
  'Altyazı eklentilerine soruluyor…': 'Asking subtitle addons…', 'Eklentilerden altyazı gelmedi. Eklentiler sayfasından OpenSubtitles’ı kurabilirsin.': 'No subtitles from addons. You can install OpenSubtitles on the Addons page.',
  'Altyazı erken geliyorsa artır, geç geliyorsa azalt. Kısayol:': 'Raise it if subtitles come early, lower it if they come late. Shortcut:',
  'Ses parçası bilgisi alınamadı.': "Couldn't read the audio tracks.", 'Tarayıcı çözemiyor, AAC’ye dönüştürülerek çalınır': "The browser can't decode it; it plays converted to AAC",
  'Bu cihazda WebGPU yok, Anime4K kullanılamıyor.': 'No WebGPU on this device, Anime4K is unavailable.', 'Bu kaynak': 'This source', 'İşleme:': 'Processing:', 'İnceleniyor…': 'Checking…',
  'Doğrudan (dönüştürme yok)': 'Direct (no conversion)', 'Dönüştürme yok, seçilen ses parçası için yeniden paketleniyor': 'No conversion, repackaged for the chosen audio track',
  'S tuşu': 'S key', 'Görüntü ve Anime4K': 'Picture and Anime4K', 'Profiller ve hesaplar': 'Profiles and accounts',
  'Sıra: dosyadaki ana dil altyazısı → internetteki ana dil altyazısı (videoya uyanı, gerekirse kaydırılarak) → ana dil İngilizce değilse İngilizceden çeviri → yedek dil. “Signs & Songs” gibi yalnızca tabela/şarkı içeren parçalar ana altyazı olarak seçilmez.': 'Order: main-language subtitle in the file → main-language subtitle online (the one that fits the video, shifted if needed) → translation from English if the main language isn’t English → backup language. Tracks with only signs/songs (“Signs & Songs”) are never picked as the main subtitle.',
  '’i izlenince bağlı hesaplarda ilerleme otomatik güncellenir.': ' is watched, progress is updated on the linked accounts.',
  'Tarayıcında MyAnimeList açıldı: giriş yapıp “Allow”a bas, gerisi otomatik.': 'MyAnimeList opened in your browser: sign in and press “Allow”, the rest is automatic.',
  'MyAnimeList bağlı değil': 'MyAnimeList not linked', 'AniList eşitleniyor…': 'Syncing AniList…', 'AniList eşitle': 'Sync AniList', 'AniList çıkış': 'Sign out of AniList',
  'AniList Client ID tanımlı değil': 'No AniList Client ID set', 'MAL eşitleniyor…': 'Syncing MAL…', 'MAL eşitle': 'Sync MAL', 'MAL çıkış': 'Sign out of MAL', 'MyAnimeList ile bağla': 'Link with MyAnimeList',
  'AniList ile bağla': 'Link with AniList',
  'Giriş AniList’in ve MyAnimeList’in kendi sitesinde, varsayılan tarayıcında yapılır; şifren bu uygulamaya hiç girilmez. Uygulama yalnızca sitenin verdiği erişim anahtarını saklar.': 'You sign in on AniList’s and MyAnimeList’s own sites in your default browser; your password never enters this app. It only keeps the access key the site gives.',
  'Geliştirici: AniList Client ID tanımlı değil': 'Developer: no AniList Client ID set', 'Uygulamanın içine gömülü bir Client ID yok.': 'There is no Client ID built into the app.',
  'Topluluk eklentileri': 'Community addons', 'gün': 'days', 'yayınlanmasına': 'until airing', 'yayınlandı': 'aired', 'İzleme sırası': 'Watch order',
  'Yayın sırasına göre. Ana hikâye numaralı; OVA, özel bölüm ve yan hikâyeler arada, isteğe bağlı.': 'In release order. The main story is numbered; OVAs, specials and side stories sit in between and are optional.',
  'isteğe bağlı': 'optional', 'Bu anime': 'This anime', 'İptal etmek için tıkla': 'Click to cancel', 'Rastgele başka bir anime': 'Another random anime', 'Rastgele anime': 'Random anime',
  'Seçiliyor… (iptal)': 'Picking… (cancel)', 'Sıradaki': 'Up next', 'Baştan izle': 'Watch from the start',
  'Sonraki bölüme geçerken filler bölümleri atla (oynatıcının ayarlarında da var)': 'Skip filler episodes when moving to the next one (also in the player settings)', 'Filler’ı otomatik atla': 'Skip fillers automatically',
  'Bugün': 'Today', 'Yarın': 'Tomorrow', 'Yayın takvimi': 'Airing schedule', 'Takvim': 'Schedule', 'Bildirimler': 'Notifications', 'Sadece listemdekiler': 'Only my list',
  'Listendeki animelerden bu gün yayınlanan yok.': 'Nothing from your list airs on this day.', 'Bu gün yayın yok.': 'Nothing airs on this day.', 'Yayınlandı': 'Aired',
  'Bu filtrelerle anime bulunamadı.': 'No anime matches these filters.', 'Gizle': 'Hide', 'Geri getir': 'Bring back',
  '“İzlemeye devam et”ten gizlediğin animeler. Sadece bu uygulamada gizlenir; AniList ve MAL listene dokunulmaz.': 'Anime you hid from “Continue Watching”. Hidden only in this app; your AniList and MAL lists are not touched.',
  'Gizlenen anime yok.': 'No hidden anime.', 'Bildirimler bağlı AniList hesabından gelir. Bu profile bağlı hesap yok.': 'Notifications come from the linked AniList account. No account is linked to this profile.',
  'Hiç bildirim yok.': 'No notifications.', 'Altyazılar (Türkçe çeviri dahil) otomatik eklenir, kaldığın yer ve izlendi bilgisi tutulur.': 'Subtitles (including the Turkish translation) are added automatically; your position and watched state are kept.',
  'Telefondaki oynatıcı açılır. Süslü ASS altyazılar ve her ses formatı için en iyisi mpv.': "Opens the phone's own player. mpv is best for styled ASS subtitles and every audio format.",
  'Bir video uygulama içinde açılmazsa harici oynatıcıyı seç.': "If a video won't open in the app, choose the external player.",
  'Grafit': 'Graphite', 'Düz koyu gri, beyaz vurgu': 'Flat dark grey, white accent', 'Grafit ışıklı': 'Graphite glow', 'Grafit + ışık hüzmesi': 'Graphite + light beam', 'OLED siyahı': 'OLED black',
  'Saf mono': 'Pure mono', 'Sadece siyah ve beyaz': 'Only black and white', 'Kâğıt': 'Paper', 'Açık: kırık beyaz, siyah yazı': 'Light: off-white, black text', 'Sakura': 'Sakura', 'Açık: kiraz çiçeği pembesi': 'Light: cherry blossom pink',
  'Spoiler, filler, Anime4K': 'Spoilers, fillers, Anime4K',
  'Türkçe çeviri bu bilgisayarda, anime altyazılarıyla eğitilmiş yapay zekâ modeliyle yapılır: internet, kota ya da engel yok. İzlediğin yerden başlar, ilk satırlar birkaç saniyede gelir. Model uygulamayla birlikte gelir.': 'The Turkish translation runs on this computer with an AI model trained on anime subtitles: no internet, quota or blocks. It starts where you are watching and the first lines arrive in seconds. The model ships with the app.',
  'Seçince hemen uygulanır. Oynatıcı her temada koyu kalır.': 'Applied right away. The player stays dark in every theme.',
  'Eklentilerden gelen torrent kaynakları seçtiğin hizmet üzerinden doğrudan linke çevrilir. Anahtarlar yalnızca bu bilgisayarda, uygulamanın kendi verisinde saklanır.': 'Torrent sources from addons are turned into direct links through the service you choose. Keys are stored only on this computer, in the app’s own data.',
  'Bölümün bu kadarı izlenince izlendi sayılır ve AniList’teki ilerleme güncellenir.': 'Once this much of an episode is watched it counts as watched and your AniList progress is updated.',
  'Spoiler gizle': 'Hide spoilers', 'İzlemediğin bölümlerin resmi bulanıklaşır, adı ve özeti gizlenir. Sadece izlediğin bölümler açık görünür.': 'Episodes you haven’t watched get a blurred picture and their title and summary are hidden. Only watched episodes show fully.',
  'Sonraki bölüme geçerken hikâye dışı (filler) bölümler atlanır; oynatıcı kaç bölüm atlandığını söyler. Anime sayfasından ve oynatıcının ayarlarından da açılıp kapatılır.': 'Filler episodes are skipped when moving to the next one; the player says how many were skipped. Also switchable on the anime page and in the player settings.',
  'Animeyi ekran kartında gerçek zamanlı keskinleştirip büyütür. Oynatma sırasında': 'Sharpens and upscales anime on the graphics card in real time. While playing,',
  'Yüksek kalite güçlü bir ekran kartı ister. Dahili grafikli ya da eski bilgisayarlarda görüntü takılabilir, kare atlayabilir; öyle olursa “Hızlı”ya geç.': 'High quality needs a strong graphics card. On integrated or older graphics the video may stutter or drop frames; switch to “Fast” then.',
  '4K videolarda Anime4K’yı kapat': 'Turn Anime4K off for 4K videos', '4K (2160p) görüntü zaten keskindir; Anime4K orada fark yaratmaz, ekran kartını boşuna yorar. 1080p ve altında çalışmaya devam eder.': '4K (2160p) is already sharp; Anime4K adds nothing there and only loads the GPU. It keeps working at 1080p and below.',
  'Gelişmiş': 'Advanced', 'Oynatıcı': 'Player', 'Genel': 'General', 'Görünüm': 'Appearance', 'Tema': 'Theme', 'Diller': 'Languages', 'Hesaplar': 'Accounts',
  'Çevriliyor… izlediğin yerin altyazısı dosyadan okunuyor': 'Translating… reading the subtitles where you are watching from the file'
})
PATTERNS.push(
  [/^Gizlenenler (\d+)$/, (_, n) => `Hidden ${n}`],
  [/^(\d+)\. bölüm hazırlanıyor…$/, (_, n) => `Preparing episode ${n}…`],
  [/^(\S+) altyazı hazırlanıyor…$/, (_, l) => `Preparing ${L(l)} subtitles…`],
  [/^(\S+) altyazı hazır$/, (_, l) => `${L(l)} subtitles ready`],
  [/^(\S+) altyazı hazırlanamadı: (.*)$/, (_, l, e) => `${L(l)} subtitles failed: ${e}`],
  [/^(\S+) altyazı seçildi · (.*)$/, (_, l, a) => `${L(l)} subtitles picked · ${a}`],
  [/^İnternetteki (\S+) altyazılar videoya uymadı$/, (_, l) => `Online ${L(l)} subtitles didn't fit the video`],
  [/^(AniList|MyAnimeList) zaten eşitli · (\d+) anime$/, (_, s, n) => `${s} already in sync · ${n} anime`],
  [/^(AniList|MyAnimeList) eşitlendi · (\d+) değişiklik alındı, (\d+) gönderildi$/, (_, s, a, b) => `${s} synced · ${a} changes received, ${b} sent`],
  [/^(AniList|MyAnimeList) eşitlemesi iptal edildi \(o ana kadar gönderilenler kaldı\)$/, (_, s) => `${s} sync cancelled (what was sent so far stays)`],
  [/^(AniList|MyAnimeList) eşitlenemedi: (.*)$/, (_, s, e) => `${s} sync failed: ${e}`],
  [/^Çevriliyor… izlediğin yerin altyazısı dosyadan okunuyor · (\d+) satır hazır$/, (_, n) => `Translating… reading the subtitles where you are watching · ${n} lines ready`],
  [/^Çevriliyor… %(\d+) · izlediğin yerden (.*)’a kadar hazır$/, (_, n, t) => `Translating… ${n}% · ready up to ${t} from where you are`],
  [/^Çevriliyor… (\d+) satır hazır$/, (_, n) => `Translating… ${n} lines ready`],
  [/^(\d+) dk kaldı$/, (_, n) => `${n} min left`],
  [/^(\d+)\/(\S+) izlendi$/, (_, a, b) => `${a}/${b} watched`],
  [/^(\d+) gün$/, (_, n) => `${n} days`],
  [/^(\d+) eş · ([\d.]+) MB\/sn$/, (_, n, v) => `${n} peers · ${v} MB/s`]
)

/** English for a Turkish UI text, or null when there is none (titles, numbers, already English). */
function tr(s: string): string | null {
  const t = s.trim()
  if (!t || !/[A-Za-zÇĞİÖŞÜçğıöşü]/.test(t)) return null
  if (EN[t] != null) return EN[t]
  for (const [re, f] of PATTERNS) {
    const m = re.exec(t)
    if (m) return f(...m)
  }
  // "TV · 12 bölüm · 2020": translate each part
  if (t.includes(' · ')) {
    const parts = t.split(' · ')
    const out = parts.map(p => tr(p) ?? p)
    return out.some((p, i) => p !== parts[i]) ? out.join(' · ') : null
  }
  return null
}

function swap(s: string): string | null {
  const r = tr(s)
  if (r == null || r === s.trim()) return null
  // keep the spaces around the text (JSX splits "12" + " bölüm" into nodes)
  return s.replace(s.trim(), r)
}

const ATTRS = ['placeholder', 'title', 'aria-label']
function translateNode(n: Node) {
  if (n.nodeType === Node.TEXT_NODE) {
    const p = n.parentElement
    if (!p || p.closest('[data-noi18n], script, style, textarea, input')) return
    const r = swap(n.nodeValue ?? '')
    if (r != null) n.nodeValue = r
    return
  }
  if (n.nodeType !== Node.ELEMENT_NODE) return
  const el = n as Element
  if (el.closest('[data-noi18n], script, style')) return
  for (const a of ATTRS) {
    const v = el.getAttribute(a)
    if (v) {
      const r = swap(v)
      if (r != null) el.setAttribute(a, r)
    }
  }
  const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT)
  let c = w.nextNode()
  while (c) {
    if (c.nodeType === Node.TEXT_NODE) translateNode(c)
    else for (const a of ATTRS) {
      const v = (c as Element).getAttribute(a)
      if (v) {
        const r = swap(v)
        if (r != null) (c as Element).setAttribute(a, r)
      }
    }
    c = w.nextNode()
  }
}

/** Start the English layer (no-op in Turkish). Call once before the app renders. */
export function startI18n() {
  if (getUiLang() !== 'en') return
  document.documentElement.lang = 'en'
  const run = () => {
    translateNode(document.body)
    new MutationObserver(ms => {
      for (const m of ms) {
        if (m.type === 'characterData') translateNode(m.target)
        else if (m.type === 'attributes') translateNode(m.target)
        else m.addedNodes.forEach(translateNode)
      }
    }).observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ATTRS })
  }
  if (document.body) run()
  else addEventListener('DOMContentLoaded', run)
}

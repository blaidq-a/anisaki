package app.anisaki.mobile

import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import androidx.activity.result.ActivityResult
import app.tauri.annotation.ActivityCallback
import app.tauri.annotation.Command
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin

/**
 * The phone's players for the Rust side (lib.rs → player_call): "play" opens Anisaki's own ExoPlayer
 * (PlayerActivity) with the subtitles and OP/ED times, "open" an installed player (mpv-android, VLC,
 * MX Player). Both answer when the player closes: where it stopped, how long the video is, and what the
 * viewer asked for next ("next", "prev", "sources"). "exit" leaves the app (Back on the first page).
 */
@TauriPlugin
class PlayerPlugin(private val activity: Activity) : Plugin(activity) {
  private val players = arrayOf("is.xyz.mpv", "org.videolan.vlc", "com.mxtech.videoplayer.ad", "com.mxtech.videoplayer.pro")

  private fun installed(pkg: String) = try {
    activity.packageManager.getPackageInfo(pkg, 0)
    true
  } catch (e: PackageManager.NameNotFoundException) {
    false
  }

  @Command
  fun open(invoke: Invoke) {
    val a = invoke.getArgs()
    val url = a.getString("url", null) ?: return invoke.reject("Video adresi yok")
    var intent = Intent(Intent.ACTION_VIEW)
    intent.setDataAndType(Uri.parse(url), "video/*")
    intent.putExtra("title", a.getString("title", "Anisaki"))
    val position = a.optLong("position", 0L)
    // resume position, understood by mpv-android, VLC and MX Player
    if (position > 0) {
      intent.putExtra("position", position.toInt())
      intent.putExtra("extra_position", position)
    }
    intent.putExtra("return_result", true)
    val pkg = players.firstOrNull { installed(it) }
    if (pkg != null) intent.setPackage(pkg) else intent = Intent.createChooser(intent, "Oynatıcı seç")
    try {
      startActivityForResult(invoke, intent, "played")
    } catch (e: ActivityNotFoundException) {
      invoke.reject("Telefonda video oynatıcı bulunamadı. Google Play'den mpv ya da VLC kur.")
    }
  }

  /** Everything the player needs for one episode / source, as intent extras. */
  private fun fill(intent: Intent, a: JSObject) {
    intent.putExtra("url", a.getString("url", null))
    intent.putExtra("title", a.getString("title", "Anisaki"))
    intent.putExtra("subtitle", a.getString("subtitle", null))
    intent.putExtra("message", a.getString("message", null))
    intent.putExtra("position", a.optLong("position", 0L))
    intent.putExtra("audioLang", a.getString("audioLang", null))
    intent.putExtra("subLang", a.getString("subLang", null))
    intent.putExtra("subLangs", a.getString("subLangs", null))
    intent.putExtra("autoSync", a.optBoolean("autoSync", true))
    intent.putExtra("autoSkipOp", a.optBoolean("autoSkipOp", false))
    intent.putExtra("autoSkipEd", a.optBoolean("autoSkipEd", false))
    intent.putExtra("autoNext", a.optBoolean("autoNext", true))
    intent.putExtra("hasNext", a.optBoolean("hasNext", false))
    intent.putExtra("hasPrev", a.optBoolean("hasPrev", false))
    intent.putExtra("tozAuto", a.optBoolean("tozAuto", false))
    intent.putExtra("episode", a.optInt("episode", 0))
    val eps = a.optJSONArray("episodeList")
    if (eps != null) {
      val nums = IntArray(eps.length())
      val titles = arrayOfNulls<String>(eps.length())
      val images = arrayOfNulls<String>(eps.length())
      val fillers = BooleanArray(eps.length())
      for (i in 0 until eps.length()) {
        val o = eps.getJSONObject(i)
        nums[i] = o.optInt("number")
        titles[i] = if (o.isNull("title")) null else o.optString("title")
        images[i] = if (o.isNull("image")) null else o.optString("image")
        fillers[i] = o.optBoolean("filler", false)
      }
      intent.putExtra("epNums", nums)
      intent.putExtra("epTitles", titles)
      intent.putExtra("epImages", images)
      intent.putExtra("epFillers", fillers)
    }
    val segs = a.optJSONArray("segments")
    if (segs != null) {
      val n = segs.length()
      val st = DoubleArray(n)
      val en = DoubleArray(n)
      val kind = arrayOfNulls<String>(n)
      for (i in 0 until n) {
        val o = segs.getJSONObject(i)
        st[i] = o.optDouble("start")
        en[i] = o.optDouble("end")
        kind[i] = o.optString("kind", "op")
      }
      intent.putExtra("segStart", st)
      intent.putExtra("segEnd", en)
      intent.putExtra("segKind", kind)
    }
    val subs = a.optJSONArray("subtitles")
    if (subs != null) {
      val n = subs.length()
      val uris = arrayOfNulls<String>(n)
      val langs = arrayOfNulls<String>(n)
      val labels = arrayOfNulls<String>(n)
      val mimes = arrayOfNulls<String>(n)
      for (i in 0 until n) {
        val o = subs.getJSONObject(i)
        uris[i] = o.optString("uri")
        langs[i] = o.optString("lang", null)
        labels[i] = o.optString("label", null)
        mimes[i] = o.optString("mime", null)
      }
      intent.putExtra("subUris", uris)
      intent.putExtra("subLangs", langs)
      intent.putExtra("subLabels", labels)
      intent.putExtra("subMimes", mimes)
    }
  }

  @Command
  fun play(invoke: Invoke) {
    val intent = Intent(activity, PlayerActivity::class.java)
    fill(intent, invoke.getArgs())
    PlayerActivity.keepPage = true
    // The player is see-through to Android (so the app keeps running behind it), and then Android turns the
    // screen the way the app behind wants: the app goes landscape too while the player is open, or the
    // loading screen came up upright.
    landscape(true)
    startActivityForResult(invoke, intent, "played")
  }

  /**
   * Töz's model files ship as APK assets; ONNX Runtime needs real files, so they are copied once into the
   * app's files folder (again after an update that brings a different model). Answers with that folder.
   */
  @Command
  fun prepareToz(invoke: Invoke) {
    Thread {
      try {
        val r = JSObject()
        r.put("path", unpackToz(activity).absolutePath)
        invoke.resolve(r)
      } catch (e: Exception) {
        invoke.reject("Çeviri modeli açılamadı: " + e.message)
      }
    }.start()
  }

  companion object {
    /** Töz's files from the APK into the app's folder (once; again when the model changes). */
    @JvmStatic
    @Synchronized
    fun unpackToz(ctx: android.content.Context): java.io.File {
      val dir = java.io.File(ctx.filesDir, "toz-anime")
      for (name in listOf("tokenizer.model", "onnx/encoder_q8.onnx", "onnx/decoder_q8.onnx")) {
        val out = java.io.File(dir, name)
        val size = try { ctx.assets.openFd(name).use { it.length } } catch (e: Exception) { -1L }
        if (out.exists() && (size < 0 || out.length() == size)) continue
        out.parentFile?.mkdirs()
        val tmp = java.io.File(out.path + ".part")
        ctx.assets.open(name).use { input -> tmp.outputStream().use { input.copyTo(it, 1 shl 20) } }
        tmp.renameTo(out)
      }
      return dir
    }
  }

  /** The next episode / another source into the player that is already open. */
  @Command
  fun load(invoke: Invoke) {
    val intent = Intent()
    fill(intent, invoke.getArgs())
    val p = PlayerActivity.current
    if (p == null) {
      // still opening (it was started with the waiting screen): it takes the video when it is up
      if (!PlayerActivity.keepPage) return invoke.reject("Oynatıcı kapalı")
      PlayerActivity.pending = intent
      return invoke.resolve()
    }
    p.runOnUiThread { p.startMedia(intent) }
    invoke.resolve()
  }

  /** Waiting screen text in the open player ("3. bölüm hazırlanıyor…", "Altyazılar aranıyor…"). */
  @Command
  fun status(invoke: Invoke) {
    val a = invoke.getArgs()
    val p = PlayerActivity.current ?: return invoke.reject("Oynatıcı kapalı")
    p.runOnUiThread { p.status(a.getString("title", null), a.getString("subtitle", null), a.getString("message", null)) }
    invoke.resolve()
  }

  /** The source list for the open player. */
  @Command
  fun sources(invoke: Invoke) {
    val list = invoke.getArgs().optJSONArray("list")
    val p = PlayerActivity.current ?: return invoke.reject("Oynatıcı kapalı")
    val n = list?.length() ?: 0
    val labels = Array(n) { list!!.getJSONObject(it).optString("label") }
    val hints = Array(n) { list!!.getJSONObject(it).optString("hint") }
    p.runOnUiThread { p.showSources(labels, hints) }
    invoke.resolve()
  }

  /** Close the open player (the source search failed, or the viewer chose to pick a source by hand). */
  @Command
  fun close(invoke: Invoke) {
    val p = PlayerActivity.current
    PlayerActivity.pending = null
    p?.runOnUiThread { p.finishWithResult() }
    invoke.resolve()
  }

  /**
   * One-click update: the new APK (an https address on the release host) is downloaded into the app's cache
   * and Android's own installer opens for it. The first time Android asks to allow installs from Anisaki:
   * its settings page opens instead, and the viewer tries again after allowing it.
   */
  @Command
  fun installApk(invoke: Invoke) {
    val url = invoke.getArgs().getString("url", null) ?: return invoke.reject("Adres yok")
    if (!url.startsWith("https://github.com/blaidq-a/anisaki/releases/download/") || !url.lowercase().endsWith(".apk")) {
      return invoke.reject("Güncelleme adresi kabul edilmedi")
    }
    if (android.os.Build.VERSION.SDK_INT >= 26 && !activity.packageManager.canRequestPackageInstalls()) {
      activity.startActivity(Intent(android.provider.Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + activity.packageName)))
      return invoke.reject("Android, Anisaki'nin güncelleme kurmasına izin istiyor: açılan sayfada izin verip tekrar dene.")
    }
    Thread {
      try {
        val dir = java.io.File(activity.cacheDir, "update").apply { mkdirs() }
        val apk = java.io.File(dir, "Anisaki.apk")
        val c = java.net.URL(url).openConnection() as java.net.HttpURLConnection
        c.instanceFollowRedirects = true
        c.connectTimeout = 20000
        c.readTimeout = 60000
        c.inputStream.use { input -> apk.outputStream().use { input.copyTo(it, 1 shl 16) } }
        val uri = androidx.core.content.FileProvider.getUriForFile(activity, activity.packageName + ".fileprovider", apk)
        val i = Intent(Intent.ACTION_VIEW).setDataAndType(uri, "application/vnd.android.package-archive")
          .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
        activity.startActivity(i)
        invoke.resolve()
      } catch (e: Exception) {
        invoke.reject("Güncelleme indirilemedi: " + e.message)
      }
    }.start()
  }

  /** A trailer straight in the YouTube app (the TV's own first), not the website. */
  @Command
  fun youtube(invoke: Invoke) {
    val id = invoke.getArgs().getString("id", null)?.takeIf { Regex("^[A-Za-z0-9_-]{6,20}$").matches(it) }
      ?: return invoke.reject("Fragman bulunamadı")
    for (pkg in listOf("com.google.android.youtube.tv", "com.google.android.youtube.googletv", "com.google.android.youtube")) {
      if (!installed(pkg)) continue
      try {
        activity.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse("vnd.youtube:$id")).setPackage(pkg))
        return invoke.resolve()
      } catch (e: ActivityNotFoundException) { /* next */ }
    }
    try {
      activity.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse("vnd.youtube:$id")))
      invoke.resolve()
    } catch (e: ActivityNotFoundException) {
      invoke.reject("YouTube uygulaması bulunamadı")
    }
  }

  @Command
  fun exit(invoke: Invoke) {
    invoke.resolve()
    // closed for good (not left running in the background with the torrent engine)
    activity.finishAndRemoveTask()
    android.os.Handler(android.os.Looper.getMainLooper()).postDelayed({ android.os.Process.killProcess(android.os.Process.myPid()) }, 400)
  }

  private fun num(data: Intent, key: String): Long = (data.extras?.get(key) as? Number)?.toLong() ?: 0L

  private fun landscape(on: Boolean) {
    try {
      activity.requestedOrientation =
        if (on) android.content.pm.ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE else android.content.pm.ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED
    } catch (e: IllegalStateException) { /* Android 8.0 */ }
  }

  @ActivityCallback
  fun played(invoke: Invoke, result: ActivityResult) {
    landscape(false)
    val data = result.data
    var pos = 0L
    var dur = 0L
    if (data != null) {
      // Anisaki / mpv-android / MX Player: "position" + "duration"; VLC: "extra_position" + "extra_duration" (ms)
      pos = num(data, "position")
      dur = num(data, "duration")
      if (pos == 0L) pos = num(data, "extra_position")
      if (dur == 0L) dur = num(data, "extra_duration")
    }
    val r = JSObject()
    r.put("position", pos)
    r.put("duration", dur)
    r.put("player", data?.component?.packageName ?: "")
    r.put("action", data?.getStringExtra("action") ?: "")
    invoke.resolve(r)
  }
}

package app.anisaki.mobile

import android.app.UiModeManager
import android.content.res.Configuration
import android.os.Bundle
import android.view.KeyEvent
import android.view.inputmethod.InputMethodManager
import android.webkit.JavascriptInterface
import android.webkit.WebView
import androidx.activity.enableEdgeToEdge

class MainActivity : TauriActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
  }

  private var web: WebView? = null
  private var tv = false
  /** A text box has the focus in the page (mobile/src/tv.ts tells). */
  @Volatile private var typing = false

  inner class TvBridge {
    @JavascriptInterface fun typing(on: Boolean) { this@MainActivity.typing = on }
    /** The search button was pressed: the TV's keyboard for the box that now has the focus. */
    @JavascriptInterface fun keyboard() {
      runOnUiThread { web?.let { showKeyboard(it) } }
    }
  }

  private fun showKeyboard(w: WebView) {
    val imm = getSystemService(INPUT_METHOD_SERVICE) as InputMethodManager
    // only when it hasn't the focus: asking again moved the page's focus to its first button
    if (!w.hasFocus()) w.requestFocus()
    imm.restartInput(w) // the page's text box becomes the keyboard's target
    w.postDelayed({
      @Suppress("DEPRECATION")
      if (!imm.showSoftInput(w, InputMethodManager.SHOW_FORCED)) imm.toggleSoftInput(InputMethodManager.SHOW_FORCED, 0)
    }, 80)
  }

  /** OK held down: sent once as "ContextMenu" (the right-click menu), and the release then clicks nothing. */
  private var okDownAt = 0L
  private var okLong = false

  /**
   * TV remote: the arrows and OK go to the page's own navigation (mobile/src/tv.ts → window.__tvKey). Left to
   * the WebView, the arrows did nothing while a text box had the focus and the first key press was lost.
   * In a text box left / right still move the cursor, and OK brings up the TV's keyboard.
   */
  override fun dispatchKeyEvent(e: KeyEvent): Boolean {
    val w = web
    if (!tv || w == null) return super.dispatchKeyEvent(e)
    val key = when (e.keyCode) {
      KeyEvent.KEYCODE_DPAD_UP -> "ArrowUp"
      KeyEvent.KEYCODE_DPAD_DOWN -> "ArrowDown"
      KeyEvent.KEYCODE_DPAD_LEFT -> "ArrowLeft"
      KeyEvent.KEYCODE_DPAD_RIGHT -> "ArrowRight"
      KeyEvent.KEYCODE_DPAD_CENTER, KeyEvent.KEYCODE_ENTER, KeyEvent.KEYCODE_NUMPAD_ENTER -> "Enter"
      else -> return super.dispatchKeyEvent(e)
    }
    if (typing && (key == "ArrowLeft" || key == "ArrowRight")) return super.dispatchKeyEvent(e)
    if (key == "Enter") {
      // a short press clicks (on release), a long one opens the menu
      if (e.action == KeyEvent.ACTION_DOWN) {
        if (e.repeatCount == 0) {
          okDownAt = e.eventTime
          okLong = false
        } else if (!okLong && (e.isLongPress || e.eventTime - okDownAt >= 450) && !typing) {
          okLong = true
          send(w, "ContextMenu")
        }
        return true
      }
      if (e.action == KeyEvent.ACTION_UP) {
        if (okLong) return true
        if (typing) showKeyboard(w) else send(w, "Enter")
      }
      return true
    }
    if (e.action != KeyEvent.ACTION_DOWN) return true
    send(w, key)
    return true
  }

  // Anisaki's own player covers the app: the page keeps running behind it (it finds the next episode and
  // the source list meanwhile). The WebView was paused here and its timers stopped, so that waited forever.
  override fun onPause() {
    super.onPause()
    if (PlayerActivity.keepPage) web?.onResume()
  }

  // The page has the remote's keys from the start (and again back from the player): without this the first
  // key press only gave the page the focus and did something odd with it.
  override fun onResume() {
    super.onResume()
    web?.post { web?.let { focusPage(it) } }
  }

  private fun send(w: WebView, key: String) {
    if (!w.hasFocus()) focusPage(w)
    w.evaluateJavascript("window.__tvKey && window.__tvKey('$key')", null)
  }

  /** Give the page the focus; Android then moves it to the page's first button, so put it back where it was. */
  private fun focusPage(w: WebView) {
    if (!tv) return
    w.requestFocus()
    w.evaluateJavascript("window.__tvRefocus && window.__tvRefocus()", null)
  }

  // On a TV the page switches to remote-control navigation and bigger type (mobile/src/tv.ts)
  override fun onWebViewCreate(webView: WebView) {
    web = webView
    val ui = getSystemService(UI_MODE_SERVICE) as? UiModeManager
    if (ui?.currentModeType == Configuration.UI_MODE_TYPE_TELEVISION) {
      tv = true
      // a TV shows no status / navigation bars over the app
      androidx.core.view.WindowCompat.getInsetsController(window, window.decorView).apply {
        hide(androidx.core.view.WindowInsetsCompat.Type.systemBars())
        systemBarsBehavior = androidx.core.view.WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
      }
      webView.settings.userAgentString = webView.settings.userAgentString + " AnisakiTV"
      webView.addJavascriptInterface(TvBridge(), "AnisakiTV")
    }
  }
}

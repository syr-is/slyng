package `is`.syr.syren

import android.graphics.Rect
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.View
import android.webkit.WebView
import androidx.activity.enableEdgeToEdge
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat

class MainActivity : TauriActivity() {
  private var insetsJs: String? = null

  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
  }

  override fun onWebViewCreate(webView: WebView) {
    super.onWebViewCreate(webView)

    val density = resources.displayMetrics.density

    ViewCompat.setOnApplyWindowInsetsListener(webView) { _, windowInsets ->
      val bars = windowInsets.getInsets(
        WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout()
      )
      val top = (bars.top / density).toInt()
      val right = (bars.right / density).toInt()
      val bottom = (bars.bottom / density).toInt()
      val left = (bars.left / density).toInt()

      // Early-layout calls before the window decoration is set up
      // sometimes report all-zero insets. Don't overwrite a known-good
      // value with zeros — it'd briefly leak content under the status bar.
      if (top > 0 || bottom > 0 || left > 0 || right > 0) {
        insetsJs = """
          (function () {
            var d = document.documentElement;
            d.style.setProperty('--syren-sai-top', '${top}px');
            d.style.setProperty('--syren-sai-right', '${right}px');
            d.style.setProperty('--syren-sai-bottom', '${bottom}px');
            d.style.setProperty('--syren-sai-left', '${left}px');
          })();
        """.trimIndent()
        applyInsetsRetried(webView)
      }

      windowInsets
    }

    // `systemGestureExclusionRects` has to be reapplied any time the
    // WebView's width/height changes — Android wipes the rects on layout
    // invalidation, and on first WindowInsets fire the WebView usually
    // hasn't been laid out yet (width/height are 0). Listen for layout
    // changes directly so we always have a fresh exclusion zone before
    // the user's first swipe.
    webView.addOnLayoutChangeListener { v, left, top, right, bottom, _, _, _, _ ->
      applyGestureExclusion(v, right - left, bottom - top)
    }

    webView.post { ViewCompat.requestApplyInsets(webView) }
  }

  private fun applyGestureExclusion(view: View, width: Int, height: Int) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) return
    if (width <= 0 || height <= 0) return
    val density = resources.displayMetrics.density
    // 24dp matches Android's own default gesture inset. Wider would
    // chew into legitimate content; narrower lets system back through.
    val edgePx = (24 * density).toInt()
    view.systemGestureExclusionRects = listOf(
      Rect(0, 0, edgePx, height),
      Rect(width - edgePx, 0, width, height)
    )
  }

  // The window-insets listener fires the moment the WebView is laid out,
  // but at that point Tauri may still be on its blank initial document —
  // `evaluateJavascript` runs against an empty `documentElement`, and
  // when the WebView finally navigates to `tauri.localhost` the CSS vars
  // are gone. We don't have a clean hook on Tauri's WebViewClient, so
  // re-fire the same JS on a few back-off delays. Once SvelteKit is up,
  // SPA navigations don't reset `documentElement.style`, so the vars
  // persist for the rest of the session.
  private fun applyInsetsRetried(webView: WebView) {
    val js = insetsJs ?: return
    val handler = Handler(Looper.getMainLooper())
    listOf(0L, 200L, 600L, 1500L, 3000L).forEach { delay ->
      handler.postDelayed({
        webView.evaluateJavascript(js, null)
      }, delay)
    }
  }
}

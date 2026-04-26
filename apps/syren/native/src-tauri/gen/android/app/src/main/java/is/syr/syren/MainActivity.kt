package `is`.syr.syren

import android.os.Bundle
import android.webkit.WebView
import androidx.activity.enableEdgeToEdge
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat

class MainActivity : TauriActivity() {
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

      val js = """
        (function () {
          var d = document.documentElement;
          d.style.setProperty('--syren-sai-top', '${top}px');
          d.style.setProperty('--syren-sai-right', '${right}px');
          d.style.setProperty('--syren-sai-bottom', '${bottom}px');
          d.style.setProperty('--syren-sai-left', '${left}px');
        })();
      """.trimIndent()

      webView.post { webView.evaluateJavascript(js, null) }
      windowInsets
    }

    webView.post { ViewCompat.requestApplyInsets(webView) }
  }
}

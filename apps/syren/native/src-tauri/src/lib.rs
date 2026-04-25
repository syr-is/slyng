#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
	tauri::Builder::default()
		.plugin(tauri_plugin_store::Builder::default().build())
		.setup(|_app| {
			#[cfg(target_os = "ios")]
			{
				use tauri::Manager;
				if let Some(window) = _app.get_webview_window("main") {
					ios::install_safe_area(&window);
				}
			}
			Ok(())
		})
		.run(tauri::generate_context!())
		.expect("error while running tauri application");
}

#[cfg(target_os = "ios")]
mod ios {
	use objc2::msg_send;
	use objc2::runtime::AnyObject;
	use objc2_foundation::NSString;
	use std::ffi::c_void;
	use tauri::WebviewWindow;

	// UIScrollViewContentInsetAdjustmentBehavior.never == 2
	const CONTENT_INSET_ADJUSTMENT_NEVER: i64 = 2;

	/// Configure the WKWebView so `env(safe-area-inset-*)` returns the real
	/// notch / home-indicator depths in CSS, then bootstrap a JS poller that
	/// mirrors those values into `--syren-sai-*` custom properties on the
	/// document root. The CSS layout reads `--syren-sai-*` first and falls
	/// back to env() — keeps parity with the Android side.
	pub fn install_safe_area(window: &WebviewWindow) {
		let _ = window.with_webview(|webview| unsafe {
			let wkwebview: *mut AnyObject = webview.inner() as *mut _;
			if wkwebview.is_null() {
				return;
			}

			// 1. Stop UIKit auto-shrinking the WebView's content area.
			//    With `.never` the WebView extends behind the unsafe area
			//    and CSS `env(safe-area-inset-*)` reports actual values.
			let scroll_view: *mut AnyObject = msg_send![wkwebview, scrollView];
			if !scroll_view.is_null() {
				let _: () = msg_send![
					scroll_view,
					setContentInsetAdjustmentBehavior: CONTENT_INSET_ADJUSTMENT_NEVER
				];
			}

			// 2. Bootstrap the JS-side mirror. After step 1, env() resolves
			//    correctly; the script reads it from a hidden probe element
			//    and republishes as `--syren-sai-*` so the layout always
			//    reads from one source regardless of platform.
			let js_ns = NSString::from_str(BOOTSTRAP_JS);
			let _: () = msg_send![
				wkwebview,
				evaluateJavaScript: &*js_ns,
				completionHandler: std::ptr::null::<c_void>()
			];
		});
	}

	const BOOTSTRAP_JS: &str = r#"
(function () {
  var apply = function () {
    var probe = document.getElementById('__syren_sai_probe');
    if (!probe) {
      probe = document.createElement('div');
      probe.id = '__syren_sai_probe';
      probe.style.cssText =
        'position:fixed;top:0;left:0;width:0;height:0;visibility:hidden;pointer-events:none;' +
        'padding-top:env(safe-area-inset-top,0px);' +
        'padding-right:env(safe-area-inset-right,0px);' +
        'padding-bottom:env(safe-area-inset-bottom,0px);' +
        'padding-left:env(safe-area-inset-left,0px);';
      (document.body || document.documentElement).appendChild(probe);
    }
    var s = getComputedStyle(probe), d = document.documentElement;
    d.style.setProperty('--syren-sai-top', s.paddingTop);
    d.style.setProperty('--syren-sai-right', s.paddingRight);
    d.style.setProperty('--syren-sai-bottom', s.paddingBottom);
    d.style.setProperty('--syren-sai-left', s.paddingLeft);
  };
  window.__syrenSaiPoll = apply;
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', apply, { once: true });
  } else {
    apply();
  }
  var t = null;
  window.addEventListener('resize', function () {
    clearTimeout(t);
    t = setTimeout(apply, 80);
  }, { passive: true });
  window.addEventListener('orientationchange', apply, { passive: true });
})();
"#;
}

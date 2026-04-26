mod auth;
mod commands;
mod session_store;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
	#[cfg(target_os = "ios")]
	use tauri::Manager;

	let builder = tauri::Builder::default()
		.plugin(tauri_plugin_store::Builder::default().build())
		.plugin(tauri_plugin_http::init())
		.manage(auth::ClientHandle::new())
		.setup(|_app| {
			#[cfg(target_os = "ios")]
			{
				if let Some(window) = _app.get_webview_window("main") {
					ios::install_safe_area(&window);
				}
			}
			Ok(())
		})
		.invoke_handler(tauri::generate_handler![
			auth::start_login,
			auth::logout,
			commands::proxy_request,
			commands::me,
			commands::servers_list,
			commands::server_get,
			commands::server_channels,
			commands::server_members,
			commands::channel_messages,
			commands::channel_send,
			commands::channel_typing,
			commands::users_me,
			commands::dm_channels,
			commands::roles_list,
			commands::my_permissions,
			commands::categories_list,
			commands::relations_snapshot,
			commands::invite_preview,
			commands::invite_join,
		]);

	builder
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

	const CONTENT_INSET_ADJUSTMENT_NEVER: i64 = 2;

	pub fn install_safe_area(window: &WebviewWindow) {
		let _ = window.with_webview(|webview| unsafe {
			let wkwebview: *mut AnyObject = webview.inner() as *mut _;
			if wkwebview.is_null() {
				return;
			}
			let scroll_view: *mut AnyObject = msg_send![wkwebview, scrollView];
			if !scroll_view.is_null() {
				let _: () = msg_send![
					scroll_view,
					setContentInsetAdjustmentBehavior: CONTENT_INSET_ADJUSTMENT_NEVER
				];
			}
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
  window.addEventListener('resize', function () { clearTimeout(t); t = setTimeout(apply, 80); }, { passive: true });
  window.addEventListener('orientationchange', apply, { passive: true });
})();
"#;
}

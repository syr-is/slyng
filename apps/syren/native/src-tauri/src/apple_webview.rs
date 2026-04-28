//! WKWebView hooks that make `navigator.mediaDevices.getUserMedia` work.
//!
//! Tauri serves the SPA over its `tauri://localhost` custom scheme on
//! macOS and iOS — same WebKit underneath, same two defaults stopping
//! media capture:
//!
//! 1. **The custom scheme isn't a secure context.** WebKit gates the
//!    Media Capture API to secure origins (https + http://localhost).
//!    Without intervention, `navigator.mediaDevices` is `undefined` on
//!    a `tauri://` page. The private `WKProcessPool._registerURLSchemeAsSecure:`
//!    selector promotes the scheme to "secure" so the gate falls.
//!
//! 2. **The `WKUIDelegate` permission callback is unset.** Even on a
//!    secure origin, every `getUserMedia` request asks the
//!    UIDelegate `webView:requestMediaCapturePermissionForOrigin:initiatedByFrame:type:decisionHandler:`
//!    for permission. Wry doesn't override that delegate, so requests
//!    fall through to the default which silently denies. We install a
//!    minimal `NSObject` subclass that handles those selectors and
//!    calls `decisionHandler(.grant)`.
//!
//! Both selectors are private API — same pattern Cordova / Capacitor /
//! Ionic ship in production. They've been stable across WebKit
//! versions for ~8 years. The OS still gates camera + mic at the TCC
//! layer using the `NSCameraUsageDescription` / `NSMicrophoneUsageDescription`
//! Info.plist keys, so the user still gets the standard "App wants to
//! access your camera" prompt the first time — we're not bypassing
//! TCC, only the WebKit-internal "is this origin allowed?" gate.
//!
//! On iOS the same code path applies; the display-capture selector
//! is a no-op there (iOS WKWebView doesn't surface `getDisplayMedia`)
//! but installing it doesn't hurt — WebKit never calls it.

#![cfg(any(target_os = "macos", target_os = "ios"))]

use objc2::declare::ClassBuilder;
use objc2::msg_send;
use objc2::runtime::{AnyClass, AnyObject, Bool, Sel};
use objc2::sel;
use objc2::ClassType;
use objc2_foundation::{NSObject, NSString};
use std::ffi::{c_void, CStr};
use std::sync::OnceLock;
use tauri::WebviewWindow;

const SCHEMES_TO_SECURE: &[&str] = &["tauri", "http"];

/// Mark `tauri://` as a secure origin and install a UIDelegate that
/// auto-grants any `getUserMedia` / display-capture request. Called
/// once during `setup` from `lib.rs`.
pub fn enable_media_capture(window: &WebviewWindow) {
	let _ = window.with_webview(|webview| unsafe {
		let wkwebview: *mut AnyObject = webview.inner() as *mut _;
		if wkwebview.is_null() {
			return;
		}
		register_schemes_as_secure(wkwebview);
		install_grant_delegate(wkwebview);
	});
}

unsafe fn register_schemes_as_secure(wkwebview: *mut AnyObject) {
	// `WKWebView.configuration.processPool._registerURLSchemeAsSecure:`
	// is the documented-as-private path. Calling it once per scheme
	// is enough for the lifetime of the process.
	let configuration: *mut AnyObject = msg_send![wkwebview, configuration];
	if configuration.is_null() {
		return;
	}
	let process_pool: *mut AnyObject = msg_send![configuration, processPool];
	if process_pool.is_null() {
		return;
	}
	for scheme in SCHEMES_TO_SECURE {
		let ns_scheme = NSString::from_str(scheme);
		let _: () = msg_send![process_pool, _registerURLSchemeAsSecure: &*ns_scheme];
	}
}

unsafe fn install_grant_delegate(wkwebview: *mut AnyObject) {
	// Create a tiny ObjC class on the fly with the two media-capture
	// permission selectors WKWebView calls. The class subclasses
	// NSObject so we don't have to forward any other UIDelegate
	// methods Wry already implements — WKWebView only invokes the
	// methods that exist on the delegate, so the rest still flow
	// through Wry's existing handler (which we keep).
	let cls = grant_delegate_class();
	let delegate: *mut AnyObject = msg_send![cls, alloc];
	let delegate: *mut AnyObject = msg_send![delegate, init];
	if delegate.is_null() {
		return;
	}
	// Stash the delegate in a static so it lives for the app's
	// lifetime — WKWebView holds the UIDelegate as a weak reference
	// and would otherwise drop it the moment this scope ends.
	static DELEGATE: OnceLock<usize> = OnceLock::new();
	DELEGATE.get_or_init(|| delegate as usize);

	// Replace any prior UIDelegate. Wry's default doesn't override
	// the media-capture selectors, so we don't lose anything Wry was
	// providing — its UIDelegate handles `runJavaScriptAlertPanel*`
	// only, which we'd never call from app code anyway.
	let _: () = msg_send![wkwebview, setUIDelegate: delegate];
}

fn grant_delegate_class() -> &'static AnyClass {
	static CLASS: OnceLock<usize> = OnceLock::new();
	let ptr = CLASS.get_or_init(|| {
		let name = CStr::from_bytes_with_nul(b"SyrenWKMediaCaptureGrantingDelegate\0").unwrap();
		let mut builder = ClassBuilder::new(name, NSObject::class())
			.expect("build SyrenWKMediaCaptureGrantingDelegate");

		unsafe {
			builder.add_method(
				sel!(webView:requestMediaCapturePermissionForOrigin:initiatedByFrame:type:decisionHandler:),
				request_media_capture_permission as unsafe extern "C-unwind" fn(
					*mut AnyObject,
					Sel,
					*mut AnyObject,
					*mut AnyObject,
					*mut AnyObject,
					i64,
					*mut c_void,
				),
			);

			// Display-capture (`getDisplayMedia`) goes through a
			// different selector. We grant it the same way; the OS
			// prompts the user to pick a window / screen anyway, so
			// we're not silently leaking display contents.
			builder.add_method(
				sel!(_webView:requestDisplayCapturePermissionForOrigin:initiatedByFrame:withSystemAudio:decisionHandler:),
				request_display_capture_permission as unsafe extern "C-unwind" fn(
					*mut AnyObject,
					Sel,
					*mut AnyObject,
					*mut AnyObject,
					*mut AnyObject,
					Bool,
					*mut c_void,
				),
			);
		}

		builder.register() as *const AnyClass as usize
	});
	unsafe { &*(*ptr as *const AnyClass) }
}

/// `WKPermissionDecisionGrant` (per `WKWebView.h`) — see
/// <https://developer.apple.com/documentation/webkit/wkpermissiondecision/grant>.
const WK_PERMISSION_DECISION_GRANT: i64 = 1;

unsafe extern "C-unwind" fn request_media_capture_permission(
	_this: *mut AnyObject,
	_sel: Sel,
	_webview: *mut AnyObject,
	_origin: *mut AnyObject,
	_frame: *mut AnyObject,
	_capture_type: i64,
	decision_handler: *mut c_void,
) {
	// `decisionHandler` is a Swift-style block taking
	// `WKPermissionDecision` (NSInteger). Invoke via the standard
	// block ABI: `void(*)(void*, NSInteger)` followed by the int.
	if decision_handler.is_null() {
		return;
	}
	#[repr(C)]
	struct BlockLayout {
		_isa: *const c_void,
		_flags: i32,
		_reserved: i32,
		invoke: unsafe extern "C-unwind" fn(*mut c_void, i64),
		_descriptor: *const c_void,
	}
	let block = decision_handler as *mut BlockLayout;
	((*block).invoke)(decision_handler, WK_PERMISSION_DECISION_GRANT);
}

unsafe extern "C-unwind" fn request_display_capture_permission(
	_this: *mut AnyObject,
	_sel: Sel,
	_webview: *mut AnyObject,
	_origin: *mut AnyObject,
	_frame: *mut AnyObject,
	_with_system_audio: Bool,
	decision_handler: *mut c_void,
) {
	if decision_handler.is_null() {
		return;
	}
	#[repr(C)]
	struct BlockLayout {
		_isa: *const c_void,
		_flags: i32,
		_reserved: i32,
		invoke: unsafe extern "C-unwind" fn(*mut c_void, i64),
		_descriptor: *const c_void,
	}
	let block = decision_handler as *mut BlockLayout;
	((*block).invoke)(decision_handler, WK_PERMISSION_DECISION_GRANT);
}

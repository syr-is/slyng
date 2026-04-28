fn main() {
	tauri_build::build();

	// Android only: libwebrtc (pulled in via the `livekit` crate) needs
	// JNI symbol exports configured before compile so the platform
	// shell's `AudioRecord` / `AudioTrack` callbacks can route into our
	// `RtcAudioSource` / `NativeAudioStream`. No-op on every other
	// target.
	if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("android") {
		webrtc_sys_build::configure_jni_symbols().expect("configure libwebrtc JNI symbols");
	}
}

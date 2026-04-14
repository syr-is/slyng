/**
 * Exposes the peers Map for stats-based VAD polling.
 * Separate module to avoid circular dependency between voice-activity and voice-engine.
 */

// Re-export via a getter that the voice engine populates
let getter: (() => Map<string, RTCPeerConnection>) | null = null;

export function setPeersGetter(fn: () => Map<string, RTCPeerConnection>) {
	getter = fn;
}

export default function getPeersMap(): Map<string, RTCPeerConnection> {
	return getter?.() ?? new Map();
}

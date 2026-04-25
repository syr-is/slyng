import { api } from '../api';

export interface Attachment {
	url: string;
	filename: string;
	mime_type: string;
	size: number;
	width?: number;
	height?: number;
}

export interface UploadHandle {
	promise: Promise<Attachment>;
	cancel: () => void;
}

function bufferToHex(buf: ArrayBuffer): string {
	const arr = new Uint8Array(buf);
	let out = '';
	for (let i = 0; i < arr.length; i++) {
		out += arr[i].toString(16).padStart(2, '0');
	}
	return out;
}

async function sha256Hex(blob: Blob): Promise<string | undefined> {
	try {
		const buf = await blob.arrayBuffer();
		const digest = await crypto.subtle.digest('SHA-256', buf);
		return bufferToHex(digest);
	} catch {
		return undefined;
	}
}

async function probeImage(file: File): Promise<{ width?: number; height?: number }> {
	try {
		const bitmap = await createImageBitmap(file);
		const { width, height } = bitmap;
		bitmap.close();
		return { width, height };
	} catch {
		return {};
	}
}

async function probeVideo(file: File): Promise<{ width?: number; height?: number }> {
	return new Promise((resolve) => {
		const url = URL.createObjectURL(file);
		const video = document.createElement('video');
		video.preload = 'metadata';
		video.muted = true;
		video.src = url;
		const done = (dim: { width?: number; height?: number }) => {
			URL.revokeObjectURL(url);
			resolve(dim);
		};
		video.onloadedmetadata = () =>
			done({ width: video.videoWidth || undefined, height: video.videoHeight || undefined });
		video.onerror = () => done({});
	});
}

/**
 * Upload a file via the syren presign → direct-PUT → finalize flow.
 * Progress is reported in [0, 1]. `cancel()` aborts the PUT and the finalize call.
 */
export function uploadFile(
	file: File,
	opts: { channelId?: string; onProgress?: (p: number) => void } = {}
): UploadHandle {
	const abort = new AbortController();

	const promise = (async (): Promise<Attachment> => {
		// Compute sha256 before presign so it can be included in the signature
		const sha256 = await sha256Hex(file);

		const presign = await api.uploads.presign({
			filename: file.name,
			mime_type: file.type || 'application/octet-stream',
			size: file.size,
			channel_id: opts.channelId,
			sha256
		});

		// Probe dimensions in parallel with the S3 PUT
		const probe: Promise<{ width?: number; height?: number }> = file.type.startsWith('image/')
			? probeImage(file)
			: file.type.startsWith('video/')
				? probeVideo(file)
				: Promise.resolve({});

		await putWithProgress(presign.signed_url, file, abort.signal, opts.onProgress, sha256);

		const { width, height } = await probe;

		let attachment = await api.uploads.finalize(presign.upload_id, {
			sha256,
			width,
			height
		});

		// 202 = background finalization, poll until done
		if (attachment && 'status' in attachment && (attachment as any).status === 'finalizing') {
			const maxPollMs = 5 * 60 * 1000;
			const started = Date.now();
			let delay = 3000;

			while (Date.now() - started < maxPollMs) {
				await new Promise((r) => setTimeout(r, delay));
				delay = Math.min(delay * 1.3, 10000);

				attachment = await api.uploads.finalize(presign.upload_id, { sha256, width, height });
				if (!attachment || !('status' in attachment) || (attachment as any).status !== 'finalizing') {
					break;
				}
			}

			if (attachment && 'status' in attachment && (attachment as any).status === 'finalizing') {
				throw new Error('Upload finalization timed out');
			}
		}

		return attachment as Attachment;
	})();

	return {
		promise,
		cancel: () => abort.abort()
	};
}

/**
 * XHR-based PUT for upload progress reporting. `fetch` doesn't expose upload
 * progress without a streaming body (which breaks CORS on many S3 servers).
 */
function hexToBase64(hex: string): string {
	return btoa(hex.match(/.{2}/g)!.map((b) => String.fromCharCode(parseInt(b, 16))).join(''));
}

function putWithProgress(
	url: string,
	file: File,
	signal: AbortSignal,
	onProgress?: (p: number) => void,
	sha256Hex?: string
): Promise<void> {
	return new Promise((resolve, reject) => {
		const xhr = new XMLHttpRequest();
		xhr.open('PUT', url, true);
		if (file.type) xhr.setRequestHeader('Content-Type', file.type);
		if (sha256Hex) xhr.setRequestHeader('x-amz-checksum-sha256', hexToBase64(sha256Hex));

		xhr.upload.onprogress = (e) => {
			if (e.lengthComputable) onProgress?.(e.loaded / e.total);
		};
		xhr.onload = () => {
			if (xhr.status >= 200 && xhr.status < 300) resolve();
			else reject(new Error(`Upload failed: ${xhr.status} ${xhr.statusText}`));
		};
		xhr.onerror = () => reject(new Error('Upload network error'));
		xhr.onabort = () => reject(new Error('Upload cancelled'));

		signal.addEventListener('abort', () => xhr.abort(), { once: true });
		xhr.send(file);
	});
}

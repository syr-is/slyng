import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AccessToken } from 'livekit-server-sdk';

@Injectable()
export class LiveKitService {
	private readonly logger = new Logger(LiveKitService.name);
	private readonly apiKey: string;
	private readonly apiSecret: string;
	private readonly url: string;
	private readonly publicUrl: string;

	constructor(private readonly config: ConfigService) {
		this.apiKey = this.config.get('LIVEKIT_API_KEY', 'devkey');
		this.apiSecret = this.config.get('LIVEKIT_API_SECRET', 'devsecret');
		this.url = this.config.get('LIVEKIT_URL', 'ws://localhost:7880');
		this.publicUrl = this.config.get('LIVEKIT_PUBLIC_URL', this.url);
	}

	/** Public URL returned to clients (wss:// in production) */
	getUrl(): string {
		return this.publicUrl;
	}

	async generateToken(
		userId: string,
		roomName: string,
		metadata?: string
	): Promise<string> {
		const at = new AccessToken(this.apiKey, this.apiSecret, {
			identity: userId,
			metadata,
			ttl: '6h'
		});
		at.addGrant({
			room: roomName,
			roomJoin: true,
			canPublish: true,
			canSubscribe: true,
			canPublishData: true
		});
		return await at.toJwt();
	}

	roomNameForChannel(channelId: string): string {
		return `voice:${channelId}`;
	}
}

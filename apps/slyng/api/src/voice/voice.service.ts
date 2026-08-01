import { Injectable, NotFoundException } from '@nestjs/common';
import { stringToRecordId } from '@slyng/types';
import { VoiceStateRepository } from './voice.repository';
import { ChannelRepository } from '../channel/channel.repository';

export interface VoiceState {
	user_id: string;
	channel_id: string;
	server_id: string;
	self_mute: boolean;
	self_deaf: boolean;
	has_camera: boolean;
	has_screen: boolean;
	joined_at: Date;
}

@Injectable()
export class VoiceService {
	// In-memory for fast lookups — persisted to DB for crash recovery
	private states = new Map<string, VoiceState>();

	constructor(
		private readonly voiceStates: VoiceStateRepository,
		private readonly channels: ChannelRepository
	) {}

	async join(userId: string, channelId: string, serverId: string): Promise<VoiceState> {
		if (!serverId) {
			const channel = await this.channels.findById(channelId);
			// A missing channel and a DM channel both used to collapse to '',
			// persisting a voice state for a channel that doesn't exist. Only the
			// DM case is legitimate: DM channels genuinely have no server_id.
			if (!channel) throw new NotFoundException('Channel not found');
			serverId = channel.server_id ? stringToRecordId.encode(channel.server_id) : '';
		}
		await this.leave(userId);

		const state: VoiceState = {
			user_id: userId,
			channel_id: channelId,
			server_id: serverId,
			self_mute: false,
			self_deaf: false,
			has_camera: false,
			has_screen: false,
			joined_at: new Date()
		};
		this.states.set(userId, state);

		// Persist with proper RecordIds for channel_id and server_id
		const dbChannelId = stringToRecordId.decode(channelId);
		const dbServerId = serverId ? stringToRecordId.decode(serverId) : null;

		const existing = await this.voiceStates.findOne({ user_id: userId });
		if (existing) {
			await this.voiceStates.merge(existing.id, {
				channel_id: dbChannelId,
				server_id: dbServerId,
				self_mute: false,
				self_deaf: false,
				has_camera: false,
				has_screen: false,
				joined_at: state.joined_at,
				updated_at: new Date()
			});
		} else {
			// Spread the in-memory state but overwrite the two id fields with
			// RecordId links — the row stores links where VoiceState holds strings.
			await this.voiceStates.create({
				...state,
				channel_id: dbChannelId,
				server_id: dbServerId,
				updated_at: new Date()
			});
		}

		return state;
	}

	async leave(userId: string): Promise<VoiceState | null> {
		const state = this.states.get(userId);
		if (!state) return null;

		this.states.delete(userId);
		await this.voiceStates.deleteWhere({ user_id: userId });
		return state;
	}

	async updateState(userId: string, selfMute: boolean, selfDeaf: boolean): Promise<VoiceState | null> {
		const state = this.states.get(userId);
		if (!state) return null;

		state.self_mute = selfMute;
		state.self_deaf = selfDeaf;

		const existing = await this.voiceStates.findOne({ user_id: userId });
		if (existing) {
			await this.voiceStates.merge(existing.id, {
				self_mute: selfMute,
				self_deaf: selfDeaf,
				updated_at: new Date()
			});
		}

		return state;
	}

	updateVideoState(userId: string, hasCamera: boolean, hasScreen: boolean): VoiceState | null {
		const state = this.states.get(userId);
		if (!state) return null;
		state.has_camera = hasCamera;
		state.has_screen = hasScreen;
		return state;
	}

	getChannelUsers(channelId: string): VoiceState[] {
		return [...this.states.values()].filter((s) => s.channel_id === channelId);
	}

	/**
	 * All voice states in a server, grouped by channel_id. Used for initial
	 * snapshot when a client enters the server — so voice-channel user lists
	 * are populated without waiting for a join/leave event.
	 */
	getByServer(serverId: string): Record<string, VoiceState[]> {
		const out: Record<string, VoiceState[]> = {};
		for (const s of this.states.values()) {
			if (s.server_id !== serverId) continue;
			(out[s.channel_id] ||= []).push(s);
		}
		return out;
	}

	getUserState(userId: string): VoiceState | null {
		return this.states.get(userId) || null;
	}

	/**
	 * Rehydrate presence after a restart.
	 *
	 * Rows must be mapped, not spread: they store `channel_id` / `server_id` as
	 * `RecordId` links while `VoiceState` holds encoded strings. The previous
	 * `row as any` put raw links into the map, so every downstream string
	 * comparison — `s.channel_id === channelId` in `getChannelUsers`,
	 * `s.server_id !== serverId` in `getByServer` — silently stopped matching,
	 * and reloaded presence was invisible to clients.
	 *
	 * Rows with no `channel_id` are skipped: a state not in a channel is not
	 * presence. `has_camera` / `has_screen` default to false — video state is
	 * renegotiated by the client on reconnect, never trusted from storage.
	 */
	async loadFromDb(): Promise<void> {
		const rows = await this.voiceStates.findMany();
		for (const row of rows) {
			if (!row.channel_id) continue;
			this.states.set(row.user_id, {
				user_id: row.user_id,
				channel_id: stringToRecordId.encode(row.channel_id),
				server_id: row.server_id ? stringToRecordId.encode(row.server_id) : '',
				self_mute: row.self_mute ?? false,
				self_deaf: row.self_deaf ?? false,
				has_camera: false,
				has_screen: false,
				joined_at: row.joined_at ?? new Date()
			});
		}
	}
}

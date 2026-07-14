//! Messages, attachments, embeds, and message-input shapes.

use serde::{Deserialize, Serialize};
use zod_gen_derive::ZodSchema;

#[cfg(target_arch = "wasm32")]
use tsify_next::Tsify;

#[derive(Clone, Debug, Serialize, Deserialize, ZodSchema)]
#[cfg_attr(target_arch = "wasm32", derive(Tsify))]
#[cfg_attr(target_arch = "wasm32", tsify(into_wasm_abi, from_wasm_abi))]
pub enum MessageType {
	#[serde(rename = "text")]
	Text,
	#[serde(rename = "system")]
	System,
	#[serde(rename = "reply")]
	Reply,
}

impl Default for MessageType {
	fn default() -> Self {
		Self::Text
	}
}

#[derive(Clone, Debug, Serialize, Deserialize, ZodSchema)]
#[cfg_attr(target_arch = "wasm32", derive(Tsify))]
#[cfg_attr(target_arch = "wasm32", tsify(into_wasm_abi, from_wasm_abi))]
pub struct Attachment {
	pub url: String,
	pub filename: String,
	pub mime_type: String,
	pub size: u64,
	#[serde(skip_serializing_if = "Option::is_none", default)]
	pub width: Option<u32>,
	#[serde(skip_serializing_if = "Option::is_none", default)]
	pub height: Option<u32>,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize, ZodSchema)]
#[cfg_attr(target_arch = "wasm32", derive(Tsify))]
#[cfg_attr(target_arch = "wasm32", tsify(into_wasm_abi, from_wasm_abi))]
pub struct Embed {
	#[serde(skip_serializing_if = "Option::is_none", default)]
	pub title: Option<String>,
	#[serde(skip_serializing_if = "Option::is_none", default)]
	pub description: Option<String>,
	#[serde(skip_serializing_if = "Option::is_none", default)]
	pub url: Option<String>,
	#[serde(skip_serializing_if = "Option::is_none", default)]
	pub thumbnail_url: Option<String>,
	#[serde(skip_serializing_if = "Option::is_none", default)]
	pub site_name: Option<String>,
	#[serde(skip_serializing_if = "Option::is_none", default)]
	pub color: Option<String>,
	/// Embeddable iframe URL for video platforms (YouTube, Vimeo, etc.).
	#[serde(skip_serializing_if = "Option::is_none", default)]
	pub embed_url: Option<String>,
}

/// Reaction summary attached to a message in list responses.
#[derive(Clone, Debug, Serialize, Deserialize, ZodSchema)]
#[cfg_attr(target_arch = "wasm32", derive(Tsify))]
#[cfg_attr(target_arch = "wasm32", tsify(into_wasm_abi, from_wasm_abi))]
pub struct ReactionSummary {
	pub value: String,
	pub count: u32,
	pub me: bool,
	#[serde(skip_serializing_if = "Option::is_none", default)]
	pub kind: Option<String>,
	#[serde(skip_serializing_if = "Option::is_none", default)]
	pub image_url: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize, ZodSchema)]
#[cfg_attr(target_arch = "wasm32", derive(Tsify))]
#[cfg_attr(target_arch = "wasm32", tsify(into_wasm_abi, from_wasm_abi))]
pub struct Message {
	pub id: String,
	pub channel_id: String,
	pub sender_id: String,
	#[serde(default)]
	#[serde(rename = "type")]
	pub message_type: MessageType,
	pub content: String,
	#[serde(skip_serializing_if = "Option::is_none", default)]
	pub edited_at: Option<String>,
	#[serde(default)]
	pub reply_to: Vec<String>,
	#[serde(default)]
	pub attachments: Vec<Attachment>,
	#[serde(default)]
	pub embeds: Vec<Embed>,
	#[serde(default)]
	pub reactions: Vec<ReactionSummary>,
	#[serde(default)]
	pub pinned: bool,
	#[serde(skip_serializing_if = "Option::is_none", default)]
	pub signature: Option<String>,
	#[serde(skip_serializing_if = "Option::is_none", default)]
	pub signer_did: Option<String>,
	#[serde(skip_serializing_if = "Option::is_none", default)]
	pub signer_delegate_key: Option<String>,
	#[serde(skip_serializing_if = "Option::is_none", default)]
	pub sender_instance_url: Option<String>,
	#[serde(default)]
	pub deleted: bool,
	#[serde(skip_serializing_if = "Option::is_none", default)]
	pub deleted_at: Option<String>,
	#[serde(skip_serializing_if = "Option::is_none", default)]
	pub deleted_by: Option<String>,
	pub created_at: String,
	pub updated_at: String,
}

/// Body for `POST /api/channels/:id/messages`.
#[derive(Clone, Debug, Default, Serialize, Deserialize, ZodSchema)]
#[cfg_attr(target_arch = "wasm32", derive(Tsify))]
#[cfg_attr(target_arch = "wasm32", tsify(into_wasm_abi, from_wasm_abi))]
pub struct SendMessageInput {
	#[serde(skip_serializing_if = "Option::is_none", default)]
	pub content: Option<String>,
	#[serde(default)]
	pub reply_to: Vec<String>,
	#[serde(default)]
	pub attachments: Vec<Attachment>,
}

/// Body for `PATCH /api/channels/:channelId/messages/:messageId`.
#[derive(Clone, Debug, Serialize, Deserialize, ZodSchema)]
#[cfg_attr(target_arch = "wasm32", derive(Tsify))]
#[cfg_attr(target_arch = "wasm32", tsify(into_wasm_abi, from_wasm_abi))]
pub struct EditMessageInput {
	pub content: String,
}

/// Body for `POST /api/channels/:channelId/messages/:messageId/reactions`.
#[derive(Clone, Debug, Serialize, Deserialize, ZodSchema)]
#[cfg_attr(target_arch = "wasm32", derive(Tsify))]
#[cfg_attr(target_arch = "wasm32", tsify(into_wasm_abi, from_wasm_abi))]
pub struct AddReactionInput {
	pub kind: String,
	pub value: String,
	#[serde(skip_serializing_if = "Option::is_none", default)]
	pub image_url: Option<String>,
}

/// Body for `DELETE /api/channels/:channelId/messages/:messageId/reactions`.
#[derive(Clone, Debug, Serialize, Deserialize, ZodSchema)]
#[cfg_attr(target_arch = "wasm32", derive(Tsify))]
#[cfg_attr(target_arch = "wasm32", tsify(into_wasm_abi, from_wasm_abi))]
pub struct RemoveReactionInput {
	pub value: String,
}

/// Body for `POST /api/channels/:channelId/pins`.
#[derive(Clone, Debug, Serialize, Deserialize, ZodSchema)]
#[cfg_attr(target_arch = "wasm32", derive(Tsify))]
#[cfg_attr(target_arch = "wasm32", tsify(into_wasm_abi, from_wasm_abi))]
pub struct PinMessageInput {
	pub message_id: String,
}

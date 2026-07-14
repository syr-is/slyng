//! DID types.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ParsedDid {
    pub method: String,
    pub id: String,
    #[serde(skip)]
    pub public_key: [u8; 32],
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VerificationMethod {
    pub id: String,
    #[serde(rename = "type")]
    pub key_type: String,
    pub controller: String,
    pub public_key_multibase: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ServiceEndpoint {
    pub id: String,
    #[serde(rename = "type")]
    pub service_type: String,
    pub service_endpoint: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DidDocument {
    #[serde(rename = "@context")]
    pub context: serde_json::Value,
    pub id: String,
    pub verification_method: Vec<VerificationMethod>,
    pub authentication: Vec<String>,
    pub assertion_method: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub service: Option<Vec<ServiceEndpoint>>,
}

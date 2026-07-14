//! Build DID documents.

use crate::types::{DidDocument, ServiceEndpoint, VerificationMethod};

/// Build a DID Document for a did:syr identity.
pub fn build_did_document(input: BuildDidDocumentInput<'_>) -> DidDocument {
    let verification_method = vec![VerificationMethod {
        id: "#root".to_string(),
        key_type: "Ed25519VerificationKey2020".to_string(),
        controller: input.did.to_string(),
        public_key_multibase: input.public_key_multibase.to_string(),
    }];

    let service = input.service_endpoint.map(|url| {
        vec![ServiceEndpoint {
            id: "#provider".to_string(),
            service_type: "SyrIdentityProvider".to_string(),
            service_endpoint: url.to_string(),
        }]
    });

    DidDocument {
        context: serde_json::json!([
            "https://www.w3.org/ns/did/v1",
            "https://w3id.org/security/suites/ed25519-2020/v1"
        ]),
        id: input.did.to_string(),
        verification_method,
        authentication: vec!["#root".to_string()],
        assertion_method: vec!["#root".to_string()],
        service,
    }
}

pub struct BuildDidDocumentInput<'a> {
    pub did: &'a str,
    pub public_key_multibase: &'a str,
    pub service_endpoint: Option<&'a str>,
}

#[cfg(test)]
mod tests {
    use super::*;
    use syr_crypto_core::encoding::{derive_did, encode_multibase, ED25519_MULTICODEC_PREFIX};
    use syr_crypto_core::keys::generate_root_keypair;

    #[test]
    fn build_did_document_basic() {
        let (pub_k, _) = generate_root_keypair();
        let did = derive_did(&pub_k);
        let mut prefixed = Vec::with_capacity(ED25519_MULTICODEC_PREFIX.len() + 32);
        prefixed.extend_from_slice(&ED25519_MULTICODEC_PREFIX);
        prefixed.extend_from_slice(&pub_k);
        let pub_multibase = encode_multibase(&prefixed);

        let doc = build_did_document(BuildDidDocumentInput {
            did: &did,
            public_key_multibase: &pub_multibase,
            service_endpoint: None,
        });

        assert_eq!(doc.id, did);
        assert_eq!(doc.verification_method.len(), 1);
        assert_eq!(doc.verification_method[0].id, "#root");
        assert!(doc.service.is_none());
    }

    #[test]
    fn build_did_document_with_service() {
        let (pub_k, _) = generate_root_keypair();
        let did = derive_did(&pub_k);
        let mut prefixed = Vec::with_capacity(ED25519_MULTICODEC_PREFIX.len() + 32);
        prefixed.extend_from_slice(&ED25519_MULTICODEC_PREFIX);
        prefixed.extend_from_slice(&pub_k);
        let pub_multibase = encode_multibase(&prefixed);

        let doc = build_did_document(BuildDidDocumentInput {
            did: &did,
            public_key_multibase: &pub_multibase,
            service_endpoint: Some("https://provider.example.com"),
        });

        assert!(doc.service.is_some());
        let svc = &doc.service.as_ref().unwrap()[0];
        assert_eq!(svc.id, "#provider");
        assert_eq!(svc.service_endpoint, "https://provider.example.com");
    }
}

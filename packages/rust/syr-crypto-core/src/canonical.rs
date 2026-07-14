//! RFC 8785 JSON Canonicalization Scheme (JCS).

use serde::Serialize;
use serde_jcs;

/// Canonicalize a JSON-serializable object using RFC 8785 JCS.
pub fn canonicalize<T: Serialize>(obj: &T) -> Result<String, String> {
    serde_jcs::to_string(obj).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde::Deserialize;

    #[test]
    fn canonicalize_deterministic() {
        #[derive(Serialize)]
        struct Obj {
            a: i32,
            b: &'static str,
        }
        let obj = Obj { a: 1, b: "x" };
        let s1 = canonicalize(&obj).unwrap();
        let s2 = canonicalize(&obj).unwrap();
        assert_eq!(s1, s2);
    }

    #[test]
    fn canonicalize_roundtrip() {
        #[derive(Serialize, Deserialize, PartialEq, Debug)]
        struct Obj {
            foo: String,
            bar: i32,
        }
        let obj = Obj {
            foo: "hello".to_string(),
            bar: 42,
        };
        let canonical = canonicalize(&obj).unwrap();
        let parsed: Obj = serde_json::from_str(&canonical).unwrap();
        assert_eq!(parsed, obj);
    }
}

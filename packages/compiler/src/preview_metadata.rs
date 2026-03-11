use std::sync::OnceLock;

use serde::Deserialize;

const PREVIEW_HOST_METADATA_JSON: &str =
    include_str!("../../preview-runtime/src/hosts/metadata.json");

#[allow(dead_code)]
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PreviewHostMetadataRecord {
    pub abstract_ancestors: Vec<String>,
    pub degraded: bool,
    pub dom_tag: String,
    pub full_size_default: bool,
    pub jsx_name: String,
    pub participates_in_layout: bool,
    pub runtime_name: String,
    pub supports_isa: bool,
    pub supports_type_rewrite: bool,
}

#[derive(Debug, Deserialize)]
struct PreviewHostMetadataDocument {
    hosts: Vec<PreviewHostMetadataRecord>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum PreviewTypeSupportKind {
    Isa,
    TypeRewrite,
}

static PREVIEW_HOST_METADATA: OnceLock<PreviewHostMetadataDocument> = OnceLock::new();

fn preview_host_metadata_document() -> &'static PreviewHostMetadataDocument {
    PREVIEW_HOST_METADATA.get_or_init(|| {
        serde_json::from_str(PREVIEW_HOST_METADATA_JSON)
            .expect("preview host metadata JSON must remain valid")
    })
}

pub fn preview_host_metadata_records() -> &'static [PreviewHostMetadataRecord] {
    preview_host_metadata_document().hosts.as_slice()
}

pub fn preview_host_metadata_by_jsx_name(jsx_name: &str) -> Option<&'static PreviewHostMetadataRecord> {
    preview_host_metadata_records()
        .iter()
        .find(|record| record.jsx_name == jsx_name)
}

pub fn preview_host_metadata_by_runtime_name(
    runtime_name: &str,
) -> Option<&'static PreviewHostMetadataRecord> {
    preview_host_metadata_records()
        .iter()
        .find(|record| record.runtime_name == runtime_name)
}

pub fn is_supported_preview_host_type(type_name: &str, kind: PreviewTypeSupportKind) -> bool {
    if let Some(record) = preview_host_metadata_by_runtime_name(type_name) {
        return match kind {
            PreviewTypeSupportKind::Isa => record.supports_isa,
            PreviewTypeSupportKind::TypeRewrite => record.supports_type_rewrite,
        };
    }

    preview_host_metadata_records().iter().any(|record| match kind {
        PreviewTypeSupportKind::Isa => {
            record.supports_isa && record.abstract_ancestors.iter().any(|ancestor| ancestor == type_name)
        }
        PreviewTypeSupportKind::TypeRewrite => {
            record.supports_type_rewrite
                && record.abstract_ancestors.iter().any(|ancestor| ancestor == type_name)
        }
    })
}

#[cfg(test)]
mod tests {
    use super::{
        is_supported_preview_host_type, preview_host_metadata_by_runtime_name,
        preview_host_metadata_records, PreviewTypeSupportKind,
    };

    #[test]
    fn metadata_captures_the_preview_abstract_host_hierarchy() {
        assert_eq!(preview_host_metadata_records().len(), 26);
        assert!(is_supported_preview_host_type(
            "GuiButton",
            PreviewTypeSupportKind::TypeRewrite
        ));
        assert!(is_supported_preview_host_type(
            "GuiLabel",
            PreviewTypeSupportKind::Isa
        ));
        assert!(is_supported_preview_host_type(
            "LayerCollector",
            PreviewTypeSupportKind::Isa
        ));
        assert!(is_supported_preview_host_type(
            "BasePlayerGui",
            PreviewTypeSupportKind::TypeRewrite
        ));
        assert!(preview_host_metadata_by_runtime_name("ScreenGui")
            .is_some_and(|record| record.abstract_ancestors.contains(&"LayerCollector".to_owned())));
        assert!(preview_host_metadata_by_runtime_name("ViewportFrame")
            .is_some_and(|record| record.degraded && record.full_size_default));
        assert!(!is_supported_preview_host_type(
            "BasePart",
            PreviewTypeSupportKind::Isa
        ));
    }
}

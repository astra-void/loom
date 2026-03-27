use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PreviewGraphImportEdge {
    pub crosses_package_boundary: bool,
    pub importer_file: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub importer_project_config_path: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub original_resolved_file: Option<String>,
    pub resolution: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub resolution_kind: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub resolved_file: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub resolved_project_config_path: Option<String>,
    pub specifier: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub stop_reason: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PreviewGraphRecordSnapshot {
    pub file_path: String,
    #[serde(default)]
    pub graph_edges: Vec<PreviewGraphImportEdge>,
    #[serde(default)]
    pub imports: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub owner_package_name: Option<String>,
    pub owner_package_root: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub project_config_path: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PreviewGraphBoundaryHop {
    pub from_file: String,
    pub from_package_root: String,
    pub to_file: String,
    pub to_package_root: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PreviewGraphTraversedProject {
    pub config_path: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub package_name: Option<String>,
    pub package_root: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PreviewGraphTrace {
    #[serde(default)]
    pub boundary_hops: Vec<PreviewGraphBoundaryHop>,
    #[serde(default)]
    pub imports: Vec<PreviewGraphImportEdge>,
    pub selection: Value,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub stop_reason: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub traversed_projects: Option<Vec<PreviewGraphTraversedProject>>,
}

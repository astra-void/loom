use std::collections::{BTreeMap, BTreeSet, HashMap};

use serde_json::Value;
use wasm_bindgen::prelude::*;

use crate::model::{
    PreviewGraphBoundaryHop, PreviewGraphImportEdge, PreviewGraphRecordSnapshot, PreviewGraphTrace,
    PreviewGraphTraversedProject,
};

pub(crate) fn to_js_error(message: impl Into<String>) -> JsValue {
    JsValue::from_str(&message.into())
}

fn dependency_paths_for_record(record: &PreviewGraphRecordSnapshot) -> BTreeSet<String> {
    let mut dependency_paths = BTreeSet::new();

    for import_path in &record.imports {
        dependency_paths.insert(import_path.clone());
    }

    for edge in &record.graph_edges {
        if let Some(resolved_file) = &edge.resolved_file {
            dependency_paths.insert(resolved_file.clone());
        }
    }

    dependency_paths
}

fn import_edge_key(edge: &PreviewGraphImportEdge) -> String {
    format!(
        "{}|{}|{}|{}|{}|{}|{}|{}|{}|{}",
        edge.importer_file,
        edge.importer_project_config_path.as_deref().unwrap_or(""),
        edge.original_resolved_file.as_deref().unwrap_or(""),
        edge.resolution,
        edge.resolution_kind.as_deref().unwrap_or(""),
        edge.resolved_file.as_deref().unwrap_or(""),
        edge.resolved_project_config_path.as_deref().unwrap_or(""),
        edge.specifier,
        edge.stop_reason.as_deref().unwrap_or(""),
        edge.crosses_package_boundary,
    )
}

fn visit_transitive_paths(
    session: &PreviewGraphSession,
    file_path: &str,
    visited: &mut BTreeSet<String>,
    collected: &mut BTreeSet<String>,
    stack: &mut Vec<String>,
) {
    if stack.iter().any(|candidate| candidate == file_path) {
        return;
    }

    if !visited.insert(file_path.to_owned()) {
        return;
    }

    collected.insert(file_path.to_owned());
    stack.push(file_path.to_owned());

    if let Some(record) = session.records.get(file_path) {
        let mut dependency_paths = dependency_paths_for_record(record)
            .into_iter()
            .collect::<Vec<_>>();
        dependency_paths.sort();

        for dependency_path in dependency_paths {
            visit_transitive_paths(session, &dependency_path, visited, collected, stack);
        }
    }

    stack.pop();
}

fn visit_graph_trace(
    session: &PreviewGraphSession,
    file_path: &str,
    visited: &mut BTreeSet<String>,
    imports: &mut BTreeMap<String, PreviewGraphImportEdge>,
    boundary_hops: &mut BTreeMap<String, PreviewGraphBoundaryHop>,
    traversed_projects: &mut BTreeMap<String, PreviewGraphTraversedProject>,
    stack: &mut Vec<String>,
    stop_reason: &mut Option<String>,
) {
    if stack.iter().any(|candidate| candidate == file_path) {
        if stop_reason.is_none() {
            *stop_reason = Some("graph-cycle".to_owned());
        }
        return;
    }

    if !visited.insert(file_path.to_owned()) {
        return;
    }

    stack.push(file_path.to_owned());

    if let Some(record) = session.records.get(file_path) {
        if let Some(project_config_path) = &record.project_config_path {
            traversed_projects
                .entry(project_config_path.clone())
                .or_insert_with(|| PreviewGraphTraversedProject {
                    config_path: project_config_path.clone(),
                    package_name: record.owner_package_name.clone(),
                    package_root: record.owner_package_root.clone(),
                });
        }

        let mut edges = record.graph_edges.clone();
        edges.sort_by(|left, right| import_edge_key(left).cmp(&import_edge_key(right)));

        for edge in &edges {
            if stop_reason.is_none() && edge.stop_reason.is_some() {
                *stop_reason = edge.stop_reason.clone();
            }

            imports
                .entry(import_edge_key(edge))
                .or_insert_with(|| edge.clone());

            if edge.crosses_package_boundary {
                if let Some(resolved_file) = edge.resolved_file.as_ref() {
                    if let Some(target_record) = session.records.get(resolved_file) {
                        boundary_hops
                            .entry(format!("{}|{}", record.file_path, resolved_file))
                            .or_insert_with(|| PreviewGraphBoundaryHop {
                                from_file: record.file_path.clone(),
                                from_package_root: record.owner_package_root.clone(),
                                to_file: resolved_file.clone(),
                                to_package_root: target_record.owner_package_root.clone(),
                            });
                    }
                }
            }
        }

        let mut dependency_paths = dependency_paths_for_record(record)
            .into_iter()
            .collect::<Vec<_>>();
        dependency_paths.sort();

        for dependency_path in dependency_paths {
            visit_graph_trace(
                session,
                &dependency_path,
                visited,
                imports,
                boundary_hops,
                traversed_projects,
                stack,
                stop_reason,
            );
        }
    }

    stack.pop();
}

#[wasm_bindgen]
pub struct PreviewGraphSession {
    pub(crate) records: HashMap<String, PreviewGraphRecordSnapshot>,
}

impl PreviewGraphSession {
    pub(crate) fn replace_records_internal(&mut self, records: Vec<PreviewGraphRecordSnapshot>) {
        self.records.clear();
        for record in records {
            self.records.insert(record.file_path.clone(), record);
        }
    }

    pub(crate) fn collect_transitive_dependency_paths_internal(
        &self,
        entry_file_path: &str,
    ) -> Vec<String> {
        let mut visited = BTreeSet::new();
        let mut collected = BTreeSet::new();
        let mut stack = Vec::new();

        visit_transitive_paths(
            self,
            entry_file_path,
            &mut visited,
            &mut collected,
            &mut stack,
        );

        collected.into_iter().collect()
    }

    pub(crate) fn collect_graph_trace_internal(
        &self,
        entry_file_path: &str,
        selection: Value,
    ) -> PreviewGraphTrace {
        let mut visited = BTreeSet::new();
        let mut imports = BTreeMap::new();
        let mut boundary_hops = BTreeMap::new();
        let mut traversed_projects = BTreeMap::new();
        let mut stack = Vec::new();
        let mut stop_reason = None;

        visit_graph_trace(
            self,
            entry_file_path,
            &mut visited,
            &mut imports,
            &mut boundary_hops,
            &mut traversed_projects,
            &mut stack,
            &mut stop_reason,
        );

        let mut boundary_hops = boundary_hops.into_values().collect::<Vec<_>>();
        boundary_hops.sort_by(|left, right| {
            if left.to_file != right.to_file {
                return left.to_file.cmp(&right.to_file);
            }

            left.from_file.cmp(&right.from_file)
        });

        let mut imports = imports.into_values().collect::<Vec<_>>();
        imports.sort_by(|left, right| {
            if left.importer_file != right.importer_file {
                return left.importer_file.cmp(&right.importer_file);
            }

            left.specifier.cmp(&right.specifier)
        });

        let mut traversed_projects = traversed_projects.into_values().collect::<Vec<_>>();
        traversed_projects.sort_by(|left, right| left.config_path.cmp(&right.config_path));

        PreviewGraphTrace {
            boundary_hops,
            imports,
            selection,
            stop_reason,
            traversed_projects: if traversed_projects.is_empty() {
                None
            } else {
                Some(traversed_projects)
            },
        }
    }
}

#[wasm_bindgen]
impl PreviewGraphSession {
    #[wasm_bindgen(constructor)]
    pub fn new() -> PreviewGraphSession {
        PreviewGraphSession {
            records: HashMap::new(),
        }
    }

    #[wasm_bindgen(js_name = replaceRecords)]
    pub fn replace_records(&mut self, raw_records: JsValue) -> Result<(), JsValue> {
        let records: Vec<PreviewGraphRecordSnapshot> = serde_wasm_bindgen::from_value(raw_records)
            .map_err(|error| {
                to_js_error(format!("Failed to parse preview graph records: {error}"))
            })?;

        self.replace_records_internal(records);
        Ok(())
    }

    #[wasm_bindgen(js_name = collectTransitiveDependencyPaths)]
    pub fn collect_transitive_dependency_paths(
        &self,
        entry_file_path: String,
    ) -> Result<JsValue, JsValue> {
        let paths = self.collect_transitive_dependency_paths_internal(&entry_file_path);
        serde_wasm_bindgen::to_value(&paths).map_err(|error| {
            to_js_error(format!(
                "Failed to serialize preview graph dependency paths: {error}"
            ))
        })
    }

    #[wasm_bindgen(js_name = collectGraphTrace)]
    pub fn collect_graph_trace(
        &self,
        entry_file_path: String,
        selection_trace: JsValue,
    ) -> Result<JsValue, JsValue> {
        let selection: Value = serde_wasm_bindgen::from_value(selection_trace)
            .map_err(|error| to_js_error(format!("Failed to parse graph selection: {error}")))?;
        let trace = self.collect_graph_trace_internal(&entry_file_path, selection);
        serde_wasm_bindgen::to_value(&trace)
            .map_err(|error| to_js_error(format!("Failed to serialize graph trace: {error}")))
    }

    pub fn dispose(&mut self) {
        self.records.clear();
    }
}

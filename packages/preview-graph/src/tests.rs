use serde_json::json;

use crate::model::{PreviewGraphImportEdge, PreviewGraphRecordSnapshot};
use crate::session::PreviewGraphSession;

fn make_edge(
    importer_file: &str,
    specifier: &str,
    resolved_file: Option<&str>,
) -> PreviewGraphImportEdge {
    PreviewGraphImportEdge {
        crosses_package_boundary: false,
        importer_file: importer_file.to_owned(),
        importer_project_config_path: None,
        original_resolved_file: resolved_file.map(|value| value.to_owned()),
        resolution: "resolved".to_owned(),
        resolution_kind: Some("source-file".to_owned()),
        resolved_file: resolved_file.map(|value| value.to_owned()),
        resolved_project_config_path: None,
        specifier: specifier.to_owned(),
        stop_reason: None,
    }
}

fn make_record(
    file_path: &str,
    imports: Vec<&str>,
    edges: Vec<PreviewGraphImportEdge>,
) -> PreviewGraphRecordSnapshot {
    PreviewGraphRecordSnapshot {
        file_path: file_path.to_owned(),
        graph_edges: edges,
        imports: imports.into_iter().map(|value| value.to_owned()).collect(),
        owner_package_name: Some("pkg".to_owned()),
        owner_package_root: "/workspace/pkg".to_owned(),
        project_config_path: Some("/workspace/pkg/tsconfig.json".to_owned()),
    }
}

#[test]
fn collects_transitive_dependency_paths() {
    let mut session = PreviewGraphSession::new();
    session.replace_records_internal(vec![
        make_record(
            "/workspace/pkg/a.tsx",
            vec!["/workspace/pkg/b.ts"],
            vec![make_edge(
                "/workspace/pkg/a.tsx",
                "./b",
                Some("/workspace/pkg/b.ts"),
            )],
        ),
        make_record(
            "/workspace/pkg/b.ts",
            vec!["/workspace/pkg/c.ts"],
            vec![make_edge(
                "/workspace/pkg/b.ts",
                "./c",
                Some("/workspace/pkg/c.ts"),
            )],
        ),
        make_record("/workspace/pkg/c.ts", vec![], vec![]),
    ]);

    let paths = session.collect_transitive_dependency_paths_internal("/workspace/pkg/a.tsx");

    assert_eq!(
        paths,
        vec![
            "/workspace/pkg/a.tsx".to_owned(),
            "/workspace/pkg/b.ts".to_owned(),
            "/workspace/pkg/c.ts".to_owned(),
        ]
    );
}

#[test]
fn collects_graph_trace_with_cycle_detection() {
    let mut session = PreviewGraphSession::new();
    session.replace_records_internal(vec![
        make_record(
            "/workspace/pkg/a.tsx",
            vec!["/workspace/pkg/b.ts"],
            vec![make_edge(
                "/workspace/pkg/a.tsx",
                "./b",
                Some("/workspace/pkg/b.ts"),
            )],
        ),
        make_record(
            "/workspace/pkg/b.ts",
            vec!["/workspace/pkg/a.tsx"],
            vec![make_edge(
                "/workspace/pkg/b.ts",
                "./a",
                Some("/workspace/pkg/a.tsx"),
            )],
        ),
    ]);

    let trace = session.collect_graph_trace_internal(
        "/workspace/pkg/a.tsx",
        json!({
            "contract": "preview.entry",
            "importChain": ["/workspace/pkg/a.tsx"],
            "symbolChain": ["/workspace/pkg/a.tsx#preview.entry"],
        }),
    );

    assert_eq!(trace.stop_reason.as_deref(), Some("graph-cycle"));
    assert_eq!(trace.imports.len(), 2);
    assert_eq!(trace.boundary_hops.len(), 0);
}

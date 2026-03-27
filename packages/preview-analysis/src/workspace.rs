use std::collections::{BTreeMap, BTreeSet, HashMap};

use js_sys::Function;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use swc_core::{
    common::{sync::Lrc, FileName, SourceMap},
    ecma::{
        ast::{
            CallExpr, Callee, Decl, ExportDecl, ExportDefaultDecl, ExportDefaultExpr,
            ExportSpecifier, Expr, ImportDecl, ImportSpecifier, Lit, Module, ModuleDecl,
            ModuleItem, NamedExport, ObjectLit, Pat, Prop, PropName, PropOrSpread, Stmt,
            TsImportEqualsDecl,
        },
        parser::{parse_file_as_module, Syntax, TsSyntax},
        visit::{Visit, VisitWith},
    },
};
use wasm_bindgen::prelude::*;

use crate::model::{PreviewGraphImportEdge, PreviewGraphRecordSnapshot, PreviewGraphTrace};
use crate::session::PreviewGraphSession;

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PreviewSourceTargetSnapshot {
    #[serde(default)]
    pub exclude: Option<Vec<String>>,
    #[serde(default)]
    pub include: Option<Vec<String>>,
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub package_name: Option<String>,
    pub package_root: String,
    pub source_root: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceFileSnapshot {
    pub file_path: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub owner_package_name: Option<String>,
    pub owner_package_root: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub project_config_path: Option<String>,
    #[serde(default)]
    pub is_entry_candidate: bool,
    pub relative_path: String,
    pub source_text: String,
    pub target: PreviewSourceTargetSnapshot,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceResolutionDiagnostic {
    pub code: String,
    pub file: String,
    #[serde(default)]
    pub import_chain: Option<Vec<String>>,
    pub package_root: String,
    pub phase: String,
    pub severity: String,
    pub summary: String,
    pub target: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceImportResolution {
    #[serde(default)]
    pub diagnostic: Option<WorkspaceResolutionDiagnostic>,
    pub edge: PreviewGraphImportEdge,
    #[serde(default)]
    pub followed_file_path: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PreviewDiagnosticsSummary {
    pub by_phase: BTreeMap<String, u32>,
    pub has_blocking: bool,
    pub total: u32,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PreviewDiagnostic {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub blocking: Option<bool>,
    pub code: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub code_frame: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub details: Option<String>,
    pub entry_id: String,
    pub file: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub import_chain: Option<Vec<String>>,
    pub phase: String,
    pub relative_file: String,
    pub severity: String,
    pub summary: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub symbol: Option<String>,
    pub target: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PreviewEntryCapabilities {
    pub supports_hot_update: bool,
    pub supports_layout_debug: bool,
    pub supports_props_editing: bool,
    pub supports_runtime_mock: bool,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PreviewEntryDescriptor {
    pub capabilities: PreviewEntryCapabilities,
    pub candidate_export_names: Vec<String>,
    pub diagnostics_summary: PreviewDiagnosticsSummary,
    pub has_default_export: bool,
    pub has_preview_export: bool,
    pub id: String,
    pub package_name: String,
    pub relative_path: String,
    pub render_target: Value,
    pub selection: Value,
    pub source_file_path: String,
    pub status: String,
    pub status_details: Value,
    pub target_name: String,
    pub title: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PreviewWorkspaceIndex {
    pub entries: Vec<PreviewEntryDescriptor>,
    pub project_name: String,
    pub protocol_version: u32,
    pub targets: Vec<PreviewSourceTargetSnapshot>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceDiscoveryEntryState {
    pub dependency_paths: Vec<String>,
    pub descriptor: PreviewEntryDescriptor,
    pub discovery_diagnostics: Vec<PreviewDiagnostic>,
    pub graph_trace: PreviewGraphTrace,
    pub package_root: String,
    pub preview_has_props: bool,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceDiscoverySnapshot {
    pub entries: Vec<WorkspaceDiscoveryEntryState>,
    pub workspace_index: PreviewWorkspaceIndex,
}

#[derive(Clone, Debug)]
struct ImportBinding {
    imported_name: String,
    source_file_path: String,
}

#[derive(Clone, Debug)]
enum ExportBinding {
    DefaultExpression,
    Local {
        local_name: String,
    },
    ReExport {
        imported_name: String,
        source_file_path: String,
    },
}

#[derive(Clone, Debug)]
struct LocalRenderableMetadata {
    is_renderable: bool,
}

#[derive(Clone, Debug)]
struct PreviewExportInfo {
    entry_local_name: Option<String>,
    has_export: bool,
    has_props: bool,
    has_render: bool,
    title: Option<String>,
}

#[derive(Clone, Debug)]
struct TargetContext {
    name: String,
    package_name: String,
    package_root: String,
}

#[derive(Clone, Debug)]
struct RawDiagnostic {
    code: String,
    file: String,
    import_chain: Option<Vec<String>>,
    package_root: String,
    phase: String,
    severity: String,
    summary: String,
    target: String,
}

#[derive(Clone, Debug)]
struct RawSourceModuleRecord {
    export_all_sources: Vec<String>,
    export_bindings: HashMap<String, Vec<ExportBinding>>,
    file_path: String,
    graph_edges: Vec<PreviewGraphImportEdge>,
    import_bindings: HashMap<String, ImportBinding>,
    imports: Vec<String>,
    is_tsx: bool,
    local_renderable_metadata: HashMap<String, LocalRenderableMetadata>,
    owner_package_name: Option<String>,
    owner_package_root: String,
    is_entry_candidate: bool,
    project_config_path: Option<String>,
    preview: PreviewExportInfo,
    raw_diagnostics: Vec<RawDiagnostic>,
    relative_path: String,
    target: TargetContext,
}

#[derive(Clone, Debug)]
struct ResolvedRenderableRef {
    import_chain: Vec<String>,
    origin_file_path: String,
    symbol_chain: Vec<String>,
    symbol_name: String,
}

pub(crate) fn to_js_error(message: impl Into<String>) -> JsValue {
    JsValue::from_str(&message.into())
}

fn humanize_title(relative_path: &str) -> String {
    let base_name = std::path::Path::new(relative_path)
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or(relative_path);
    let base_name = base_name.strip_suffix(".loom").unwrap_or(base_name);
    let mut title = base_name.replace(['-', '_'], " ");
    let mut result = String::with_capacity(title.len());
    let mut last_was_lower = false;

    for ch in title.drain(..) {
        if last_was_lower && ch.is_ascii_uppercase() {
            result.push(' ');
        }
        result.push(ch);
        last_was_lower = ch.is_ascii_lowercase() || ch.is_ascii_digit();
    }

    let mut chars = result.chars();
    match chars.next() {
        Some(first) => first.to_uppercase().collect::<String>() + chars.as_str(),
        None => String::new(),
    }
}

fn is_component_name(name: &str) -> bool {
    name.chars()
        .next()
        .map(|ch| ch.is_ascii_uppercase())
        .unwrap_or(false)
}

fn is_renderable_initializer(expr: Option<&Expr>) -> bool {
    matches!(expr, Some(Expr::Arrow(_)) | Some(Expr::Fn(_)))
}

fn get_property_name_text(name: &PropName) -> Option<String> {
    match name {
        PropName::Ident(value) => Some(value.sym.to_string()),
        PropName::Str(value) => Some(value.value.to_string_lossy().into_owned()),
        PropName::Num(value) => Some(value.value.to_string()),
        _ => None,
    }
}

fn unwrap_preview_expression(mut expr: Option<&Expr>) -> Option<&Expr> {
    while let Some(current) = expr {
        match current {
            Expr::Paren(paren) => expr = Some(&paren.expr),
            Expr::TsAs(ts_as) => expr = Some(ts_as.expr.as_ref()),
            Expr::TsTypeAssertion(type_assertion) => expr = Some(type_assertion.expr.as_ref()),
            Expr::TsConstAssertion(const_assertion) => expr = Some(const_assertion.expr.as_ref()),
            _ => return expr,
        }
    }

    None
}

fn parse_preview_object(node: Option<&Expr>) -> Option<PreviewExportInfo> {
    let unwrapped_node = unwrap_preview_expression(node)?;
    let Expr::Object(ObjectLit { props, .. }) = unwrapped_node else {
        return None;
    };

    let mut entry_local_name = None;
    let mut title = None;
    let mut has_props = false;
    let mut has_render = false;

    for property in props {
        let PropOrSpread::Prop(prop) = property else {
            continue;
        };

        match prop.as_ref() {
            Prop::KeyValue(key_value) => {
                let Some(property_name) = get_property_name_text(&key_value.key) else {
                    continue;
                };

                if property_name == "title" {
                    if let Expr::Lit(Lit::Str(value)) = key_value.value.as_ref() {
                        title = Some(value.value.to_string_lossy().into_owned());
                    }
                    continue;
                }

                if property_name == "props" {
                    has_props = true;
                    continue;
                }

                if property_name == "entry" {
                    if let Expr::Ident(ident) = key_value.value.as_ref() {
                        entry_local_name = Some(ident.sym.to_string());
                    }
                    continue;
                }

                if property_name == "render" {
                    has_render = true;
                }
            }
            Prop::Shorthand(ident) => {
                if ident.sym == *"props" {
                    has_props = true;
                }
            }
            _ => {}
        }
    }

    Some(PreviewExportInfo {
        has_export: true,
        has_props,
        has_render,
        title,
        entry_local_name,
    })
}

fn make_default_preview_export_info() -> PreviewExportInfo {
    PreviewExportInfo {
        entry_local_name: None,
        has_export: false,
        has_props: false,
        has_render: false,
        title: None,
    }
}

fn to_relative_path(root_path: &str, file_path: &str) -> String {
    std::path::Path::new(file_path)
        .strip_prefix(root_path)
        .ok()
        .and_then(|path| path.to_str())
        .unwrap_or(file_path)
        .replace('\\', "/")
}

fn create_target_context(target: &PreviewSourceTargetSnapshot) -> TargetContext {
    TargetContext {
        name: target.name.clone(),
        package_name: target
            .package_name
            .clone()
            .unwrap_or_else(|| target.name.clone()),
        package_root: target.package_root.clone(),
    }
}

fn parse_ts_module(source_text: &str, file_path: &str) -> Result<Module, JsValue> {
    let is_declaration_file = file_path.ends_with(".d.ts") || file_path.ends_with(".d.tsx");
    let is_tsx = file_path.ends_with(".tsx")
        || file_path.ends_with(".loom.tsx")
        || file_path.ends_with(".d.tsx");
    let cm: Lrc<SourceMap> = Default::default();
    let fm = cm.new_source_file(
        FileName::Custom(file_path.to_owned()).into(),
        source_text.to_owned(),
    );
    let mut recovered_errors = Vec::new();
    let module = parse_file_as_module(
        &fm,
        Syntax::Typescript(TsSyntax {
            decorators: true,
            dts: is_declaration_file,
            tsx: is_tsx,
            ..Default::default()
        }),
        Default::default(),
        None,
        &mut recovered_errors,
    )
    .map_err(|error| to_js_error(format!("Failed to parse TSX {file_path}: {error:?}")))?;

    if !is_declaration_file && !recovered_errors.is_empty() {
        return Err(to_js_error(format!(
            "Recovered parse errors in {file_path}: {recovered_errors:?}"
        )));
    }

    Ok(module)
}

struct RequireCollector {
    specifiers: BTreeSet<String>,
}

impl Visit for RequireCollector {
    fn visit_call_expr(&mut self, expr: &CallExpr) {
        if expr.args.len() == 1
            && matches!(&expr.callee, Callee::Expr(expr) if matches!(expr.as_ref(), Expr::Ident(ident) if ident.sym == *"require"))
        {
            if let Some(arg) = expr.args.first() {
                if let Expr::Lit(Lit::Str(value)) = arg.expr.as_ref() {
                    self.specifiers
                        .insert(value.value.to_string_lossy().into_owned());
                }
            }
        }

        expr.visit_children_with(self);
    }
}

fn collect_local_renderable_names(
    module: &Module,
    file_path: &str,
) -> (
    Option<PreviewExportInfo>,
    HashMap<String, LocalRenderableMetadata>,
) {
    let _file_basename = std::path::Path::new(file_path)
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or(file_path);
    let mut local_renderable_metadata = HashMap::new();
    let mut local_preview_info = None;

    for item in &module.body {
        match item {
            ModuleItem::Stmt(Stmt::Decl(Decl::Fn(fn_decl))) => {
                let name = fn_decl.ident.sym.to_string();
                if is_component_name(&name) {
                    local_renderable_metadata.insert(
                        name.clone(),
                        LocalRenderableMetadata {
                            is_renderable: true,
                        },
                    );
                }
            }
            ModuleItem::Stmt(Stmt::Decl(Decl::Var(var_decl))) => {
                for decl in &var_decl.decls {
                    let Pat::Ident(binding) = &decl.name else {
                        continue;
                    };

                    let name = binding.id.sym.to_string();
                    if name == "preview" {
                        if let Some(expr) = decl.init.as_deref() {
                            local_preview_info =
                                parse_preview_object(Some(expr)).or(local_preview_info);
                        }
                    }

                    if is_component_name(&name) {
                        local_renderable_metadata.insert(
                            name.clone(),
                            LocalRenderableMetadata {
                                is_renderable: is_renderable_initializer(decl.init.as_deref()),
                            },
                        );
                    }
                }
            }
            ModuleItem::ModuleDecl(ModuleDecl::ExportDecl(ExportDecl { decl, .. })) => match decl {
                Decl::Fn(fn_decl) => {
                    let name = fn_decl.ident.sym.to_string();
                    if is_component_name(&name) {
                        local_renderable_metadata.insert(
                            name.clone(),
                            LocalRenderableMetadata {
                                is_renderable: true,
                            },
                        );
                    }
                }
                Decl::Var(var_decl) => {
                    for decl in &var_decl.decls {
                        let Pat::Ident(binding) = &decl.name else {
                            continue;
                        };

                        let name = binding.id.sym.to_string();
                        if is_component_name(&name) {
                            local_renderable_metadata.insert(
                                name.clone(),
                                LocalRenderableMetadata {
                                    is_renderable: is_renderable_initializer(decl.init.as_deref()),
                                },
                            );
                        }
                    }
                }
                _ => {}
            },
            _ => {}
        }
    }

    (local_preview_info, local_renderable_metadata)
}

fn add_diagnostic(raw_diagnostics: &mut HashMap<String, RawDiagnostic>, diagnostic: RawDiagnostic) {
    let key = format!(
        "{}:{}:{}",
        diagnostic.code, diagnostic.file, diagnostic.summary
    );
    raw_diagnostics.insert(key, diagnostic);
}

fn record_import_resolution(
    imports: &mut BTreeSet<String>,
    raw_diagnostics: &mut HashMap<String, RawDiagnostic>,
    resolution: Option<WorkspaceImportResolution>,
) -> Option<String> {
    if let Some(resolution) = resolution {
        if let Some(diagnostic) = resolution.diagnostic {
            add_diagnostic(
                raw_diagnostics,
                RawDiagnostic {
                    code: diagnostic.code,
                    file: diagnostic.file,
                    import_chain: diagnostic.import_chain,
                    package_root: diagnostic.package_root,
                    phase: diagnostic.phase,
                    severity: diagnostic.severity,
                    summary: diagnostic.summary,
                    target: diagnostic.target,
                },
            );
        }

        if let Some(followed) = resolution.followed_file_path {
            imports.insert(followed.clone());
            return Some(followed);
        }
    }

    None
}

fn resolve_import_from_js(
    resolver: &Function,
    importer_file_path: &str,
    specifier: &str,
) -> Option<WorkspaceImportResolution> {
    let result = resolver
        .call2(
            &JsValue::NULL,
            &JsValue::from_str(importer_file_path),
            &JsValue::from_str(specifier),
        )
        .ok()?;

    if result.is_null() || result.is_undefined() {
        return None;
    }

    serde_wasm_bindgen::from_value(result).ok()
}

fn parse_module_record(
    snapshot: &WorkspaceFileSnapshot,
    resolver: &Function,
) -> Result<RawSourceModuleRecord, JsValue> {
    let module = parse_ts_module(&snapshot.source_text, &snapshot.file_path)?;
    let (mut preview, local_renderable_metadata) =
        collect_local_renderable_names(&module, &snapshot.file_path);
    let mut import_bindings = HashMap::new();
    let mut export_bindings: HashMap<String, Vec<ExportBinding>> = HashMap::new();
    let mut export_all_sources = Vec::new();
    let mut graph_edges = Vec::new();
    let mut imports = BTreeSet::new();
    let mut raw_diagnostics = HashMap::new();
    let mut _preview_exported = false;
    let preview_info_default = make_default_preview_export_info();
    let mut preview_info = preview.take().unwrap_or(preview_info_default);

    for item in &module.body {
        match item {
            ModuleItem::ModuleDecl(ModuleDecl::Import(ImportDecl {
                src, specifiers, ..
            })) => {
                let resolved = resolve_import_from_js(
                    resolver,
                    &snapshot.file_path,
                    &src.value.to_string_lossy().into_owned(),
                );
                if let Some(resolution) = &resolved {
                    graph_edges.push(resolution.edge.clone());
                }
                if let Some(followed_file_path) =
                    record_import_resolution(&mut imports, &mut raw_diagnostics, resolved)
                {
                    let clause = specifiers;
                    if let Some(ImportSpecifier::Default(default_specifier)) = clause.first() {
                        import_bindings.insert(
                            default_specifier.local.sym.to_string(),
                            ImportBinding {
                                imported_name: "default".to_owned(),
                                source_file_path: followed_file_path.clone(),
                            },
                        );
                    }

                    for specifier in clause {
                        match specifier {
                            ImportSpecifier::Named(named) => {
                                let local = named.local.sym.to_string();
                                let imported_name = named
                                    .imported
                                    .as_ref()
                                    .map(|imported| match imported {
                                        swc_core::ecma::ast::ModuleExportName::Ident(ident) => {
                                            ident.sym.to_string()
                                        }
                                        swc_core::ecma::ast::ModuleExportName::Str(value) => {
                                            value.value.to_string_lossy().into_owned()
                                        }
                                    })
                                    .unwrap_or_else(|| local.clone());
                                import_bindings.insert(
                                    local,
                                    ImportBinding {
                                        imported_name,
                                        source_file_path: followed_file_path.clone(),
                                    },
                                );
                            }
                            ImportSpecifier::Default(default_specifier) => {
                                import_bindings.insert(
                                    default_specifier.local.sym.to_string(),
                                    ImportBinding {
                                        imported_name: "default".to_owned(),
                                        source_file_path: followed_file_path.clone(),
                                    },
                                );
                            }
                            ImportSpecifier::Namespace(namespace_specifier) => {
                                import_bindings.insert(
                                    namespace_specifier.local.sym.to_string(),
                                    ImportBinding {
                                        imported_name: "*".to_owned(),
                                        source_file_path: followed_file_path.clone(),
                                    },
                                );
                            }
                        }
                    }
                }
            }
            ModuleItem::ModuleDecl(ModuleDecl::TsImportEquals(import_equals)) => {
                let TsImportEqualsDecl { module_ref, id, .. } = &**import_equals;
                if let swc_core::ecma::ast::TsModuleRef::TsExternalModuleRef(expr) = module_ref {
                    let module_name = expr.expr.value.to_string_lossy().into_owned();
                    let resolved =
                        resolve_import_from_js(resolver, &snapshot.file_path, &module_name);
                    if let Some(resolution) = &resolved {
                        graph_edges.push(resolution.edge.clone());
                    }
                    record_import_resolution(&mut imports, &mut raw_diagnostics, resolved);
                }
                let _ = id;
            }
            ModuleItem::ModuleDecl(ModuleDecl::ExportDecl(ExportDecl { decl, .. })) => match decl {
                Decl::Fn(function) => {
                    let name = function.ident.sym.to_string();
                    if name == "preview" {
                        _preview_exported = true;
                    } else {
                        export_bindings
                            .entry(name.clone())
                            .or_default()
                            .push(ExportBinding::Local { local_name: name });
                    }
                }
                Decl::Var(var_decl) => {
                    for decl in &var_decl.decls {
                        let Pat::Ident(binding) = &decl.name else {
                            continue;
                        };
                        let name = binding.id.sym.to_string();
                        if name == "preview" {
                            _preview_exported = true;
                            preview_info =
                                parse_preview_object(decl.init.as_deref()).unwrap_or(preview_info);
                            continue;
                        }
                        export_bindings
                            .entry(name.clone())
                            .or_default()
                            .push(ExportBinding::Local { local_name: name });
                    }
                }
                _ => {}
            },
            ModuleItem::ModuleDecl(ModuleDecl::ExportDefaultDecl(ExportDefaultDecl {
                decl,
                ..
            })) => {
                _preview_exported = _preview_exported
                    || matches!(
                        decl,
                        swc_core::ecma::ast::DefaultDecl::Fn(_)
                            | swc_core::ecma::ast::DefaultDecl::Class(_)
                    );
                export_bindings
                    .entry("default".to_owned())
                    .or_default()
                    .push(ExportBinding::DefaultExpression);
            }
            ModuleItem::ModuleDecl(ModuleDecl::ExportDefaultExpr(ExportDefaultExpr { .. })) => {
                export_bindings
                    .entry("default".to_owned())
                    .or_default()
                    .push(ExportBinding::DefaultExpression);
            }
            ModuleItem::ModuleDecl(ModuleDecl::ExportNamed(NamedExport {
                src,
                specifiers,
                ..
            })) => {
                if let Some(src) = src {
                    let resolved = resolve_import_from_js(
                        resolver,
                        &snapshot.file_path,
                        &src.value.to_string_lossy().into_owned(),
                    );
                    if let Some(resolution) = &resolved {
                        graph_edges.push(resolution.edge.clone());
                    }
                    if let Some(followed_file_path) =
                        record_import_resolution(&mut imports, &mut raw_diagnostics, resolved)
                    {
                        if specifiers.is_empty() {
                            export_all_sources.push(followed_file_path);
                        } else {
                            for specifier in specifiers {
                                if let ExportSpecifier::Named(named) = specifier {
                                    let local_name = match &named.orig {
                                        swc_core::ecma::ast::ModuleExportName::Ident(ident) => {
                                            ident.sym.to_string()
                                        }
                                        swc_core::ecma::ast::ModuleExportName::Str(value) => {
                                            value.value.to_string_lossy().into_owned()
                                        }
                                    };
                                    let export_name = named
                                        .exported
                                        .as_ref()
                                        .map(|exported| match exported {
                                            swc_core::ecma::ast::ModuleExportName::Ident(ident) => {
                                                ident.sym.to_string()
                                            }
                                            swc_core::ecma::ast::ModuleExportName::Str(value) => {
                                                value.value.to_string_lossy().into_owned()
                                            }
                                        })
                                        .unwrap_or_else(|| local_name.clone());

                                    if local_name == "preview" {
                                        _preview_exported = true;
                                        continue;
                                    }

                                    export_bindings.entry(export_name).or_default().push(
                                        ExportBinding::ReExport {
                                            imported_name: local_name,
                                            source_file_path: followed_file_path.clone(),
                                        },
                                    );
                                }
                            }
                        }
                    }
                } else {
                    for specifier in specifiers {
                        if let ExportSpecifier::Named(named) = specifier {
                            let local_name = match &named.orig {
                                swc_core::ecma::ast::ModuleExportName::Ident(ident) => {
                                    ident.sym.to_string()
                                }
                                swc_core::ecma::ast::ModuleExportName::Str(value) => {
                                    value.value.to_string_lossy().into_owned()
                                }
                            };
                            let export_name = named
                                .exported
                                .as_ref()
                                .map(|exported| match exported {
                                    swc_core::ecma::ast::ModuleExportName::Ident(ident) => {
                                        ident.sym.to_string()
                                    }
                                    swc_core::ecma::ast::ModuleExportName::Str(value) => {
                                        value.value.to_string_lossy().into_owned()
                                    }
                                })
                                .unwrap_or_else(|| local_name.clone());

                            if local_name == "preview" {
                                _preview_exported = true;
                                continue;
                            }

                            export_bindings
                                .entry(export_name)
                                .or_default()
                                .push(ExportBinding::Local { local_name });
                        }
                    }
                }
            }
            _ => {}
        }
    }

    let mut require_collector = RequireCollector {
        specifiers: BTreeSet::new(),
    };
    module.visit_with(&mut require_collector);
    for specifier in require_collector.specifiers {
        let resolved = resolve_import_from_js(resolver, &snapshot.file_path, &specifier);
        if let Some(resolution) = &resolved {
            graph_edges.push(resolution.edge.clone());
        }
        record_import_resolution(&mut imports, &mut raw_diagnostics, resolved);
    }

    Ok(RawSourceModuleRecord {
        export_all_sources,
        export_bindings,
        file_path: snapshot.file_path.clone(),
        graph_edges,
        import_bindings,
        imports: imports.into_iter().collect(),
        is_tsx: snapshot.file_path.ends_with(".tsx") || snapshot.file_path.ends_with(".loom.tsx"),
        local_renderable_metadata,
        owner_package_name: snapshot.owner_package_name.clone(),
        owner_package_root: snapshot.owner_package_root.clone(),
        is_entry_candidate: snapshot.is_entry_candidate,
        project_config_path: snapshot.project_config_path.clone(),
        preview: preview_info,
        raw_diagnostics: raw_diagnostics.into_values().collect(),
        relative_path: snapshot.relative_path.clone(),
        target: create_target_context(&snapshot.target),
    })
}

fn resolve_local_reference(
    record: &RawSourceModuleRecord,
    local_name: &str,
    records_by_path: &HashMap<String, RawSourceModuleRecord>,
    stack: &mut BTreeSet<String>,
) -> Option<ResolvedRenderableRef> {
    if record
        .local_renderable_metadata
        .get(local_name)
        .map(|metadata| metadata.is_renderable)
        .unwrap_or(false)
    {
        return Some(ResolvedRenderableRef {
            import_chain: vec![record.file_path.clone()],
            origin_file_path: record.file_path.clone(),
            symbol_chain: vec![format!("{}#{}", record.file_path, local_name)],
            symbol_name: local_name.to_owned(),
        });
    }

    let import_binding = record.import_bindings.get(local_name)?;
    let source_record = records_by_path.get(&import_binding.source_file_path)?;
    resolve_export_reference(
        source_record,
        &import_binding.imported_name,
        records_by_path,
        stack,
    )
    .map(|resolved| ResolvedRenderableRef {
        import_chain: {
            let mut chain = vec![record.file_path.clone()];
            chain.extend(resolved.import_chain);
            chain
        },
        origin_file_path: resolved.origin_file_path,
        symbol_chain: {
            let mut chain = vec![format!("{}#{}", record.file_path, local_name)];
            chain.extend(resolved.symbol_chain);
            chain
        },
        symbol_name: resolved.symbol_name,
    })
}

fn resolve_export_reference(
    record: &RawSourceModuleRecord,
    export_name: &str,
    records_by_path: &HashMap<String, RawSourceModuleRecord>,
    stack: &mut BTreeSet<String>,
) -> Option<ResolvedRenderableRef> {
    let stack_key = format!("{}:{}", record.file_path, export_name);
    if stack.contains(&stack_key) {
        return None;
    }
    stack.insert(stack_key.clone());

    if let Some(bindings) = record.export_bindings.get(export_name) {
        for binding in bindings {
            match binding {
                ExportBinding::DefaultExpression => {
                    stack.remove(&stack_key);
                    return Some(ResolvedRenderableRef {
                        import_chain: vec![record.file_path.clone()],
                        origin_file_path: record.file_path.clone(),
                        symbol_chain: vec![format!("{}#default", record.file_path)],
                        symbol_name: "default".to_owned(),
                    });
                }
                ExportBinding::Local { local_name } => {
                    if let Some(resolved) =
                        resolve_local_reference(record, local_name, records_by_path, stack)
                    {
                        stack.remove(&stack_key);
                        return Some(resolved);
                    }
                }
                ExportBinding::ReExport {
                    imported_name,
                    source_file_path,
                } => {
                    if let Some(source_record) = records_by_path.get(source_file_path) {
                        if let Some(resolved) = resolve_export_reference(
                            source_record,
                            imported_name,
                            records_by_path,
                            stack,
                        ) {
                            stack.remove(&stack_key);
                            return Some(ResolvedRenderableRef {
                                import_chain: {
                                    let mut chain = vec![record.file_path.clone()];
                                    chain.extend(resolved.import_chain);
                                    chain
                                },
                                origin_file_path: resolved.origin_file_path,
                                symbol_chain: {
                                    let mut chain =
                                        vec![format!("{}#{}", record.file_path, export_name)];
                                    chain.extend(resolved.symbol_chain);
                                    chain
                                },
                                symbol_name: resolved.symbol_name,
                            });
                        }
                    }
                }
            }
        }
    }

    if export_name != "default" {
        for source_file_path in &record.export_all_sources {
            if let Some(source_record) = records_by_path.get(source_file_path) {
                if let Some(resolved) =
                    resolve_export_reference(source_record, export_name, records_by_path, stack)
                {
                    stack.remove(&stack_key);
                    return Some(ResolvedRenderableRef {
                        import_chain: {
                            let mut chain = vec![record.file_path.clone()];
                            chain.extend(resolved.import_chain);
                            chain
                        },
                        origin_file_path: resolved.origin_file_path,
                        symbol_chain: {
                            let mut chain = vec![format!("{}#{}", record.file_path, export_name)];
                            chain.extend(resolved.symbol_chain);
                            chain
                        },
                        symbol_name: resolved.symbol_name,
                    });
                }
            }
        }
    }

    stack.remove(&stack_key);
    None
}

fn get_renderable_named_exports(
    record: &RawSourceModuleRecord,
    records_by_path: &HashMap<String, RawSourceModuleRecord>,
) -> Vec<String> {
    let mut renderable_exports = BTreeSet::new();
    for export_name in record.export_bindings.keys() {
        if export_name == "default" || export_name == "preview" {
            continue;
        }

        if resolve_export_reference(record, export_name, records_by_path, &mut BTreeSet::new())
            .is_some()
        {
            renderable_exports.insert(export_name.clone());
        }
    }

    for source_file_path in &record.export_all_sources {
        if let Some(source_record) = records_by_path.get(source_file_path) {
            for export_name in get_renderable_named_exports(source_record, records_by_path) {
                renderable_exports.insert(export_name);
            }
        }
    }

    renderable_exports.into_iter().collect()
}

fn has_renderable_default_export(
    record: &RawSourceModuleRecord,
    records_by_path: &HashMap<String, RawSourceModuleRecord>,
) -> bool {
    resolve_export_reference(record, "default", records_by_path, &mut BTreeSet::new()).is_some()
}

fn resolve_preview_entry_export(
    record: &RawSourceModuleRecord,
    records_by_path: &HashMap<String, RawSourceModuleRecord>,
) -> Option<(String, ResolvedRenderableRef)> {
    if record.preview.has_render && record.preview.entry_local_name.is_none() {
        return Some((
            "preview.render".to_owned(),
            ResolvedRenderableRef {
                import_chain: vec![record.file_path.clone()],
                origin_file_path: record.file_path.clone(),
                symbol_chain: vec![format!("{}#render", record.file_path)],
                symbol_name: "render".to_owned(),
            },
        ));
    }

    let entry_local_name = record.preview.entry_local_name.clone()?;
    let resolved_entry = resolve_local_reference(
        record,
        &entry_local_name,
        records_by_path,
        &mut BTreeSet::new(),
    )?;

    let mut selected_export_name: Option<String> = None;
    for export_name in record.export_bindings.keys() {
        if export_name == "default" || export_name == "preview" {
            continue;
        }

        let Some(resolved_export) =
            resolve_export_reference(record, export_name, records_by_path, &mut BTreeSet::new())
        else {
            continue;
        };

        if resolved_export.origin_file_path == resolved_entry.origin_file_path
            && resolved_export.symbol_name == resolved_entry.symbol_name
        {
            selected_export_name = match selected_export_name {
                Some(current) if current <= *export_name => Some(current),
                _ => Some(export_name.clone()),
            };
        }
    }

    Some((
        selected_export_name.unwrap_or(entry_local_name),
        resolved_entry,
    ))
}

fn is_preview_package_internal_entry(target: &TargetContext, relative_path: &str) -> bool {
    target.package_name == "@loom-dev/preview"
        && (relative_path.starts_with("runtime/") || relative_path.starts_with("shell/"))
}

fn create_diagnostics_summary(diagnostics: &[PreviewDiagnostic]) -> PreviewDiagnosticsSummary {
    let mut by_phase = BTreeMap::<String, u32>::new();
    for diagnostic in diagnostics {
        *by_phase.entry(diagnostic.phase.clone()).or_insert(0) += 1;
    }

    PreviewDiagnosticsSummary {
        by_phase,
        has_blocking: diagnostics
            .iter()
            .any(|diagnostic| diagnostic.severity == "error"),
        total: diagnostics.len() as u32,
    }
}

fn create_capabilities(render_target: &Value) -> PreviewEntryCapabilities {
    let supports_props_editing = render_target
        .get("kind")
        .and_then(|value| value.as_str())
        .map(|value| value == "component")
        .unwrap_or(false);

    PreviewEntryCapabilities {
        supports_hot_update: true,
        supports_layout_debug: true,
        supports_props_editing,
        supports_runtime_mock: true,
    }
}

fn create_base_status_details(status: &str, render_target: &Value) -> Value {
    match status {
        "ambiguous" => json!({
            "kind": "ambiguous",
            "reason": "ambiguous-exports",
            "candidates": render_target.get("candidates").cloned().unwrap_or(Value::Array(vec![])),
        }),
        "needs_harness" => {
            let reason = if render_target
                .get("kind")
                .and_then(|value| value.as_str())
                .unwrap_or_default()
                == "none"
                && render_target
                    .get("reason")
                    .and_then(|value| value.as_str())
                    .unwrap_or_default()
                    == "no-component-export"
            {
                "no-component-export"
            } else {
                "missing-explicit-contract"
            };
            json!({
                "kind": "needs_harness",
                "reason": reason,
                "candidates": render_target.get("candidates").cloned().unwrap_or(Value::Array(vec![])),
            })
        }
        "blocked_by_layout" => json!({
            "kind": "blocked_by_layout",
            "reason": "layout-issues",
            "issueCodes": [],
        }),
        "blocked_by_runtime" => json!({
            "kind": "blocked_by_runtime",
            "reason": "runtime-issues",
            "issueCodes": [],
        }),
        "blocked_by_transform" => json!({
            "kind": "blocked_by_transform",
            "reason": "transform-diagnostics",
            "blockingCodes": [],
        }),
        _ => json!({ "kind": "ready" }),
    }
}

fn create_entry_diagnostic(
    code: &str,
    entry_id: &str,
    file_path: &str,
    package_root: &str,
    summary: &str,
    severity: &str,
) -> PreviewDiagnostic {
    PreviewDiagnostic {
        blocking: None,
        code: code.to_owned(),
        code_frame: None,
        details: None,
        entry_id: entry_id.to_owned(),
        file: file_path.to_owned(),
        import_chain: None,
        phase: "discovery".to_owned(),
        relative_file: to_relative_path(package_root, file_path),
        severity: severity.to_owned(),
        summary: summary.to_owned(),
        symbol: None,
        target: "preview-engine".to_owned(),
    }
}

fn collect_transitive_diagnostics(
    entry_id: &str,
    file_path: &str,
    records_by_path: &HashMap<String, RawSourceModuleRecord>,
    visited: &mut BTreeSet<String>,
    diagnostics: &mut HashMap<String, PreviewDiagnostic>,
) {
    if !visited.insert(file_path.to_owned()) {
        return;
    }

    let Some(record) = records_by_path.get(file_path) else {
        return;
    };

    for diagnostic in &record.raw_diagnostics {
        let next = PreviewDiagnostic {
            blocking: None,
            code: diagnostic.code.clone(),
            code_frame: None,
            details: None,
            entry_id: entry_id.to_owned(),
            file: diagnostic.file.clone(),
            import_chain: diagnostic.import_chain.clone(),
            phase: diagnostic.phase.clone(),
            relative_file: to_relative_path(&diagnostic.package_root, &diagnostic.file),
            severity: diagnostic.severity.clone(),
            summary: diagnostic.summary.clone(),
            symbol: None,
            target: diagnostic.target.clone(),
        };
        let key = format!("{}:{}:{}", next.code, next.file, next.summary);
        diagnostics.insert(key, next);
    }

    let mut dependency_paths = BTreeSet::new();
    dependency_paths.extend(record.imports.iter().cloned());
    for edge in &record.graph_edges {
        if let Some(resolved_file) = &edge.resolved_file {
            dependency_paths.insert(resolved_file.clone());
        }
    }

    for dependency_path in dependency_paths {
        collect_transitive_diagnostics(
            entry_id,
            &dependency_path,
            records_by_path,
            visited,
            diagnostics,
        );
    }
}

fn collect_dependency_paths(
    record: &RawSourceModuleRecord,
    graph_session: &PreviewGraphSession,
) -> Vec<String> {
    graph_session.collect_transitive_dependency_paths_internal(&record.file_path)
}

fn to_preview_graph_records(records: &[RawSourceModuleRecord]) -> Vec<PreviewGraphRecordSnapshot> {
    records
        .iter()
        .map(|record| PreviewGraphRecordSnapshot {
            file_path: record.file_path.clone(),
            graph_edges: record.graph_edges.clone(),
            imports: record.imports.clone(),
            owner_package_name: record.owner_package_name.clone(),
            owner_package_root: record.owner_package_root.clone(),
            project_config_path: record.project_config_path().map(|value| value.to_owned()),
        })
        .collect()
}

impl RawSourceModuleRecord {
    fn project_config_path(&self) -> Option<&str> {
        self.project_config_path.as_deref()
    }
}

fn build_descriptor(
    record: &RawSourceModuleRecord,
    records_by_path: &HashMap<String, RawSourceModuleRecord>,
    graph_session: &PreviewGraphSession,
) -> (
    Vec<String>,
    PreviewEntryDescriptor,
    Vec<PreviewDiagnostic>,
    PreviewGraphTrace,
) {
    let entry_id = format!("{}:{}", record.target.name, record.relative_path);
    let candidate_export_names = {
        let mut names = get_renderable_named_exports(record, records_by_path);
        names.sort();
        names
    };
    let has_default_export = has_renderable_default_export(record, records_by_path);
    let renderable_candidates = if has_default_export {
        let mut names = vec!["default".to_owned()];
        names.extend(candidate_export_names.clone());
        names
    } else {
        candidate_export_names.clone()
    };
    let mut entry_diagnostics = {
        let mut diagnostics = HashMap::<String, PreviewDiagnostic>::new();
        collect_transitive_diagnostics(
            &entry_id,
            &record.file_path,
            records_by_path,
            &mut BTreeSet::new(),
            &mut diagnostics,
        );
        diagnostics.into_values().collect::<Vec<_>>()
    };
    let (selection, render_target, status, selection_trace) = if let Some((export_name, trace)) =
        resolve_preview_entry_export(record, records_by_path)
    {
        (
            json!({
                "kind": "explicit",
                "contract": if record.preview.has_render { "preview.render" } else { "preview.entry" },
            }),
            if record.preview.has_render {
                json!({"kind": "harness", "contract": "preview.render"})
            } else {
                json!({
                    "kind": "component",
                    "exportName": export_name,
                    "usesPreviewProps": record.preview.has_props,
                })
            },
            "ready".to_owned(),
            json!({
                "contract": if record.preview.has_render { "preview.render" } else { "preview.entry" },
                "importChain": trace.import_chain,
                "symbolChain": trace.symbol_chain,
                "requestedSymbol": if record.preview.has_render { Value::Null } else { json!(record.preview.entry_local_name.clone()) },
                "resolvedExportName": if record.preview.has_render { Value::Null } else { json!(export_name) },
            }),
        )
    } else if renderable_candidates.len() > 1 {
        entry_diagnostics.push(create_entry_diagnostic(
            "AMBIGUOUS_COMPONENT_EXPORTS",
            &entry_id,
            &record.file_path,
            &record.target.package_root,
            &format!(
                "Multiple component exports need explicit disambiguation: {}.",
                candidate_export_names.join(", ")
            ),
            "warning",
        ));
        (
            json!({
                "kind": "unresolved",
                "reason": "ambiguous-exports",
            }),
            json!({
                "kind": "none",
                "reason": "ambiguous-exports",
                "candidates": renderable_candidates,
            }),
            "ambiguous".to_owned(),
            json!({
                "importChain": [record.file_path.clone()],
                "symbolChain": [],
            }),
        )
    } else if renderable_candidates.len() == 1 {
        entry_diagnostics.push(create_entry_diagnostic(
            "MISSING_EXPLICIT_PREVIEW_CONTRACT",
            &entry_id,
            &record.file_path,
            &record.target.package_root,
            &format!(
                "This file does not declare `preview.entry` or `preview.render`. Add an explicit preview contract to select {}.",
                renderable_candidates[0]
            ),
            "warning",
        ));
        (
            json!({
                "kind": "unresolved",
                "reason": "missing-explicit-contract",
            }),
            json!({
                "kind": "none",
                "reason": "missing-explicit-contract",
                "candidates": renderable_candidates,
            }),
            "needs_harness".to_owned(),
            json!({
                "importChain": [record.file_path.clone()],
                "requestedSymbol": record.preview.entry_local_name.clone(),
                "symbolChain": [],
            }),
        )
    } else {
        if candidate_export_names.is_empty() && !has_default_export {
            entry_diagnostics.push(create_entry_diagnostic(
                "NO_COMPONENT_EXPORTS",
                &entry_id,
                &record.file_path,
                &record.target.package_root,
                "No exported component candidates were found for preview entry selection.",
                "warning",
            ));
        }

        (
            json!({
                "kind": "unresolved",
                "reason": "no-component-export",
            }),
            json!({
                "kind": "none",
                "reason": if candidate_export_names.is_empty() && !has_default_export {
                    "no-component-export"
                } else {
                    "missing-explicit-contract"
                },
            }),
            "needs_harness".to_owned(),
            json!({
                "importChain": [record.file_path.clone()],
                "symbolChain": [],
            }),
        )
    };

    if record.preview.has_export
        && !record.preview.has_render
        && !resolve_preview_entry_export(record, records_by_path).is_some()
    {
        entry_diagnostics.push(create_entry_diagnostic(
            "PREVIEW_RENDER_MISSING",
            &entry_id,
            &record.file_path,
            &record.target.package_root,
            "The file exports `preview`, but it does not define a usable `preview.entry` or callable `preview.render`.",
            "warning",
        ));
    }

    let graph_trace =
        graph_session.collect_graph_trace_internal(&record.file_path, selection_trace.clone());
    if graph_trace.stop_reason.as_deref() == Some("graph-cycle") {
        entry_diagnostics.push(create_entry_diagnostic(
            "GRAPH_CYCLE_DETECTED",
            &entry_id,
            &record.file_path,
            &record.target.package_root,
            &format!(
                "Preview graph detected a cycle while traversing {}.",
                record.relative_path
            ),
            "warning",
        ));
    }

    let mut dependency_paths = if let Some(path_record) = records_by_path.get(&record.file_path) {
        collect_dependency_paths(path_record, graph_session)
    } else {
        Vec::new()
    };
    dependency_paths.sort();

    let diagnostics_summary = create_diagnostics_summary(&entry_diagnostics);
    let title = record
        .preview
        .title
        .clone()
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| humanize_title(&record.relative_path));
    let status_details = create_base_status_details(&status, &render_target);
    let descriptor = PreviewEntryDescriptor {
        capabilities: create_capabilities(&render_target),
        candidate_export_names,
        diagnostics_summary,
        has_default_export,
        has_preview_export: record.preview.has_export,
        id: entry_id.clone(),
        package_name: record.target.package_name.clone(),
        relative_path: record.relative_path.clone(),
        render_target,
        selection,
        source_file_path: record.file_path.clone(),
        status,
        status_details,
        target_name: record.target.name.clone(),
        title,
    };

    (dependency_paths, descriptor, entry_diagnostics, graph_trace)
}

#[wasm_bindgen]
pub struct WorkspaceAnalysisSession {
    project_name: String,
    protocol_version: u32,
    resolve_import: Function,
    records: Vec<WorkspaceFileSnapshot>,
}

#[wasm_bindgen]
impl WorkspaceAnalysisSession {
    #[wasm_bindgen(constructor)]
    pub fn new(
        project_name: String,
        protocol_version: u32,
        resolve_import: Function,
    ) -> WorkspaceAnalysisSession {
        WorkspaceAnalysisSession {
            project_name,
            protocol_version,
            resolve_import,
            records: Vec::new(),
        }
    }

    #[wasm_bindgen(js_name = replaceRecords)]
    pub fn replace_records(&mut self, raw_records: JsValue) -> Result<(), JsValue> {
        let records: Vec<WorkspaceFileSnapshot> = serde_wasm_bindgen::from_value(raw_records)
            .map_err(|error| {
                to_js_error(format!("Failed to parse workspace file snapshots: {error}"))
            })?;
        self.records = records;
        Ok(())
    }

    #[wasm_bindgen(js_name = buildWorkspaceDiscovery)]
    pub fn build_workspace_discovery(&self) -> Result<JsValue, JsValue> {
        let mut parsed_records = HashMap::new();
        let mut ordered_targets = BTreeMap::<String, PreviewSourceTargetSnapshot>::new();

        for snapshot in &self.records {
            ordered_targets
                .entry(snapshot.target.name.clone())
                .or_insert_with(|| snapshot.target.clone());
        }

        for snapshot in &self.records {
            let parsed = parse_module_record(snapshot, &self.resolve_import)?;
            parsed_records.insert(parsed.file_path.clone(), parsed);
        }

        let graph_records =
            to_preview_graph_records(&parsed_records.values().cloned().collect::<Vec<_>>());
        let mut graph_session = PreviewGraphSession::new();
        graph_session.replace_records_internal(graph_records);

        let mut entry_states = Vec::new();
        let mut workspace_entries = Vec::new();

        for target in ordered_targets.values() {
            let target_context = create_target_context(target);
            let mut entry_records = parsed_records
                .values()
                .filter(|record| record.is_tsx)
                .filter(|record| record.is_entry_candidate)
                .filter(|record| record.target.name == target_context.name)
                .filter(|record| {
                    !is_preview_package_internal_entry(&record.target, &record.relative_path)
                })
                .cloned()
                .collect::<Vec<_>>();
            entry_records.sort_by(|left, right| {
                if left.relative_path != right.relative_path {
                    return left.relative_path.cmp(&right.relative_path);
                }

                left.file_path.cmp(&right.file_path)
            });

            for record in entry_records {
                let (dependency_paths, descriptor, discovery_diagnostics, graph_trace) =
                    build_descriptor(&record, &parsed_records, &graph_session);
                workspace_entries.push(descriptor.clone());
                entry_states.push(WorkspaceDiscoveryEntryState {
                    dependency_paths,
                    descriptor,
                    discovery_diagnostics,
                    graph_trace,
                    package_root: record.target.package_root.clone(),
                    preview_has_props: record.preview.has_props,
                });
            }
        }

        workspace_entries.sort_by(|left, right| {
            if left.target_name != right.target_name {
                return left.target_name.cmp(&right.target_name);
            }

            left.relative_path.cmp(&right.relative_path)
        });

        let workspace_index = PreviewWorkspaceIndex {
            entries: workspace_entries,
            project_name: self.project_name.clone(),
            protocol_version: self.protocol_version,
            targets: ordered_targets.values().cloned().collect(),
        };

        serde_wasm_bindgen::to_value(&WorkspaceDiscoverySnapshot {
            entries: entry_states,
            workspace_index,
        })
        .map_err(|error| to_js_error(format!("Failed to serialize workspace discovery: {error}")))
    }

    pub fn dispose(&mut self) {
        self.records.clear();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_preview_object_from_const_assertion() {
        let module = parse_ts_module(
            r#"
                export const preview = ({
                    entry: ButtonPreview,
                    props: { checked: true },
                    title: "Button",
                }) as const;
            "#,
            "Button.loom.tsx",
        )
        .expect("module parses");

        let preview_decl = module
            .body
            .iter()
            .find_map(|item| match item {
                ModuleItem::ModuleDecl(ModuleDecl::ExportDecl(ExportDecl { decl, .. })) => {
                    match decl {
                        Decl::Var(var_decl) => var_decl.decls.iter().find_map(|decl| {
                            let Pat::Ident(binding) = &decl.name else {
                                return None;
                            };

                            (binding.id.sym == *"preview").then_some(decl.init.as_deref())
                        }),
                        _ => None,
                    }
                }
                _ => None,
            })
            .flatten();

        let preview = parse_preview_object(preview_decl).expect("preview object parsed");
        assert_eq!(preview.entry_local_name.as_deref(), Some("ButtonPreview"));
        assert_eq!(preview.title.as_deref(), Some("Button"));
        assert!(preview.has_export);
        assert!(preview.has_props);
    }

    #[test]
    fn resolves_preview_entry_export_aliases() {
        let source_record = RawSourceModuleRecord {
            export_all_sources: vec![],
            export_bindings: HashMap::from([(
                "Showcase".to_owned(),
                vec![ExportBinding::Local {
                    local_name: "Showcase".to_owned(),
                }],
            )]),
            file_path: "/workspace/src/Showcase.tsx".to_owned(),
            graph_edges: vec![],
            import_bindings: HashMap::new(),
            imports: vec![],
            is_tsx: true,
            local_renderable_metadata: HashMap::from([(
                "Showcase".to_owned(),
                LocalRenderableMetadata {
                    is_renderable: true,
                },
            )]),
            owner_package_name: Some("@fixtures/debug".to_owned()),
            owner_package_root: "/workspace".to_owned(),
            is_entry_candidate: false,
            project_config_path: None,
            preview: make_default_preview_export_info(),
            raw_diagnostics: vec![],
            relative_path: "src/Showcase.tsx".to_owned(),
            target: TargetContext {
                name: "fixture".to_owned(),
                package_name: "@fixtures/debug".to_owned(),
                package_root: "/workspace".to_owned(),
            },
        };

        let entry_record = RawSourceModuleRecord {
            export_all_sources: vec![],
            export_bindings: HashMap::from([(
                "ExplicitCard".to_owned(),
                vec![ExportBinding::ReExport {
                    imported_name: "Showcase".to_owned(),
                    source_file_path: source_record.file_path.clone(),
                }],
            )]),
            file_path: "/workspace/src/ReExport.loom.tsx".to_owned(),
            graph_edges: vec![],
            import_bindings: HashMap::from([(
                "Showcase".to_owned(),
                ImportBinding {
                    imported_name: "Showcase".to_owned(),
                    source_file_path: source_record.file_path.clone(),
                },
            )]),
            imports: vec![source_record.file_path.clone()],
            is_tsx: true,
            local_renderable_metadata: HashMap::new(),
            owner_package_name: Some("@fixtures/debug".to_owned()),
            owner_package_root: "/workspace".to_owned(),
            is_entry_candidate: true,
            project_config_path: None,
            preview: PreviewExportInfo {
                entry_local_name: Some("Showcase".to_owned()),
                has_export: true,
                has_props: true,
                has_render: false,
                title: Some("Explicit Card".to_owned()),
            },
            raw_diagnostics: vec![],
            relative_path: "src/ReExport.loom.tsx".to_owned(),
            target: TargetContext {
                name: "fixture".to_owned(),
                package_name: "@fixtures/debug".to_owned(),
                package_root: "/workspace".to_owned(),
            },
        };

        let records_by_path = HashMap::from([
            (source_record.file_path.clone(), source_record),
            (entry_record.file_path.clone(), entry_record.clone()),
        ]);

        let (export_name, _) =
            resolve_preview_entry_export(&entry_record, &records_by_path).expect("resolved");
        assert_eq!(export_name, "ExplicitCard");
    }

    #[test]
    fn parses_declaration_modules_in_dts_mode() {
        let module = parse_ts_module(
            r#"
                export interface Validator<T> {
                    (value: unknown): T;
                }

                export type ReactText = string | number;
                export const string: Validator<string>;
            "#,
            "prop-types.d.ts",
        )
        .expect("declaration module parses");

        assert!(!module.body.is_empty());
    }
}

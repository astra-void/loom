use std::{
    collections::{HashMap, HashSet},
    fs,
    path::{Component, Path, PathBuf},
};

use napi_derive::napi;
use swc_core::{
    common::{sync::Lrc, FileName, SourceMap, Span, SyntaxContext, DUMMY_SP},
    ecma::{
        ast::{
            ArrowExpr, AssignPat, BindingIdent, BlockStmt, CallExpr, Callee, CatchClause,
            ClassExpr, Constructor, Decl, Expr, ExprOrSpread, FnExpr, ForHead, ForInStmt,
            ForOfStmt, ForStmt, Function, Ident, IdentName, ImportDecl, ImportNamedSpecifier,
            ImportPhase, ImportSpecifier, JSXClosingElement, JSXElementName, JSXOpeningElement,
            KeyValueProp, Lit, MemberExpr, MemberProp, Module, ModuleDecl, ModuleItem, NamedExport,
            Null, ObjectPatProp, ParamOrTsParamProp, Pat, Prop, PropName, Stmt, Str, SwitchCase,
            TsEntityName, TsGetterSignature, TsImportEqualsDecl, TsKeywordType, TsKeywordTypeKind,
            TsMethodSignature, TsModuleBlock, TsParamPropParam, TsPropertySignature,
            TsSetterSignature, TsType, TsTypeRef, TsUnionOrIntersectionType, TsUnionType,
            UpdateExpr, VarDeclOrExpr,
        },
        codegen::{text_writer::JsWriter, Config as CodegenConfig, Emitter},
        parser::{parse_file_as_module, Syntax, TsSyntax},
        visit::{VisitMut, VisitMutWith},
    },
};

const PREVIEW_GLOBAL_HELPER_NAME: &str = "__previewGlobal";
const NEVER_REWRITE_IDENTIFIER_NAMES: [&str; 3] =
    [PREVIEW_GLOBAL_HELPER_NAME, "arguments", "require"];
const RUNTIME_HELPER_NAMES: [&str; 9] = [
    PREVIEW_GLOBAL_HELPER_NAME,
    "Color3",
    "UDim2",
    "UDim",
    "Vector2",
    "typeIs",
    "pairs",
    "error",
    "isPreviewElement",
];
const RUNTIME_HOST_NAMES: [&str; 20] = [
    "Frame",
    "TextButton",
    "ScreenGui",
    "TextLabel",
    "TextBox",
    "ImageLabel",
    "ScrollingFrame",
    "UICorner",
    "UIPadding",
    "UIListLayout",
    "UIGridLayout",
    "UIStroke",
    "UIScale",
    "UIGradient",
    "UIPageLayout",
    "UITableLayout",
    "UISizeConstraint",
    "UITextSizeConstraint",
    "UIAspectRatioConstraint",
    "UIFlexItem",
];

#[allow(non_snake_case)]
#[napi(object)]
pub struct UnsupportedPatternError {
    pub code: String,
    pub message: String,
    pub file: String,
    pub line: u32,
    pub column: u32,
    pub symbol: Option<String>,
    pub target: String,
}

#[allow(non_snake_case)]
#[napi(object)]
pub struct TransformPreviewSourceOptions {
    pub file_path: String,
    pub runtime_module: String,
    pub target: String,
}

#[allow(non_snake_case)]
#[napi(object)]
pub struct TransformPreviewSourceResult {
    pub code: String,
    pub errors: Vec<UnsupportedPatternError>,
}

struct PreviewTransform<'a> {
    options: &'a TransformPreviewSourceOptions,
    cm: Lrc<SourceMap>,
    scope_stack: Vec<HashSet<String>>,
    errors: Vec<UnsupportedPatternError>,
    suppress_identifier_rewrite_depth: usize,
}

impl<'a> PreviewTransform<'a> {
    fn new(options: &'a TransformPreviewSourceOptions, cm: Lrc<SourceMap>) -> Self {
        Self {
            options,
            cm,
            scope_stack: vec![runtime_binding_names()],
            errors: Vec::new(),
            suppress_identifier_rewrite_depth: 0,
        }
    }

    fn with_scope<F>(&mut self, bindings: HashSet<String>, callback: F)
    where
        F: FnOnce(&mut Self),
    {
        self.scope_stack.push(bindings);
        callback(self);
        self.scope_stack.pop();
    }

    fn with_identifier_rewrite_suppressed<F>(&mut self, callback: F)
    where
        F: FnOnce(&mut Self),
    {
        self.suppress_identifier_rewrite_depth += 1;
        callback(self);
        self.suppress_identifier_rewrite_depth -= 1;
    }

    fn has_binding(&self, name: &str) -> bool {
        self.scope_stack
            .iter()
            .rev()
            .any(|scope| scope.contains(name))
    }

    fn should_rewrite_identifier(&self, ident: &Ident) -> bool {
        if self.suppress_identifier_rewrite_depth > 0 {
            return false;
        }

        let name = ident.sym.as_ref();
        !NEVER_REWRITE_IDENTIFIER_NAMES.contains(&name) && !self.has_binding(name)
    }

    fn create_unsupported_error(
        &self,
        span: Span,
        code: &str,
        message: String,
        symbol: Option<String>,
    ) -> UnsupportedPatternError {
        let location = self.cm.lookup_char_pos(span.lo());
        UnsupportedPatternError {
            code: code.to_owned(),
            message,
            file: self.options.file_path.clone(),
            line: location.line as u32,
            column: (location.col_display + 1) as u32,
            symbol,
            target: self.options.target.clone(),
        }
    }

    fn push_unsupported_error(
        &mut self,
        span: Span,
        code: &str,
        message: String,
        symbol: Option<String>,
    ) {
        self.errors
            .push(self.create_unsupported_error(span, code, message, symbol));
    }
}
impl VisitMut for PreviewTransform<'_> {
    fn visit_mut_module(&mut self, module: &mut Module) {
        let bindings = collect_module_item_bindings(&module.body);
        self.with_scope(bindings, |transformer| {
            module.body.visit_mut_with(transformer);
        });
        module.body = merge_runtime_imports(
            std::mem::take(&mut module.body),
            &self.options.runtime_module,
        );
    }

    fn visit_mut_block_stmt(&mut self, block: &mut BlockStmt) {
        let bindings = collect_statement_bindings(&block.stmts);
        self.with_scope(bindings, |transformer| {
            block.visit_mut_children_with(transformer);
        });
    }

    fn visit_mut_switch_case(&mut self, case: &mut SwitchCase) {
        let bindings = collect_statement_bindings(&case.cons);
        self.with_scope(bindings, |transformer| {
            case.visit_mut_children_with(transformer);
        });
    }

    fn visit_mut_ts_module_block(&mut self, block: &mut TsModuleBlock) {
        let bindings = collect_module_item_bindings(&block.body);
        self.with_scope(bindings, |transformer| {
            block.visit_mut_children_with(transformer);
        });
    }

    fn visit_mut_catch_clause(&mut self, catch_clause: &mut CatchClause) {
        let bindings = collect_catch_bindings(catch_clause);
        self.with_scope(bindings, |transformer| {
            catch_clause.visit_mut_children_with(transformer);
        });
    }

    fn visit_mut_for_stmt(&mut self, for_stmt: &mut ForStmt) {
        let bindings = collect_for_stmt_bindings(for_stmt);
        self.with_scope(bindings, |transformer| {
            for_stmt.visit_mut_children_with(transformer);
        });
    }

    fn visit_mut_for_in_stmt(&mut self, for_in_stmt: &mut ForInStmt) {
        let bindings = collect_for_in_bindings(for_in_stmt);
        self.with_scope(bindings, |transformer| {
            for_in_stmt.visit_mut_children_with(transformer);
        });
    }

    fn visit_mut_for_of_stmt(&mut self, for_of_stmt: &mut ForOfStmt) {
        let bindings = collect_for_of_bindings(for_of_stmt);
        self.with_scope(bindings, |transformer| {
            for_of_stmt.visit_mut_children_with(transformer);
        });
    }

    fn visit_mut_function(&mut self, function: &mut Function) {
        let bindings = collect_function_bindings(function);
        self.with_scope(bindings, |transformer| {
            function.visit_mut_children_with(transformer);
        });
    }

    fn visit_mut_arrow_expr(&mut self, arrow_expr: &mut ArrowExpr) {
        let bindings = collect_arrow_bindings(arrow_expr);
        self.with_scope(bindings, |transformer| {
            arrow_expr.visit_mut_children_with(transformer);
        });
    }

    fn visit_mut_fn_expr(&mut self, fn_expr: &mut FnExpr) {
        let mut bindings = HashSet::new();
        if let Some(ident) = &fn_expr.ident {
            bindings.insert(ident.sym.to_string());
        }

        self.with_scope(bindings, |transformer| {
            fn_expr.visit_mut_children_with(transformer);
        });
    }

    fn visit_mut_class_expr(&mut self, class_expr: &mut ClassExpr) {
        let mut bindings = HashSet::new();
        if let Some(ident) = &class_expr.ident {
            bindings.insert(ident.sym.to_string());
        }

        self.with_scope(bindings, |transformer| {
            class_expr.visit_mut_children_with(transformer);
        });
    }

    fn visit_mut_constructor(&mut self, constructor: &mut Constructor) {
        let bindings = collect_constructor_bindings(constructor);
        self.with_scope(bindings, |transformer| {
            constructor.visit_mut_children_with(transformer);
        });
    }

    fn visit_mut_import_decl(&mut self, import_decl: &mut ImportDecl) {
        let module_name = import_decl.src.value.to_string_lossy().into_owned();
        let next_module = if is_preview_runtime_alias_source(&module_name) {
            Some(self.options.runtime_module.clone())
        } else if module_name == "@rbxts/react" {
            Some("react".to_owned())
        } else if module_name.starts_with('.') {
            Some(resolve_relative_module_specifier(
                &self.options.file_path,
                &module_name,
            ))
        } else {
            None
        };

        if let Some(next_module) = next_module {
            import_decl.src = Box::new(string_literal(&next_module));
        }

        import_decl.visit_mut_children_with(self);
    }

    fn visit_mut_named_export(&mut self, named_export: &mut NamedExport) {
        if let Some(src) = &named_export.src {
            let module_name = src.value.to_string_lossy().into_owned();
            if module_name.starts_with('.') {
                named_export.src = Some(Box::new(string_literal(
                    &resolve_relative_module_specifier(&self.options.file_path, &module_name),
                )));
            }
        }

        named_export.visit_mut_children_with(self);
    }

    fn visit_mut_expr(&mut self, expr: &mut Expr) {
        if let Expr::Member(member_expr) = expr {
            if let Some(resolved_enum) = resolve_enum_literal(member_expr) {
                *expr = Expr::Lit(Lit::Str(string_literal(&resolved_enum)));
                return;
            }

            if is_enum_member_chain(member_expr) {
                member_expr.visit_mut_children_with(self);
                return;
            }

            member_expr.visit_mut_children_with(self);
            return;
        }

        if let Expr::Call(call_expr) = expr {
            if let Some((object_expr, type_name, span, symbol)) = extract_isa_pattern(call_expr) {
                if is_supported_isa_type(&type_name) {
                    let mut next_object = object_expr;
                    next_object.visit_mut_with(self);
                    *expr = create_is_preview_element_call(
                        call_expr.span,
                        call_expr.ctxt,
                        next_object,
                        &type_name,
                    );
                    return;
                }

                self.push_unsupported_error(
                    span,
                    "UNSUPPORTED_RUNTIME_PATTERN",
                    "Only preview-supported `IsA(...)` checks can be mapped for preview generation.".to_owned(),
                    Some(symbol),
                );
                call_expr.visit_mut_children_with(self);
                return;
            }

            call_expr.visit_mut_children_with(self);
            if is_zero_arg_use_ref_call(call_expr) {
                call_expr.args.push(ExprOrSpread {
                    spread: None,
                    expr: Box::new(Expr::Lit(Lit::Null(Null { span: DUMMY_SP }))),
                });
            }
            return;
        }
        if let Expr::Ident(ident) = expr {
            if self.should_rewrite_identifier(ident) {
                *expr = create_preview_global_access_expression(ident.sym.as_ref());
                return;
            }
        }

        expr.visit_mut_children_with(self);
    }

    fn visit_mut_update_expr(&mut self, update_expr: &mut UpdateExpr) {
        self.with_identifier_rewrite_suppressed(|transformer| {
            update_expr.arg.visit_mut_with(transformer);
        });
    }

    fn visit_mut_prop(&mut self, prop: &mut Prop) {
        if let Prop::Shorthand(ident) = prop {
            if self.should_rewrite_identifier(ident) {
                let key = PropName::Ident(IdentName::new(ident.sym.clone(), ident.span));
                let value = Box::new(create_preview_global_access_expression(ident.sym.as_ref()));
                *prop = Prop::KeyValue(KeyValueProp { key, value });
                return;
            }
        }

        prop.visit_mut_children_with(self);
    }

    fn visit_mut_ts_type(&mut self, ts_type: &mut TsType) {
        if let TsType::TsTypeRef(type_ref) = ts_type {
            if let Some(type_name) = get_ts_entity_ident_name(&type_ref.type_name) {
                if is_supported_type_name(type_name) {
                    *ts_type = create_preview_element_type();
                    return;
                }

                if type_name == "InputObject" {
                    *ts_type = create_event_type();
                    return;
                }
            }
        }

        ts_type.visit_mut_children_with(self);
    }

    fn visit_mut_ts_property_signature(&mut self, property_signature: &mut TsPropertySignature) {
        if property_signature.computed {
            property_signature.key.visit_mut_with(self);
        } else {
            self.with_identifier_rewrite_suppressed(|transformer| {
                property_signature.key.visit_mut_with(transformer);
            });
        }

        property_signature.type_ann.visit_mut_with(self);
    }

    fn visit_mut_ts_getter_signature(&mut self, getter_signature: &mut TsGetterSignature) {
        if getter_signature.computed {
            getter_signature.key.visit_mut_with(self);
        } else {
            self.with_identifier_rewrite_suppressed(|transformer| {
                getter_signature.key.visit_mut_with(transformer);
            });
        }

        getter_signature.type_ann.visit_mut_with(self);
    }

    fn visit_mut_ts_setter_signature(&mut self, setter_signature: &mut TsSetterSignature) {
        if setter_signature.computed {
            setter_signature.key.visit_mut_with(self);
        } else {
            self.with_identifier_rewrite_suppressed(|transformer| {
                setter_signature.key.visit_mut_with(transformer);
            });
        }

        setter_signature.param.visit_mut_with(self);
    }

    fn visit_mut_ts_method_signature(&mut self, method_signature: &mut TsMethodSignature) {
        if method_signature.computed {
            method_signature.key.visit_mut_with(self);
        } else {
            self.with_identifier_rewrite_suppressed(|transformer| {
                method_signature.key.visit_mut_with(transformer);
            });
        }

        method_signature.params.visit_mut_with(self);
        method_signature.type_ann.visit_mut_with(self);
        method_signature.type_params.visit_mut_with(self);
    }

    fn visit_mut_jsx_opening_element(&mut self, opening: &mut JSXOpeningElement) {
        opening.visit_mut_children_with(self);
        maybe_rewrite_jsx_host_name(&mut opening.name, &mut self.errors, &self.cm, self.options);
    }

    fn visit_mut_jsx_closing_element(&mut self, closing: &mut JSXClosingElement) {
        closing.visit_mut_children_with(self);
        maybe_rewrite_jsx_host_name(&mut closing.name, &mut self.errors, &self.cm, self.options);
    }
}

#[napi(js_name = "transformPreviewSource")]
pub fn transform_preview_source(
    code: String,
    options: TransformPreviewSourceOptions,
) -> napi::Result<TransformPreviewSourceResult> {
    let cm: Lrc<SourceMap> = Default::default();
    let is_tsx = options.file_path.ends_with(".tsx");
    let file = cm.new_source_file(FileName::Custom(options.file_path.clone()).into(), code);

    let mut recovered_errors = Vec::new();
    let mut module = parse_file_as_module(
        &file,
        Syntax::Typescript(TsSyntax {
            decorators: true,
            tsx: is_tsx,
            ..Default::default()
        }),
        Default::default(),
        None,
        &mut recovered_errors,
    )
    .map_err(|err| napi::Error::from_reason(format!("Failed to parse preview source: {err:?}")))?;

    if !recovered_errors.is_empty() {
        return Err(napi::Error::from_reason(format!(
            "Recovered parse errors in preview source: {recovered_errors:?}"
        )));
    }

    let mut transformer = PreviewTransform::new(&options, cm.clone());
    module.visit_mut_with(&mut transformer);

    let mut output = Vec::new();
    {
        let mut emitter = Emitter {
            cfg: CodegenConfig::default(),
            cm: cm.clone(),
            comments: None,
            wr: JsWriter::new(cm.clone(), "\n", &mut output, None),
        };

        emitter.emit_module(&module).map_err(|err| {
            napi::Error::from_reason(format!("Failed to emit preview source: {err:?}"))
        })?;
    }

    let emitted = String::from_utf8(output).map_err(|err| {
        napi::Error::from_reason(format!(
            "Generated preview output was not valid UTF-8: {err}"
        ))
    })?;

    Ok(TransformPreviewSourceResult {
        code: format!("// Generated by @lattice-ui/preview. Do not edit.\n{emitted}\n"),
        errors: transformer.errors,
    })
}

fn runtime_binding_names() -> HashSet<String> {
    RUNTIME_HELPER_NAMES
        .iter()
        .chain(RUNTIME_HOST_NAMES.iter())
        .map(|value| (*value).to_owned())
        .collect()
}

fn is_preview_runtime_alias_source(module_name: &str) -> bool {
    matches!(
        module_name,
        "@lattice-ui/core" | "@lattice-ui/layer" | "@lattice-ui/focus" | "@lattice-ui/style"
    )
}

fn supported_host_mapping(host_name: &str) -> Option<&'static str> {
    match host_name {
        "frame" => Some("Frame"),
        "textbutton" => Some("TextButton"),
        "screengui" => Some("ScreenGui"),
        "textlabel" => Some("TextLabel"),
        "textbox" => Some("TextBox"),
        "imagelabel" => Some("ImageLabel"),
        "scrollingframe" => Some("ScrollingFrame"),
        "uicorner" => Some("UICorner"),
        "uipadding" => Some("UIPadding"),
        "uilistlayout" => Some("UIListLayout"),
        "uigridlayout" => Some("UIGridLayout"),
        "uistroke" => Some("UIStroke"),
        "uiscale" => Some("UIScale"),
        "uigradient" => Some("UIGradient"),
        "uipagelayout" => Some("UIPageLayout"),
        "uitablelayout" => Some("UITableLayout"),
        "uisizeconstraint" => Some("UISizeConstraint"),
        "uitextsizeconstraint" => Some("UITextSizeConstraint"),
        "uiaspectratioconstraint" => Some("UIAspectRatioConstraint"),
        "uiflexitem" => Some("UIFlexItem"),
        _ => None,
    }
}

fn is_supported_type_name(type_name: &str) -> bool {
    matches!(
        type_name,
        "GuiObject"
            | "BasePlayerGui"
            | "Instance"
            | "Frame"
            | "ScreenGui"
            | "TextButton"
            | "TextLabel"
            | "TextBox"
            | "ImageLabel"
            | "ScrollingFrame"
    )
}

fn is_supported_isa_type(type_name: &str) -> bool {
    matches!(
        type_name,
        "GuiObject"
            | "Frame"
            | "ScreenGui"
            | "TextButton"
            | "TextLabel"
            | "TextBox"
            | "ImageLabel"
            | "ScrollingFrame"
    )
}
fn resolve_supported_enum_value(value: &str) -> Option<&'static str> {
    match value {
        "Enum.TextXAlignment.Left" => Some("left"),
        "Enum.TextXAlignment.Center" => Some("center"),
        "Enum.TextXAlignment.Right" => Some("right"),
        "Enum.TextYAlignment.Top" => Some("top"),
        "Enum.TextYAlignment.Center" => Some("center"),
        "Enum.TextYAlignment.Bottom" => Some("bottom"),
        "Enum.FillDirection.Horizontal" => Some("horizontal"),
        "Enum.FillDirection.Vertical" => Some("vertical"),
        "Enum.SortOrder.LayoutOrder" => Some("layout-order"),
        "Enum.SortOrder.Name" => Some("name"),
        "Enum.AutomaticSize.None" => Some("none"),
        "Enum.AutomaticSize.X" => Some("x"),
        "Enum.AutomaticSize.Y" => Some("y"),
        "Enum.AutomaticSize.XY" => Some("xy"),
        "Enum.ScrollingDirection.X" => Some("x"),
        "Enum.ScrollingDirection.Y" => Some("y"),
        "Enum.ScrollingDirection.XY" => Some("xy"),
        "Enum.KeyCode.Return" => Some("Enter"),
        "Enum.KeyCode.Space" => Some(" "),
        "Enum.KeyCode.Down" => Some("ArrowDown"),
        "Enum.KeyCode.Up" => Some("ArrowUp"),
        "Enum.KeyCode.Left" => Some("ArrowLeft"),
        "Enum.KeyCode.Right" => Some("ArrowRight"),
        "Enum.KeyCode.Home" => Some("Home"),
        "Enum.KeyCode.End" => Some("End"),
        "Enum.KeyCode.PageUp" => Some("PageUp"),
        "Enum.KeyCode.PageDown" => Some("PageDown"),
        "Enum.KeyCode.Escape" => Some("Escape"),
        "Enum.KeyCode.Backspace" => Some("Backspace"),
        _ => None,
    }
}

fn string_literal(value: &str) -> Str {
    Str {
        span: DUMMY_SP,
        value: value.into(),
        raw: None,
    }
}

fn create_preview_global_access_expression(name: &str) -> Expr {
    Expr::Call(CallExpr {
        span: DUMMY_SP,
        ctxt: Default::default(),
        callee: Callee::Expr(Box::new(Expr::Ident(Ident::new_no_ctxt(
            PREVIEW_GLOBAL_HELPER_NAME.into(),
            DUMMY_SP,
        )))),
        args: vec![ExprOrSpread {
            spread: None,
            expr: Box::new(Expr::Lit(Lit::Str(string_literal(name)))),
        }],
        type_args: None,
    })
}

fn create_preview_element_type() -> TsType {
    TsType::TsUnionOrIntersectionType(TsUnionOrIntersectionType::TsUnionType(TsUnionType {
        span: DUMMY_SP,
        types: vec![
            Box::new(TsType::TsTypeRef(TsTypeRef {
                span: DUMMY_SP,
                type_name: TsEntityName::Ident(Ident::new_no_ctxt("HTMLElement".into(), DUMMY_SP)),
                type_params: None,
            })),
            Box::new(TsType::TsKeywordType(TsKeywordType {
                span: DUMMY_SP,
                kind: TsKeywordTypeKind::TsNullKeyword,
            })),
        ],
    }))
}

fn create_event_type() -> TsType {
    TsType::TsTypeRef(TsTypeRef {
        span: DUMMY_SP,
        type_name: TsEntityName::Ident(Ident::new_no_ctxt("Event".into(), DUMMY_SP)),
        type_params: None,
    })
}

fn create_runtime_named_import_specifier(name: &str) -> ImportNamedSpecifier {
    ImportNamedSpecifier {
        span: DUMMY_SP,
        local: Ident::new_no_ctxt(name.into(), DUMMY_SP),
        imported: None,
        is_type_only: false,
    }
}

fn create_runtime_import_declaration(
    runtime_module: &str,
    specifiers: Vec<ImportNamedSpecifier>,
) -> ModuleItem {
    ModuleItem::ModuleDecl(ModuleDecl::Import(ImportDecl {
        span: DUMMY_SP,
        specifiers: specifiers.into_iter().map(ImportSpecifier::Named).collect(),
        src: Box::new(string_literal(runtime_module)),
        type_only: false,
        with: None,
        phase: ImportPhase::Evaluation,
    }))
}

fn merge_runtime_imports(body: Vec<ModuleItem>, runtime_module: &str) -> Vec<ModuleItem> {
    let mut specifiers = Vec::new();
    let mut specifier_indices = HashMap::new();

    for helper_name in RUNTIME_HELPER_NAMES {
        specifier_indices.insert(helper_name.to_owned(), specifiers.len());
        specifiers.push(create_runtime_named_import_specifier(helper_name));
    }

    for host_name in RUNTIME_HOST_NAMES {
        specifier_indices.insert(host_name.to_owned(), specifiers.len());
        specifiers.push(create_runtime_named_import_specifier(host_name));
    }

    let mut remaining_items = Vec::with_capacity(body.len() + 1);

    for item in body {
        let ModuleItem::ModuleDecl(ModuleDecl::Import(import_decl)) = &item else {
            remaining_items.push(item);
            continue;
        };

        if import_decl.src.value.to_string_lossy() != runtime_module {
            remaining_items.push(item);
            continue;
        }

        let has_default_or_namespace = import_decl.specifiers.iter().any(|specifier| {
            matches!(
                specifier,
                ImportSpecifier::Default(_) | ImportSpecifier::Namespace(_)
            )
        });

        if has_default_or_namespace {
            remaining_items.push(item);
            continue;
        }

        for specifier in &import_decl.specifiers {
            let ImportSpecifier::Named(named) = specifier else {
                continue;
            };

            let next_specifier = ImportNamedSpecifier {
                span: named.span,
                local: named.local.clone(),
                imported: named.imported.clone(),
                is_type_only: import_decl.type_only || named.is_type_only,
            };
            let local_name = next_specifier.local.sym.to_string();

            if let Some(existing_index) = specifier_indices.get(&local_name).copied() {
                if specifiers[existing_index].is_type_only && !next_specifier.is_type_only {
                    specifiers[existing_index] = next_specifier;
                }
            } else {
                specifier_indices.insert(local_name, specifiers.len());
                specifiers.push(next_specifier);
            }
        }
    }

    let mut next_body = Vec::with_capacity(remaining_items.len() + 1);
    next_body.push(create_runtime_import_declaration(
        runtime_module,
        specifiers,
    ));
    next_body.extend(remaining_items);
    next_body
}

fn collect_module_item_bindings(items: &[ModuleItem]) -> HashSet<String> {
    let mut bindings = HashSet::new();
    for item in items {
        match item {
            ModuleItem::Stmt(stmt) => add_statement_bindings(&mut bindings, stmt),
            ModuleItem::ModuleDecl(module_decl) => {
                add_module_decl_bindings(&mut bindings, module_decl)
            }
        }
    }
    bindings
}

fn collect_statement_bindings(statements: &[Stmt]) -> HashSet<String> {
    let mut bindings = HashSet::new();
    for statement in statements {
        add_statement_bindings(&mut bindings, statement);
    }
    bindings
}
fn collect_function_bindings(function: &Function) -> HashSet<String> {
    let mut bindings = HashSet::new();
    for param in &function.params {
        add_pattern_bindings(&mut bindings, &param.pat);
    }
    bindings
}

fn collect_arrow_bindings(arrow_expr: &ArrowExpr) -> HashSet<String> {
    let mut bindings = HashSet::new();
    for param in &arrow_expr.params {
        add_pattern_bindings(&mut bindings, param);
    }
    bindings
}

fn collect_constructor_bindings(constructor: &Constructor) -> HashSet<String> {
    let mut bindings = HashSet::new();
    for param in &constructor.params {
        match param {
            ParamOrTsParamProp::Param(param) => add_pattern_bindings(&mut bindings, &param.pat),
            ParamOrTsParamProp::TsParamProp(param_prop) => match &param_prop.param {
                TsParamPropParam::Ident(ident) => {
                    bindings.insert(ident.id.sym.to_string());
                }
                TsParamPropParam::Assign(assign) => {
                    add_pattern_bindings(&mut bindings, &assign.left)
                }
            },
        }
    }
    bindings
}

fn collect_catch_bindings(catch_clause: &CatchClause) -> HashSet<String> {
    let mut bindings = HashSet::new();
    if let Some(param) = &catch_clause.param {
        add_pattern_bindings(&mut bindings, param);
    }
    bindings
}

fn collect_for_stmt_bindings(for_stmt: &ForStmt) -> HashSet<String> {
    let mut bindings = HashSet::new();
    if let Some(VarDeclOrExpr::VarDecl(var_decl)) = &for_stmt.init {
        add_var_decl_bindings(&mut bindings, var_decl.decls.iter().map(|decl| &decl.name));
    }
    bindings
}

fn collect_for_in_bindings(for_in_stmt: &ForInStmt) -> HashSet<String> {
    let mut bindings = HashSet::new();
    add_for_head_bindings(&mut bindings, &for_in_stmt.left);
    bindings
}

fn collect_for_of_bindings(for_of_stmt: &ForOfStmt) -> HashSet<String> {
    let mut bindings = HashSet::new();
    add_for_head_bindings(&mut bindings, &for_of_stmt.left);
    bindings
}

fn add_module_decl_bindings(bindings: &mut HashSet<String>, module_decl: &ModuleDecl) {
    match module_decl {
        ModuleDecl::Import(import_decl) => add_import_decl_bindings(bindings, import_decl),
        ModuleDecl::ExportDecl(export_decl) => add_decl_bindings(bindings, &export_decl.decl),
        ModuleDecl::TsImportEquals(import_equals) => {
            add_import_equals_bindings(bindings, import_equals)
        }
        ModuleDecl::ExportDefaultDecl(export_default_decl) => match &export_default_decl.decl {
            swc_core::ecma::ast::DefaultDecl::Fn(function) => {
                if let Some(ident) = &function.ident {
                    bindings.insert(ident.sym.to_string());
                }
            }
            swc_core::ecma::ast::DefaultDecl::Class(class) => {
                if let Some(ident) = &class.ident {
                    bindings.insert(ident.sym.to_string());
                }
            }
            _ => {}
        },
        _ => {}
    }
}

fn add_statement_bindings(bindings: &mut HashSet<String>, statement: &Stmt) {
    match statement {
        Stmt::Decl(decl) => add_decl_bindings(bindings, decl),
        Stmt::For(for_stmt) => {
            if let Some(VarDeclOrExpr::VarDecl(var_decl)) = &for_stmt.init {
                add_var_decl_bindings(bindings, var_decl.decls.iter().map(|decl| &decl.name));
            }
        }
        Stmt::ForIn(for_in_stmt) => add_for_head_bindings(bindings, &for_in_stmt.left),
        Stmt::ForOf(for_of_stmt) => add_for_head_bindings(bindings, &for_of_stmt.left),
        _ => {}
    }
}

fn add_decl_bindings(bindings: &mut HashSet<String>, decl: &Decl) {
    match decl {
        Decl::Var(var_decl) => {
            add_var_decl_bindings(bindings, var_decl.decls.iter().map(|decl| &decl.name))
        }
        Decl::Fn(fn_decl) => {
            bindings.insert(fn_decl.ident.sym.to_string());
        }
        Decl::Class(class_decl) => {
            bindings.insert(class_decl.ident.sym.to_string());
        }
        Decl::TsEnum(enum_decl) => {
            bindings.insert(enum_decl.id.sym.to_string());
        }
        _ => {}
    }
}

fn add_var_decl_bindings<'a, I>(bindings: &mut HashSet<String>, names: I)
where
    I: IntoIterator<Item = &'a Pat>,
{
    for name in names {
        add_pattern_bindings(bindings, name);
    }
}

fn add_import_decl_bindings(bindings: &mut HashSet<String>, import_decl: &ImportDecl) {
    for specifier in &import_decl.specifiers {
        match specifier {
            ImportSpecifier::Named(named) => {
                bindings.insert(named.local.sym.to_string());
            }
            ImportSpecifier::Default(default) => {
                bindings.insert(default.local.sym.to_string());
            }
            ImportSpecifier::Namespace(namespace) => {
                bindings.insert(namespace.local.sym.to_string());
            }
        }
    }
}
fn add_import_equals_bindings(bindings: &mut HashSet<String>, import_equals: &TsImportEqualsDecl) {
    bindings.insert(import_equals.id.sym.to_string());
}

fn add_for_head_bindings(bindings: &mut HashSet<String>, head: &ForHead) {
    match head {
        ForHead::VarDecl(var_decl) => {
            add_var_decl_bindings(bindings, var_decl.decls.iter().map(|decl| &decl.name))
        }
        ForHead::Pat(pattern) => add_pattern_bindings(bindings, pattern),
        ForHead::UsingDecl(using_decl) => {
            for decl in &using_decl.decls {
                add_pattern_bindings(bindings, &decl.name);
            }
        }
    }
}

fn add_pattern_bindings(bindings: &mut HashSet<String>, pattern: &Pat) {
    match pattern {
        Pat::Ident(BindingIdent { id, .. }) => {
            bindings.insert(id.sym.to_string());
        }
        Pat::Array(array_pattern) => {
            for element in array_pattern.elems.iter().flatten() {
                add_pattern_bindings(bindings, element);
            }
        }
        Pat::Object(object_pattern) => {
            for property in &object_pattern.props {
                match property {
                    ObjectPatProp::Assign(assign) => {
                        bindings.insert(assign.key.sym.to_string());
                    }
                    ObjectPatProp::KeyValue(key_value) => {
                        add_pattern_bindings(bindings, &key_value.value)
                    }
                    ObjectPatProp::Rest(rest) => add_pattern_bindings(bindings, &rest.arg),
                }
            }
        }
        Pat::Rest(rest_pattern) => add_pattern_bindings(bindings, &rest_pattern.arg),
        Pat::Assign(AssignPat { left, .. }) => add_pattern_bindings(bindings, left),
        Pat::Expr(_) | Pat::Invalid(_) => {}
    }
}

fn get_ts_entity_ident_name(type_name: &TsEntityName) -> Option<&str> {
    match type_name {
        TsEntityName::Ident(ident) => Some(ident.sym.as_ref()),
        TsEntityName::TsQualifiedName(_) => None,
    }
}

fn maybe_rewrite_jsx_host_name(
    name: &mut JSXElementName,
    errors: &mut Vec<UnsupportedPatternError>,
    cm: &Lrc<SourceMap>,
    options: &TransformPreviewSourceOptions,
) {
    let JSXElementName::Ident(ident) = name else {
        return;
    };

    let host_name = ident.sym.as_ref();
    if host_name.to_lowercase() != host_name {
        return;
    }

    if let Some(mapped_name) = supported_host_mapping(host_name) {
        *ident = Ident::new_no_ctxt(mapped_name.into(), ident.span);
        return;
    }

    let location = cm.lookup_char_pos(ident.span.lo());
    errors.push(UnsupportedPatternError {
        code: "UNSUPPORTED_HOST_ELEMENT".to_owned(),
        message: format!("Host element {host_name} is not supported by preview generation."),
        file: options.file_path.clone(),
        line: location.line as u32,
        column: (location.col_display + 1) as u32,
        symbol: Some(host_name.to_owned()),
        target: options.target.clone(),
    });
}

fn is_zero_arg_use_ref_call(call_expr: &CallExpr) -> bool {
    call_expr.args.is_empty()
        && matches!(
            (&call_expr.callee, &call_expr.type_args),
            (Callee::Expr(callee_expr), Some(type_args))
                if matches!(&**callee_expr, Expr::Member(member_expr) if member_expr.prop.is_ident_with("useRef"))
                    && type_args.params.len() == 1
        )
}

fn extract_isa_pattern(call_expr: &CallExpr) -> Option<(Box<Expr>, String, Span, String)> {
    let Callee::Expr(callee_expr) = &call_expr.callee else {
        return None;
    };
    let Expr::Member(member_expr) = &**callee_expr else {
        return None;
    };
    if !member_expr.prop.is_ident_with("IsA") {
        return None;
    }

    let [argument] = call_expr.args.as_slice() else {
        return None;
    };
    let Expr::Lit(Lit::Str(type_name)) = &*argument.expr else {
        return None;
    };

    Some((
        member_expr.obj.clone(),
        type_name.value.to_string_lossy().into_owned(),
        call_expr.span,
        "IsA".to_owned(),
    ))
}

fn create_is_preview_element_call(
    span: Span,
    ctxt: SyntaxContext,
    object_expr: Box<Expr>,
    type_name: &str,
) -> Expr {
    Expr::Call(CallExpr {
        span,
        ctxt,
        callee: Callee::Expr(Box::new(Expr::Ident(Ident::new_no_ctxt(
            "isPreviewElement".into(),
            DUMMY_SP,
        )))),
        args: vec![
            ExprOrSpread {
                spread: None,
                expr: object_expr,
            },
            ExprOrSpread {
                spread: None,
                expr: Box::new(Expr::Lit(Lit::Str(string_literal(type_name)))),
            },
        ],
        type_args: None,
    })
}

fn is_enum_member_chain(member_expr: &MemberExpr) -> bool {
    if matches!(member_expr.prop, MemberProp::Computed(_)) {
        return false;
    }

    match &*member_expr.obj {
        Expr::Ident(ident) => ident.sym == *"Enum",
        Expr::Member(parent) => is_enum_member_chain(parent),
        _ => false,
    }
}

fn resolve_enum_literal(member_expr: &MemberExpr) -> Option<String> {
    let mut segments = Vec::new();
    collect_member_chain_segments(member_expr, &mut segments)?;
    resolve_supported_enum_value(&segments.join(".")).map(ToOwned::to_owned)
}

fn collect_member_chain_segments(expr: &MemberExpr, segments: &mut Vec<String>) -> Option<()> {
    match &*expr.obj {
        Expr::Ident(ident) => segments.push(ident.sym.to_string()),
        Expr::Member(parent) => collect_member_chain_segments(parent, segments)?,
        _ => return None,
    }

    let MemberProp::Ident(prop) = &expr.prop else {
        return None;
    };
    segments.push(prop.sym.to_string());
    Some(())
}

fn resolve_relative_module_specifier(file_path: &str, module_specifier: &str) -> String {
    if !module_specifier.starts_with('.') || Path::new(module_specifier).extension().is_some() {
        return module_specifier.to_owned();
    }

    let current_file = path_from_string(file_path);
    let current_dir = current_file
        .parent()
        .map(normalize_path)
        .unwrap_or_else(|| PathBuf::from("."));
    let resolved_base = normalize_path(&current_dir.join(module_specifier));
    let candidates = [
        resolved_base.with_extension("ts"),
        resolved_base.with_extension("tsx"),
        resolved_base.join("index.ts"),
        resolved_base.join("index.tsx"),
    ];

    let Some(resolved_path) = candidates.into_iter().find(|candidate| {
        fs::metadata(candidate)
            .map(|metadata| metadata.is_file())
            .unwrap_or(false)
    }) else {
        return module_specifier.to_owned();
    };

    let Some(relative_path) = relative_path(&current_dir, &resolved_path) else {
        return module_specifier.to_owned();
    };

    if relative_path.starts_with('.') {
        relative_path
    } else {
        format!("./{relative_path}")
    }
}

fn path_from_string(value: &str) -> PathBuf {
    if value.is_empty() {
        PathBuf::from(".")
    } else {
        PathBuf::from(value)
    }
}

fn normalize_path(path: &Path) -> PathBuf {
    let mut normalized = PathBuf::new();
    for component in path.components() {
        match component {
            Component::CurDir => {}
            Component::ParentDir => {
                if !normalized.pop() {
                    normalized.push(component.as_os_str());
                }
            }
            Component::Normal(value) => normalized.push(value),
            Component::Prefix(prefix) => normalized.push(prefix.as_os_str()),
            Component::RootDir => normalized.push(component.as_os_str()),
        }
    }
    normalized
}

fn relative_path(from_dir: &Path, to_path: &Path) -> Option<String> {
    let from = normalize_path(from_dir);
    let to = normalize_path(to_path);
    let from_components = from.components().collect::<Vec<_>>();
    let to_components = to.components().collect::<Vec<_>>();

    let mut shared_length = 0usize;
    while shared_length < from_components.len()
        && shared_length < to_components.len()
        && from_components[shared_length] == to_components[shared_length]
    {
        shared_length += 1;
    }

    if shared_length == 0 && matches!(from_components.first(), Some(Component::Prefix(_))) {
        return None;
    }

    let mut parts = Vec::new();
    for component in &from_components[shared_length..] {
        if matches!(component, Component::Normal(_)) {
            parts.push("..".to_owned());
        }
    }

    for component in &to_components[shared_length..] {
        match component {
            Component::Normal(value) => parts.push(value.to_string_lossy().into_owned()),
            Component::CurDir => {}
            Component::ParentDir => parts.push("..".to_owned()),
            Component::RootDir | Component::Prefix(_) => return None,
        }
    }

    if parts.is_empty() {
        Some(".".to_owned())
    } else {
        Some(parts.join("/"))
    }
}

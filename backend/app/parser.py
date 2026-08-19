"""Tree-sitter based parsing: import extraction, function/class chunking,
and dependency-graph construction (NetworkX -> React Flow JSON schema)."""

import os
import networkx as nx
import tree_sitter_javascript as tsjavascript
import tree_sitter_python as tspython
import tree_sitter_typescript as tstypescript
from tree_sitter import Language, Parser

PY_LANGUAGE = Language(tspython.language())
JS_LANGUAGE = Language(tsjavascript.language())
TS_LANGUAGE = Language(tstypescript.language_typescript())

_PARSERS = {
    "python": Parser(PY_LANGUAGE),
    "javascript": Parser(JS_LANGUAGE),
    "typescript": Parser(TS_LANGUAGE),
}

EXTENSION_LANGUAGE = {
    ".py": "python",
    ".js": "javascript",
    ".ts": "typescript",
}

# Node types that resolve to a JS/TS module source path we should try to resolve
JS_MODULE_EXTENSIONS = [".js", ".ts", ".jsx", ".tsx"]

CHUNK_NODE_TYPES = {
    "python": {"function_definition", "class_definition"},
    "javascript": {"function_declaration", "class_declaration", "method_definition"},
    "typescript": {"function_declaration", "class_declaration", "method_definition", "interface_declaration"},
}

IGNORED_DIRS = {".git", "node_modules", "__pycache__", ".venv", "venv", "dist", "build"}

# Unresolved imports are collapsed into one node per ecosystem instead of one
# node per package, so a repo with 60 npm imports doesn't render 60 dashed
# boxes. JS and TS share a node since both resolve through npm.
EXTERNAL_GROUPS = {
    "python": ("external-group:python", "Python Dependencies"),
    "javascript": ("external-group:js", "JS / TS Dependencies"),
    "typescript": ("external-group:js", "JS / TS Dependencies"),
}

# Tree-sitter node type for a function/method call expression, per language.
CALL_NODE_TYPES = {
    "python": "call",
    "javascript": "call_expression",
    "typescript": "call_expression",
}


def _is_chunk_node(node, language: str) -> bool:
    if node.type in CHUNK_NODE_TYPES[language]:
        return True
    # `const foo = () => {}` / `const foo = function() {}` are the dominant
    # way functions are defined in modern JS/TS - plain node-type membership misses them.
    if language in ("javascript", "typescript") and node.type == "variable_declarator":
        value = node.child_by_field_name("value")
        return value is not None and value.type in ("arrow_function", "function_expression")
    return False


def _text(node, source: bytes) -> str:
    return source[node.start_byte:node.end_byte].decode("utf8", errors="replace")


# ---------------------------------------------------------------------------
# Import extraction
# ---------------------------------------------------------------------------

def _extract_python_imports(root, source: bytes) -> list[str]:
    """Returns raw import strings. Relative imports keep their leading dots
    (e.g. '.utils', '..pkg') so the resolver can walk directories correctly."""
    imports = []

    def visit(node):
        if node.type == "import_statement":
            name_node = node.child_by_field_name("name")
            if name_node is not None:
                if name_node.type == "dotted_name":
                    imports.append(_text(name_node, source))
                elif name_node.type == "aliased_import":
                    dotted = name_node.child_by_field_name("name")
                    if dotted is not None:
                        imports.append(_text(dotted, source))
        elif node.type == "import_from_statement":
            module_node = node.child_by_field_name("module_name")
            if module_node is not None:
                if module_node.type == "dotted_name":
                    imports.append(_text(module_node, source))
                elif module_node.type == "relative_import":
                    has_submodule = any(c.type == "dotted_name" for c in module_node.children)
                    if has_submodule:
                        # from .utils import helper -> edge targets the utils module
                        imports.append(_text(module_node, source))
                    else:
                        # from . import parser, other -> each name is a sibling module
                        dots = _text(module_node, source)
                        for name_node in node.children_by_field_name("name"):
                            if name_node.type == "dotted_name":
                                imports.append(dots + _text(name_node, source))
                            elif name_node.type == "aliased_import":
                                dotted = name_node.child_by_field_name("name")
                                if dotted is not None:
                                    imports.append(dots + _text(dotted, source))
        for child in node.children:
            visit(child)

    visit(root)
    return imports


def _extract_js_imports(root, source: bytes) -> list[str]:
    imports = []

    def visit(node):
        if node.type == "import_statement":
            source_node = node.child_by_field_name("source")
            if source_node is not None:
                imports.append(_text(source_node, source).strip("'\"`"))
        for child in node.children:
            visit(child)

    visit(root)
    return imports


def extract_imports(language: str, source: bytes) -> list[str]:
    """Parses `source` and returns the raw list of imported module/path strings."""
    tree = _PARSERS[language].parse(source)
    if language == "python":
        return _extract_python_imports(tree.root_node, source)
    return _extract_js_imports(tree.root_node, source)


# ---------------------------------------------------------------------------
# Function / class boundary extraction
# ---------------------------------------------------------------------------

def _chunk_name(node, source: bytes) -> str:
    name_node = node.child_by_field_name("name")
    if name_node is not None:
        return _text(name_node, source)
    return "<anonymous>"


def extract_chunks(language: str, source: bytes, file_path: str, module_name: str) -> list[dict]:
    """Walks the AST (not naive line-splitting) to find function/class boundaries.

    Returns a list of {file_path, start_line, end_line, name, source} dicts,
    one per function/class definition, with nested defs (methods, closures)
    given dotted qualified names.
    """
    tree = _PARSERS[language].parse(source)
    chunks = []

    def visit(node, scope: list[str]):
        for child in node.children:
            if _is_chunk_node(child, language):
                name = _chunk_name(child, source)
                qualified_name = ".".join([module_name] + scope + [name])
                chunks.append({
                    "file_path": file_path,
                    "start_line": child.start_point[0] + 1,
                    "end_line": child.end_point[0] + 1,
                    "name": qualified_name,
                    "source": _text(child, source),
                })
                visit(child, scope + [name])
            else:
                visit(child, scope)

    visit(tree.root_node, [])
    return chunks


def _extract_called_names(language: str, source: bytes) -> set[str]:
    """Returns the short (unqualified) name of every function/method called in
    `source` - e.g. both `foo()` and `self.foo()` contribute "foo". Used as a
    best-effort heuristic to link import edges to the specific functions they're
    actually used for; it's name-matching, not full scope resolution, so it can
    both miss calls (aliased imports) and over-match (two files that each
    happen to define a same-named function)."""
    tree = _PARSERS[language].parse(source)
    call_type = CALL_NODE_TYPES[language]
    names = set()

    def visit(node):
        if node.type == call_type:
            func = node.child_by_field_name("function")
            if func is not None:
                if func.type in ("identifier", "property_identifier"):
                    names.add(_text(func, source))
                elif func.type in ("attribute", "member_expression"):
                    attr = func.child_by_field_name("attribute") or func.child_by_field_name("property")
                    if attr is not None:
                        names.add(_text(attr, source))
        for child in node.children:
            visit(child)

    visit(tree.root_node)
    return names


# ---------------------------------------------------------------------------
# Import resolution: raw import string -> repo-relative file-node id
# ---------------------------------------------------------------------------

def _resolve_python_import(imp: str, source_rel_id: str, all_ids: set[str]) -> str | None:
    dots = 0
    while dots < len(imp) and imp[dots] == ".":
        dots += 1
    remainder = imp[dots:]
    parts = remainder.split(".") if remainder else []
    module_path = "/".join(parts)

    if dots == 0:
        # Absolute import: try from repo root.
        base_dirs = [""]
    else:
        # Relative import: level 1 ('.') means the current package (the
        # importing file's own directory); each extra dot climbs one more.
        source_dir = os.path.dirname(source_rel_id)
        parts_up = source_dir.split("/") if source_dir else []
        climb = dots - 1
        if climb:
            parts_up = parts_up[:-climb] if climb <= len(parts_up) else []
        base_dirs = ["/".join(parts_up)]

    for base in base_dirs:
        candidate_file = f"{base}/{module_path}.py" if base else f"{module_path}.py"
        candidate_pkg = f"{base}/{module_path}/__init__.py" if base else f"{module_path}/__init__.py"
        for candidate in (candidate_file, candidate_pkg):
            normalized = os.path.normpath(candidate).replace(os.sep, "/")
            if normalized in all_ids:
                return normalized
    return None


def _resolve_js_import(imp: str, source_rel_id: str, all_ids: set[str]) -> str | None:
    if not (imp.startswith(".") or imp.startswith("/")):
        return None  # bare package import (npm module) -> external

    source_dir = os.path.dirname(source_rel_id)
    base = os.path.normpath(os.path.join(source_dir, imp)).replace(os.sep, "/")

    candidates = [base]
    for ext in JS_MODULE_EXTENSIONS:
        candidates.append(base + ext)
        candidates.append(f"{base}/index{ext}")

    for candidate in candidates:
        if candidate in all_ids:
            return candidate
    return None


def resolve_import(language: str, imp: str, source_rel_id: str, all_ids: set[str]) -> str | None:
    """Resolves a raw import string to a repo-relative node id, or None if it
    points outside the repo (stdlib/external package)."""
    if language == "python":
        return _resolve_python_import(imp, source_rel_id, all_ids)
    return _resolve_js_import(imp, source_rel_id, all_ids)


# ---------------------------------------------------------------------------
# Graph construction
# ---------------------------------------------------------------------------

def build_dependency_graph(repo_path: str) -> dict:
    """Walks `repo_path`, parses every .py/.js/.ts file, and builds a
    dependency graph (NetworkX DiGraph internally) exported to the
    React Flow JSON schema: {nodes: [{id, position, data}], edges: [{id, source, target, type}]}.
    """
    graph = nx.DiGraph()
    files: dict[str, dict] = {}

    for root, dirs, filenames in os.walk(repo_path):
        dirs[:] = [d for d in dirs if d not in IGNORED_DIRS]
        for filename in filenames:
            ext = os.path.splitext(filename)[1]
            language = EXTENSION_LANGUAGE.get(ext)
            if language is None:
                continue

            abs_path = os.path.join(root, filename)
            rel_id = os.path.relpath(abs_path, repo_path).replace(os.sep, "/")
            module_name = rel_id[: -len(ext)].replace("/", ".")

            with open(abs_path, "rb") as f:
                source = f.read()

            chunks = extract_chunks(language, source, rel_id, module_name)
            called_names: set[str] = set()
            for chunk in chunks:
                called_names |= _extract_called_names(language, chunk["source"].encode("utf8"))

            graph.add_node(
                rel_id,
                label=filename,
                type="file",
                language=language,
                folder=os.path.dirname(rel_id),
                code=source.decode("utf8", errors="replace"),
                chunks=chunks,
            )
            files[rel_id] = {
                "language": language,
                "source": source,
                "chunks": chunks,
                "called_names": called_names,
            }

    all_ids = set(files.keys())

    for rel_id, info in files.items():
        imports = extract_imports(info["language"], info["source"])
        for imp in imports:
            target_id = resolve_import(info["language"], imp, rel_id, all_ids)

            if target_id is not None:
                if not graph.has_edge(rel_id, target_id):
                    graph.add_edge(rel_id, target_id, id=f"edge-{rel_id}-to-{target_id}", type="imports")
                continue

            # Unresolved: route to this file's ecosystem group node instead of
            # creating a one-off node per package.
            group_id, group_label = EXTERNAL_GROUPS[info["language"]]
            if not graph.has_node(group_id):
                graph.add_node(
                    group_id, label=group_label, type="external-group", language=None, code=None,
                    dependencies=set(),
                )
            graph.nodes[group_id]["dependencies"].add(imp)

            if graph.has_edge(rel_id, group_id):
                graph.edges[rel_id, group_id]["packages"].add(imp)
            else:
                graph.add_edge(
                    rel_id, group_id, id=f"edge-{rel_id}-to-{group_id}", type="imports-external",
                    packages={imp},
                )

    # Second pass: for each resolved file->file import edge, narrow it down to
    # the specific functions actually called across that edge (best-effort
    # name matching - see _extract_called_names).
    for rel_id, info in files.items():
        for target_id in list(graph.successors(rel_id)):
            edge_data = graph.edges[rel_id, target_id]
            if edge_data.get("type") != "imports":
                continue
            target_info = files.get(target_id)
            if target_info is None:
                continue
            target_short_names = {c["name"].split(".")[-1] for c in target_info["chunks"]}
            matched = info["called_names"] & target_short_names
            if matched:
                edge_data["calls"] = matched

    return _export_graph(graph)


def _export_graph(graph: nx.DiGraph) -> dict:
    nodes = []
    for node_id, data in graph.nodes(data=True):
        clean = dict(data)
        if isinstance(clean.get("dependencies"), set):
            clean["dependencies"] = sorted(clean["dependencies"])
        nodes.append({"id": node_id, "position": {"x": 0, "y": 0}, "data": clean})

    edges = []
    for u, v, data in graph.edges(data=True):
        clean = dict(data)
        if isinstance(clean.get("packages"), set):
            clean["packages"] = sorted(clean["packages"])
        if isinstance(clean.get("calls"), set):
            clean["calls"] = sorted(clean["calls"])
        edge_id = clean.pop("id")
        edge_type = clean.pop("type")
        edges.append({"id": edge_id, "source": u, "target": v, "type": edge_type, **clean})

    return {"nodes": nodes, "edges": edges}

import tree_sitter_python as tspython
from tree_sitter import Language, Parser

# Initialize the Python language grammar
PY_LANGUAGE = Language(tspython.language())
parser = Parser()
parser.language = PY_LANGUAGE

# This query finds both 'import x' and 'from x import y' statements in the AST
PYTHON_IMPORT_QUERY = PY_LANGUAGE.query("""
    (import_statement name: (dotted_name) @import_name)
    (import_from_statement module_name: (dotted_name) @module_name)
""")

def extract_python_imports(file_path: str) -> list[str]:
    """Reads a Python file, generates an AST, and extracts outgoing edges (imports)."""
    with open(file_path, "rb") as f:
        code = f.read()

    # Build the Abstract Syntax Tree
    tree = parser.parse(code)
    
    # Query the AST for the import statements
    captures = PYTHON_IMPORT_QUERY.captures(tree.root_node)
    
    edges = []
    for node, capture_name in captures:
        # node.text gives us the raw byte string of the imported module
        imported_module = node.text.decode("utf8")
        edges.append(imported_module)
        
    return edges

import os

def build_dependency_graph(repo_path: str):
    nodes = []
    edges = []
    
    for root, _, files in os.walk(repo_path):
        for file in files:
            if file.endswith(".py"):
                file_path = os.path.join(root, file)
                # Calculate a relative path to use as a unique Node ID
                relative_id = os.path.relpath(file_path, repo_path)
                
                # 1. Add the Node
                nodes.append({
                    "id": relative_id,
                    "position": {"x": 0, "y": 0},
                    "data": {"label": file, "type": "file", "language": "python"}
                })
                
                # 2. Extract and Add the Edges
                imports = extract_python_imports(file_path)
                for imp in imports:
                    edges.append({
                        "id": f"edge-{relative_id}-to-{imp}",
                        "source": relative_id,
                        "target": imp, # Note: Resolving this to an exact file path is a future step!
                        "type": "imports"
                    })
                    
    return {"nodes": nodes, "edges": edges}
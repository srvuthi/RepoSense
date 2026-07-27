"""Local embeddings (sentence-transformers) + Chroma vector store for RAG chunk retrieval.

One persistent Chroma collection holds chunks from every analyzed repo; every
write and read is scoped by a `job_id` metadata filter so different repos'
chunks never bleed into each other's search results.
"""

import os
import chromadb
from sentence_transformers import SentenceTransformer

CHROMA_PATH = os.path.join(os.path.dirname(__file__), "..", "chroma_data")
COLLECTION_NAME = "repo_chunks"

_model: SentenceTransformer | None = None
_client: chromadb.ClientAPI | None = None
_collection = None


def _get_model() -> SentenceTransformer:
    global _model
    if _model is None:
        _model = SentenceTransformer("all-MiniLM-L6-v2")
    return _model


def _get_collection():
    global _client, _collection
    if _collection is None:
        _client = chromadb.PersistentClient(path=CHROMA_PATH)
        _collection = _client.get_or_create_collection(COLLECTION_NAME)
    return _collection


def embed_and_store_chunks(job_id: str, nodes: list[dict]) -> int:
    """Embeds every function/class chunk (not whole files) from a parsed
    repo's file nodes and stores them in Chroma tagged with `job_id`.

    Returns the number of chunks stored.
    """
    ids, documents, metadatas = [], [], []

    for node in nodes:
        data = node.get("data", {})
        if data.get("type") != "file":
            continue
        for i, chunk in enumerate(data.get("chunks") or []):
            ids.append(f"{job_id}::{node['id']}::{i}")
            documents.append(chunk["source"])
            metadatas.append({
                "job_id": job_id,
                "file_path": chunk["file_path"],
                "start_line": chunk["start_line"],
                "end_line": chunk["end_line"],
                "name": chunk["name"],
            })

    if not documents:
        return 0

    embeddings = _get_model().encode(documents, show_progress_bar=False).tolist()
    _get_collection().add(ids=ids, embeddings=embeddings, documents=documents, metadatas=metadatas)
    return len(documents)


def retrieve_chunks(job_id: str, query: str, top_k: int = 5, scope: str | None = None) -> list[dict]:
    """Returns up to `top_k` chunks from `job_id`'s repo most relevant to `query`.

    If `scope` is given (a file_path), results are restricted to chunks from
    that file only.
    """
    where = {"job_id": job_id} if not scope else {"$and": [{"job_id": job_id}, {"file_path": scope}]}
    query_embedding = _get_model().encode([query]).tolist()[0]

    results = _get_collection().query(
        query_embeddings=[query_embedding],
        n_results=top_k,
        where=where,
    )

    if not results["documents"] or not results["documents"][0]:
        return []

    return [
        {
            "source": doc,
            "file_path": meta["file_path"],
            "start_line": meta["start_line"],
            "end_line": meta["end_line"],
            "name": meta["name"],
            "distance": dist,
        }
        for doc, meta, dist in zip(
            results["documents"][0], results["metadatas"][0], results["distances"][0]
        )
    ]

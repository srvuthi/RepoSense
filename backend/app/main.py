import os
import re
import uuid
import shutil
import requests
import git
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, field_validator
from dotenv import load_dotenv
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded

from app.parser import build_dependency_graph
from app.vectorstore import embed_and_store_chunks, retrieve_chunks
from app.llm import generate_answer
from app.citations import validate_citations

# Load environment variables (.env)
load_dotenv()

app = FastAPI()

# Simple in-memory per-IP rate limiting - no Redis/external deps needed for MVP scale.
limiter = Limiter(key_func=get_remote_address)
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

# Configure CORS so the frontend can communicate with this API.
# In production, set FRONTEND_ORIGIN to the exact deployed frontend URL
# (e.g. https://reposense.vercel.app) so only that origin is allowed.
# Locally, Vite picks the next free port (5173, 5174, ...) if the default is
# taken, so we match any localhost port instead of hardcoding one.
FRONTEND_ORIGIN = os.getenv("FRONTEND_ORIGIN")

if FRONTEND_ORIGIN:
    app.add_middleware(
        CORSMiddleware,
        allow_origins=[FRONTEND_ORIGIN],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
else:
    app.add_middleware(
        CORSMiddleware,
        allow_origin_regex=r"http://(localhost|127\.0\.0\.1):\d+",
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

MAX_SIZE_KB = 100 * 1024  # 100MB cap in kilobytes

class RepoRequest(BaseModel):
    repo_url: str

    @field_validator('repo_url')
    def validate_github_url(cls, v):
        # Enforce strictly github.com URLs. This automatically rejects file:// or internal IPs.
        github_regex = r"^https://github\.com/([\w-]+)/([\w.-]+)/?$"
        if not re.match(github_regex, v):
            raise ValueError("Invalid URL. Must be a public https://github.com/owner/repo URL.")
        return v

def check_repo_size_via_api(repo_url: str):
    """Checks GitHub API for repo size BEFORE cloning to enforce the size cap."""
    parts = repo_url.rstrip('/').split('/')
    owner, repo = parts[-2], parts[-1].replace('.git', '')
    
    api_url = f"https://api.github.com/repos/{owner}/{repo}"
    
    # We do not use auth here. If a repo requires auth, it's private and fails the MVP scope.
    response = requests.get(api_url)
    
    if response.status_code == 404:
        raise HTTPException(status_code=400, detail="Repository not found or is private.")
    elif response.status_code != 200:
        raise HTTPException(status_code=400, detail=f"GitHub API error: {response.text}")
        
    repo_data = response.json()
    size_kb = repo_data.get("size", 0)
    
    if size_kb > MAX_SIZE_KB:
        raise HTTPException(
            status_code=413, 
            detail=f"Repository exceeds the {MAX_SIZE_KB // 1024}MB limit. (Size: {size_kb/1024:.2f} MB)"
        )
    
    return True

@app.post("/analyze")
@limiter.limit("10/minute")
async def analyze_repository(request: Request, body: RepoRequest):
    # 1. Size cap check BEFORE anything touches the disk
    check_repo_size_via_api(body.repo_url)

    # 2. Setup per-job UUID temporary directory
    job_id = uuid.uuid4().hex
    target_dir = os.path.abspath(f"./temp_repos/{job_id}")

    try:
        # 3. Shallow clone via GitPython (depth=1)
        git.Repo.clone_from(body.repo_url, target_dir, depth=1)

        # 4. Parse the repo (tree-sitter) and build the dependency graph
        graph = build_dependency_graph(target_dir)

        # 5. Embed every function/class chunk and store it in Chroma for RAG chat
        embed_and_store_chunks(job_id, graph["nodes"])

        return {
            "status": "success",
            "job_id": job_id,
            "nodes": graph["nodes"],
            "edges": graph["edges"],
        }

    except git.exc.GitCommandError as e:
        raise HTTPException(status_code=500, detail=f"Git clone failed: {str(e)}")
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"An unexpected error occurred: {str(e)}")
        
    finally:
        # 4. Cleanup to prevent server storage bloat
        # Note: If you want to physically inspect the cloned files during your tests,
        # you can temporarily comment these two lines out.
        if os.path.exists(target_dir):
            shutil.rmtree(target_dir)


class ChatRequest(BaseModel):
    job_id: str
    message: str
    scope: str | None = None  # optional file_path to restrict retrieval to


@app.post("/chat")
@limiter.limit("15/minute")
async def chat(request: Request, body: ChatRequest):
    chunks = retrieve_chunks(body.job_id, body.message, top_k=5, scope=body.scope)

    if not chunks:
        return {
            "answer": "I couldn't find any relevant code for that question in this repo.",
            "citations": [],
            "unverified_citations": [],
            "chunks_used": [],
        }

    try:
        raw_answer = generate_answer(body.message, chunks)
    except RuntimeError as e:
        raise HTTPException(status_code=500, detail=str(e))

    answer, verified, unverified = validate_citations(raw_answer, chunks)

    return {
        "answer": answer,
        "citations": verified,
        "unverified_citations": unverified,
        "chunks_used": [
            {
                "file_path": c["file_path"],
                "start_line": c["start_line"],
                "end_line": c["end_line"],
                "name": c["name"],
            }
            for c in chunks
        ],
    }
import os
import re
import uuid
import shutil
import requests
import git
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, field_validator
from dotenv import load_dotenv

# Load environment variables (.env)
load_dotenv()

app = FastAPI()

# Configure CORS so your Vite frontend can communicate with this API
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"], 
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

MAX_SIZE_KB = 5 * 1024  # 5MB cap in kilobytes

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
    """Checks GitHub API for repo size BEFORE cloning to enforce 5MB cap."""
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
            detail=f"Repository exceeds the 5MB limit. (Size: {size_kb/1024:.2f} MB)"
        )
    
    return True

@app.post("/analyze")
async def analyze_repository(request: RepoRequest):
    # 1. Size cap check BEFORE anything touches the disk
    check_repo_size_via_api(request.repo_url)
    
    # 2. Setup per-job UUID temporary directory
    job_id = uuid.uuid4().hex
    target_dir = os.path.abspath(f"./temp_repos/{job_id}")
    
    try:
        # 3. Shallow clone via GitPython (depth=1)
        git.Repo.clone_from(request.repo_url, target_dir, depth=1)
        
        # ==========================================
        # NEXT ROADMAP STEP: TREE-SITTER PARSING
        # Once we integrate tree-sitter, the logic to 
        # extract imports and build the graph goes here.
        # ==========================================
        
        return {
            "status": "success", 
            "job_id": job_id,
            "message": f"Successfully validated and cloned into {job_id}."
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
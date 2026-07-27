"""Validates LLM-produced file:line citations against the chunks that were
actually retrieved for the query, so a hallucinated citation never reaches
the user looking like a verified one."""

import re

# Matches `path/to/file.py:12` or `path/to/file.py:12-18`. Requiring a
# .py/.js/.ts extension right before the colon keeps this from matching
# unrelated colon-separated text (timestamps, URLs, etc).
CITATION_PATTERN = re.compile(r"([\w./\-]+\.(?:py|js|ts)):(\d+)(?:-(\d+))?")


def _overlaps(cited_start: int, cited_end: int, chunk: dict) -> bool:
    return chunk["file_path"] and not (cited_end < chunk["start_line"] or cited_start > chunk["end_line"])


def validate_citations(answer: str, chunks: list[dict]) -> tuple[str, list[dict], list[dict]]:
    """Returns (cleaned_answer, verified_citations, unverified_citations).

    Any citation whose file_path:line doesn't overlap a retrieved chunk's
    actual range is stripped from the answer text and reported separately.
    """
    verified: list[dict] = []
    unverified: list[dict] = []
    seen = set()

    def replace(match: re.Match) -> str:
        file_path, start_str, end_str = match.group(1), match.group(2), match.group(3)
        start = int(start_str)
        end = int(end_str) if end_str else start

        is_valid = any(c["file_path"] == file_path and _overlaps(start, end, c) for c in chunks)
        key = (file_path, start, end)

        if is_valid:
            if key not in seen:
                seen.add(key)
                verified.append({"file_path": file_path, "start_line": start, "end_line": end})
            return match.group(0)

        if key not in seen:
            seen.add(key)
            unverified.append({"file_path": file_path, "start_line": start, "end_line": end})
        return "[unverified citation removed]"

    cleaned = CITATION_PATTERN.sub(replace, answer)
    return cleaned, verified, unverified

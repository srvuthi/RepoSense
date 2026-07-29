// Falls back to localhost for local dev; set VITE_API_BASE_URL in production
// (see .env.example) to point at the deployed backend instead.
export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8000';

// Backend error bodies aren't all shaped the same way:
// - our own HTTPExceptions:        {"detail": "some string"}
// - Pydantic validation errors:    {"detail": [{"msg": "...", ...}, ...]}
// - slowapi rate-limit responses:  {"error": "Rate limit exceeded: 10 per 1 minute"}
// Normalize all three into one readable message instead of leaking "[object Object]"
// or a bare status code to the user.
export const extractErrorMessage = (body: unknown, status: number): string => {
  if (body && typeof body === 'object') {
    if ('detail' in body) {
      const detail = (body as { detail: unknown }).detail;
      if (typeof detail === 'string') return detail;
      if (Array.isArray(detail)) {
        return detail
          .map((d) => (d && typeof d === 'object' && 'msg' in d ? String((d as { msg: unknown }).msg) : String(d)))
          .join(' ')
          .replace(/^Value error,\s*/, '');
      }
    }
    if ('error' in body && typeof (body as { error: unknown }).error === 'string') {
      return (body as { error: string }).error;
    }
  }
  return `HTTP error! status: ${status}`;
};

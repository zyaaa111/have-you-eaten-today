const DEFAULT_API_BASE = "/api";

export function getApiBaseUrl(envValue = process.env.NEXT_PUBLIC_API_BASE_URL): string {
  const trimmed = envValue?.trim();
  if (!trimmed) {
    return DEFAULT_API_BASE;
  }
  return trimmed.replace(/\/+$/, "") || DEFAULT_API_BASE;
}

export function buildApiUrl(path: string, envValue = process.env.NEXT_PUBLIC_API_BASE_URL): string {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${getApiBaseUrl(envValue)}${normalizedPath}`;
}

/** Normalizes a filesystem path to a leading-slash form for URI building. */
function normalizeFsPath(path: string): string {
  let normalized = path.replace(/\\/g, "/");
  if (/^[a-zA-Z]:/.test(normalized)) {
    normalized = `/${normalized}`;
  }
  if (!normalized.startsWith("/")) {
    normalized = `/${normalized}`;
  }
  return normalized;
}

/**
 * Builds a VS Code deep link for a source location, or `null` when the URI is
 * not a resolvable filesystem path (e.g. a `package:` URI).
 */
export function toEditorUrl(sourceUri?: string, line?: number): string | null {
  if (!sourceUri) return null;

  let raw: string;
  if (sourceUri.startsWith("file://")) {
    try {
      raw = decodeURIComponent(new URL(sourceUri).pathname);
    } catch {
      return null;
    }
  } else if (sourceUri.startsWith("/") || /^[a-zA-Z]:[\\/]/.test(sourceUri)) {
    raw = sourceUri;
  } else {
    return null;
  }

  const path = normalizeFsPath(raw);
  const suffix = line && line > 0 ? `:${line}` : "";
  return `vscode://file${path}${suffix}`;
}

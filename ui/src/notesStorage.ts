export function readNotesPref(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function writeNotesPref(key: string, value: string, privateMode = false): void {
  if (privateMode) return;
  try {
    localStorage.setItem(key, value);
  } catch {
    // Storage quota or restricted context
  }
}

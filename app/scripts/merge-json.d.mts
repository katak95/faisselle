export function mergeObjects(base: Record<string, unknown>, ours: Record<string, unknown>, theirs: Record<string, unknown>): { merged: Record<string, unknown>; kept: string[] }

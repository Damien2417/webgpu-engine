export type BackendAssetKind = 'texture' | 'model';

export interface BackendAssetRecord {
  id: string;
  name: string;
  kind: BackendAssetKind;
  mime: string;
  filename: string;
  createdAt: string;
}

export async function listBackendAssets(): Promise<BackendAssetRecord[]> {
  const res = await fetch('/api/assets');
  if (!res.ok) throw new Error('Failed to list backend assets');
  return (await res.json()) as BackendAssetRecord[];
}

export async function uploadBackendAsset(
  name: string,
  kind: BackendAssetKind,
  dataUrl: string,
): Promise<BackendAssetRecord> {
  const res = await fetch('/api/assets', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, kind, dataUrl }),
  });
  if (!res.ok) throw new Error('Failed to upload backend asset');
  return (await res.json()) as BackendAssetRecord;
}

export async function deleteBackendAsset(id: string): Promise<void> {
  const res = await fetch(`/api/assets/${id}`, { method: 'DELETE' });
  if (!res.ok) throw new Error('Failed to delete backend asset');
}

export function backendAssetContentUrl(id: string): string {
  return `/api/assets/${id}/content`;
}


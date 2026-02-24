export interface ParsedMesh {
  vertices: Float32Array; // 15 floats/vertex
  indices:  Uint32Array;
}

export function parseObj(text: string): ParsedMesh {
  const positions: [number,number,number][] = [];
  const normals:   [number,number,number][] = [];
  const uvs:       [number,number][]        = [];

  const vertData: number[] = [];
  const idxData:  number[] = [];
  const vmap = new Map<string, number>();

  const addVertex = (key: string, vi: number, ti: number, ni: number): number => {
    if (vmap.has(key)) return vmap.get(key)!;
    const p = positions[vi] ?? [0,0,0];
    const u = uvs[ti]       ?? [0,0];
    const n = normals[ni]   ?? [0,1,0];
    const idx = vertData.length / 15;
    vertData.push(p[0],p[1],p[2], 1,1,1, u[0],1-u[1], n[0],n[1],n[2], 1,0,0,1);
    vmap.set(key, idx);
    return idx;
  };

  for (const rawLine of text.split('\n')) {
    const line  = rawLine.trim();
    const parts = line.split(/\s+/);
    if (parts[0] === 'v')  positions.push([+parts[1],+parts[2],+parts[3]]);
    else if (parts[0] === 'vn') normals.push([+parts[1],+parts[2],+parts[3]]);
    else if (parts[0] === 'vt') uvs.push([+parts[1],+parts[2]]);
    else if (parts[0] === 'f') {
      const face: number[] = [];
      for (const tok of parts.slice(1)) {
        const segs = tok.split('/');
        const vi = parseInt(segs[0]) - 1;
        const ti = segs[1] ? parseInt(segs[1]) - 1 : -1;
        const ni = segs[2] ? parseInt(segs[2]) - 1 : -1;
        face.push(addVertex(tok, vi, ti, ni));
      }
      // Fan triangulation
      for (let i = 1; i < face.length - 1; i++) {
        idxData.push(face[0], face[i], face[i+1]);
      }
    }
  }

  return { vertices: new Float32Array(vertData), indices: new Uint32Array(idxData) };
}

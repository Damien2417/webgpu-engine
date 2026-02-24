import type { ParsedMesh } from './parseObj';

export async function parseGlb(buffer: ArrayBuffer): Promise<ParsedMesh> {
  const view   = new DataView(buffer);
  const magic  = view.getUint32(0, true);
  if (magic !== 0x46546C67) throw new Error('Not a GLB file (wrong magic)');

  const jsonLen  = view.getUint32(12, true);
  const jsonText = new TextDecoder().decode(buffer.slice(20, 20 + jsonLen));
  const gltf     = JSON.parse(jsonText);

  const binStart = 20 + jsonLen + 8; // skip BIN chunk header (8 bytes)
  const bin      = buffer.slice(binStart);

  const typeStride = (type: string): number =>
    ({ SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT2: 4, MAT3: 9, MAT4: 16 } as Record<string, number>)[type] ?? 1;

  const getAccessorData = (accIdx: number): Float32Array | Uint16Array | Uint32Array => {
    const acc   = gltf.accessors[accIdx];
    const bv    = gltf.bufferViews[acc.bufferView];
    const start = (bv.byteOffset ?? 0) + (acc.byteOffset ?? 0);
    const count = acc.count * typeStride(acc.type);
    const componentType: number = acc.componentType;
    if (componentType === 5126) return new Float32Array(bin, start, count);
    if (componentType === 5123) return new Uint16Array(bin, start, acc.count);
    if (componentType === 5125) return new Uint32Array(bin, start, acc.count);
    throw new Error('Unsupported componentType: ' + componentType);
  };

  // Use first mesh, first primitive
  const prim = gltf.meshes[0].primitives[0];
  const pos  = getAccessorData(prim.attributes.POSITION)   as Float32Array;
  const nor  = prim.attributes.NORMAL     != null ? getAccessorData(prim.attributes.NORMAL)       as Float32Array : null;
  const uv   = prim.attributes.TEXCOORD_0 != null ? getAccessorData(prim.attributes.TEXCOORD_0)   as Float32Array : null;
  const rawIdx = getAccessorData(prim.indices);
  const indices = new Uint32Array(rawIdx.length);
  for (let i = 0; i < rawIdx.length; i++) indices[i] = rawIdx[i];

  const vcount = pos.length / 3;
  const vdata  = new Float32Array(vcount * 15);
  for (let i = 0; i < vcount; i++) {
    const o = i * 15;
    vdata[o]   = pos[i*3];   vdata[o+1] = pos[i*3+1]; vdata[o+2] = pos[i*3+2];
    vdata[o+3] = 1; vdata[o+4] = 1; vdata[o+5] = 1;
    vdata[o+6] = uv ? uv[i*2] : 0;
    vdata[o+7] = uv ? 1 - uv[i*2+1] : 0;
    vdata[o+8]  = nor ? nor[i*3]   : 0;
    vdata[o+9]  = nor ? nor[i*3+1] : 1;
    vdata[o+10] = nor ? nor[i*3+2] : 0;
    vdata[o+11] = 1; vdata[o+12] = 0; vdata[o+13] = 0; vdata[o+14] = 1;
  }

  return { vertices: vdata, indices };
}

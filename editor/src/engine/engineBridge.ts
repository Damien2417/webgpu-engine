import init, { World } from '../../../engine-core/pkg/engine_core.js';
import type { EntityId, Transform } from './types';

class EngineBridge {
  private world: World | null = null;
  private rafId: number | null = null;

  async initialize(canvas: HTMLCanvasElement): Promise<void> {
    await init();
    this.world = await World.new(canvas);
  }

  get isReady(): boolean { return this.world !== null; }

  // ── Entités ─────────────────────────────────────────────────────────────────

  createEntity(name?: string): EntityId {
    if (!this.world) throw new Error('Bridge not initialized');
    const id = this.world.create_entity();
    this.world.add_transform(id, 0, 0, 0);
    if (name) this.world.set_entity_name(id, name);
    return id;
  }

  removeEntity(id: EntityId): void {
    this.world?.remove_entity(id);
  }

  getEntityIds(): EntityId[] {
    if (!this.world) return [];
    return Array.from(this.world.get_entity_ids());
  }

  getEntityName(id: EntityId): string {
    return this.world?.get_entity_name(id) ?? `Entity ${id}`;
  }

  setEntityName(id: EntityId, name: string): void {
    this.world?.set_entity_name(id, name);
  }

  addMeshRenderer(id: EntityId): void {
    this.world?.add_mesh_renderer(id);
  }

  // ── Transform ───────────────────────────────────────────────────────────────

  getTransform(id: EntityId): Transform {
    if (!this.world) return { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] };
    const a = this.world.get_transform_array(id);
    return {
      position: [a[0], a[1], a[2]],
      rotation: [a[3], a[4], a[5]],
      scale:    [a[6], a[7], a[8]],
    };
  }

  setPosition(id: EntityId, x: number, y: number, z: number): void {
    this.world?.set_position(id, x, y, z);
  }

  setRotation(id: EntityId, x: number, y: number, z: number): void {
    this.world?.set_rotation(id, x, y, z);
  }

  setScale(id: EntityId, x: number, y: number, z: number): void {
    this.world?.set_scale(id, x, y, z);
  }

  // ── Caméra ──────────────────────────────────────────────────────────────────

  setCamera(ex: number, ey: number, ez: number, tx: number, ty: number, tz: number): void {
    this.world?.set_camera(ex, ey, ez, tx, ty, tz);
  }

  getViewProj(): Float32Array {
    if (!this.world) return new Float32Array(16);
    return this.world.get_view_proj();
  }

  // ── Textures / Matériaux ────────────────────────────────────────────────────

  uploadTexture(width: number, height: number, data: Uint8ClampedArray, mipmaps = true): number {
    return this.world?.upload_texture(width, height, new Uint8Array(data.buffer), mipmaps) ?? -1;
  }

  addMaterial(entityId: EntityId, texId: number): void {
    this.world?.add_material(entityId, texId);
  }

  // ── Matériaux PBR ────────────────────────────────────────────────────────────

  addPbrMaterial(entityId: EntityId, texId: number, metallic: number, roughness: number): void {
    this.world?.add_pbr_material(entityId, texId, metallic, roughness);
  }

  setEmissive(entityId: EntityId, r: number, g: number, b: number): void {
    this.world?.set_emissive(entityId, r, g, b);
  }

  // ── Mesh type ────────────────────────────────────────────────────────────────

  setMeshType(entityId: EntityId, meshType: 'cube' | 'plane'): void {
    this.world?.set_mesh_type(entityId, meshType);
  }

  getMeshType(entityId: EntityId): 'cube' | 'plane' {
    return (this.world?.get_mesh_type(entityId) as 'cube' | 'plane') ?? 'cube';
  }

  // ── Physique ─────────────────────────────────────────────────────────────────

  addRigidBody(entityId: EntityId, isStatic: boolean): void {
    this.world?.add_rigid_body(entityId, isStatic);
  }

  addCollider(entityId: EntityId, hx: number, hy: number, hz: number): void {
    this.world?.add_collider_aabb(entityId, hx, hy, hz);
  }

  // ── Lumières ─────────────────────────────────────────────────────────────────

  addPointLight(entityId: EntityId, r: number, g: number, b: number, intensity: number): void {
    this.world?.add_point_light(entityId, r, g, b, intensity);
  }

  addDirectionalLight(dx: number, dy: number, dz: number, r: number, g: number, b: number, intensity: number): void {
    this.world?.add_directional_light(dx, dy, dz, r, g, b, intensity);
  }

  // ── Player / Input ────────────────────────────────────────────────────────────

  setPlayer(entityId: EntityId): void {
    this.world?.set_player(entityId);
  }

  setInput(keys: number, mouseDx: number, mouseDy: number): void {
    this.world?.set_input(keys, mouseDx, mouseDy);
  }

  // ── Tags ──────────────────────────────────────────────────────────────────────

  setTag(entityId: EntityId, tag: string): void {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (this.world as any)?.set_tag(entityId, tag);
  }

  getEntityByTag(tag: string): EntityId | null {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const id = (this.world as any)?.get_entity_by_tag(tag) ?? 0xFFFFFFFF;
    return id === 0xFFFFFFFF ? null : id;
  }

  // ── Simulation ────────────────────────────────────────────────────────────────

  update(deltaMs: number): void {
    this.world?.update(deltaMs);
  }

  // ── Scène ───────────────────────────────────────────────────────────────────

  saveScene(): string {
    return this.world?.save_scene() ?? '{}';
  }

  loadScene(json: string): void {
    this.world?.load_scene(json);
  }

  // ── Render loop ─────────────────────────────────────────────────────────────

  startLoop(onFrame?: () => void): void {
    if (this.rafId !== null) return;
    let lastTime = performance.now();
    const loop = (now: number) => {
      const deltaMs = Math.min(now - lastTime, 50); // cap 50ms anti-spiral
      lastTime = now;
      this.world?.render_frame(deltaMs);
      onFrame?.();
      this.rafId = requestAnimationFrame(loop);
    };
    this.rafId = requestAnimationFrame(loop);
  }

  startGameLoop(onFrame?: (deltaMs: number) => void): void {
    if (this.rafId !== null) return;
    let lastTime = performance.now();
    const loop = (now: number) => {
      const deltaMs = Math.min(now - lastTime, 50);
      lastTime = now;
      this.world?.update(deltaMs);
      this.world?.render_frame(deltaMs);
      onFrame?.(deltaMs);
      this.rafId = requestAnimationFrame(loop);
    };
    this.rafId = requestAnimationFrame(loop);
  }

  stopLoop(): void {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }
}

// Singleton partagé par toute l'app
export const bridge = new EngineBridge();

/* tslint:disable */
/* eslint-disable */

export class World {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    /**
     * Ajoute un Collider AABB (demi-extents en mètres). Centre = Transform.position.
     */
    add_collider_aabb(id: number, hx: number, hy: number, hz: number): void;
    /**
     * Définit la lumière directionnelle (soleil). Un seul appel suffit.
     * direction (dx, dy, dz) : vecteur vers lequel la lumière pointe (normalisé automatiquement).
     */
    add_directional_light(dx: number, dy: number, dz: number, r: number, g: number, b: number, intensity: number): void;
    /**
     * Rétrocompatibilité Phase 1-5. Utilise add_pbr_material pour le PBR.
     */
    add_material(entity_id: number, texture_id: number): void;
    /**
     * Ajoute un MeshRenderer Cube + crée les ressources GPU associées.
     */
    add_mesh_renderer(id: number): void;
    /**
     * Associe un matériau PBR complet à l'entité.
     */
    add_pbr_material(entity_id: number, albedo_tex: number, metallic: number, roughness: number): void;
    /**
     * Ajoute une point light attachée à l'entité (doit avoir un Transform).
     * Couleur (r, g, b) entre 0.0 et 1.0, intensity en lux (ex: 5.0–20.0).
     */
    add_point_light(id: number, r: number, g: number, b: number, intensity: number): void;
    /**
     * Ajoute un RigidBody. `is_static = true` pour les entités fixes (sol, murs).
     */
    add_rigid_body(id: number, is_static: boolean): void;
    /**
     * Ajoute un composant Transform à l'entité (position initiale xyz).
     */
    add_transform(id: number, x: number, y: number, z: number): void;
    /**
     * Crée une entité vide. Retourne son handle (usize).
     */
    create_entity(): number;
    /**
     * Retourne le premier ID d'entité ayant ce tag, ou u32::MAX si aucun.
     */
    get_entity_by_tag(tag: string): number;
    /**
     * Liste les IDs de toutes les entités qui ont un Transform.
     */
    get_entity_ids(): Uint32Array;
    /**
     * Retourne le nom de l'entité (défaut: "Entity {id}").
     */
    get_entity_name(id: number): string;
    /**
     * Retourne le type de mesh d'une entité ("cube" | "plane").
     */
    get_mesh_type(id: number): string;
    /**
     * Retourne le tag d'une entité ("" si aucun tag assigné).
     */
    get_tag(id: number): string;
    /**
     * Retourne [px, py, pz, rx, ry, rz, sx, sy, sz] pour l'entité.
     * Retourne 9 zéros si l'entité n'a pas de Transform.
     */
    get_transform_array(id: number): Float32Array;
    /**
     * Retourne la matrice view*proj [16 f32, column-major] pour les gizmos.
     */
    get_view_proj(): Float32Array;
    /**
     * Charge une scène depuis un JSON string.
     * Supprime les entités non-persistantes, puis crée les entités du JSON.
     * Retourne un Uint32Array des IDs des nouvelles entités créées.
     */
    load_scene(json: string): Uint32Array;
    static new(canvas: HTMLCanvasElement): Promise<World>;
    /**
     * Enregistre un TextureId GPU sous un nom string.
     * Appeler avant load_scene() pour que les textures nommées soient résolvables.
     */
    register_texture(name: string, texture_id: number): void;
    /**
     * Supprime une entité et tous ses composants.
     */
    remove_entity(id: number): void;
    render_frame(_delta_ms: number): void;
    /**
     * Sérialise la scène courante (toutes les entités) en JSON string.
     */
    save_scene(): string;
    set_camera(ex: number, ey: number, ez: number, tx: number, ty: number, tz: number): void;
    /**
     * Rend un objet émissif (ex: ampoule, néon).
     * r,g,b > 1.0 permet de faire du "bloom" si on avait du post-process,
     * ici cela garantit juste une couleur très vive.
     */
    set_emissive(entity_id: number, r: number, g: number, b: number): void;
    /**
     * Définit le nom d'une entité.
     */
    set_entity_name(id: number, name: string): void;
    /**
     * Transmet l'état input du frame courant.
     * `keys` bitmask : bit0=W, bit1=S, bit2=A, bit3=D, bit4=SPACE.
     * `mouse_dx/dy` : delta pixels depuis le dernier frame (Pointer Lock).
     */
    set_input(keys: number, mouse_dx: number, mouse_dy: number): void;
    /**
     * Change le type de mesh d'une entité existante ("cube" ou "plane").
     */
    set_mesh_type(id: number, mesh_type: string): void;
    /**
     * Applique une normal map à l'entité (doit avoir un Material).
     */
    set_normal_map(entity_id: number, normal_tex_id: number): void;
    /**
     * Marque (ou démarque) une entité comme persistante.
     * Les entités persistantes survivent aux appels à load_scene().
     */
    set_persistent(id: number, persistent: boolean): void;
    /**
     * Désigne l'entité joueur. La caméra FPS la suivra automatiquement.
     */
    set_player(id: number): void;
    set_position(id: number, x: number, y: number, z: number): void;
    set_rotation(id: number, x: number, y: number, z: number): void;
    set_scale(id: number, x: number, y: number, z: number): void;
    /**
     * Assigne un tag string à une entité. Remplace le tag précédent s'il en avait un.
     */
    set_tag(id: number, tag: string): void;
    /**
     * Met à jour la physique et la caméra FPS. Appeler avant render_frame().
     */
    update(delta_ms: number): void;
    /**
     * Upload custom mesh. vertices: flat f32 array (15 per vertex), indices: u32 array.
     * Returns custom mesh index for use with set_mesh_type("custom:N").
     */
    upload_custom_mesh(vertices: Float32Array, indices: Uint32Array): number;
    /**
     * Charge des pixels RGBA bruts en GPU. Retourne un TextureId (u32).
     * Cote TS : passer un Uint8Array de taille width * height * 4.
     */
    upload_texture(width: number, height: number, data: Uint8Array, generate_mipmaps: boolean): number;
}

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly __wbg_world_free: (a: number, b: number) => void;
    readonly world_add_collider_aabb: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly world_add_directional_light: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number) => void;
    readonly world_add_material: (a: number, b: number, c: number) => void;
    readonly world_add_mesh_renderer: (a: number, b: number) => void;
    readonly world_add_pbr_material: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly world_add_point_light: (a: number, b: number, c: number, d: number, e: number, f: number) => void;
    readonly world_add_rigid_body: (a: number, b: number, c: number) => void;
    readonly world_add_transform: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly world_create_entity: (a: number) => number;
    readonly world_get_entity_by_tag: (a: number, b: number, c: number) => number;
    readonly world_get_entity_ids: (a: number) => any;
    readonly world_get_entity_name: (a: number, b: number) => [number, number];
    readonly world_get_mesh_type: (a: number, b: number) => [number, number];
    readonly world_get_tag: (a: number, b: number) => [number, number];
    readonly world_get_transform_array: (a: number, b: number) => any;
    readonly world_get_view_proj: (a: number) => any;
    readonly world_load_scene: (a: number, b: number, c: number) => any;
    readonly world_new: (a: any) => any;
    readonly world_register_texture: (a: number, b: number, c: number, d: number) => void;
    readonly world_remove_entity: (a: number, b: number) => void;
    readonly world_render_frame: (a: number, b: number) => void;
    readonly world_save_scene: (a: number) => [number, number];
    readonly world_set_camera: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => void;
    readonly world_set_emissive: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly world_set_entity_name: (a: number, b: number, c: number, d: number) => void;
    readonly world_set_input: (a: number, b: number, c: number, d: number) => void;
    readonly world_set_mesh_type: (a: number, b: number, c: number, d: number) => void;
    readonly world_set_normal_map: (a: number, b: number, c: number) => void;
    readonly world_set_persistent: (a: number, b: number, c: number) => void;
    readonly world_set_player: (a: number, b: number) => void;
    readonly world_set_position: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly world_set_rotation: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly world_set_scale: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly world_set_tag: (a: number, b: number, c: number, d: number) => void;
    readonly world_update: (a: number, b: number) => void;
    readonly world_upload_custom_mesh: (a: number, b: number, c: number, d: number, e: number) => number;
    readonly world_upload_texture: (a: number, b: number, c: number, d: number, e: number, f: number) => number;
    readonly wasm_bindgen__closure__destroy__h1594f53794f5ca3c: (a: number, b: number) => void;
    readonly wasm_bindgen__convert__closures_____invoke__h564448fd7b5a9a51: (a: number, b: number, c: any, d: any) => void;
    readonly wasm_bindgen__convert__closures_____invoke__hb5a70b2dabc2cd9f: (a: number, b: number, c: any) => void;
    readonly __wbindgen_malloc: (a: number, b: number) => number;
    readonly __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
    readonly __wbindgen_exn_store: (a: number) => void;
    readonly __externref_table_alloc: () => number;
    readonly __wbindgen_externrefs: WebAssembly.Table;
    readonly __wbindgen_free: (a: number, b: number, c: number) => void;
    readonly __wbindgen_start: () => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;

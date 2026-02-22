import init, { World } from "../../engine-core/pkg/engine_core.js";

await init();

// ── 1. Initialisation WebGPU & Canvas ─────────────────────────────────────
const canvas = document.getElementById(
  "game-canvas",
) as HTMLCanvasElement | null;
if (!canvas) throw new Error("Canvas #game-canvas introuvable");

canvas.width = window.innerWidth;
canvas.height = window.innerHeight;

let world: World;
try {
  world = await World.new(canvas);
} catch (err) {
  const msg = err instanceof Error ? err.message : String(err);
  document.body.innerHTML = `<pre style="color:red;padding:20px">Erreur WebGPU:\n${msg}</pre>`;
  throw err;
}

// ── 2. HUD & UI ───────────────────────────────────────────────────────────
const hud = document.createElement("div");
hud.style.cssText =
  'position:fixed;inset:0;pointer-events:none;z-index:100;user-select:none;font-family:"Courier New", monospace;';
document.body.appendChild(hud);

const crosshair = document.createElement("div");
crosshair.style.cssText =
  "position:absolute;top:50%;left:50%;width:4px;height:4px;background:cyan;transform:translate(-50%,-50%);box-shadow:0 0 8px cyan;transition:transform 0.05s;";
hud.appendChild(crosshair);

const scoreDisplay = document.createElement("div");
scoreDisplay.style.cssText =
  "position:absolute;top:20px;left:20px;color:white;font-size:24px;font-weight:bold;text-shadow:0 0 5px cyan;";
//scoreDisplay.textContent = "NEUTRALISÉS: 0";
hud.appendChild(scoreDisplay);

const hpDisplay = document.createElement("div");
hpDisplay.style.cssText =
  "position:absolute;bottom:20px;left:20px;color:lime;font-size:36px;font-weight:bold;text-shadow:0 0 5px lime;";
//hpDisplay.textContent = "INTÉGRITÉ: 100%";
hud.appendChild(hpDisplay);

const startOverlay = document.createElement("div");
startOverlay.style.cssText =
  "position:fixed;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;color:white;background:rgba(0,5,15,0.95);z-index:200;font-family:sans-serif;transition:opacity 0.3s;";
document.body.appendChild(startOverlay);

// ── 3. Système de Chargement des Textures (Albedo & Displacement) ─────────

function createFallbackTexture(w: World): number {
  const size = 256;
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const isPink = (Math.floor(x / 32) + Math.floor(y / 32)) % 2 === 0;
      data.set(
        isPink ? [255, 0, 255, 255] : [0, 0, 0, 255],
        (y * size + x) * 4,
      );
    }
  }
  return w.upload_texture(size, size, data, true);
}

function createSkyTexture(w: World): number {
  const size = 1024;
  const data = new Uint8Array(size * size * 4);
  for (let i = 0; i < size * size; i++) {
    const x = i % size;
    const y = Math.floor(i / size);

    // Fond bleu très sombre / noir
    data[i * 4] = 2; // R
    data[i * 4 + 1] = 2; // G
    data[i * 4 + 2] = 10; // B
    data[i * 4 + 3] = 255;

    // Étoiles aléatoires
    if (Math.random() > 0.999) {
      const brightness = 150 + Math.random() * 105;
      data[i * 4] = brightness;
      data[i * 4 + 1] = brightness;
      data[i * 4 + 2] = brightness;
    }

    // Petite nébuleuse diffuse
    const noise = Math.sin(x * 0.01) * Math.cos(y * 0.01);
    if (noise > 0.7) {
      data[i * 4 + 2] += 20; // Plus de bleu
    }
  }
  return w.upload_texture(size, size, data, false);
}

const fallbackTex = createFallbackTexture(world);

// Charge une image de couleur standard
async function loadTexture(w: World, url: string): Promise<number> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      const cvs = document.createElement("canvas");
      cvs.width = img.width;
      cvs.height = img.height;
      const ctx = cvs.getContext("2d", { willReadFrequently: true })!;
      ctx.drawImage(img, 0, 0);
      // CORRECTION ICI : new Uint8Array(...)
      const data = new Uint8Array(
        ctx.getImageData(0, 0, img.width, img.height).data.buffer,
      );
      resolve(w.upload_texture(img.width, img.height, data, true));
    };
    img.onerror = () => {
      console.warn(`[Assets] Texture introuvable : ${url}`);
      resolve(fallbackTex);
    };
    img.src = url;
  });
}

// Convertit Displacement en Normal Map
async function loadDisplacementAsNormal(
  w: World,
  url: string,
  strength = 3.0,
): Promise<number> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      const cvs = document.createElement("canvas");
      const width = img.width;
      const height = img.height;
      cvs.width = width;
      cvs.height = height;
      const ctx = cvs.getContext("2d", { willReadFrequently: true })!;
      ctx.drawImage(img, 0, 0);
      const imgData = ctx.getImageData(0, 0, width, height).data;

      const normalData = new Uint8Array(width * height * 4);

      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          // ... (Le code de l'algorithme Sobel reste identique) ...
          const xL = x > 0 ? x - 1 : 0;
          const xR = x < width - 1 ? x + 1 : width - 1;
          const yU = y > 0 ? y - 1 : 0;
          const yD = y < height - 1 ? y + 1 : height - 1;

          const hL = imgData[(y * width + xL) * 4] / 255.0;
          const hR = imgData[(y * width + xR) * 4] / 255.0;
          const hU = imgData[(yU * width + x) * 4] / 255.0;
          const hD = imgData[(yD * width + x) * 4] / 255.0;

          const dx = (hL - hR) * strength;
          const dy = (hU - hD) * strength;
          const dz = 1.0;

          const len = Math.hypot(dx, dy, dz);
          const i = (y * width + x) * 4;
          normalData[i] = Math.floor(((dx / len) * 0.5 + 0.5) * 255);
          normalData[i + 1] = Math.floor(((dy / len) * 0.5 + 0.5) * 255);
          normalData[i + 2] = Math.floor((dz / len) * 255);
          normalData[i + 3] = 255;
        }
      }
      resolve(w.upload_texture(width, height, normalData, true));
    };
    img.onerror = () => resolve(fallbackTex);
    img.src = url;
  });
}

startOverlay.innerHTML =
  '<h1 style="color:cyan;">Conversion & Chargement des textures 4K...</h1>';

// Chargement des textures (Sol = concrete, Murs = rock_wall)
const [tFloorAlbedo, tFloorNormal, tWallAlbedo, tWallNormal] =
  await Promise.all([
    loadTexture(world, "/textures/rock_embedded_concrete_diff_4k.jpg"),
    loadDisplacementAsNormal(
      world,
      "/textures/rock_embedded_concrete_disp_4k.png",
      5.0,
    ),
    loadTexture(world, "/textures/rock_wall_03_diff_4k.jpg"),
    loadDisplacementAsNormal(world, "/textures/rock_wall_03_disp_4k.png", 5.0),
  ]);

startOverlay.innerHTML =
  '<h1 style="color:cyan;text-shadow:0 0 10px cyan;font-size:50px;margin:0">SECTEUR 7</h1><p>Cliquez n\'importe où pour engager le combat</p><p style="color:#aaa">WASD : Mouvement | ESPACE : Saut | CLIC : Tir</p>';

// ── 4. Construction de l'Arène Sci-Fi (Atmosphérique) ─────────────────────

// Fonction utilitaire pour créer des blocs (Sols, Murs, Caisses)
function spawnBlock(
  x: number,
  y: number,
  z: number,
  sx: number,
  sy: number,
  sz: number,
  albedoId: number,
  normalId: number,
  metallic: number,
  roughness: number,
) {
  const id = world.create_entity();
  world.add_transform(id, x, y, z);
  world.set_scale(id, sx, sy, sz);
  world.add_mesh_renderer(id);
  world.add_pbr_material(id, albedoId, metallic, roughness);
  // Appliquer la normal map si elle est valide (différente du fallback)
  if (normalId !== fallbackTex) world.set_normal_map(id, normalId);

  world.add_rigid_body(id, true); // Statique (ne bouge pas)
  world.add_collider_aabb(id, sx / 2, sy / 2, sz / 2);
  return id;
}

// 1. Lumière Directionnelle : "Clair de Lune" (Bleu nuit, faible intensité)
world.add_directional_light(-0.5, -1.0, -0.5, 0.1, 0.15, 0.3, 0.8);

// Fonction pour créer un lampadaire industriel complexe
function spawnStreetLamp(x: number, z: number, rotationY: number) {
  const lampHeight = 4.5;

  // 1. Base en béton
  const base = world.create_entity();
  world.add_transform(base, x, 0.4, z);
  world.set_scale(base, 0.8, 0.8, 0.8);
  world.add_mesh_renderer(base);
  world.add_pbr_material(base, tFloorAlbedo, 0.1, 0.9);
  world.add_rigid_body(base, true);
  world.add_collider_aabb(base, 0.4, 0.4, 0.4);

  // 2. Poteau métallique
  const pole = world.create_entity();
  world.add_transform(pole, x, lampHeight / 2, z);
  world.set_scale(pole, 0.2, lampHeight, 0.2);
  world.add_mesh_renderer(pole);
  world.add_pbr_material(pole, tWallAlbedo, 0.8, 0.4);
  world.add_rigid_body(pole, true);
  world.add_collider_aabb(pole, 0.1, lampHeight / 2, 0.1);

  // 3. Bras horizontal
  const armLen = 1.5;
  const rad = (rotationY * Math.PI) / 180;
  const armX = Math.cos(rad) * (armLen / 2);
  const armZ = -Math.sin(rad) * (armLen / 2);

  const arm = world.create_entity();
  world.add_transform(arm, x + armX, lampHeight - 0.2, z + armZ);
  world.set_scale(arm, armLen, 0.15, 0.15);
  world.set_rotation(arm, 0, rotationY, 0);
  world.add_mesh_renderer(arm);
  world.add_pbr_material(arm, tWallAlbedo, 0.8, 0.4);

  // 4. Tête de la lampe
  const headX = Math.cos(rad) * (armLen - 0.2);
  const headZ = -Math.sin(rad) * (armLen - 0.2);

  const head = world.create_entity();
  world.add_transform(head, x + headX, lampHeight - 0.3, z + headZ);
  world.set_scale(head, 0.5, 0.2, 0.4);
  world.set_rotation(head, 0, rotationY, 0);
  world.add_mesh_renderer(head);
  world.add_pbr_material(head, tWallAlbedo, 0.9, 0.3);

  // 5. Ampoule Émissive (Visuel)
  const bulb = world.create_entity();
  world.add_transform(bulb, x + headX, lampHeight - 0.45, z + headZ);
  world.set_scale(bulb, 0.3, 0.05, 0.2);
  world.set_rotation(bulb, 0, rotationY, 0);
  world.add_mesh_renderer(bulb);
  world.add_pbr_material(bulb, fallbackTex, 0.0, 1.0);
  // C'est ici que set_emissive est utilisé (Orange Sodium intense)
  world.set_emissive(bulb, 5.0, 3.0, 0.5);

  // 6. La vraie lumière (Point Light)
  const light = world.create_entity();
  world.add_transform(light, x + headX, lampHeight - 1.0, z + headZ);
  world.add_point_light(light, 1.0, 0.6, 0.1, 30.0);
}

// ── Création de la géométrie de la scène ──

// Le Sol (Sombre et humide -> roughness plus bas)
spawnBlock(0, -0.5, 0, 80, 1, 80, tFloorAlbedo, tFloorNormal, 0.1, 0.4);

// Murs d'enceinte
spawnBlock(0, 4, -40, 80, 10, 2, tWallAlbedo, tWallNormal, 0.1, 0.6);
spawnBlock(0, 4, 40, 80, 10, 2, tWallAlbedo, tWallNormal, 0.1, 0.6);
spawnBlock(-40, 4, 0, 2, 10, 80, tWallAlbedo, tWallNormal, 0.1, 0.6);
spawnBlock(40, 4, 0, 2, 10, 80, tWallAlbedo, tWallNormal, 0.1, 0.6);

// Placement des Lampadaires
const lampSpacing = 20;
for (let z = -30; z <= 30; z += lampSpacing) {
  spawnStreetLamp(-15, z, 90); // Gauche
  spawnStreetLamp(15, z, -90); // Droite
}

// Obstacles centraux
spawnBlock(0, 1, 0, 4, 2, 4, tWallAlbedo, tWallNormal, 0.2, 0.7);
spawnBlock(-5, 0.5, 5, 2, 1, 2, tWallAlbedo, tWallNormal, 0.2, 0.7);
spawnBlock(5, 1.5, -5, 3, 3, 3, tWallAlbedo, tWallNormal, 0.2, 0.7);

// "Anomalie" lumineuse au centre
const anomaly = world.create_entity();
world.add_transform(anomaly, 0, 2.5, 0);
world.set_scale(anomaly, 0.2, 0.2, 0.2);
world.add_mesh_renderer(anomaly);
world.add_pbr_material(anomaly, fallbackTex, 0.0, 1.0);
world.set_emissive(anomaly, 0.2, 5.0, 5.0); // Cyan très brillant
world.add_point_light(anomaly, 0.1, 1.0, 1.0, 20.0);

const tSky = createSkyTexture(world);
const skyboxId = world.create_entity();

// 1. Position et Échelle
world.add_transform(skyboxId, 0, 0, 0);
// On met -1 pour le scale afin que le tiling dans le shader soit de 1x1 par face
// Mais on veut un cube GÉANT, donc on gère la taille via la transformation
world.set_scale(skyboxId, -500, -500, -500);

world.add_mesh_renderer(skyboxId);

// 2. Matériau
// Important : On met metallic à 0 et roughness à 1 pour éviter les reflets bizarres du soleil sur le ciel
world.add_pbr_material(skyboxId, tSky, 0.0, 1.0);

// 3. Émissif puissant
// On booste la valeur (ex: 2.0) pour que les étoiles percent bien le noir
world.set_emissive(skyboxId, 2.0, 2.0, 2.5);

// ── 5. Le Joueur ──────────────────────────────────────────────────────────
const player = world.create_entity();
world.add_transform(player, 0, 2, 0);
world.add_rigid_body(player, false);
world.add_collider_aabb(player, 0.4, 0.9, 0.4);
world.set_player(player);

// ── 6. Logique de Jeu (Projectiles & Ennemis) ─────────────────────────────
interface Bullet {
  id: number;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  life: number;
}
interface Enemy {
  id: number;
  x: number;
  y: number;
  z: number;
  hp: number;
  active: boolean;
  hitTimer: number;
}

const bullets: Bullet[] = [];
const enemies: Enemy[] = [];
let kills = 0;
let playerHp = 100;

function spawnEnemy() {
  return;
  const angle = Math.random() * Math.PI * 2;
  const dist = 20 + Math.random() * 5;
  const x = Math.cos(angle) * dist;
  const z = Math.sin(angle) * dist;

  const id = world.create_entity();
  world.add_transform(id, x, 1, z);
  world.set_scale(id, 1, 2, 1);
  world.add_mesh_renderer(id);
  // Les ennemis utilisent la texture du mur, assombrie et métallisée
  world.add_pbr_material(id, tWallAlbedo, 0.2, 0.5);
  world.add_point_light(id, 1, 0, 0, 5.0);
  world.add_rigid_body(id, true);
  world.add_collider_aabb(id, 0.5, 1.0, 0.5);

  enemies.push({ id, x, y: 1, z, hp: 5, active: true, hitTimer: 0 });
}

function takeDamage(amount: number) {
  playerHp -= amount;
  hpDisplay.textContent = `INTÉGRITÉ: ${Math.max(0, Math.floor(playerHp))}%`;
  hpDisplay.style.color =
    playerHp > 50 ? "lime" : playerHp > 20 ? "orange" : "red";

  if (playerHp <= 0) {
    document.exitPointerLock();
    startOverlay.style.display = "flex";
    startOverlay.style.opacity = "1";
    startOverlay.innerHTML = `<h1 style="color:red;font-size:50px">ÉCHEC CRITIQUE</h1><p>Entités détruites : ${kills}</p><button onclick="location.reload()" style="padding:15px 30px;font-size:24px;background:red;color:white;border:none;cursor:pointer;margin-top:20px;">RELANCER LE SYSTÈME</button>`;
  }
}

// ── 7. Entrées Joueur (Input) ─────────────────────────────────────────────
let keysMask = 0;
let mouseDxAcc = 0;
let mouseDyAcc = 0;
let camYaw = 0;
let camPitch = 0;

document.addEventListener("keydown", (e) => {
  if (playerHp <= 0) return;
  if (e.code === "KeyW") keysMask |= 1 << 0;
  if (e.code === "KeyS") keysMask |= 1 << 1;
  if (e.code === "KeyA") keysMask |= 1 << 2;
  if (e.code === "KeyD") keysMask |= 1 << 3;
  if (e.code === "Space") {
    keysMask |= 1 << 4;
    e.preventDefault();
  }
});

document.addEventListener("keyup", (e) => {
  if (e.code === "KeyW") keysMask &= ~(1 << 0);
  if (e.code === "KeyS") keysMask &= ~(1 << 1);
  if (e.code === "KeyA") keysMask &= ~(1 << 2);
  if (e.code === "KeyD") keysMask &= ~(1 << 3);
  if (e.code === "Space") keysMask &= ~(1 << 4);
});

document.addEventListener("mousemove", (e) => {
  if (document.pointerLockElement === canvas) {
    mouseDxAcc += e.movementX;
    mouseDyAcc += e.movementY;
    camYaw += e.movementX * 0.002;
    camPitch -= e.movementY * 0.002;
    camPitch = Math.max(
      (-89 * Math.PI) / 180,
      Math.min((89 * Math.PI) / 180, camPitch),
    );
  }
});

// Clic global (document)
document.addEventListener("click", () => {
  if (playerHp <= 0) return;

  if (document.pointerLockElement !== canvas) {
    canvas.requestPointerLock();
    return;
  }

  // TIR
  try {
    const sceneData = JSON.parse(world.save_scene());
    const pData = sceneData.entities[player];

    if (pData && pData.transform) {
      const px = pData.transform.position[0];
      const py = pData.transform.position[1] + 1.6;
      const pz = pData.transform.position[2];

      const dirX = Math.cos(camPitch) * Math.sin(camYaw);
      const dirY = Math.sin(camPitch);
      const dirZ = -Math.cos(camPitch) * Math.cos(camYaw);

      const bId = world.create_entity();
      world.add_transform(bId, px + dirX, py + dirY, pz + dirZ);
      world.set_scale(bId, 0.1, 0.1, 0.8);
      world.set_rotation(
        bId,
        (-camPitch * 180) / Math.PI,
        (camYaw * 180) / Math.PI,
        0,
      );
      world.add_mesh_renderer(bId);

      world.add_pbr_material(bId, fallbackTex, 0.5, 0.5);
      world.add_point_light(bId, 0, 1, 1, 15.0);

      bullets.push({
        id: bId,
        x: px + dirX,
        y: py + dirY,
        z: pz + dirZ,
        vx: dirX * 60.0,
        vy: dirY * 60.0,
        vz: dirZ * 60.0,
        life: 2.0,
      });

      crosshair.style.transform = "translate(-50%,-50%) scale(3)";
      crosshair.style.background = "white";
      setTimeout(() => {
        crosshair.style.transform = "translate(-50%,-50%) scale(1)";
        crosshair.style.background = "cyan";
      }, 50);
    }
  } catch (err) {}
});

document.addEventListener("pointerlockchange", () => {
  if (playerHp > 0) {
    startOverlay.style.opacity =
      document.pointerLockElement === canvas ? "0" : "1";
    setTimeout(
      () =>
        (startOverlay.style.display =
          document.pointerLockElement === canvas ? "none" : "flex"),
      300,
    );
  }
});

// ── 8. Boucle Principale ──────────────────────────────────────────────────
let lastTime = performance.now();
let lastSpawnTime = performance.now();

function loop() {
  const now = performance.now();
  const delta = Math.min(now - lastTime, 50);
  const dt = delta / 1000;
  lastTime = now;

  if (playerHp > 0 && document.pointerLockElement === canvas) {
    let px = 0,
      py = 2,
      pz = 0;
    try {
      const scene = JSON.parse(world.save_scene());
      const t = scene.entities[player]?.transform;
      if (t) {
        px = t.position[0];
        py = t.position[1];
        pz = t.position[2];
        world.set_position(skyboxId, px, py, pz);
      }
    } catch (e) {}

    // -- Mise à jour des Projectiles --
    for (let i = bullets.length - 1; i >= 0; i--) {
      const b = bullets[i];
      b.life -= dt;
      if (b.life <= 0) {
        world.set_scale(b.id, 0, 0, 0);
        world.set_position(b.id, 0, -100, 0);
        bullets.splice(i, 1);
        continue;
      }

      b.x += b.vx * dt;
      b.y += b.vy * dt;
      b.z += b.vz * dt;
      world.set_position(b.id, b.x, b.y, b.z);

      let hit = false;
      for (const e of enemies) {
        if (!e.active) continue;
        const dx = b.x - e.x;
        const dy = b.y - e.y;
        const dz = b.z - e.z;
        if (Math.abs(dx) < 0.6 && Math.abs(dy) < 1.1 && Math.abs(dz) < 0.6) {
          e.hp--;
          e.hitTimer = 0.1;
          world.set_scale(e.id, 0.8, 1.8, 0.8);

          if (e.hp <= 0) {
            e.active = false;
            world.set_scale(e.id, 0, 0, 0);
            world.set_position(e.id, 0, -100, 0);
            kills++;
            scoreDisplay.textContent = `NEUTRALISÉS: ${kills}`;
          }
          hit = true;
          break;
        }
      }

      if (hit) {
        world.set_scale(b.id, 0, 0, 0);
        world.set_position(b.id, 0, -100, 0);
        bullets.splice(i, 1);
      }
    }

    // -- Mise à jour de l'IA --
    for (const e of enemies) {
      if (!e.active) continue;

      if (e.hitTimer > 0) {
        e.hitTimer -= dt;
        if (e.hitTimer <= 0) world.set_scale(e.id, 1, 2, 1);
      }

      const dx = px - e.x;
      const dz = pz - e.z;
      const dist = Math.hypot(dx, dz);

      if (dist > 1.2) {
        const speed = 4.0 + kills * 0.1;
        e.x += (dx / dist) * speed * dt;
        e.z += (dz / dist) * speed * dt;
        world.set_position(e.id, e.x, 1.0, e.z);

        const angle = Math.atan2(dx, dz);
        world.set_rotation(e.id, 0, (angle * 180) / Math.PI, 0);
      } else {
        takeDamage(30 * dt);
      }
    }

    // -- Spawning --
    const maxEnemies = Math.min(15, 5 + Math.floor(kills / 2));
    if (
      now - lastSpawnTime > 1500 &&
      enemies.filter((e) => e.active).length < maxEnemies
    ) {
      lastSpawnTime = now;
      spawnEnemy();
    }
  }

  world.set_input(keysMask, mouseDxAcc, mouseDyAcc);
  mouseDxAcc = 0;
  mouseDyAcc = 0;

  world.update(delta);
  world.render_frame(delta);

  requestAnimationFrame(loop);
}

for (let i = 0; i < 3; i++) spawnEnemy();
requestAnimationFrame(loop);

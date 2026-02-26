import { bridge } from './engineBridge';
import { useComponentStore } from '../store/componentStore';

export function syncEditorComponentsToEngine(): void {
  const entries = Object.entries(useComponentStore.getState().components);

  for (const [idStr, comps] of entries) {
    const id = Number(idStr);
    if (!Number.isFinite(id)) continue;

    if (comps.meshType !== undefined) {
      bridge.setMeshType(id, comps.meshType);
    }

    if (comps.material !== undefined) {
      const m = comps.material;
      bridge.addPbrMaterial(id, m.texId, m.metallic, m.roughness);
      bridge.setEmissive(id, m.emissive[0], m.emissive[1], m.emissive[2]);
    }

    if (comps.rigidbody !== undefined) {
      bridge.addRigidBody(id, comps.rigidbody.isStatic);
    }

    if (comps.collider !== undefined) {
      const c = comps.collider;
      bridge.addCollider(id, c.hx, c.hy, c.hz);
    }

    if (comps.pointLight !== undefined) {
      const l = comps.pointLight;
      bridge.addPointLight(id, l.r, l.g, l.b, l.intensity);
    }

    if (comps.directionalLight !== undefined) {
      const l = comps.directionalLight;
      bridge.addDirectionalLightEntity(id, l.r, l.g, l.b, l.intensity, l.coneAngle ?? 30);
    }

    if (comps.isPlayer !== undefined) {
      bridge.setPlayer(id);
    }

    if (comps.camera !== undefined) {
      const c = comps.camera;
      bridge.addCamera(id, c.fov, c.near, c.far);
      bridge.setCameraFollowEntity(id, c.followEntity);
      if (c.isActive) bridge.setActiveCamera(id);
    }
  }
}

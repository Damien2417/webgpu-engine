import React from 'react';
import { useComponentStore } from '../../store/componentStore';
import type { EntityId } from '../../engine/types';
import MeshRendererPanel from './panels/MeshRendererPanel';
import MaterialPanel from './panels/MaterialPanel';
import RigidbodyPanel from './panels/RigidbodyPanel';
import ColliderPanel from './panels/ColliderPanel';
import LightPanel from './panels/LightPanel';
import PlayerControllerPanel from './panels/PlayerControllerPanel';

export default function ComponentPanels({ entityId }: { entityId: EntityId }) {
  const { getComponents } = useComponentStore();
  const c = getComponents(entityId);

  return (
    <>
      {c.meshType          !== undefined && <MeshRendererPanel     entityId={entityId} />}
      {c.material          !== undefined && <MaterialPanel         entityId={entityId} />}
      {c.rigidbody         !== undefined && <RigidbodyPanel        entityId={entityId} />}
      {c.collider          !== undefined && <ColliderPanel         entityId={entityId} />}
      {(c.pointLight !== undefined || c.directionalLight !== undefined) && <LightPanel entityId={entityId} />}
      {c.isPlayer          !== undefined && <PlayerControllerPanel entityId={entityId} />}
    </>
  );
}

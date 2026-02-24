import React from 'react';
import { useComponentStore } from '../../store/componentStore';
import type { EntityId } from '../../engine/types';
import MeshRendererPanel from './panels/MeshRendererPanel';
import MaterialPanel from './panels/MaterialPanel';
import RigidbodyPanel from './panels/RigidbodyPanel';
import ColliderPanel from './panels/ColliderPanel';
import LightPanel from './panels/LightPanel';
import PlayerControllerPanel from './panels/PlayerControllerPanel';
import ScriptPanel from './panels/ScriptPanel';
import CameraPanel from './panels/CameraPanel';
import ParticlePanel from './panels/ParticlePanel';
import TagField from './panels/TagField';

export default function ComponentPanels({ entityId }: { entityId: EntityId }) {
  const { getComponents } = useComponentStore();
  const c = getComponents(entityId);

  return (
    <>
      <TagField entityId={entityId} />
      {c.meshType          !== undefined && <MeshRendererPanel     entityId={entityId} />}
      {c.material          !== undefined && <MaterialPanel         entityId={entityId} />}
      {c.rigidbody         !== undefined && <RigidbodyPanel        entityId={entityId} />}
      {c.collider          !== undefined && <ColliderPanel         entityId={entityId} />}
      {(c.pointLight !== undefined || c.directionalLight !== undefined) && <LightPanel entityId={entityId} />}
      {c.isPlayer          !== undefined && <PlayerControllerPanel entityId={entityId} />}
      {c.script            !== undefined && <ScriptPanel           entityId={entityId} />}
      {c.camera            !== undefined && <CameraPanel           entityId={entityId} />}
      {c.particle          !== undefined && <ParticlePanel         entityId={entityId} />}
    </>
  );
}

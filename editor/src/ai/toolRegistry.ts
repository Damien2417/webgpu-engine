// ── Tool registry: declares all tools + Gemini FunctionDeclarations ──────────

import type { FunctionDeclaration } from '@google/genai';
import type { ToolCall, ToolResult } from './types';

// Handler signature: receives validated args, returns result or throws
export type ToolHandler = (args: Record<string, unknown>) => Promise<ToolResult['result']> | ToolResult['result'];

export interface ToolDef {
  name:        string;
  description: string;
  declaration: FunctionDeclaration;  // sent to Gemini
  handler:     ToolHandler;
  destructive?: boolean;             // requires confirmation in safe mode
  maxPerRequest?: number;
}

// ── Tool definitions ──────────────────────────────────────────────────────────

const tools: Map<string, ToolDef> = new Map();

export function registerTool(def: ToolDef) {
  tools.set(def.name, def);
}

export function getToolDef(name: string): ToolDef | undefined {
  return tools.get(name);
}

export function getAllTools(): ToolDef[] {
  return Array.from(tools.values());
}

/** Returns the Gemini FunctionDeclarations array for generateContent */
export function getFunctionDeclarations(): FunctionDeclaration[] {
  return getAllTools().map(t => t.declaration);
}

// ── 6 base tools (Sprint 1) ───────────────────────────────────────────────────
// Handlers are injected by toolExecutor.ts via registerTool().
// This file only declares the schema; actual implementation is in toolExecutor.ts.

export const TOOL_DECLARATIONS: FunctionDeclaration[] = [
  {
    name: 'get_scene_summary',
    description: 'Returns a summary of all entities in the scene: id, name, tag, position, components.',
    parametersJsonSchema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'get_selection',
    description: 'Returns the currently selected entity in the editor (id, name, transform, components).',
    parametersJsonSchema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'find_entities',
    description: 'Search for entities by name, tag, or component type.',
    parametersJsonSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search term' },
        by:    { type: 'string', enum: ['name', 'tag', 'component'], description: 'Search field' },
      },
      required: ['query', 'by'],
    },
  },
  {
    name: 'create_entity',
    description: 'Creates a new entity in the scene. Set withMesh=false to create a group/empty node (no visible mesh).',
    parametersJsonSchema: {
      type: 'object',
      properties: {
        name:     { type: 'string', description: 'Entity name' },
        position: {
          type: 'array', items: { type: 'number' }, minItems: 3, maxItems: 3,
          description: '[x, y, z] world position',
        },
        scale: {
          type: 'array', items: { type: 'number' }, minItems: 3, maxItems: 3,
          description: '[x, y, z] scale',
        },
        withMesh: {
          type: 'boolean',
          description: 'If false, creates an empty/group node with no mesh (default: true)',
        },
      },
      required: ['name'],
    },
  },
  {
    name: 'delete_entity',
    description: 'Deletes an entity from the scene by its numeric ID.',
    parametersJsonSchema: {
      type: 'object',
      properties: {
        entityId: { type: 'number', description: 'Entity ID to delete' },
      },
      required: ['entityId'],
    },
  },
  {
    name: 'set_transform',
    description: 'Sets the position, rotation, and/or scale of an entity.',
    parametersJsonSchema: {
      type: 'object',
      properties: {
        entityId: { type: 'number', description: 'Target entity ID' },
        position: {
          type: 'array', items: { type: 'number' }, minItems: 3, maxItems: 3,
          description: '[x, y, z] world position',
        },
        rotation: {
          type: 'array', items: { type: 'number' }, minItems: 3, maxItems: 3,
          description: '[x, y, z] Euler rotation in degrees',
        },
        scale: {
          type: 'array', items: { type: 'number' }, minItems: 3, maxItems: 3,
          description: '[x, y, z] scale',
        },
      },
      required: ['entityId'],
    },
  },
  // ── V1.1 placement tools (Sprint 3) ─────────────────────────────────────────
  {
    name: 'duplicate_entity',
    description: 'Duplicates an existing entity, optionally multiple times.',
    parametersJsonSchema: {
      type: 'object',
      properties: {
        entityId: { type: 'number', description: 'Entity ID to duplicate' },
        count:    { type: 'number', description: 'Number of copies (default 1)' },
      },
      required: ['entityId'],
    },
  },
  {
    name: 'add_component',
    description: 'Adds a component to an entity (meshRenderer, rigidbody, collider, pointLight, material).',
    parametersJsonSchema: {
      type: 'object',
      properties: {
        entityId:      { type: 'number', description: 'Target entity ID' },
        componentType: {
          type: 'string',
          enum: ['meshRenderer', 'rigidbody', 'collider', 'pointLight', 'material'],
          description: 'Component type to add',
        },
        initialValues: { type: 'object', description: 'Optional initial values for the component' },
      },
      required: ['entityId', 'componentType'],
    },
  },
  {
    name: 'update_component',
    description: 'Updates fields on an existing component.',
    parametersJsonSchema: {
      type: 'object',
      properties: {
        entityId:      { type: 'number', description: 'Target entity ID' },
        componentType: {
          type: 'string',
          enum: ['transform', 'meshRenderer', 'rigidbody', 'collider', 'pointLight', 'material'],
          description: 'Component type to update',
        },
        patch: { type: 'object', description: 'Key-value pairs to merge into the component' },
      },
      required: ['entityId', 'componentType', 'patch'],
    },
  },
  // ── Hierarchy tools ──────────────────────────────────────────────────────────
  {
    name: 'set_parent',
    description: 'Sets the parent of an entity (childId becomes a child of parentId). Use this to build grouped/composite objects. The child\'s transform is automatically converted to local space.',
    parametersJsonSchema: {
      type: 'object',
      properties: {
        childId:  { type: 'number', description: 'ID of the entity to attach as a child' },
        parentId: { type: 'number', description: 'ID of the parent entity (the group root)' },
      },
      required: ['childId', 'parentId'],
    },
  },
  {
    name: 'remove_parent',
    description: 'Detaches an entity from its parent, promoting it back to root level. The world transform is preserved.',
    parametersJsonSchema: {
      type: 'object',
      properties: {
        childId: { type: 'number', description: 'ID of the entity to detach from its parent' },
      },
      required: ['childId'],
    },
  },
];

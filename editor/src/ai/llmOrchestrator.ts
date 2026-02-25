// ── LLM Orchestrator: boucle agentique avec Gemini tool calling ───────────────
//
// Flux par tour :
//   1. generateContent avec tools déclarés
//   2. Si la réponse contient des functionCalls → les exécuter → renvoyer les résultats
//   3. Répéter jusqu'à réponse texte finale ou MAX_ROUNDS atteint

import { GoogleGenAI, FunctionCallingConfigMode } from '@google/genai';
import type { Content, Part } from '@google/genai';
import type { ToolCall, ToolResult } from './types';
import { TOOL_DECLARATIONS } from './toolRegistry';
import { buildContextString } from './contextBuilder';
import { executeToolCall } from './toolExecutor';

const MODEL = 'gemini-flash-latest';

function getClient(): GoogleGenAI {
  const key = import.meta.env.VITE_GEMINI_API_KEY as string | undefined;
  if (!key) throw new Error('VITE_GEMINI_API_KEY is not set. Crée editor/.env avec ta clé.');
  return new GoogleGenAI({ apiKey: key });
}

const SYSTEM_INSTRUCTION = `You are an AI assistant integrated into a 3D scene editor (WebGPU-based).
Your job is to help users build 3D scenes by calling the provided tools.

Rules:
- Always call tools to modify the scene — never describe changes without calling tools.
- You can chain multiple tool calls across multiple rounds — use get_scene_summary or
  find_entities first to discover entity IDs, then act on them.
- Never invent entity IDs. Always discover them via tools.
- Positions use Y-up coordinates (Y = vertical). 1 unit ≈ 1 meter.
- When placing multiple objects (e.g. chairs around a table), compute positions mathematically.
- After all actions are done, respond with a short summary of what you did.

Grouping rules (IMPORTANT):
- For any complex or composite object (table, chair, lamp, car, building, character, etc.),
  always represent it as a GROUP: create a parent entity (no mesh) at the object's centroid,
  then create each part as a child entity with set_parent(child_id, parent_id).
- Name the group after the object (e.g. "Table"), name parts descriptively (e.g. "Table_Top",
  "Table_Leg_FL", "Chair_Seat", "Chair_Back").
- A single primitive (a lone cube, plane, sphere) does NOT need a group.
- Moving/rotating/scaling the group entity automatically affects all children — prefer
  editing the group transform rather than individual parts.
- When the user asks to move, rotate or scale a composite object, target the group entity.`;

export interface AgentRound {
  calls:   ToolCall[];
  results: ToolResult[];
}

export interface AgentResult {
  rounds:    AgentRound[];    // toutes les itérations tool-call → résultat
  finalText: string;          // réponse textuelle finale du modèle
}

/** Boucle agentique complète : exécute les tools tant que le modèle en demande. */
export async function runAgentLoop(
  userMessage: string,
  history:     Content[],
  safeMode:    boolean,
  onRound?:    (round: AgentRound) => void,  // callback pour mise à jour UI en temps réel
  signal?:     AbortSignal,                   // pour annuler la boucle depuis l'UI
): Promise<AgentResult> {
  const ai = getClient();

  const sceneContext      = buildContextString();
  const systemWithContext = `${SYSTEM_INSTRUCTION}\n\nCurrent scene:\n${sceneContext}`;

  // Conversation locale — on fait grandir ce tableau au fil des tours
  const contents: Content[] = [
    ...history,
    { role: 'user', parts: [{ text: userMessage }] },
  ];

  const rounds: AgentRound[] = [];

  // eslint-disable-next-line no-constant-condition
  while (true) {
    if (signal?.aborted) {
      return { rounds, finalText: '[Annulé par l\'utilisateur]' };
    }

    const response = await ai.models.generateContent({
      model: MODEL,
      contents,
      config: {
        systemInstruction: systemWithContext,
        toolConfig: {
          functionCallingConfig: { mode: FunctionCallingConfigMode.AUTO },
        },
        tools: [{ functionDeclarations: TOOL_DECLARATIONS }],
      },
    });

    const rawCalls = response.functionCalls ?? [];

    // Pas de tool calls → le modèle a fini
    if (rawCalls.length === 0) {
      return { rounds, finalText: response.text ?? '' };
    }

    // ── Convertir en ToolCall internes ───────────────────────────────────────
    const calls: ToolCall[] = rawCalls.map((fc, i) => ({
      id:   fc.id ?? `call_${Date.now()}_${i}`,
      tool: fc.name ?? '',
      args: (fc.args ?? {}) as Record<string, unknown>,
    }));

    // ── Exécuter les tools ────────────────────────────────────────────────────
    const results: ToolResult[] = [];
    for (const call of calls) {
      // Safe mode : bloquer delete_entity
      if (safeMode && call.tool === 'delete_entity') {
        results.push({
          id: call.id, ok: false, result: null, warnings: [],
          error: 'Safe mode: delete_entity bloqué. Désactive le Safe mode pour autoriser les suppressions.',
        });
        continue;
      }
      results.push(await executeToolCall(call));
    }

    const currentRound: AgentRound = { calls, results };
    rounds.push(currentRound);
    onRound?.(currentRound);

    // ── Réinjecter le contenu EXACT du modèle (thought_signature incluse) ────
    // Les modèles "thinking" (gemini-2.5-*) renvoient des thought parts avec
    // thoughtSignature. Il faut les réinjecter tels quels — ne pas reconstruire
    // manuellement les parts sinon on perd la signature → erreur 400.
    const modelContent = response.candidates?.[0]?.content;
    if (modelContent) {
      contents.push(modelContent);
    } else {
      // Fallback si pas de candidate (ne devrait pas arriver)
      contents.push({ role: 'model', parts: rawCalls.map(fc => ({ functionCall: fc })) });
    }

    // ── Construire les parts de réponse (functionResponse) ──────────────────
    const responseParts: Part[] = results.map((res, i) => ({
      functionResponse: {
        id:   calls[i].id,
        name: calls[i].tool,
        response: res.ok
          ? { result: res.result }
          : { error: res.error ?? 'Unknown error' },
      },
    }));

    contents.push({ role: 'user', parts: responseParts });
  }
}

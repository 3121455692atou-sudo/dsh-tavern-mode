import { toolPresetMessages } from './presets.js';
import { staticText } from './prompt-context.js';

// A stale per-agent preset id must not opt the shared prose preset into every
// tool. Custom agent prompts are explicit; evaluate selected prompts in ONE batch.
export function explicitToolPreset(agent, agentPresets) {
  return !!(agent?.presetId && agentPresets?.[agent.presetId]);
}

export async function renderToolPrompts(preset, { stage, explicit, mode, prompt = '' }, render) {
  const messages = [...toolPresetMessages(preset, { stage, explicit, mode }),
    ...(prompt?.trim() ? [{ role: 'system', content: prompt }] : [])];
  if (!messages.length) return [];
  const dynamic = messages.some(message => /<%|<if\b|\{\{/.test(message.content));
  const result = dynamic ? await render(messages.map(message => ({ text: message.content }))) : null;
  return messages.map((message, index) => ({
    role: /^(ai|assistant)$/i.test(message.role) ? 'assistant' : message.role.toLowerCase(),
    content: result?.texts[index] ?? message.content,
    cacheStatic: staticText(message.content),
  }));
}

import { toolScopeAllows } from './tool-policy.js';
import officialDefault from '../vendor/default-preset.json' with { type: 'json' };

const { openai_max_tokens: _defaultOutputLimit, openai_max_context: _defaultContextLimit, ...defaultWritingPreset } = officialDefault;
export { defaultWritingPreset };

export const MARKERS = ['worldInfoBefore', 'personaDescription', 'charDescription', 'charPersonality', 'scenario', 'worldInfoAfter', 'dialogueExamples', 'chatHistory'];
const SETTING_MAP = { max_context: 'openai_max_context', max_completion_tokens: 'openai_max_tokens', reply_count: 'n', should_stream: 'stream_openai', request_thoughts: 'show_thoughts', enable_function_calling: 'function_calling', enable_web_search: 'enable_web_search' };

export function presetPrompts(preset, characterId = 100001) {
  if (!preset) return [];
  if (preset.settings && !preset.prompt_order) return preset.prompts ?? [];
  const order = (preset.prompt_order ?? []).find(x => String(x.character_id) === String(characterId)) ?? preset.prompt_order?.find(x => x.character_id === 100001) ?? preset.prompt_order?.[0];
  const byId = new Map((preset.prompts ?? []).map(prompt => [prompt.identifier, prompt]));
  const sequence = order?.order ?? (preset.prompts ?? []).map(p => ({ identifier: p.identifier, enabled: p.enabled !== false }));
  return sequence.map(ref => {
    const prompt = byId.get(ref.identifier);
    if (!prompt) throw new Error(`预设顺序引用了不存在的提示词：${ref.identifier}`);
    return {
      ...prompt, id: prompt.identifier, enabled: ref.enabled === true,
      position: Number(prompt.injection_position) === 1 ? { type: 'in_chat', depth: prompt.injection_depth ?? 4, order: prompt.injection_order ?? 100 } : { type: 'relative' },
      extra: { raw: prompt },
    };
  });
}

export function toHelperPreset(preset) {
  const prompts = presetPrompts(preset);
  const included = new Set(prompts.map(p => p.id));
  const settings = { ...preset };
  delete settings.prompts; delete settings.prompt_order; delete settings.extensions;
  for (const [helper, native] of Object.entries(SETTING_MAP)) if (preset[native] !== undefined) settings[helper] = preset[native];
  return {
    settings, prompts,
    prompts_unused: (preset.prompts ?? []).filter(p => !included.has(p.identifier)).map(p => ({ ...p, id: p.identifier, enabled: false, position: Number(p.injection_position) === 1 ? { type: 'in_chat', depth: p.injection_depth ?? 4, order: p.injection_order ?? 100 } : { type: 'relative' }, extra: { raw: p } })),
    extensions: structuredClone(preset.extensions ?? {}),
  };
}

export function fromHelperPreset(helper, original = {}) {
  const result = structuredClone(original);
  for (const [key, value] of Object.entries(helper.settings ?? {})) result[SETTING_MAP[key] ?? key] = value;
  const old = new Map((original.prompts ?? []).map(p => [p.identifier, p]));
  const convert = prompt => {
    const { raw, ...extra } = prompt.extra ?? {};
    return {
    ...(old.get(prompt.id) ?? raw ?? {}), ...extra, identifier: prompt.id, name: prompt.name, enabled: prompt.enabled,
    role: prompt.role ?? 'system', content: prompt.content ?? '', marker: MARKERS.includes(prompt.id),
    injection_position: prompt.position?.type === 'in_chat' ? 1 : 0,
    injection_depth: prompt.position?.depth ?? old.get(prompt.id)?.injection_depth ?? 4,
    injection_order: prompt.position?.order ?? old.get(prompt.id)?.injection_order ?? 100,
    };
  };
  result.prompts = [...helper.prompts, ...(helper.prompts_unused ?? [])].map(convert);
  result.prompt_order ??= [];
  const index = Math.max(0, result.prompt_order.findIndex(order => String(order.character_id) === '100001'));
  result.prompt_order[index] = { ...(result.prompt_order[index] ?? { character_id: 100001 }), order: helper.prompts.map(p => ({ identifier: p.id, enabled: p.enabled })) };
  result.extensions = structuredClone(helper.extensions ?? original.extensions ?? {});
  return result;
}

export function toolPresetMessages(preset, { stage, explicit = false, mode = 'full' } = {}) {
  if (!preset) return [];
  return presetPrompts(preset).filter(prompt => (mode === 'full' || explicit || toolScopeAllows(prompt, stage)) && prompt.enabled && !prompt.marker && !MARKERS.includes(prompt.id) && prompt.content?.trim() && prompt.position?.type !== 'in_chat')
    .map(prompt => ({ role: prompt.role ?? 'system', content: prompt.content }));
}

export function legacyPromptMessages(data, type, replacements = {}) {
  if (!data) return [];
  const source = type === 'table' ? data.charCardPrompt : data.plotSettings?.promptGroup?.length ? data.plotSettings.promptGroup : data.plotSettings?.prompts ?? data.promptGroup ?? data.prompts ?? (Array.isArray(data) ? data : []);
  return (source ?? []).filter(p => p.enabled !== false && typeof p.content === 'string').map(p => ({
    role: String(p.role ?? 'system').toLowerCase(),
    content: p.content.replace(/\$[A-Za-z][A-Za-z_]*|\{\{([^{}]+)\}\}/g, (whole, key) => Object.hasOwn(replacements, key ?? whole) ? String(replacements[key ?? whole]) : whole),
  }));
}

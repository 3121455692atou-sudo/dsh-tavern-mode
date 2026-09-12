const escape = value => value.replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
export const interactionInstruction = '在正文和角色卡协议之后，用独立的 <tavern_ui>JSON</tavern_ui> 块提供状态与可点击行动。JSON 格式为 {"status":[{"label":"状态名称","value":"状态值"}],"choices":[{"label":"按钮文字","message":"点击后代表用户发送的完整内容"}]}。两个字段都是数组；没有对应内容时用空数组。状态与行动只写入此块，正文中照常叙述。';
export const INTERACTION = {
  type: 'object', additionalProperties: false, required: ['status', 'choices'],
  properties: Object.fromEntries([['status', 'value'], ['choices', 'message']].map(([key, field]) => [key, {
    type: 'array', items: { type: 'object', additionalProperties: false, required: ['label', field], properties: { label: { type: 'string' }, [field]: { type: 'string' } } },
  }])),
};

export async function repairInteraction(text, repair) {
  try { extractInteraction(text); return text; }
  catch (error) {
    const matches = [...text.matchAll(/<tavern_ui>\s*([\s\S]*?)\s*<\/tavern_ui>/g)];
    if (matches.length !== 1) throw error;
    const match = matches[0], panel = await repair(match[1], error.message);
    const result = text.slice(0, match.index) + '<tavern_ui>' + JSON.stringify(panel) + '</tavern_ui>' + text.slice(match.index + match[0].length);
    extractInteraction(result);
    return result;
  }
}

export function extractInteraction(text) {
  const pattern = /<tavern_ui>\s*([\s\S]*?)\s*<\/tavern_ui>/g;
  const matches = [...text.matchAll(pattern)];
  if (!matches.length) {
    if (text.includes('<tavern_ui>')) throw new Error('交互协议未闭合');
    return { text, panel: null };
  }
  if (matches.length !== 1) throw new Error('交互协议应只有一个数据块');
  let panel;
  try { panel = JSON.parse(matches[0][1]); } catch { throw new Error('交互协议不是有效 JSON'); }
  if (!panel || Array.isArray(panel) || Object.keys(panel).some(key => !['status','choices'].includes(key))) throw new Error('交互协议字段无效');
  for (const [key, fields] of [['status',['label','value']],['choices',['label','message']]]) {
    if (!Array.isArray(panel[key]) || panel[key].some(item => !item || Object.keys(item).length !== 2 || fields.some(field => typeof item[field] !== 'string'))) throw new Error('交互协议数据无效');
  }
  return { text: text.replace(pattern, ''), panel };
}

export function interactionHtml(panel) {
  const status = panel.status.length ? `<details><summary>状态</summary><dl>${panel.status.map(item=>`<div><dt>${escape(item.label)}</dt><dd>${escape(item.value)}</dd></div>`).join('')}</dl></details>` : '';
  return `<style>body{font:14px/1.7 var(--tavern-font,system-ui);color:var(--tavern-color)}details{border:1px solid #8884;border-radius:10px;padding:10px 14px;margin-bottom:12px}summary{cursor:pointer}dl>div{display:flex;gap:18px}dt{opacity:.65}dd{margin:0}.actions{display:flex;flex-wrap:wrap;gap:8px}button{font:inherit;color:inherit;background:transparent;border:1px solid #8885;border-radius:8px;padding:8px 12px;cursor:pointer}button:hover{background:var(--tavern-bubble)}button:focus-visible{outline:2px solid #6384f4}</style>${status}<div class="actions">${panel.choices.map((item,index)=>`<button data-choice="${index}">${escape(item.label)}</button>`).join('')}</div><script>const choices=${JSON.stringify(panel.choices).replaceAll('<','\\u003c')};document.querySelectorAll('[data-choice]').forEach(button=>button.addEventListener('click',async()=>{button.disabled=true;try{await sendUserMessage(choices[Number(button.dataset.choice)].message);}finally{button.disabled=false;}}));<\/script>`;
}

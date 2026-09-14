export const DEFAULT_WRITING_LENGTH = Object.freeze({ min: 2000, max: 4000 });

export function writingLengthInstruction(config = {}) {
  const min = config.writingMinChars ?? DEFAULT_WRITING_LENGTH.min;
  const max = config.writingMaxChars ?? DEFAULT_WRITING_LENGTH.max;
  return `正文篇幅目标：${min}–${max} 字。这是写作提示，不是硬性输出上限。仅计算最终正文的叙述与对白，不计思考内容、HTML 标签、状态栏和协议数据。思考长度不受此区间限制；请在正文目标范围内安排情节并自然收束，完整保留角色卡要求的协议块，不要为凑字数重复内容或截断输出。`;
}

export function withWritingLength(messages, config) {
  const instruction = writingLengthInstruction(config);
  return messages[0]?.role === 'system'
    ? [{ ...messages[0], content: `${instruction}\n\n${messages[0].content}` }, ...messages.slice(1)]
    : [{ role: 'system', content: instruction }, ...messages];
}

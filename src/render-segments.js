import { parseFragment } from 'parse5';
import { marked } from 'marked';

const blocks = new Set('address article aside blockquote canvas details dialog div dl fieldset figure footer form h1 h2 h3 h4 h5 h6 header hr iframe main nav ol p pre script section style table ul svg video audio template'.split(' '));
const containsBlock = node => blocks.has(node.tagName) || (node.childNodes ?? []).some(containsBlock);

function isHtmlDocument(source) {
  return /^\s*<!DOCTYPE\s+html\b/i.test(source);
}

function unfenced(source) {
  if (!source) return [];
  const embedded = source.match(/<!DOCTYPE\s+html\b[\s\S]*$/i);
  if (embedded?.index > 0) return [...unfenced(source.slice(0, embedded.index)), { html: embedded[0] }];
  if (isHtmlDocument(source) || /^\s*<(?:!doctype|html|head|body)\b/i.test(source)) return [{ html: source }];
  const literals = [];
  marked.walkTokens(marked.lexer(source), token => {
    if (token.type !== 'codespan') return;
    for (let at = source.indexOf(token.raw); at >= 0; at = source.indexOf(token.raw, at + token.raw.length)) literals.push([at, at + token.raw.length]);
  });
  const ranges = [];
  for (const node of parseFragment(source, { sourceCodeLocationInfo: true }).childNodes) {
    const location = node.sourceCodeLocation;
    if (!location || literals.some(([start, end]) => location.startOffset >= start && location.startOffset < end)) continue;
    if (node.nodeName === '#comment') { ranges.push({ start: location.startOffset, end: location.endOffset, block: true, comment: true }); continue; }
    if (!node.tagName) continue;
    const block = containsBlock(node);
    const previous = ranges.at(-1);
    if (previous && !previous.comment && previous.block === block && !source.slice(previous.end, location.startOffset).trim()) previous.end = location.endOffset;
    else ranges.push({ start: location.startOffset, end: location.endOffset, block });
  }
  const result = []; let offset = 0;
  for (const range of ranges.filter(range => range.block)) {
    if (range.start > offset) result.push({ text: source.slice(offset, range.start) });
    if (!range.comment) result.push({ html: source.slice(range.start, range.end) }); offset = range.end;
  }
  if (offset < source.length) result.push({ text: source.slice(offset) });
  return result;
}

// Extract complete fenced components before Markdown's raw-HTML block rules can
// consume their opening fence. HTML source ranges preserve scripts and entities.
export function renderSegments(text) {
  const result = [], opening = /^ {0,3}(`{3,}|~{3,})([^\n]*)\n/gm;
  let offset = 0, match;
  while ((match = opening.exec(text))) {
    const closing = new RegExp('^ {0,3}' + match[1][0] + '{' + match[1].length + ',}[ \\t]*(?:\\n|$)', 'gm');
    closing.lastIndex = opening.lastIndex;
    const end = closing.exec(text);
    if (!end) { result.push(...unfenced(text.slice(offset, match.index)), { text: text.slice(match.index) }); offset = text.length; break; }
    result.push(...unfenced(text.slice(offset, match.index)));
    const body = text.slice(opening.lastIndex, end.index);
    if (/^html?(?:\s|$)/i.test(match[2].trim()) || isHtmlDocument(body)) result.push({ html: body });
    else result.push({ text: text.slice(match.index, closing.lastIndex) });
    offset = opening.lastIndex = closing.lastIndex;
  }
  result.push(...unfenced(text.slice(offset)));
  return result.reduce((segments, part) => {
    if (part.text !== undefined && segments.at(-1)?.text !== undefined) segments.at(-1).text += part.text;
    else segments.push(part);
    return segments;
  }, []);
}

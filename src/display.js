import { renderSegments } from './render-segments.js';
import { buildSpeechDocument, hasSpeechMarks } from './speech-frame.js';

export function displaySegments(text, enabled, meta = {}) {
  if (enabled && typeof enabled === 'object') { meta = enabled; enabled = true; }
  if (!enabled) return renderSegments(text);
  return renderSegments(text).flatMap(part => {
    if (part.html !== undefined) return [part];
    if (!hasSpeechMarks(part.text)) return [part];
    return [{ html: buildSpeechDocument(part.text, meta) }];
  });
}

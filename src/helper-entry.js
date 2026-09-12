import { klona } from 'klona';
import * as preset from '@/function/preset';
import * as regex from '@/function/tavern_regex';
import * as events from '@/function/event';
import * as globals from '@/function/global';
import * as util from '@/function/util';
import * as version from '@/function/version';
import * as lorebookEntries from '@/function/lorebook_entry';
import { getWorldbook, replaceWorldbook, updateWorldbookWith, createWorldbookEntries, deleteWorldbookEntries } from '@/function/worldbook';
export { fromCharacterBook } from '@/util/compatibility';
export { newWorldInfoEntryTemplate } from '../vendor/tavern-helper/host/world-info.js';

window.klona = klona;
export const api = Object.fromEntries(Object.entries({ ...preset, ...regex, ...globals, ...util, ...version, ...lorebookEntries, getWorldbook, replaceWorldbook, updateWorldbookWith, createWorldbookEntries, deleteWorldbookEntries }).filter(([key, value]) => !key.startsWith('_') && typeof value === 'function'));
export const { tavern_events, iframe_events } = events;
export function bind(target) {
  const bound = Object.fromEntries(Object.entries({ ...events, ...globals, ...util }).filter(([key, value]) => key.startsWith('_') && typeof value === 'function').map(([key, value]) => [key.slice(1), value.bind(target)]));
  for (const name of ['eventOn', 'eventOnce', 'eventMakeFirst', 'eventMakeLast']) {
    const register = bound[name];
    bound[name] = (event, listener) => ({ ...register(event, listener), stop: () => bound.eventRemoveListener(event, listener) });
  }
  Object.assign(target, bound);
  return bound;
}

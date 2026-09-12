// Extracted from SillyTavern 1.18.0 / ST-Prompt-Template 1.17.1 (2026-09-11).
// Source ranges, hashes and adaptations: upstream.json. License: LICENSE-AGPL-3.0.
export function createWorldInfoReader({ context, _, characters, this_chid, power_user, chat_metadata, chat, loadWorldInfo, evalTemplate, substituteParams, getRegexedString }) {
  const regex_placement = { WORLD_INFO: 5 };
  const world_info_position = {
    before: 0,
    after: 1,
    ANTop: 2,
    ANBottom: 3,
    atDepth: 4,
    EMTop: 5,
    EMBottom: 6,
    outlet: 7
  };
  const DEFAULT_DEPTH = 4;
  const METADATA_KEY = "world_info";
  const KNOWN_DECORATORS = [
    "@@activate",
    "@@dont_activate",
    "@@message_formatting",
    "@@generate_before",
    "@@generate_after",
    "@@render_before",
    "@@render_after",
    "@@dont_preload",
    "@@initial_variables",
    "@@always_enabled",
    "@@only_preload",
    "@@iframe",
    "@@preprocessing",
    "@@if",
    "@@private"
  ];
  const DEPTH_MAPPING = {
    [world_info_position.before]: 4,
    // Before Char Defs
    [world_info_position.after]: 3,
    // After Char Defs
    [world_info_position.EMTop]: 2,
    // Before Example Messages
    [world_info_position.EMBottom]: 1,
    // After Example Messages
    [world_info_position.ANTop]: 1,
    // Top of Author's Note
    [world_info_position.ANBottom]: -1
    // Bottom of Author's Note
  };
  function getWorldInfoSorter(entries) {
    return (a, b) => worldInfoSorter(a, b, Math.max(...entries.map((x) => x.position === world_info_position.atDepth ? x.depth : 0)));
  }
  function worldInfoSorter(a, b, top = DEFAULT_DEPTH) {
    function calcDepth(entry) {
      const offset = DEPTH_MAPPING[entry.position];
      if (offset == null)
        return entry.depth ?? DEFAULT_DEPTH;
      if (entry.position === world_info_position.ANTop || entry.position === world_info_position.ANBottom) {
        switch (chat_metadata.note_position) {
          case 0:
          case 2:
            return offset + top + DEPTH_MAPPING[world_info_position.before] + 2;
          case 1:
            return (chat_metadata.note_depth ?? DEFAULT_DEPTH) + (entry.depth ?? DEFAULT_DEPTH);
        }
      }
      return offset + top;
    }
    return calcDepth(b) - calcDepth(a) || a.order - b.order || b.uid - a.uid;
  }
  function parseDecorators(content) {
    const getBaseDecorator = (line) => {
      let candidate = line.startsWith("@@@") ? line.substring(1) : line;
      const firstSpaceIndex = candidate.indexOf(" ");
      if (firstSpaceIndex !== -1) {
        candidate = candidate.substring(0, firstSpaceIndex);
      }
      return candidate;
    };
    const isKnownDecorator = (line) => {
      const base = getBaseDecorator(line);
      return KNOWN_DECORATORS.includes(base);
    };
    if (!content.startsWith("@@")) {
      return [[], content];
    }
    const lines = content.split("\n");
    const decorators = [];
    let contentStartIndex = 0;
    let fallbacked = false;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line.startsWith("@@")) {
        if (line.startsWith("@@@") && !fallbacked) {
          contentStartIndex = i;
          break;
        }
        if (isKnownDecorator(line)) {
          const normalizedLine = line.startsWith("@@@") ? line.substring(1) : line;
          decorators.push(normalizedLine);
          fallbacked = false;
        } else {
          fallbacked = true;
        }
      } else {
        contentStartIndex = i;
        break;
      }
    }
    const newContent = lines.slice(contentStartIndex).join("\n");
    return [decorators, newContent];
  }
  async function getWorldInfoEntries(name) {
    const lore = name || characters[this_chid]?.data?.extensions?.world || power_user.persona_description_lorebook || chat_metadata[METADATA_KEY] || "";
    const lorebook = await loadWorldInfo(lore);
    if (!lorebook) {
      console.log(`[Prompt Template] lorebook not found: ${lore} (${name})`);
      return [];
    }
    const entries = Object.values(lorebook.entries).map((entry) => {
      const clone = { ...entry };
      clone.uid = Number(entry.uid);
      const [decorators, content] = parseDecorators(entry.content);
      clone.decorators = decorators;
      clone.content = content;
      clone.world = lore;
      return clone;
    });
    return entries.sort(getWorldInfoSorter(entries));
  }
  async function getWorldInfoEntry(name, title) {
    let entries = [];
    if (title != null) {
      entries = await getWorldInfoEntries(name);
    } else {
      entries = await getWorldInfoEntries();
      title = name;
    }
    for (const data of entries) {
      if (data.comment === title || data.uid === title || data.comment.match(title))
        return data;
    }
    console.log(`[Prompt Template] entry not found: ${title} (${name})`);
    return null;
  }
  async function boundedReadWorldinfo(worldinfoOrEntry, entryOrData = {}, data = {}) {
    let wi = null;
    if (_.isPlainObject(entryOrData)) {
      wi = await getWorldInfoEntry(this.world_info?.world || "", worldinfoOrEntry);
      if (_.isPlainObject(entryOrData)) {
        data = entryOrData;
      }
    } else {
      wi = await getWorldInfoEntry(worldinfoOrEntry || this.world_info?.world || "", entryOrData);
    }
    if (wi) {
      let content = wi.content;
      if (globalThis.CustomGeneration?.DataOverride) {
        const override = new globalThis.CustomGeneration.DataOverride(chat, chat_metadata);
        content = override.getOverride(wi.world, wi.uid)?.content ?? content;
      }
      return await evalTemplate(
        substituteParams(getRegexedString(content, regex_placement.WORLD_INFO)),
        _.merge(this, data, { world_info: wi }),
        { when: `${wi.world}.${wi.comment}` }
      );
    }
    console.warn(`[Prompt Template] worldinfo ${worldinfoOrEntry} or entry ${entryOrData} not found`);
    return "";
  }
  return boundedReadWorldinfo.bind(context);
}


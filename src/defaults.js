export function defaultTables() {
  return {
    mate: { type: 'chatSheets', version: 2 },
    sheet_scene: {
      uid: 'scene', name: '当前场景', orderNo: 0,
      content: [['row_id', '地点', '时间', '当前情况']],
      sourceData: { ddl: 'CREATE TABLE scene (row_id INTEGER PRIMARY KEY, location TEXT NOT NULL, time TEXT NOT NULL, summary TEXT NOT NULL)', updateNode: '只保留 row_id=1 一行，根据已完成正文更新当前地点、时间和情况。' },
    },
    sheet_characters: {
      uid: 'characters', name: '角色状态', orderNo: 1,
      content: [['row_id', '角色', '地点', '状态', '当前目标']],
      sourceData: { ddl: 'CREATE TABLE characters (row_id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE, location TEXT NOT NULL, state TEXT NOT NULL, intention TEXT NOT NULL)', updateNode: '每名角色一行。记录实际所在位置、可观察状态和已经表达或实行的目标；不把推进计划写成已发生事实。' },
    },
    sheet_threads: {
      uid: 'threads', name: '剧情线索', orderNo: 2,
      content: [['row_id', '线索', '进展', '状态']],
      sourceData: { ddl: "CREATE TABLE threads (row_id INTEGER PRIMARY KEY, topic TEXT NOT NULL, progress TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('进行中','已解决')))", updateNode: '只记录已经在正文出现的重要线索、约定和待办；解决后更新状态。' },
    },
  };
}

export const stageLabels = { roster: '识别角色', recall: '召回记忆', combine: '组合场景', advance: '设计推进', write: '写作', format: '对白格式', memory: '记录记忆', table: '更新表格' };

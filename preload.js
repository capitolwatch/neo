const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('neo', {
  readLibrary: () => ipcRenderer.invoke('library:read'),
  writeLibrary: (data) => ipcRenderer.invoke('library:write', data),
  libraryPath: () => ipcRenderer.invoke('library:path'),

  createBook: (meta) => ipcRenderer.invoke('book:create', meta),
  readBookMeta: (bookId) => ipcRenderer.invoke('book:readMeta', bookId),
  writeBookMeta: (bookId, meta) => ipcRenderer.invoke('book:writeMeta', bookId, meta),
  deleteBook: (bookId, title) => ipcRenderer.invoke('book:delete', bookId, title),
  setCover: (bookId) => ipcRenderer.invoke('book:setCover', bookId),
  coverPath: (bookId, file) => ipcRenderer.invoke('book:coverPath', bookId, file),

  readChapter: (bookId, chId) => ipcRenderer.invoke('chapter:read', bookId, chId),
  writeChapter: (bookId, chId, html) => ipcRenderer.invoke('chapter:write', bookId, chId, html),
  deleteChapter: (bookId, chId) => ipcRenderer.invoke('chapter:delete', bookId, chId),

  readAux: (bookId, name) => ipcRenderer.invoke('aux:read', bookId, name),
  writeAux: (bookId, name, html) => ipcRenderer.invoke('aux:write', bookId, name, html),

  readJSON: (bookId, name, fallback) => ipcRenderer.invoke('json:read', bookId, name, fallback),
  writeJSON: (bookId, name, data) => ipcRenderer.invoke('json:write', bookId, name, data),

  exportSave: (payload) => ipcRenderer.invoke('export:save', payload),
  emailDraft: (payload) => ipcRenderer.invoke('email:draft', payload),
  logError: (msg) => ipcRenderer.invoke('log:error', msg),
  importPick: () => ipcRenderer.invoke('import:pick'),
  setSilo: (on) => ipcRenderer.invoke('silo:set', on),
  fullscreenEscape: () => ipcRenderer.invoke('fullscreen:escape'),

  cards: {
    list: (bookId) => ipcRenderer.invoke('cards:list', bookId),
    blank: (type) => ipcRenderer.invoke('cards:blank', type),
    save: (bookId, card) => ipcRenderer.invoke('cards:save', bookId, card),
    validate: (bookId, card) => ipcRenderer.invoke('cards:validate', bookId, card),
    remove: (bookId, cardId) => ipcRenderer.invoke('cards:delete', bookId, cardId),
    import: (bookId, cards) => ipcRenderer.invoke('cards:import', bookId, cards)
  },

  ai: {
    hasKey: () => ipcRenderer.invoke('ai:hasKey'),
    setKey: (key) => ipcRenderer.invoke('ai:setKey', key),
    clearKey: () => ipcRenderer.invoke('ai:clearKey'),
    suggestCard: (payload) => ipcRenderer.invoke('ai:suggestCard', payload),
    lookupSource: (query, family) => ipcRenderer.invoke('ai:lookupSource', query, family),
    audit: (bookId) => ipcRenderer.invoke('ai:audit', bookId),
    proseCheck: (bookId, n) => ipcRenderer.invoke('ai:proseCheck', bookId, n)
  },

  board: {
    read: (bookId) => ipcRenderer.invoke('board:read', bookId),
    write: (bookId, board) => ipcRenderer.invoke('board:write', bookId, board),
    newTheme: () => ipcRenderer.invoke('board:newTheme')
  },

  sources: {
    list: () => ipcRenderer.invoke('sources:list'),
    blank: (family) => ipcRenderer.invoke('sources:blank', family),
    blankVersion: () => ipcRenderer.invoke('sources:blankVersion'),
    read: (id) => ipcRenderer.invoke('sources:read', id),
    save: (src) => ipcRenderer.invoke('sources:save', src),
    validate: (src) => ipcRenderer.invoke('sources:validate', src),
    remove: (id) => ipcRenderer.invoke('sources:delete', id),
    attach: (id, versionId) => ipcRenderer.invoke('sources:attach', id, versionId),
    archive: (url) => ipcRenderer.invoke('sources:archive', url),
    reveal: (id) => ipcRenderer.invoke('sources:reveal', id)
  },

  onMenu: (cb) => ipcRenderer.on('menu', (_e, msg) => cb(msg))
});

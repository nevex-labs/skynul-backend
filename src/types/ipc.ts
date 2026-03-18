export const IPC = {
  ping: 'skynul:app:ping',
  runtimeGetStats: 'skynul:app:runtime:getStats',
  getPolicy: 'skynul:policy:get',
  pickWorkspace: 'skynul:workspace:pick',
  setCapability: 'skynul:policy:setCapability',
  setTheme: 'skynul:policy:setTheme',
  setOpenAIModel: 'skynul:provider:openai:setModel',
  setOpenAIApiKey: 'skynul:provider:openai:setApiKey',
  hasOpenAIApiKey: 'skynul:provider:openai:hasApiKey',
  chatSend: 'skynul:chat:send',
  openExternal: 'skynul:app:openExternal',
  authOpen: 'skynul:auth:open',
  fsReadText: 'skynul:fs:readText',
  fsWriteText: 'skynul:fs:writeText',
  fsSaveTempFile: 'skynul:fs:saveTempFile',
  clipboardReadText: 'skynul:clipboard:readText',
  chatgptOAuthStart: 'skynul:chatgpt:oauth:start',
  chatgptHasAuth: 'skynul:chatgpt:hasAuth',
  chatgptSignOut: 'skynul:chatgpt:signOut',
  setActiveProvider: 'skynul:provider:setActive',
  setProviderApiKey: 'skynul:provider:setApiKey',
  hasProviderApiKey: 'skynul:provider:hasApiKey',
  setLanguage: 'skynul:policy:setLanguage',
  windowMinimize: 'skynul:window:minimize',
  windowMaximize: 'skynul:window:maximize',
  windowClose: 'skynul:window:close',
  showOpenFilesDialog: 'skynul:dialog:showOpenFiles',

  // ── Task Agent ────────────────────────────────────────────────────────
  taskCreate: 'skynul:task:create',
  taskApprove: 'skynul:task:approve',
  taskCancel: 'skynul:task:cancel',
  taskPause: 'skynul:task:pause',
  taskResume: 'skynul:task:resume',
  taskGet: 'skynul:task:get',
  taskList: 'skynul:task:list',
  taskDelete: 'skynul:task:delete',
  taskSendMessage: 'skynul:task:sendMessage',

  setTaskMemoryEnabled: 'skynul:policy:setTaskMemoryEnabled',
  setTaskAutoApprove: 'skynul:policy:setTaskAutoApprove',

  // ── Skills ──────────────────────────────────────────────────────────
  skillList: 'skynul:skill:list',
  skillSave: 'skynul:skill:save',
  skillDelete: 'skynul:skill:delete',
  skillToggle: 'skynul:skill:toggle',
  skillImport: 'skynul:skill:import',

  // ── Channels ────────────────────────────────────────────────────────
  channelGetAll: 'skynul:channel:getAll',
  channelGetSettings: 'skynul:channel:getSettings',
  channelSetEnabled: 'skynul:channel:setEnabled',
  channelSetCredentials: 'skynul:channel:setCredentials',
  channelGeneratePairing: 'skynul:channel:generatePairing',
  channelUnpair: 'skynul:channel:unpair',
  channelGetGlobal: 'skynul:channel:getGlobal',
  channelSetAutoApprove: 'skynul:channel:setAutoApprove',

  // ── Schedules ──────────────────────────────────────────────────────
  scheduleList: 'skynul:schedule:list',
  scheduleSave: 'skynul:schedule:save',
  scheduleDelete: 'skynul:schedule:delete',
  scheduleToggle: 'skynul:schedule:toggle',

  // ── Audio Transcription ───────────────────────────────────────────────
  transcribeAudio: 'skynul:audio:transcribe',

  // ── Browser Snapshots ─────────────────────────────────────────────────
  browserSnapshotList: 'skynul:browser:snapshot:list',
  browserSnapshotSave: 'skynul:browser:snapshot:save',
  browserSnapshotRestore: 'skynul:browser:snapshot:restore',
  browserSnapshotDelete: 'skynul:browser:snapshot:delete',

  // ── User Facts (long-term memory) ───────────────────────────────────
  factSave: 'skynul:fact:save',
  factDelete: 'skynul:fact:delete',
  factList: 'skynul:fact:list',

  // ── Auto-Update ────────────────────────────────────────────────────
  updateCheck: 'skynul:update:check',
  updateDownload: 'skynul:update:download',
  updateInstall: 'skynul:update:install',

  // ── Projects ────────────────────────────────────────────────────────
  projectList: 'skynul:project:list',
  projectCreate: 'skynul:project:create',
  projectUpdate: 'skynul:project:update',
  projectDelete: 'skynul:project:delete',
  projectAddTask: 'skynul:project:addTask',
  projectRemoveTask: 'skynul:project:removeTask',

  // ── Ollama ─────────────────────────────────────────────────────────────
  ollamaPing: 'skynul:ollama:ping',
  ollamaModels: 'skynul:ollama:models',
  ollamaInstalled: 'skynul:ollama:installed',

  // ── Secrets (generic key-value) ──────────────────────────────────────
  getSecretKeys: 'skynul:secrets:getKeys',
  getSecret: 'skynul:secrets:get',
  setSecret: 'skynul:secrets:set',
} as const;

export type IpcChannel = (typeof IPC)[keyof typeof IPC];

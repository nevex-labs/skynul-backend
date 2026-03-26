import { TASK_CAPABILITY_IDS, type TaskCapabilityId, type TaskMode, type TaskRunnerId } from '../../types';
import type { ChatMessage } from '../../types';
import { deriveRunner } from './task-routing';

export type TaskInferenceInput = {
  prompt: string;
  attachments?: string[];
};

export type TaskInferenceResult = {
  mode: TaskMode;
  runner: TaskRunnerId;
  capabilities: TaskCapabilityId[];
  source: 'rules' | 'llm';
  confidence: number;
};

export type TaskInferenceStrategy = 'rules' | 'llm' | 'auto';

function stripDiacritics(s: string): string {
  // NFD splits accents into separate codepoints; remove combining marks.
  return s.normalize('NFD').replace(/\p{M}/gu, '');
}

function normalizePrompt(prompt: string): string {
  return stripDiacritics(prompt).toLowerCase();
}

function hasAny(haystack: string, needles: string[]): boolean {
  return needles.some((n) => haystack.includes(n));
}

function isSimpleMathPrompt(prompt: string): boolean {
  const p = normalizePrompt(prompt);
  // High-signal phrases for arithmetic questions
  const askMath =
    hasAny(p, ['cuanto es', 'cuanto da', 'decime cuanto', 'dime cuanto', 'calculate', 'calc', 'what is', "what's"]) ||
    /\b(\d+\s*(\+|\-|\*|x|×|\/|÷)\s*\d+)\b/.test(p);

  if (!askMath) return false;

  // If the prompt also contains strong "do something" signals, it's not trivial.
  const nonTrivialSignals = [
    'http://',
    'https://',
    'browser',
    'website',
    'webpage',
    'navigate',
    'scrape',
    'search',
    'google',
    'download',
    'descarg',
    'excel',
    'word',
    'powerpoint',
    'binance',
    'coinbase',
    'polymarket',
    'swap',
    'dex',
    'onchain',
    'defi',
    'uniswap',
    'file',
    'repo',
    'git',
    'endpoint',
    'api',
  ];
  if (hasAny(p, nonTrivialSignals)) return false;

  // Keep it conservative: very short prompts only.
  return p.trim().length <= 80;
}

function isInformationQuestion(prompt: string): boolean {
  const p = normalizePrompt(prompt).trim();

  const looksLikeQuestion =
    p.endsWith('?') ||
    hasAny(p, [
      'que ',
      'que es',
      'como ',
      'como es',
      'por que',
      'porque',
      'para que',
      'quien',
      'quienes',
      'donde',
      'cuando',
      'which ',
      'what ',
      "what's ",
      'why ',
      'how ',
      'tell me',
      'explain',
      'define',
    ]);

  if (!looksLikeQuestion) return false;

  // If the user is clearly asking the agent to DO something (tools), it's not info-only.
  const toolSignals = [
    'http://',
    'https://',
    'browser',
    'website',
    'webpage',
    'navigate',
    'scrape',
    'search',
    'google',
    'bing',
    'duckduckgo',
    'download',
    'descarg',
    'abrir',
    'open ',
    'compr',
    'buy',
    'reserv',
    'book',
    'flight',
    'vuelo',
    'hotel',
    'excel',
    'word',
    'powerpoint',
    'blender',
    'photoshop',
    'illustrator',
    'polymarket',
    'binance',
    'coinbase',
    'swap',
    'dex',
    'onchain',
    'defi',
    'uniswap',
    'repo',
    'git',
    'endpoint',
    'api',
    'cbu',
    'cvu',
    'transferir',
    'prometeo',
    'plaid',
    'wire transfer',
    'bank transfer',
    'transferencia bancaria',
  ];

  return !hasAny(p, toolSignals);
}

function normalizeCapabilities(caps: string[]): TaskCapabilityId[] {
  const allowed = TASK_CAPABILITY_IDS;
  const set = new Set<TaskCapabilityId>();
  for (const c of caps) {
    if ((allowed as readonly string[]).includes(c)) set.add(c as TaskCapabilityId);
  }
  return [...set];
}

function inferCapabilitiesRules(prompt: string): TaskCapabilityId[] {
  const p = normalizePrompt(prompt);

  // Trivial arithmetic/questions: no special capabilities required.
  if (isSimpleMathPrompt(prompt)) return [];
  if (isInformationQuestion(prompt)) return [];

  const caps = new Set<TaskCapabilityId>();

  // Browser / web intent: only add when there's a clear web action.
  const hasUrl = /https?:\/\//.test(p);
  const webActionVerbs = [
    'navigate',
    'scrape',
    'search',
    'google',
    'bing',
    'duckduckgo',
    'busc',
    'naveg',
    'download',
    'descarg',
    'open ',
    ' abrir',
  ];
  const webTargets = ['amazon', 'mercadolibre', 'airbnb', 'despegar'];
  if (hasUrl || hasAny(p, webActionVerbs) || hasAny(p, webTargets)) caps.add('browser.cdp');

  // Trading
  if (hasAny(p, ['polymarket'])) caps.add('polymarket.trading');
  if (hasAny(p, ['swap', 'dex', 'onchain', 'defi', 'uniswap', 'base chain', 'weth', 'send eth', 'send usdc'])) {
    caps.add('onchain.trading');
  }
  if (hasAny(p, ['binance', 'coinbase', 'cex', 'spot order', 'limit order', 'market order'])) caps.add('cex.trading');
  // Fiat bank transfers: require high-specificity signals to avoid false positives.
  // Generic words like "pagar" or "banco" are NOT enough — they fire on "pagar en Amazon".
  // We require either an explicit provider name, a banking identifier (CBU/CVU/alias),
  // or a combination of transfer verb + fiat amount keyword.
  const hasFiatProvider = hasAny(p, ['prometeo', 'plaid', 'dwolla']);
  const hasBankingId = hasAny(p, ['cbu', 'cvu', ' alias bancario', 'cuenta bancaria', 'clabe', 'iban', 'routing number', 'account number', 'ach transfer', 'wire transfer', 'bank transfer', 'transferencia bancaria']);
  const hasFiatTransferVerb = hasAny(p, ['transferir', 'hacer una transferencia', 'mandar plata', 'mandar dinero', 'enviar dinero', 'enviar plata', 'send money', 'fiat transfer']);
  const hasFiatBalance = hasAny(p, ['saldo bancario', 'saldo en el banco', 'bank balance', 'bank account balance']);
  if (hasFiatProvider || hasBankingId || hasFiatTransferVerb || hasFiatBalance) {
    caps.add('fiat.transfers');
  }

  // Apps / Office / Creative tooling (brands are useful regardless of UI language)
  if (hasAny(p, ['launch', 'open app', 'whatsapp', 'telegram', 'discord', 'slack', 'spotify'])) caps.add('app.launch');
  if (hasAny(p, ['excel', 'word', 'powerpoint', 'spreadsheet', 'document', 'formatting']))
    caps.add('office.professional');
  if (
    hasAny(p, [
      'illustrator',
      'photoshop',
      'after effects',
      'aftereffects',
      'blender',
      'unreal',
      'indesign',
      'premiere',
      'vector',
      'logo',
      'render',
      '3d model',
      'compositing',
    ])
  ) {
    caps.add('app.scripting');
  }

  // If nothing matched, default to NO special capabilities.
  return [...caps];
}

function inferModeRules(prompt: string, capabilities: TaskCapabilityId[], attachments?: string[]): TaskMode {
  const p = normalizePrompt(prompt);

  if (isSimpleMathPrompt(prompt)) return 'code';
  if (isInformationQuestion(prompt)) return 'code';

  // If it's explicitly a trading/transfers task, we treat it as browser-mode entrypoint (TaskRunner will route to CDP).
  if (capabilities.some((c) => c.endsWith('.trading') || c === 'fiat.transfers')) return 'browser';

  // Strong code signals
  const codeSignals = [
    'implement',
    'refactor',
    'bug',
    'stack trace',
    'typescript',
    'javascript',
    'node',
    'backend',
    'frontend',
    'api',
    'endpoint',
    'fix ',
    'error',
    'compile',
    'test',
    'unit test',
    'docker',
    'kubernetes',
    'ci',
    'lint',
    'repo',
    'pull request',
    'git',
    'npm',
    'pnpm',
    'bun',
    'python',
    'go ',
    'java',
    'c#',
    'sql',
    'migration',
  ];
  if (hasAny(p, codeSignals)) return 'code';

  // Attachments usually imply code-mode work.
  const att = attachments ?? [];
  if (att.some((a) => /\.(ts|tsx|js|jsx|py|go|java|rb|php|cs|sql|json|yml|yaml|md|toml|env)$/i.test(a))) {
    return 'code';
  }

  // If it needs browser, use browser. Otherwise default to code (chat-only/tool-less).
  if (capabilities.includes('browser.cdp')) return 'browser';
  return 'code';
}

export function inferTaskSetupRules(input: TaskInferenceInput): TaskInferenceResult {
  const capabilities = inferCapabilitiesRules(input.prompt);
  const mode = inferModeRules(input.prompt, capabilities, input.attachments);
  const runner: TaskRunnerId = deriveRunner(mode, capabilities);

  // Confidence: high when we have strong signals, low when we default to chat-only.
  const p = normalizePrompt(input.prompt);
  let confidence = 0.4;
  if (isSimpleMathPrompt(input.prompt) || isInformationQuestion(input.prompt)) confidence = 0.95;
  else if (capabilities.some((c) => c.endsWith('.trading') || c === 'fiat.transfers')) confidence = 0.95;
  else if (
    capabilities.includes('app.scripting') ||
    capabilities.includes('office.professional') ||
    capabilities.includes('app.launch')
  )
    confidence = 0.9;
  else if (capabilities.includes('browser.cdp')) confidence = /https?:\/\//.test(p) ? 0.9 : 0.75;
  else confidence = 0.45;

  return { mode, runner, capabilities, source: 'rules', confidence };
}

function extractJsonObject(text: string): string {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) throw new Error('No JSON object found in model output');
  return text.slice(start, end + 1);
}

export async function inferTaskSetupLLM(opts: {
  input: TaskInferenceInput;
  chat: (messages: ChatMessage[]) => Promise<string>;
}): Promise<TaskInferenceResult> {
  const prompt = opts.input.prompt;
  const attachments = opts.input.attachments ?? [];

  const sys =
    'You are a task classifier for an autonomous agent backend. ' +
    'Return ONE JSON object ONLY with keys: mode, runner, capabilities, confidence. ' +
    'mode: "browser" or "code". runner: "browser" | "code" | "cdp". ' +
    'capabilities must be an array containing any of: ' +
    `${JSON.stringify([...TASK_CAPABILITY_IDS])}. ` +
    'Rules: ' +
    '(1) If the user is asking a simple question (facts, explanations, math), use mode="code", capabilities=[]. ' +
    '(2) Only include browser.cdp if the user explicitly wants web navigation/search/scraping/download/opening websites. ' +
    '(3) For trading intents, include the specific *.trading capability and set runner="cdp" (mode can stay "browser"). ' +
    '(4) Use fiat.transfers when the user wants to execute a bank transfer, send money to a bank account, check a bank balance, or mentions banking identifiers (CBU, CVU, CLABE, IBAN, routing number, ACH, wire transfer) or providers (Prometeo, Plaid). Set runner="cdp". ' +
    '(5) confidence is a number 0..1.';

  const user =
    `Prompt: ${prompt}\n` +
    (attachments.length ? `Attachments: ${attachments.join(', ')}\n` : '') +
    'Classify this task.';

  const messages: ChatMessage[] = [{ role: 'user', content: sys + '\n\n' + user }];

  const raw = await opts.chat(messages);
  const jsonText = extractJsonObject(raw);
  const parsed = JSON.parse(jsonText) as {
    mode?: string;
    runner?: string;
    capabilities?: string[];
    confidence?: number;
  };

  const capabilities = normalizeCapabilities(Array.isArray(parsed.capabilities) ? parsed.capabilities : []);
  const mode: TaskMode = parsed.mode === 'browser' ? 'browser' : 'code';
  const runner: TaskRunnerId = deriveRunner(mode, capabilities);

  const confidence =
    typeof parsed.confidence === 'number' && Number.isFinite(parsed.confidence)
      ? Math.max(0, Math.min(1, parsed.confidence))
      : 0.6;

  return { mode, runner, capabilities, source: 'llm', confidence };
}

export async function inferTaskSetup(opts: {
  input: TaskInferenceInput;
  strategy?: TaskInferenceStrategy;
  chat: (messages: ChatMessage[]) => Promise<string>;
}): Promise<TaskInferenceResult> {
  const strategy = opts.strategy ?? 'auto';
  if (strategy === 'rules') return inferTaskSetupRules(opts.input);
  if (strategy === 'llm') return inferTaskSetupLLM({ input: opts.input, chat: opts.chat });

  const rules = inferTaskSetupRules(opts.input);
  if (rules.confidence >= 0.75) return rules;
  try {
    return await inferTaskSetupLLM({ input: opts.input, chat: opts.chat });
  } catch {
    return rules;
  }
}

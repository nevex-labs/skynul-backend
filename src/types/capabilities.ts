export const TASK_CAPABILITY_IDS = [
  'browser.cdp',
  'app.launch',
  'polymarket.trading',
  'office.professional',
  'app.scripting',
  'onchain.trading',
  'cex.trading',
] as const;

export type TaskCapabilityId = (typeof TASK_CAPABILITY_IDS)[number];

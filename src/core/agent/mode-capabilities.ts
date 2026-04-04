/**
 * Mode-to-capability mappings.
 *
 * Each mode has a set of default capabilities that are auto-assigned
 * when a task is created. Users can override in Advanced mode.
 */

import type { TaskCapabilityId } from '../../shared/types/task';

export type TaskMode = 'browser' | 'code';

export const MODE_CAPABILITIES: Record<TaskMode, TaskCapabilityId[]> = {
  browser: ['browser.cdp', 'app.launch'],
  code: ['office.professional', 'app.scripting'],
};

export interface CapabilityGroup {
  id: string;
  label: string;
  icon: string;
  capabilities: Array<{
    id: TaskCapabilityId;
    title: string;
    desc: string;
  }>;
}

export const CAPABILITY_GROUPS: CapabilityGroup[] = [
  {
    id: 'browser',
    label: 'Browser',
    icon: 'globe',
    capabilities: [
      { id: 'browser.cdp', title: 'Browser Control', desc: 'Control Chrome via Playwright (CDP).' },
      { id: 'app.launch', title: 'Launch Apps', desc: 'Open applications on your computer.' },
    ],
  },
  {
    id: 'code',
    label: 'Code & Files',
    icon: 'terminal',
    capabilities: [
      { id: 'office.professional', title: 'Office Pro', desc: 'Professional formatting for Excel, Word, PowerPoint.' },
      { id: 'app.scripting', title: 'App Scripting', desc: 'Run scripts in Illustrator, Photoshop, Blender, etc.' },
    ],
  },
  {
    id: 'trading',
    label: 'Trading',
    icon: 'trending-up',
    capabilities: [
      { id: 'polymarket.trading', title: 'Polymarket', desc: 'Trade on Polymarket prediction markets.' },
      { id: 'onchain.trading', title: 'On-Chain Trading', desc: 'Trade on DEXs and manage on-chain assets (EVM).' },
      { id: 'cex.trading', title: 'CEX Trading', desc: 'Trade on centralized exchanges (Binance, Coinbase).' },
    ],
  },
];

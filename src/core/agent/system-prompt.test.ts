import { describe, it, expect } from 'vitest';
import { buildBrowserSystemPrompt, buildCdpSystemPrompt, buildCodeSystemPrompt, buildOrchestratorSystemPrompt } from './system-prompt';

describe('buildCdpSystemPrompt', () => {
  describe('onchain.trading capability', () => {
    it('includes on-chain block when capability is active', () => {
      const prompt = buildCdpSystemPrompt(['onchain.trading']);
      expect(prompt).toContain('ON-CHAIN TRADING ACTIONS');
      expect(prompt).toContain('chain_get_balance');
      expect(prompt).toContain('chain_send_token');
      expect(prompt).toContain('chain_swap');
      expect(prompt).toContain('chain_get_tx_status');
      expect(prompt).toContain('0.40 USDC');
    });

    it('omits on-chain block when capability is not active', () => {
      const prompt = buildCdpSystemPrompt(['polymarket.trading']);
      expect(prompt).not.toContain('ON-CHAIN TRADING ACTIONS');
      expect(prompt).not.toContain('chain_get_balance');
    });

    it('includes Base Sepolia as default chain reference', () => {
      const prompt = buildCdpSystemPrompt(['onchain.trading']);
      expect(prompt).toContain('Base Sepolia');
      expect(prompt).toContain('84532');
    });
  });

  describe('cex.trading capability', () => {
    it('includes CEX block when capability is active', () => {
      const prompt = buildCdpSystemPrompt(['cex.trading']);
      expect(prompt).toContain('CEX TRADING ACTIONS');
      expect(prompt).toContain('cex_get_balance');
      expect(prompt).toContain('cex_place_order');
      expect(prompt).toContain('cex_cancel_order');
      expect(prompt).toContain('cex_get_positions');
      expect(prompt).toContain('cex_withdraw');
    });

    it('omits CEX block when capability is not active', () => {
      const prompt = buildCdpSystemPrompt(['polymarket.trading']);
      expect(prompt).not.toContain('CEX TRADING ACTIONS');
      expect(prompt).not.toContain('cex_place_order');
    });

    it('includes exchange symbol format notes', () => {
      const prompt = buildCdpSystemPrompt(['cex.trading']);
      expect(prompt).toContain('BTCUSDT');   // Binance format
      expect(prompt).toContain('BTC-USD');   // Coinbase format
    });

    it('includes fee disclosure', () => {
      const prompt = buildCdpSystemPrompt(['cex.trading']);
      expect(prompt).toContain('0.40 USDC');
    });
  });

  describe('multiple capabilities', () => {
    it('includes both blocks when both are active', () => {
      const prompt = buildCdpSystemPrompt(['onchain.trading', 'cex.trading']);
      expect(prompt).toContain('ON-CHAIN TRADING ACTIONS');
      expect(prompt).toContain('CEX TRADING ACTIONS');
    });

    it('includes polymarket + onchain + cex together', () => {
      const prompt = buildCdpSystemPrompt(['polymarket.trading', 'onchain.trading', 'cex.trading']);
      expect(prompt).toContain('POLYMARKET TRADING ACTIONS');
      expect(prompt).toContain('ON-CHAIN TRADING ACTIONS');
      expect(prompt).toContain('CEX TRADING ACTIONS');
    });
  });

  describe('subagent mode', () => {
    it('includes subagent block when isSubagent = true', () => {
      const prompt = buildCdpSystemPrompt(['onchain.trading'], true);
      expect(prompt).toContain('YOU ARE A SUB-AGENT');
      expect(prompt).toContain('set_identity');
    });

    it('omits subagent block when isSubagent = false', () => {
      const prompt = buildCdpSystemPrompt(['onchain.trading'], false);
      expect(prompt).not.toContain('YOU ARE A SUB-AGENT');
    });
  });

  describe('capability list', () => {
    it('lists active capabilities at top of prompt', () => {
      const prompt = buildCdpSystemPrompt(['onchain.trading', 'cex.trading']);
      expect(prompt).toContain('- onchain.trading');
      expect(prompt).toContain('- cex.trading');
    });
  });

  describe('compact mode — CDP', () => {
    it('compact=false keeps verbose procedural blocks', () => {
      const full = buildCdpSystemPrompt([], false, false);
      expect(full).toContain('FLIGHT SEARCH');
      expect(full).toContain('MercadoLibre');
      expect(full).toContain('DONE SUMMARY FORMAT');
    });

    it('compact=true strips flight search instructions', () => {
      const compact = buildCdpSystemPrompt([], false, true);
      expect(compact).not.toContain('FLIGHT SEARCH');
      expect(compact).not.toContain('turismocity');
      expect(compact).not.toContain('skyscanner');
    });

    it('compact=true strips MercadoLibre hardcoded script', () => {
      const compact = buildCdpSystemPrompt([], false, true);
      expect(compact).not.toContain('MercadoLibre');
      expect(compact).not.toContain('__PRELOADED_STATE__');
    });

    it('compact=true strips DONE SUMMARY FORMAT section', () => {
      const compact = buildCdpSystemPrompt([], false, true);
      expect(compact).not.toContain('DONE SUMMARY FORMAT');
    });

    it('compact=true keeps core rules and available actions', () => {
      const compact = buildCdpSystemPrompt([], false, true);
      expect(compact).toContain('ONE JSON');
      expect(compact).toContain('navigate');
      expect(compact).toContain('evaluate');
      expect(compact).toContain('done');
    });

    it('compact=true keeps trading discipline when polymarket is active', () => {
      const compact = buildCdpSystemPrompt(['polymarket.trading'], false, true);
      expect(compact).toContain('TRADING DISCIPLINE');
      expect(compact).toContain('NEVER use "done" while you have open positions');
      expect(compact).toContain('polymarket_get_account_summary');
    });

    it('compact=true strips office block even when capability is active', () => {
      const compact = buildCdpSystemPrompt(['office.professional'], false, true);
      expect(compact).not.toContain('OFFICE PROFESSIONAL SKILLS');
      expect(compact).not.toContain('banded rows');
    });

    it('compact=true is shorter than full prompt', () => {
      const full = buildCdpSystemPrompt(['polymarket.trading'], false, false);
      const compact = buildCdpSystemPrompt(['polymarket.trading'], false, true);
      expect(compact.length).toBeLessThan(full.length * 0.75); // at least 25% shorter
    });
  });
});

// ── buildCodeSystemPrompt ─────────────────────────────────────────────────────

describe('buildCodeSystemPrompt', () => {
  describe('full mode', () => {
    it('includes core rules', () => {
      const prompt = buildCodeSystemPrompt();
      expect(prompt).toContain('ONE JSON object per response');
      expect(prompt).toContain('NEVER repeat an action that already succeeded');
    });

    it('includes per-action descriptions', () => {
      const prompt = buildCodeSystemPrompt();
      expect(prompt).toContain('### file_read:');
      expect(prompt).toContain('### file_write:');
      expect(prompt).toContain('### file_edit:');
    });

    it('includes dev best practices', () => {
      const prompt = buildCodeSystemPrompt();
      expect(prompt).toContain('DEVELOPMENT BEST PRACTICES');
      expect(prompt).toContain('Read before edit');
    });

    it('includes app scripting block when capability is active', () => {
      const prompt = buildCodeSystemPrompt(['app.scripting']);
      expect(prompt).toContain('APP SCRIPTING');
      expect(prompt).toContain('app_script');
    });

    it('omits app scripting when capability is not active', () => {
      const prompt = buildCodeSystemPrompt([]);
      expect(prompt).not.toContain('APP SCRIPTING');
    });
  });

  describe('compact mode', () => {
    it('keeps core rules', () => {
      const compact = buildCodeSystemPrompt([], false, true);
      expect(compact).toContain('ONE JSON object per response');
      expect(compact).toContain('NEVER repeat an action that already succeeded');
    });

    it('keeps dev best practices', () => {
      const compact = buildCodeSystemPrompt([], false, true);
      expect(compact).toContain('DEVELOPMENT BEST PRACTICES');
      expect(compact).toContain('Read before edit');
      expect(compact).toContain('Use file_search to find code');
    });

    it('keeps action schemas', () => {
      const compact = buildCodeSystemPrompt([], false, true);
      expect(compact).toContain('file_read');
      expect(compact).toContain('file_edit');
      expect(compact).toContain('shell');
    });

    it('strips verbose per-action description paragraphs', () => {
      const compact = buildCodeSystemPrompt([], false, true);
      expect(compact).not.toContain('### file_read:');
      expect(compact).not.toContain('cat -n style');
      expect(compact).not.toContain('### file_write:');
      expect(compact).not.toContain('Creates intermediate directories');
      expect(compact).not.toContain('### file_edit:');
      expect(compact).not.toContain('Search-and-replace');
    });

    it('strips Git Workflow section', () => {
      const compact = buildCodeSystemPrompt([], false, true);
      expect(compact).not.toContain('### Git Workflow:');
      expect(compact).not.toContain('Stage specific files, never');
    });

    it('compact mode is shorter than full', () => {
      const full = buildCodeSystemPrompt([], false, false);
      const compact = buildCodeSystemPrompt([], false, true);
      expect(compact.length).toBeLessThan(full.length * 0.75);
    });

    it('subagent block still injected in compact mode', () => {
      const compact = buildCodeSystemPrompt([], true, true);
      expect(compact).toContain('YOU ARE A SUB-AGENT');
    });
  });
});

// ── buildBrowserSystemPrompt ──────────────────────────────────────────────────

describe('buildBrowserSystemPrompt', () => {
  describe('full mode', () => {
    it('includes core rules', () => {
      const prompt = buildBrowserSystemPrompt();
      expect(prompt).toContain('ONE JSON object per response');
    });

    it('includes IFRAMES guidance', () => {
      const prompt = buildBrowserSystemPrompt();
      expect(prompt).toContain('IFRAMES');
    });

    it('includes GOOGLE DOCS section', () => {
      const prompt = buildBrowserSystemPrompt();
      expect(prompt).toContain('GOOGLE DOCS');
    });

    it('includes SOCIAL MEDIA POSTING guidance', () => {
      const prompt = buildBrowserSystemPrompt();
      expect(prompt).toContain('SOCIAL MEDIA POSTING');
    });

    it('includes detailed element reference selector fallback chain', () => {
      const prompt = buildBrowserSystemPrompt();
      expect(prompt).toContain('ELEMENT REFERENCES');
      expect(prompt).toContain('data-testid');
    });
  });

  describe('compact mode', () => {
    it('keeps core rules', () => {
      const compact = buildBrowserSystemPrompt(false, true);
      expect(compact).toContain('ONE JSON');
      expect(compact).toContain('navigate');
      expect(compact).toContain('done');
    });

    it('keeps element-ref selector hint', () => {
      const compact = buildBrowserSystemPrompt(false, true);
      expect(compact).toContain('data-testid');
    });

    it('strips IFRAMES section', () => {
      const compact = buildBrowserSystemPrompt(false, true);
      expect(compact).not.toContain('IFRAMES');
    });

    it('strips GOOGLE DOCS section', () => {
      const compact = buildBrowserSystemPrompt(false, true);
      expect(compact).not.toContain('GOOGLE DOCS');
    });

    it('strips SOCIAL MEDIA POSTING section', () => {
      const compact = buildBrowserSystemPrompt(false, true);
      expect(compact).not.toContain('SOCIAL MEDIA POSTING');
    });

    it('strips DOWNLOADING IMAGES FROM CHATGPT section', () => {
      const compact = buildBrowserSystemPrompt(false, true);
      expect(compact).not.toContain('DOWNLOADING IMAGES FROM CHATGPT');
    });

    it('compact is shorter than full', () => {
      const full = buildBrowserSystemPrompt(false, false);
      const compact = buildBrowserSystemPrompt(false, true);
      expect(compact.length).toBeLessThan(full.length * 0.75);
    });

    it('subagent block still injected in compact mode', () => {
      const compact = buildBrowserSystemPrompt(true, true);
      expect(compact).toContain('YOU ARE A SUB-AGENT');
    });
  });
});

// ── Polymarket block improvements ─────────────────────────────────────────────

describe('buildCdpSystemPrompt — Polymarket improvements', () => {
  it('includes heartbeat timeout warning', () => {
    const prompt = buildCdpSystemPrompt(['polymarket.trading']);
    expect(prompt).toContain('10 second');
  });

  it('includes tickSize guidance', () => {
    const prompt = buildCdpSystemPrompt(['polymarket.trading']);
    expect(prompt).toContain('tickSize');
  });

  it('compact still keeps heartbeat and discipline rules', () => {
    const compact = buildCdpSystemPrompt(['polymarket.trading'], false, true);
    expect(compact).toContain('TRADING DISCIPLINE');
    expect(compact).toContain('NEVER use "done" while you have open positions');
    expect(compact).toContain('10 second');
  });
});

describe('buildOrchestratorSystemPrompt', () => {
  it('includes orchestrator role declaration', () => {
    const prompt = buildOrchestratorSystemPrompt([]);
    expect(prompt).toContain('orchestrator');
  });

  it('includes task_spawn action', () => {
    const prompt = buildOrchestratorSystemPrompt([]);
    expect(prompt).toContain('task_spawn');
  });

  it('includes task_wait action', () => {
    const prompt = buildOrchestratorSystemPrompt([]);
    expect(prompt).toContain('task_wait');
  });

  it('includes plan action', () => {
    const prompt = buildOrchestratorSystemPrompt([]);
    expect(prompt).toContain('"type": "plan"');
  });

  it('includes done and fail actions', () => {
    const prompt = buildOrchestratorSystemPrompt([]);
    expect(prompt).toContain('done');
    expect(prompt).toContain('fail');
  });

  it('includes sub-agent roles', () => {
    const prompt = buildOrchestratorSystemPrompt([]);
    expect(prompt).toContain('Research');
    expect(prompt).toContain('Risk');
    expect(prompt).toContain('Executor');
  });

  it('includes trading safety gate when trading cap is present', () => {
    const prompt = buildOrchestratorSystemPrompt(['polymarket.trading']);
    expect(prompt).toContain('TRADING SAFETY GATE');
    expect(prompt).toContain('Risk');
    expect(prompt).toContain('APPROVED');
  });

  it('omits trading safety gate when no trading caps', () => {
    const prompt = buildOrchestratorSystemPrompt([]);
    expect(prompt).not.toContain('TRADING SAFETY GATE');
  });

  it('includes trading gate for onchain.trading', () => {
    const prompt = buildOrchestratorSystemPrompt(['onchain.trading']);
    expect(prompt).toContain('TRADING SAFETY GATE');
  });

  it('includes trading gate for cex.trading', () => {
    const prompt = buildOrchestratorSystemPrompt(['cex.trading']);
    expect(prompt).toContain('TRADING SAFETY GATE');
  });

  it('compact version omits verbose workflow but keeps core rules', () => {
    const full = buildOrchestratorSystemPrompt([]);
    const compact = buildOrchestratorSystemPrompt([], '', true);
    // compact should be shorter
    expect(compact.length).toBeLessThan(full.length);
    // but must keep essential actions
    expect(compact).toContain('task_spawn');
    expect(compact).toContain('task_wait');
    expect(compact).toContain('plan');
    expect(compact).toContain('done');
    expect(compact).toContain('fail');
  });

  it('includes memory context when provided', () => {
    const prompt = buildOrchestratorSystemPrompt([], 'User context: BTC strategy');
    expect(prompt).toContain('User context: BTC strategy');
  });

  it('plan action schema includes objective and subtasks fields', () => {
    const prompt = buildOrchestratorSystemPrompt([]);
    expect(prompt).toContain('objective');
    expect(prompt).toContain('subtasks');
  });

  it('includes maxSteps guidance per role', () => {
    const prompt = buildOrchestratorSystemPrompt([]);
    expect(prompt).toContain('Research');
    expect(prompt).toContain('30');  // Research maxSteps
    expect(prompt).toContain('15');  // Risk maxSteps
    expect(prompt).toContain('50');  // Executor maxSteps
  });

  it('includes model guidance — use cheaper models for Research and Risk', () => {
    const prompt = buildOrchestratorSystemPrompt([]);
    expect(prompt).toContain('mini');
    expect(prompt).toContain('nano');
  });

  it('task_spawn schema includes maxSteps and model fields', () => {
    const prompt = buildOrchestratorSystemPrompt([]);
    expect(prompt).toContain('maxSteps');
    expect(prompt).toContain('"model"');
  });

  it('includes knowledge memory actions', () => {
    const prompt = buildOrchestratorSystemPrompt([]);
    expect(prompt).toContain('memory_save');
    expect(prompt).toContain('memory_search');
    expect(prompt).toContain('memory_context');
  });

  it('compact includes knowledge memory actions in short form', () => {
    const compact = buildOrchestratorSystemPrompt([], '', true);
    expect(compact).toContain('memory_save');
    expect(compact).toContain('memory_search');
    expect(compact).toContain('memory_context');
  });
});

// ── Knowledge memory block ─────────────────────────────────────────────────────

describe('knowledge memory block — all builders', () => {
  it('buildCodeSystemPrompt includes memory_save', () => {
    const prompt = buildCodeSystemPrompt();
    expect(prompt).toContain('memory_save');
    expect(prompt).toContain('memory_search');
    expect(prompt).toContain('memory_context');
  });

  it('buildCodeSystemPrompt compact includes condensed knowledge memory', () => {
    const compact = buildCodeSystemPrompt([], false, true);
    expect(compact).toContain('memory_save');
    expect(compact).toContain('memory_search');
    expect(compact).toContain('memory_context');
  });

  it('buildCdpSystemPrompt includes memory actions', () => {
    const prompt = buildCdpSystemPrompt([]);
    expect(prompt).toContain('memory_save');
    expect(prompt).toContain('memory_search');
    expect(prompt).toContain('memory_context');
  });

  it('buildBrowserSystemPrompt includes memory actions', () => {
    const prompt = buildBrowserSystemPrompt();
    expect(prompt).toContain('memory_save');
    expect(prompt).toContain('memory_search');
    expect(prompt).toContain('memory_context');
  });

  it('knowledge memory block includes obs_type examples', () => {
    const prompt = buildCodeSystemPrompt();
    expect(prompt).toContain('obs_type');
    expect(prompt).toContain('topic_key');
  });
});

import { describe, it, expect } from 'vitest';
import { buildCdpSystemPrompt } from './system-prompt';

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
});

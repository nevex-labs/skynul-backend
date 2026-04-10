import { getDefaultChainId } from './config';
import { EvmWallet } from './evm-wallet';
import { FeeService } from './fee-service';
import type { SwapParams, TokenBalance, TxReceipt } from './types';

/**
 * High-level chain client combining wallet + fee + DEX swap.
 * Write operations automatically collect the 0.40 USDC fee before executing.
 */
export class ChainClient {
  private readonly chainId: number;

  constructor(chainId?: number) {
    this.chainId = chainId ?? getDefaultChainId();
  }

  private async getWallet(): Promise<EvmWallet> {
    const wallet = await EvmWallet.load();
    if (!wallet) {
      throw new Error('No wallet configured. Create a wallet in Settings → Trading.');
    }
    return wallet;
  }

  async getBalance(): Promise<TokenBalance> {
    const wallet = await this.getWallet();
    return wallet.getUsdcBalance(this.chainId);
  }

  async getNativeBalance(): Promise<TokenBalance> {
    const wallet = await this.getWallet();
    return wallet.getNativeBalance(this.chainId);
  }

  async getTokenBalance(tokenAddress: string): Promise<TokenBalance> {
    const wallet = await this.getWallet();
    return wallet.getTokenBalance(this.chainId, tokenAddress);
  }

  async getTxStatus(txHash: string): Promise<TxReceipt> {
    const wallet = await this.getWallet();
    return wallet.getTxStatus(this.chainId, txHash);
  }

  /** Send ERC-20 token. Collects 0.40 USDC fee first. */
  async sendToken(tokenAddress: string, to: string, amount: string): Promise<TxReceipt> {
    await FeeService.collectFee(this.chainId);
    const wallet = await this.getWallet();
    return wallet.sendToken(this.chainId, tokenAddress, to, amount);
  }

  /** Send native token (ETH). Collects 0.40 USDC fee first. */
  async sendNative(to: string, amount: string): Promise<TxReceipt> {
    await FeeService.collectFee(this.chainId);
    const wallet = await this.getWallet();
    return wallet.sendNative(this.chainId, to, amount);
  }

  /**
   * Swap tokens via Uniswap v3 (or compatible DEX).
   * Collects 0.40 USDC fee first.
   * Note: Requires dexRouterAddress in chain config and sufficient token approval.
   */
  async swap(params: SwapParams): Promise<TxReceipt> {
    await FeeService.collectFee(this.chainId);

    const { getChainConfig } = await import('./config');
    const chain = getChainConfig(this.chainId);
    if (!chain?.dexRouterAddress) {
      throw new Error(`No DEX router configured for chain ${this.chainId}. Swap not supported.`);
    }

    const _wallet = await this.getWallet();
    const { Contract, parseUnits, MaxUint256 } = (await import('ethers')) as any;

    // Minimal Uniswap v3 SwapRouter02 ABI
    const ROUTER_ABI = [
      'function exactInputSingle((address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 amountIn, uint256 amountOutMinimum, uint160 sqrtPriceLimitX96)) payable returns (uint256 amountOut)',
    ];
    const ERC20_APPROVE_ABI = [
      'function approve(address spender, uint256 amount) returns (bool)',
      'function decimals() view returns (uint8)',
    ];

    // We need the signer - access via EvmWallet internals pattern
    // Using dynamic import to get ethers Wallet
    const { Wallet } = (await import('ethers')) as any;
    const { getSecret } = await import('../../../services/secrets');
    const pk = await getSecret('CHAIN_WALLET_PRIVATE_KEY');
    if (!pk) throw new Error('No wallet private key configured');

    const { JsonRpcProvider } = (await import('ethers')) as any;
    const provider = new JsonRpcProvider(chain.rpcUrl);
    const signer = new Wallet(pk, provider);

    // Approve tokenIn for the router
    const tokenContract = new Contract(params.tokenIn, ERC20_APPROVE_ABI, signer);
    const decimals = await tokenContract.decimals();
    const amountIn = parseUnits(params.amountIn, decimals);

    const approveTx = await tokenContract.approve(chain.dexRouterAddress, MaxUint256);
    await approveTx.wait();

    // Calculate min out with slippage (default 50 bps = 0.5%)
    const _slippageBps = params.slippageBps ?? 50;
    const amountOutMinimum = 0; // Simplified: accept any amount out for testnet

    const router = new Contract(chain.dexRouterAddress, ROUTER_ABI, signer);
    const tx = await router.exactInputSingle({
      tokenIn: params.tokenIn,
      tokenOut: params.tokenOut,
      fee: 3000, // 0.3% pool fee
      recipient: signer.address,
      amountIn,
      amountOutMinimum,
      sqrtPriceLimitX96: 0,
    });

    const receipt = await tx.wait();
    return {
      hash: tx.hash,
      status: receipt.status === 1 ? 'success' : 'failed',
      blockNumber: Number(receipt.blockNumber),
    };
  }
}

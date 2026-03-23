import { getChainConfig } from './config';
import type { TokenBalance, TxReceipt } from './types';

const ERC20_ABI = [
  'function balanceOf(address) view returns (uint256)',
  'function decimals() view returns (uint8)',
  'function symbol() view returns (string)',
  'function transfer(address to, uint256 amount) returns (bool)',
];

export class EvmWallet {
  private readonly privateKey: string;
  private readonly address: string;

  private constructor(privateKey: string, address: string) {
    this.privateKey = privateKey;
    this.address = address;
  }

  static async create(): Promise<{ address: string }> {
    const { Wallet } = (await import('ethers')) as any;
    const wallet = Wallet.createRandom();
    const { setSecret } = await import('../stores/secret-store');
    await setSecret('CHAIN_WALLET_PRIVATE_KEY', wallet.privateKey);
    return { address: wallet.address };
  }

  static async load(): Promise<EvmWallet | null> {
    const { getSecret } = await import('../stores/secret-store');
    const pk = (await getSecret('CHAIN_WALLET_PRIVATE_KEY')) ?? process.env.CHAIN_WALLET_PRIVATE_KEY;
    if (!pk) return null;
    const { Wallet } = (await import('ethers')) as any;
    const address = new Wallet(pk).address;
    return new EvmWallet(pk, address);
  }

  static async exists(): Promise<boolean> {
    const { getSecret } = await import('../stores/secret-store');
    const pk = (await getSecret('CHAIN_WALLET_PRIVATE_KEY')) ?? process.env.CHAIN_WALLET_PRIVATE_KEY;
    return Boolean(pk);
  }

  private async getProvider(chainId: number): Promise<any> {
    const chain = getChainConfig(chainId);
    if (!chain) throw new Error(`Unknown chainId: ${chainId}`);
    const { JsonRpcProvider } = (await import('ethers')) as any;
    return new JsonRpcProvider(chain.rpcUrl);
  }

  private async getSigner(chainId: number): Promise<any> {
    const { Wallet } = (await import('ethers')) as any;
    const provider = await this.getProvider(chainId);
    return new Wallet(this.privateKey, provider);
  }

  getAddress(): string {
    return this.address;
  }

  async getNativeBalance(chainId: number): Promise<TokenBalance> {
    const chain = getChainConfig(chainId);
    if (!chain) throw new Error(`Unknown chainId: ${chainId}`);
    const { formatUnits } = (await import('ethers')) as any;
    const provider = await this.getProvider(chainId);
    const signer = await this.getSigner(chainId);
    const address = signer.address;
    const raw = await provider.getBalance(address);
    const bal = formatUnits(raw, chain.nativeCurrency.decimals);
    return {
      symbol: chain.nativeCurrency.symbol,
      address: '0x0000000000000000000000000000000000000000',
      balance: bal,
      balanceRaw: raw.toString(),
      decimals: chain.nativeCurrency.decimals,
    };
  }

  async getTokenBalance(chainId: number, tokenAddress: string): Promise<TokenBalance> {
    const { Contract, formatUnits } = (await import('ethers')) as any;
    const provider = await this.getProvider(chainId);
    const signer = await this.getSigner(chainId);
    const contract = new Contract(tokenAddress, ERC20_ABI, provider);
    const [rawBalance, decimals, symbol] = await Promise.all([
      contract.balanceOf(signer.address),
      contract.decimals(),
      contract.symbol(),
    ]);
    const bal = formatUnits(rawBalance, decimals);
    return {
      symbol,
      address: tokenAddress,
      balance: bal,
      balanceRaw: rawBalance.toString(),
      decimals: Number(decimals),
    };
  }

  async getUsdcBalance(chainId: number): Promise<TokenBalance> {
    const chain = getChainConfig(chainId);
    if (!chain) throw new Error(`Unknown chainId: ${chainId}`);
    return this.getTokenBalance(chainId, chain.usdcAddress);
  }

  async sendToken(chainId: number, tokenAddress: string, to: string, amount: string): Promise<TxReceipt> {
    const { Contract, parseUnits } = (await import('ethers')) as any;
    const signer = await this.getSigner(chainId);
    const contract = new Contract(tokenAddress, ERC20_ABI, signer);
    const decimals = await contract.decimals();
    const amountRaw = parseUnits(amount, decimals);
    const tx = await contract.transfer(to, amountRaw);
    const receipt = await tx.wait();
    return {
      hash: tx.hash,
      status: receipt.status === 1 ? 'success' : 'failed',
      blockNumber: Number(receipt.blockNumber),
    };
  }

  async sendNative(chainId: number, to: string, amount: string): Promise<TxReceipt> {
    const { parseEther } = (await import('ethers')) as any;
    const signer = await this.getSigner(chainId);
    const chain = getChainConfig(chainId);
    if (!chain) throw new Error(`Unknown chainId: ${chainId}`);
    const tx = await signer.sendTransaction({
      to,
      value: parseEther(amount),
    });
    const receipt = await tx.wait();
    return {
      hash: tx.hash,
      status: receipt.status === 1 ? 'success' : 'failed',
      blockNumber: Number(receipt.blockNumber),
    };
  }

  async getTxStatus(chainId: number, txHash: string): Promise<TxReceipt> {
    const provider = await this.getProvider(chainId);
    const receipt = await provider.getTransactionReceipt(txHash);
    if (!receipt) {
      return { hash: txHash, status: 'pending' };
    }
    return {
      hash: txHash,
      status: receipt.status === 1 ? 'success' : 'failed',
      blockNumber: Number(receipt.blockNumber),
    };
  }
}

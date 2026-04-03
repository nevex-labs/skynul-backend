import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";
const DEPLOYER_KEY = process.env.DEPLOYER_PRIVATE_KEY ?? "0x" + "00".repeat(32);
const config: HardhatUserConfig = {
  solidity: "0.8.24",
  networks: {
    base: {
      url: "https://mainnet.base.org",
      chainId: 8453,
      accounts: [DEPLOYER_KEY],
    },
  },
};
export default config;

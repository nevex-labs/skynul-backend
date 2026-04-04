const hre = require('hardhat');

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  console.log('Deploying with:', deployer.address);

  // Get network
  const network = hre.network.name;
  console.log('Network:', network);

  // Addresses per network
  const config = {
    baseSepolia: {
      usdc: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
      uniswapRouter: '0x94cC0AaC535CCDB3C01d6787D6413C739ae12bc4', // SwapRouter02
      treasury: process.env.CHAIN_TREASURY_ADDRESS || deployer.address,
    },
    base: {
      usdc: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
      uniswapRouter: '0x2626664c2603336E57B271c5C0b26F421741e481', // SwapRouter02
      treasury: process.env.CHAIN_TREASURY_ADDRESS || deployer.address,
    },
    arbitrum: {
      usdc: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
      uniswapRouter: '0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45', // SwapRouter02
      treasury: process.env.CHAIN_TREASURY_ADDRESS || deployer.address,
    },
  };

  const chainConfig = config[network];
  if (!chainConfig) {
    throw new Error(`No config for network: ${network}. Add it to deploy.js`);
  }

  console.log('\nDeployment parameters:');
  console.log('  USDC:', chainConfig.usdc);
  console.log('  Uniswap Router:', chainConfig.uniswapRouter);
  console.log('  Treasury:', chainConfig.treasury);

  // Deploy
  const SkynulRouter = await hre.ethers.getContractFactory('SkynulRouter');
  const router = await SkynulRouter.deploy(chainConfig.usdc, chainConfig.treasury, chainConfig.uniswapRouter);

  await router.waitForDeployment();
  const address = await router.getAddress();

  console.log('\n✅ SkynulRouter deployed to:', address);
  console.log('\nNext steps:');
  console.log('  1. Verify on Etherscan:');
  console.log(
    `     npx hardhat verify --network ${network} ${address} ${chainConfig.usdc} ${chainConfig.treasury} ${chainConfig.uniswapRouter}`
  );
  console.log('\n  2. Update chain config in src/core/chain/config.ts:');
  console.log(`     skynulRouterAddress: '${address}'`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });

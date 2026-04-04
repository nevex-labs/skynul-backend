// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";

/**
 * @title SkynulRouter
 * @notice Router that executes swaps via Uniswap V3 and collects a 1% platform fee.
 * @dev Users must approve this contract to spend their USDC before calling swap.
 */
contract SkynulRouter is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ── State Variables ──────────────────────────────────────────────────────

    /// @notice Address of the USDC token
    IERC20 public immutable usdc;

    /// @notice Address that receives platform fees
    address public treasury;

    /// @notice Platform fee percentage (1% = 100 basis points)
    uint256 public constant FEE_BPS = 100;
    uint256 public constant BPS_DENOMINATOR = 10000;

    /// @notice Uniswap V3 SwapRouter02 address
    address public uniswapRouter;

    /// @notice Emergency pause flag
    bool public paused;

    // ── Events ───────────────────────────────────────────────────────────────

    event SwapExecuted(
        address indexed user,
        address indexed tokenIn,
        address indexed tokenOut,
        uint256 amountIn,
        uint256 amountOut,
        uint256 feeAmount,
        uint256 timestamp
    );

    event TreasuryUpdated(address oldTreasury, address newTreasury);
    event UniswapRouterUpdated(address oldRouter, address newRouter);
    event EmergencyPause(bool paused);
    event EmergencyWithdraw(address indexed token, uint256 amount, address indexed to);

    // ── Modifiers ────────────────────────────────────────────────────────────

    modifier whenNotPaused() {
        require(!paused, "SkynulRouter: paused");
        _;
    }

    // ── Constructor ──────────────────────────────────────────────────────────

    /**
     * @param _usdc USDC token address
     * @param _treasury Treasury address for fee collection
     * @param _uniswapRouter Uniswap V3 SwapRouter02 address
     */
    constructor(address _usdc, address _treasury, address _uniswapRouter) {
        require(_usdc != address(0), "SkynulRouter: zero USDC");
        require(_treasury != address(0), "SkynulRouter: zero treasury");
        require(_uniswapRouter != address(0), "SkynulRouter: zero router");

        usdc = IERC20(_usdc);
        treasury = _treasury;
        uniswapRouter = _uniswapRouter;
    }

    // ── Core Functions ───────────────────────────────────────────────────────

    /**
     * @notice Execute a swap with platform fee deduction.
     * @dev User must have approved this contract for amountIn + fee.
     * @param tokenOut Token to receive
     * @param amountIn Amount of USDC to swap (includes fee)
     * @param amountOutMinimum Minimum amount of tokenOut to receive (slippage protection)
     * @param poolFee Uniswap V3 pool fee tier (500, 3000, or 10000)
     * @param deadline Transaction deadline (unix timestamp)
     * @return amountOut Actual amount of tokenOut received
     */
    function swap(
        address tokenOut,
        uint256 amountIn,
        uint256 amountOutMinimum,
        uint24 poolFee,
        uint256 deadline
    ) external nonReentrant whenNotPaused returns (uint256 amountOut) {
        require(tokenOut != address(0), "SkynulRouter: zero tokenOut");
        require(amountIn > 0, "SkynulRouter: zero amountIn");
        require(deadline >= block.timestamp, "SkynulRouter: expired");

        // Calculate fee
        uint256 feeAmount = (amountIn * FEE_BPS) / BPS_DENOMINATOR;
        uint256 swapAmount = amountIn - feeAmount;

        // Transfer USDC from user
        usdc.safeTransferFrom(msg.sender, address(this), amountIn);

        // Send fee to treasury
        usdc.safeTransfer(treasury, feeAmount);

        // Approve Uniswap router to spend swapAmount
        usdc.safeApprove(uniswapRouter, 0);
        usdc.safeApprove(uniswapRouter, swapAmount);

        // Execute swap via Uniswap V3
        amountOut = _executeUniswapSwap(
            address(usdc),
            tokenOut,
            poolFee,
            swapAmount,
            amountOutMinimum,
            deadline
        );

        // Send output tokens to user
        IERC20(tokenOut).safeTransfer(msg.sender, amountOut);

        emit SwapExecuted(
            msg.sender,
            address(usdc),
            tokenOut,
            amountIn,
            amountOut,
            feeAmount,
            block.timestamp
        );
    }

    /**
     * @notice Execute a multi-hop swap.
     * @param path Encoded path (tokenA + fee1 + tokenB + fee2 + tokenC)
     * @param amountIn Amount of USDC to swap (includes fee)
     * @param amountOutMinimum Minimum amount of final token to receive
     * @param deadline Transaction deadline
     * @return amountOut Actual amount of final token received
     */
    function swapMultiHop(
        bytes calldata path,
        uint256 amountIn,
        uint256 amountOutMinimum,
        uint256 deadline
    ) external nonReentrant whenNotPaused returns (uint256 amountOut) {
        require(path.length >= 43, "SkynulRouter: invalid path");
        require(amountIn > 0, "SkynulRouter: zero amountIn");
        require(deadline >= block.timestamp, "SkynulRouter: expired");

        // Calculate fee
        uint256 feeAmount = (amountIn * FEE_BPS) / BPS_DENOMINATOR;
        uint256 swapAmount = amountIn - feeAmount;

        // Transfer USDC from user
        usdc.safeTransferFrom(msg.sender, address(this), amountIn);

        // Send fee to treasury
        usdc.safeTransfer(treasury, feeAmount);

        // Approve Uniswap router
        usdc.safeApprove(uniswapRouter, 0);
        usdc.safeApprove(uniswapRouter, swapAmount);

        // Execute multi-hop swap
        amountOut = _executeUniswapSwapExactInput(
            path,
            swapAmount,
            amountOutMinimum,
            deadline
        );

        // Get the last token from path
        address lastToken = _getLastTokenFromPath(path);
        IERC20(lastToken).safeTransfer(msg.sender, amountOut);

        emit SwapExecuted(
            msg.sender,
            address(usdc),
            lastToken,
            amountIn,
            amountOut,
            feeAmount,
            block.timestamp
        );
    }

    // ── Internal Functions ───────────────────────────────────────────────────

    function _executeUniswapSwap(
        address tokenIn,
        address tokenOut,
        uint24 poolFee,
        uint256 amountIn,
        uint256 amountOutMinimum,
        uint256 deadline
    ) internal returns (uint256 amountOut) {
        // Uniswap V3 ExactInputSingle params encoding
        // struct ExactInputSingleParams {
        //     address tokenIn;
        //     address tokenOut;
        //     uint24 fee;
        //     address recipient;
        //     uint256 amountIn;
        //     uint256 amountOutMinimum;
        //     uint160 sqrtPriceLimitX96;
        // }

        bytes memory data = abi.encodeWithSelector(
            bytes4(keccak256("exactInputSingle((address,address,uint24,address,uint256,uint256,uint160))")),
            tokenIn,
            tokenOut,
            poolFee,
            msg.sender, // recipient (will be overridden by final transfer)
            amountIn,
            amountOutMinimum,
            0 // sqrtPriceLimitX96 = 0 means no price limit
        );

        (bool success, bytes memory result) = uniswapRouter.call(data);
        require(success, "SkynulRouter: swap failed");

        amountOut = abi.decode(result, (uint256));
    }

    function _executeUniswapSwapExactInput(
        bytes calldata path,
        uint256 amountIn,
        uint256 amountOutMinimum,
        uint256 deadline
    ) internal returns (uint256 amountOut) {
        // struct ExactInputParams {
        //     bytes path;
        //     address recipient;
        //     uint256 amountIn;
        //     uint256 amountOutMinimum;
        // }

        bytes memory data = abi.encodeWithSelector(
            bytes4(keccak256("exactInput((bytes,address,uint256,uint256))")),
            path,
            msg.sender,
            amountIn,
            amountOutMinimum
        );

        (bool success, bytes memory result) = uniswapRouter.call(data);
        require(success, "SkynulRouter: multi-hop swap failed");

        amountOut = abi.decode(result, (uint256));
    }

    function _getLastTokenFromPath(bytes calldata path) internal pure returns (address) {
        // Path format: tokenA (20 bytes) + fee (3 bytes) + tokenB (20 bytes) + ...
        // Last 20 bytes of path is the last token
        return address(bytes20(path[path.length - 20:]));
    }

    // ── Admin Functions ──────────────────────────────────────────────────────

    /**
     * @notice Update treasury address
     */
    function setTreasury(address _treasury) external onlyOwner {
        require(_treasury != address(0), "SkynulRouter: zero treasury");
        emit TreasuryUpdated(treasury, _treasury);
        treasury = _treasury;
    }

    /**
     * @notice Update Uniswap router address
     */
    function setUniswapRouter(address _uniswapRouter) external onlyOwner {
        require(_uniswapRouter != address(0), "SkynulRouter: zero router");
        emit UniswapRouterUpdated(uniswapRouter, _uniswapRouter);
        uniswapRouter = _uniswapRouter;
    }

    /**
     * @notice Emergency pause/unpause
     */
    function setPause(bool _paused) external onlyOwner {
        paused = _paused;
        emit EmergencyPause(_paused);
    }

    /**
     * @notice Emergency withdraw any ERC-20 tokens stuck in contract
     */
    function emergencyWithdraw(address token, uint256 amount, address to) external onlyOwner {
        require(token != address(0), "SkynulRouter: zero token");
        require(to != address(0), "SkynulRouter: zero recipient");

        if (token == address(usdc)) {
            usdc.safeTransfer(to, amount);
        } else {
            IERC20(token).safeTransfer(to, amount);
        }

        emit EmergencyWithdraw(token, amount, to);
    }

    // ── View Functions ───────────────────────────────────────────────────────

    /**
     * @notice Calculate fee for a given amount
     */
    function calculateFee(uint256 amountIn) external pure returns (uint256) {
        return (amountIn * FEE_BPS) / BPS_DENOMINATOR;
    }

    /**
     * @notice Calculate net amount after fee
     */
    function calculateNetAmount(uint256 amountIn) external pure returns (uint256) {
        uint256 fee = (amountIn * FEE_BPS) / BPS_DENOMINATOR;
        return amountIn - fee;
    }
}

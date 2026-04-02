/**
 * Shell Command Sandbox — Flexible security for API REST with agent-specific policies.
 *
 * Modes:
 * - STRICT (default): Block all DESTRUCTIVE/NETWORK, confirm EXECUTE
 * - PERMISSIVE: Allow more, log warnings
 * - AUDIT: Report only, don't block (testing)
 *
 * Features:
 * - Pipeline parsing (|, &&, ||, ;)
 * - Risk classification (READ/WRITE/EXECUTE/NETWORK/DESTRUCTIVE)
 * - Agent-specific policies
 * - Dry-run mode for testing
 */

import { childLogger } from '../../logger';

const logger = childLogger({ component: 'shell-sandbox' });

export type RiskLevel = 'READ' | 'WRITE' | 'EXECUTE' | 'NETWORK' | 'DESTRUCTIVE';
export type SandboxMode = 'STRICT' | 'PERMISSIVE' | 'AUDIT';

const RISK_PRECEDENCE: Record<RiskLevel, number> = {
  READ: 0,
  WRITE: 1,
  EXECUTE: 2,
  NETWORK: 3,
  DESTRUCTIVE: 4,
};

/** Command capabilities for fine-grained permissions. */
export type ShellCapability =
  | 'read'
  | 'write'
  | 'execute'
  | 'network'
  | 'destructive'
  | 'docker'
  | 'git'
  | 'npm'
  | 'sudo';

/** Sandbox configuration per agent or global. */
export type SandboxConfig = {
  mode: SandboxMode;
  /** Explicit capabilities (overrides mode defaults). */
  capabilities: ShellCapability[];
  /** Block specific commands regardless of capabilities. */
  blockedCommands: string[];
  /** Always allow these commands. */
  allowedCommands: string[];
  /** Custom risk overrides per command. */
  commandRiskOverrides: Record<string, RiskLevel>;
  /** Max pipeline complexity (number of segments). */
  maxComplexity: number;
  /** Allow subshells $(). */
  allowSubshells: boolean;
};

/** Default STRICT config (API REST safe). */
export const STRICT_CONFIG: SandboxConfig = {
  mode: 'STRICT',
  capabilities: ['read', 'write'],
  blockedCommands: [],
  allowedCommands: [],
  commandRiskOverrides: {},
  maxComplexity: 10,
  allowSubshells: false,
};

/** PERMISSIVE config (for trusted agents). */
export const PERMISSIVE_CONFIG: SandboxConfig = {
  mode: 'PERMISSIVE',
  capabilities: ['read', 'write', 'execute', 'network', 'docker', 'git', 'npm'],
  blockedCommands: ['sudo', 'su', 'rm'],
  allowedCommands: [],
  commandRiskOverrides: {},
  maxComplexity: 20,
  allowSubshells: true,
};

/** AUDIT config (testing, reports only). */
export const AUDIT_CONFIG: SandboxConfig = {
  mode: 'AUDIT',
  capabilities: ['read', 'write', 'execute', 'network', 'destructive', 'docker', 'git', 'npm', 'sudo'],
  blockedCommands: [],
  allowedCommands: [],
  commandRiskOverrides: {},
  maxComplexity: 50,
  allowSubshells: true,
};

/** Pre-configured policies for common agent types. */
export const AGENT_POLICIES: Record<string, SandboxConfig> = {
  researcher: STRICT_CONFIG,
  executor: {
    ...PERMISSIVE_CONFIG,
    capabilities: [...PERMISSIVE_CONFIG.capabilities, 'execute'],
  },
  monitor: STRICT_CONFIG,
  copywriter: STRICT_CONFIG,
  trader: {
    ...STRICT_CONFIG,
    capabilities: [...STRICT_CONFIG.capabilities, 'network'],
  },
  designer: STRICT_CONFIG,
};

const COMMAND_RISK_MAP: Record<string, RiskLevel> = {
  // READ (including shell built-ins)
  ls: 'READ',
  cat: 'READ',
  grep: 'READ',
  find: 'READ',
  head: 'READ',
  tail: 'READ',
  wc: 'READ',
  echo: 'READ',
  pwd: 'READ',
  id: 'READ',
  whoami: 'READ',
  uname: 'READ',
  date: 'READ',
  which: 'READ',
  file: 'READ',
  less: 'READ',
  more: 'READ',
  sort: 'READ',
  true: 'READ',
  false: 'READ',
  sleep: 'READ',
  test: 'READ',
  '[[': 'READ',
  '[': 'READ',
  wait: 'READ',
  jobs: 'READ',
  bg: 'READ',
  fg: 'READ',
  cd: 'READ',
  pushd: 'READ',
  popd: 'READ',
  dirs: 'READ',
  alias: 'READ',
  unalias: 'READ',
  export: 'READ',
  unset: 'READ',
  readonly: 'READ',
  local: 'READ',
  shift: 'READ',
  exit: 'READ',
  return: 'READ',
  break: 'READ',
  continue: 'READ',
  uniq: 'READ',
  cut: 'READ',
  awk: 'READ',
  sed: 'READ',
  tr: 'READ',
  rev: 'READ',
  diff: 'READ',
  cmp: 'READ',
  stat: 'READ',
  du: 'READ',
  df: 'READ',
  ps: 'READ',
  env: 'READ',
  printenv: 'READ',

  // WRITE
  cp: 'WRITE',
  mv: 'WRITE',
  touch: 'WRITE',
  mkdir: 'WRITE',
  rmdir: 'WRITE',
  tee: 'WRITE',
  chmod: 'WRITE',
  chown: 'WRITE',
  ln: 'WRITE',
  install: 'WRITE',

  // EXECUTE
  python: 'EXECUTE',
  python3: 'EXECUTE',
  node: 'EXECUTE',
  npm: 'EXECUTE',
  yarn: 'EXECUTE',
  pnpm: 'EXECUTE',
  bun: 'EXECUTE',
  ruby: 'EXECUTE',
  perl: 'EXECUTE',
  php: 'EXECUTE',
  java: 'EXECUTE',
  javac: 'EXECUTE',
  go: 'EXECUTE',
  rustc: 'EXECUTE',
  cargo: 'EXECUTE',
  make: 'EXECUTE',
  cmake: 'EXECUTE',
  gcc: 'EXECUTE',
  g: 'EXECUTE',
  clang: 'EXECUTE',
  sh: 'EXECUTE',
  bash: 'EXECUTE',
  zsh: 'EXECUTE',
  fish: 'EXECUTE',
  exec: 'EXECUTE',
  eval: 'EXECUTE',
  source: 'EXECUTE',
  '.': 'EXECUTE',

  // NETWORK
  curl: 'NETWORK',
  wget: 'NETWORK',
  nc: 'NETWORK',
  netcat: 'NETWORK',
  telnet: 'NETWORK',
  ftp: 'NETWORK',
  sftp: 'NETWORK',
  scp: 'NETWORK',
  rsync: 'NETWORK',
  ssh: 'NETWORK',
  dig: 'NETWORK',
  nslookup: 'NETWORK',
  host: 'NETWORK',
  ping: 'NETWORK',
  traceroute: 'NETWORK',
  nmap: 'NETWORK',
  netstat: 'NETWORK',
  ss: 'NETWORK',
  ip: 'NETWORK',
  ifconfig: 'NETWORK',

  // DESTRUCTIVE
  rm: 'DESTRUCTIVE',
  kill: 'DESTRUCTIVE',
  killall: 'DESTRUCTIVE',
  pkill: 'DESTRUCTIVE',
  dd: 'DESTRUCTIVE',
  mkfs: 'DESTRUCTIVE',
  format: 'DESTRUCTIVE',
  fdisk: 'DESTRUCTIVE',
  parted: 'DESTRUCTIVE',
  shred: 'DESTRUCTIVE',
  wipe: 'DESTRUCTIVE',
  wipefs: 'DESTRUCTIVE',
  mkswap: 'DESTRUCTIVE',
  swapon: 'DESTRUCTIVE',
  swapoff: 'DESTRUCTIVE',
  init: 'DESTRUCTIVE',
  telinit: 'DESTRUCTIVE',
  shutdown: 'DESTRUCTIVE',
  reboot: 'DESTRUCTIVE',
  halt: 'DESTRUCTIVE',
  poweroff: 'DESTRUCTIVE',
  systemctl: 'DESTRUCTIVE',
  service: 'DESTRUCTIVE',
  userdel: 'DESTRUCTIVE',
  groupdel: 'DESTRUCTIVE',
  passwd: 'DESTRUCTIVE',
};

const BLOCKED_PATTERNS = [
  { pattern: /\brm\s+(-[rfR]+\s+)?[\/~]/, reason: 'rm targeting root or home', risk: 'DESTRUCTIVE' as RiskLevel },
  {
    pattern: />\s*\/dev\/(sd[a-z]|hd[a-z]|nvme|disk)/,
    reason: 'redirect to block device',
    risk: 'DESTRUCTIVE' as RiskLevel,
  },
  { pattern: /\bdd\s+.*if=.*of=\/dev\//, reason: 'dd to device', risk: 'DESTRUCTIVE' as RiskLevel },
  { pattern: /curl.*\|\s*(ba)?sh/i, reason: 'curl pipe to shell', risk: 'EXECUTE' as RiskLevel },
  { pattern: /wget.*\|\s*(ba)?sh/i, reason: 'wget pipe to shell', risk: 'EXECUTE' as RiskLevel },
  { pattern: /:\(\)\s*{\s*:\|:\s*&\s*};:/, reason: 'fork bomb', risk: 'DESTRUCTIVE' as RiskLevel },
  { pattern: /sudo\s+/i, reason: 'sudo escalation', risk: 'DESTRUCTIVE' as RiskLevel },
  { pattern: /su\s+-/i, reason: 'su escalation', risk: 'DESTRUCTIVE' as RiskLevel },
  { pattern: /\bchmod\s+[0-7]*777/, reason: 'chmod 777 (world-writable)', risk: 'DESTRUCTIVE' as RiskLevel },
];

export type ParsedCommand = {
  command: string;
  args: string[];
  risk: RiskLevel;
  hasRedirect: boolean;
  redirectTarget?: string;
};

export type ParsedPipeline = {
  commands: ParsedCommand[];
  overallRisk: RiskLevel;
  hasSubshell: boolean;
  complexity: number;
};

function extractCommand(cmd: string): string {
  return cmd.replace(/.*\//, '').split(' ')[0]?.toLowerCase() || '';
}

function parseCommandArgs(segment: string): { command: string; args: string[]; redirectTarget?: string } {
  const tokens: string[] = [];
  let current = '';
  let inQuote: string | null = null;
  let redirectTarget: string | undefined;

  for (let i = 0; i < segment.length; i++) {
    const char = segment[i]!;
    const nextChar = segment[i + 1];

    if (char === '"' || char === "'") {
      if (inQuote === char) {
        inQuote = null;
      } else if (!inQuote) {
        inQuote = char;
      } else {
        current += char;
      }
    } else if ((char === '>' || char === '<') && !inQuote) {
      if (current) {
        tokens.push(current);
        current = '';
      }
      if (char === '>' && nextChar === '>') {
        i++; // Skip second >
      }
      // Collect redirect target
      let target = '';
      for (let j = i + 1; j < segment.length; j++) {
        const c = segment[j]!;
        if (c === ' ' && !target) continue;
        if (c === ' ' || c === '|' || c === '&' || c === ';') break;
        target += c;
      }
      redirectTarget = target;
      break;
    } else if (char === ' ' && !inQuote) {
      if (current) {
        tokens.push(current);
        current = '';
      }
    } else {
      current += char;
    }
  }

  if (current) {
    tokens.push(current);
  }

  return {
    command: tokens[0] || '',
    args: tokens.slice(1),
    redirectTarget,
  };
}

function getCommandRisk(command: string, args: string[]): RiskLevel {
  const cmd = extractCommand(command);

  if (cmd === 'sed' && args.some((a) => a === '-i' || a.startsWith('-i'))) {
    return 'WRITE';
  }

  const baseRisk = COMMAND_RISK_MAP[cmd];
  if (!baseRisk) {
    return 'EXECUTE';
  }

  if (cmd === 'rm' && args.some((a) => a.startsWith('-') && (a.includes('r') || a.includes('f')))) {
    return 'DESTRUCTIVE';
  }

  return baseRisk;
}

export function parsePipeline(command: string): ParsedPipeline {
  const commands: ParsedCommand[] = [];
  let hasSubshell = false;
  let complexity = 0;

  if (command.includes('$(') || command.includes('`')) {
    hasSubshell = true;
    complexity += 5;
  }

  // Split by chain operators
  const chainParts = command.split(/(\s*&&\s*|\s*\|\|\s*|\s*;\s*)/);

  for (const part of chainParts) {
    if (part.match(/^\s*(&&|\|\||;)\s*$/)) {
      complexity += 1;
      continue;
    }

    const pipeParts = part.split(/\s*\|\s*/);

    for (let j = 0; j < pipeParts.length; j++) {
      const segment = pipeParts[j]?.trim();
      if (!segment) continue;

      if (j > 0) complexity += 1;

      const parsed = parseCommandArgs(segment);
      if (parsed.command) {
        commands.push({
          command: parsed.command,
          args: parsed.args,
          risk: getCommandRisk(parsed.command, parsed.args),
          hasRedirect: !!parsed.redirectTarget,
          redirectTarget: parsed.redirectTarget,
        });
        complexity += 1;
      }
    }
  }

  let overallRisk: RiskLevel = 'READ';
  for (const cmd of commands) {
    if (RISK_PRECEDENCE[cmd.risk] > RISK_PRECEDENCE[overallRisk]) {
      overallRisk = cmd.risk;
    }
  }

  if (hasSubshell && overallRisk !== 'EXECUTE' && overallRisk !== 'NETWORK' && overallRisk !== 'DESTRUCTIVE') {
    overallRisk = 'EXECUTE';
  }

  return {
    commands,
    overallRisk,
    hasSubshell,
    complexity,
  };
}

export type ValidationResult = {
  allowed: boolean;
  risk: RiskLevel;
  mode: SandboxMode;
  reason?: string;
  warnings: string[];
  details: {
    commands: ParsedCommand[];
    complexity: number;
    wouldBeBlockedInStrict: boolean;
  };
};

export function validateCommand(command: string, config?: Partial<SandboxConfig>): ValidationResult {
  const cfg: SandboxConfig = {
    ...STRICT_CONFIG,
    ...config,
    capabilities: [...(config?.capabilities || STRICT_CONFIG.capabilities)],
    blockedCommands: [...(config?.blockedCommands || [])],
    allowedCommands: [...(config?.allowedCommands || [])],
  };

  const warnings: string[] = [];
  const parsed = parsePipeline(command);

  // Check blocked patterns first
  for (const { pattern, reason, risk } of BLOCKED_PATTERNS) {
    if (pattern.test(command)) {
      const result: ValidationResult = {
        allowed: cfg.mode === 'AUDIT',
        risk,
        mode: cfg.mode,
        reason: `Blocked pattern: ${reason}`,
        warnings: [`Would violate policy: ${reason}`],
        details: {
          commands: parsed.commands,
          complexity: parsed.complexity,
          wouldBeBlockedInStrict: true,
        },
      };
      if (cfg.mode === 'AUDIT') {
        result.warnings.push('AUDIT mode: would be blocked in STRICT');
      }
      return result;
    }
  }

  // Check complexity
  if (parsed.complexity > cfg.maxComplexity) {
    return {
      allowed: cfg.mode === 'AUDIT',
      risk: parsed.overallRisk,
      mode: cfg.mode,
      reason: `Command too complex (${parsed.complexity} > ${cfg.maxComplexity})`,
      warnings: [`Complexity ${parsed.complexity} exceeds limit ${cfg.maxComplexity}`],
      details: {
        commands: parsed.commands,
        complexity: parsed.complexity,
        wouldBeBlockedInStrict: true,
      },
    };
  }

  // Check subshells
  if (parsed.hasSubshell && !cfg.allowSubshells) {
    return {
      allowed: cfg.mode === 'AUDIT',
      risk: 'EXECUTE',
      mode: cfg.mode,
      reason: 'Subshells not allowed',
      warnings: ['Subshell detected but not allowed in policy'],
      details: {
        commands: parsed.commands,
        complexity: parsed.complexity,
        wouldBeBlockedInStrict: true,
      },
    };
  }

  // Check each command
  for (const cmd of parsed.commands) {
    const baseCmd = extractCommand(cmd.command);

    // Check explicit allows
    if (cfg.allowedCommands.includes(baseCmd)) {
      continue;
    }

    // Check explicit blocks
    if (cfg.blockedCommands.includes(baseCmd)) {
      return {
        allowed: cfg.mode === 'AUDIT',
        risk: cmd.risk,
        mode: cfg.mode,
        reason: `Command '${baseCmd}' is blocked`,
        warnings: [`'${baseCmd}' in blocked commands list`],
        details: {
          commands: parsed.commands,
          complexity: parsed.complexity,
          wouldBeBlockedInStrict: true,
        },
      };
    }

    // Check capabilities
    const requiredCap = riskToCapability(cmd.risk);
    if (!cfg.capabilities.includes(requiredCap)) {
      const result: ValidationResult = {
        allowed: cfg.mode === 'AUDIT',
        risk: cmd.risk,
        mode: cfg.mode,
        reason: `Blocked: ${baseCmd} requires '${requiredCap}' capability`,
        warnings: [`Blocked: '${baseCmd}' requires '${requiredCap}' capability`],
        details: {
          commands: parsed.commands,
          complexity: parsed.complexity,
          wouldBeBlockedInStrict: true,
        },
      };
      if (cfg.mode === 'AUDIT') {
        result.warnings.push(`AUDIT: missing ${requiredCap}`);
      }
      return result;
    }

    // Add warnings for higher risk commands
    if (cmd.risk === 'DESTRUCTIVE') {
      warnings.push(`Destructive command: ${baseCmd}`);
    } else if (cmd.risk === 'NETWORK') {
      warnings.push(`Network command: ${baseCmd}`);
    } else if (cmd.risk === 'EXECUTE') {
      warnings.push(`Code execution: ${baseCmd}`);
    }
  }

  // All checks passed
  const result: ValidationResult = {
    allowed: true,
    risk: parsed.overallRisk,
    mode: cfg.mode,
    warnings,
    details: {
      commands: parsed.commands,
      complexity: parsed.complexity,
      wouldBeBlockedInStrict: cfg.mode !== 'STRICT' && wouldBeBlockedInStrictMode(parsed, cfg),
    },
  };

  if (cfg.mode === 'AUDIT') {
    result.warnings.push('AUDIT mode: command allowed');
  }

  return result;
}

function riskToCapability(risk: RiskLevel): ShellCapability {
  switch (risk) {
    case 'READ':
      return 'read';
    case 'WRITE':
      return 'write';
    case 'EXECUTE':
      return 'execute';
    case 'NETWORK':
      return 'network';
    case 'DESTRUCTIVE':
      return 'destructive';
  }
}

function wouldBeBlockedInStrictMode(parsed: ParsedPipeline, cfg: SandboxConfig): boolean {
  // Simulate STRICT mode check
  const strictCaps = STRICT_CONFIG.capabilities;
  for (const cmd of parsed.commands) {
    const requiredCap = riskToCapability(cmd.risk);
    if (!strictCaps.includes(requiredCap)) {
      return true;
    }
  }
  if (parsed.hasSubshell && !STRICT_CONFIG.allowSubshells) {
    return true;
  }
  if (parsed.complexity > STRICT_CONFIG.maxComplexity) {
    return true;
  }
  return false;
}

/** Get config for an agent by name. */
export function getAgentPolicy(agentName: string): SandboxConfig {
  return AGENT_POLICIES[agentName] || STRICT_CONFIG;
}

/** Create a custom config merging with defaults. */
export function createConfig(
  base: 'STRICT' | 'PERMISSIVE' | 'AUDIT',
  overrides?: Partial<SandboxConfig>
): SandboxConfig {
  const baseConfig = base === 'STRICT' ? STRICT_CONFIG : base === 'PERMISSIVE' ? PERMISSIVE_CONFIG : AUDIT_CONFIG;
  return {
    ...baseConfig,
    ...overrides,
    capabilities: [...(overrides?.capabilities ?? baseConfig.capabilities)],
    blockedCommands: [...baseConfig.blockedCommands, ...(overrides?.blockedCommands ?? [])],
    allowedCommands: [...baseConfig.allowedCommands, ...(overrides?.allowedCommands ?? [])],
  };
}

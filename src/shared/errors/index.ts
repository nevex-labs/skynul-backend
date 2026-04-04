export class SecretNotFoundError {
  readonly _tag = 'SecretNotFoundError' as const;
  constructor(public readonly keyName: string) {}
}

export class SecretAlreadyExistsError {
  readonly _tag = 'SecretAlreadyExistsError' as const;
  constructor(public readonly keyName: string) {}
}

export class DatabaseError {
  readonly _tag = 'DatabaseError' as const;
  constructor(public readonly cause: unknown) {}
}

export class CryptoError {
  readonly _tag = 'CryptoError' as const;
  constructor(public readonly cause: unknown) {}
}

export class ConfigError {
  readonly _tag = 'ConfigError' as const;
  constructor(public readonly message: string) {}
}

export class ProjectNotFoundError {
  readonly _tag = 'ProjectNotFoundError' as const;
  constructor(public readonly projectId: string | number) {}
}

export class SkillNotFoundError {
  readonly _tag = 'SkillNotFoundError' as const;
  constructor(public readonly skillId: string | number) {}
}

export class BrowserSnapshotNotFoundError {
  readonly _tag = 'BrowserSnapshotNotFoundError' as const;
  constructor(public readonly snapshotId: string) {}
}

export class SessionNotFoundError {
  readonly _tag = 'SessionNotFoundError' as const;
  constructor(public readonly sessionId: string) {}
}

export class ChannelNotFoundError {
  readonly _tag = 'ChannelNotFoundError' as const;
  constructor(public readonly channelId: string) {}
}

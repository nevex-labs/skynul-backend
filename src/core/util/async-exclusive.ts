export function createAsyncExclusive(): <T>(fn: () => Promise<T>) => Promise<T> {
  let chain = Promise.resolve();
  return function runExclusive<T>(fn: () => Promise<T>): Promise<T> {
    const next = chain.then(() => fn());
    chain = next.then(
      () => undefined,
      () => undefined
    );
    return next;
  };
}

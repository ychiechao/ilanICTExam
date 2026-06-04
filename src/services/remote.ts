const DEFAULT_TIMEOUT_MS = 5000;

export async function withRemoteTimeout<T>(
  task: Promise<T>,
  label: string,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(`${label} 連線逾時，已改用本機模式。`));
    }, timeoutMs);
  });

  try {
    return await Promise.race([task, timeout]);
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
}

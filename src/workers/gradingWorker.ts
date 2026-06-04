interface WorkerRequest {
  code: string;
  inputs: string[];
  maxOutputLength: number;
}

self.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const { code, inputs, maxOutputLength } = event.data;
  const queue = [...inputs];
  const output: string[] = [];

  const prompt = () => queue.shift() ?? "";
  const alert = (value: unknown) => {
    output.push(String(value));
  };
  const consoleProxy = {
    log: (...values: unknown[]) => output.push(values.map(String).join(" ")),
  };
  const windowProxy = {
    prompt,
    alert,
  };

  try {
    const runner = new Function("window", "prompt", "alert", "console", code);
    runner(windowProxy, prompt, alert, consoleProxy);
    const joined = output.join(" ").trim();
    const safeOutput =
      joined.length > maxOutputLength
        ? `${joined.slice(0, maxOutputLength)}...(輸出過長，已截斷)`
        : joined;
    self.postMessage({ output: safeOutput });
  } catch (error) {
    self.postMessage({
      output: output.join(" ").trim(),
      error: error instanceof Error ? error.message : "執行失敗",
    });
  }
};

export {};

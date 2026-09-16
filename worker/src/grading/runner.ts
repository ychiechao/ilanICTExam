/**
 * 在 Worker 裡執行參賽者的程式。
 *
 * Cloudflare Workers 禁止 eval / new Function，所以用 JS-Interpreter（Blockly 官方配套的 ES5 直譯器）
 * 逐步執行。好處是可以用「步數」限制無限迴圈，與 CPU 時間無關、結果可重現。
 * prompt / alert / console.log 的行為與前端 Web Worker 相同。
 */
import Interpreter from "js-interpreter";
import type { RunResult } from "../../../shared/grading";

export interface RunOptions {
  inputs: string[];
  maxSteps: number;
  maxOutputLength: number;
}

export interface RunOutcome extends RunResult {
  steps: number;
}

export function runProgram(code: string, options: RunOptions): RunOutcome {
  const queue = [...options.inputs];
  const output: string[] = [];
  let steps = 0;

  let interpreter: Interpreter;
  try {
    interpreter = new Interpreter(code, (it, globalObject) => {
      // Blockly 產生的程式呼叫 window.prompt / window.alert；直譯器裡 window 就是全域物件。
      it.setProperty(globalObject, "prompt", it.createNativeFunction(() => queue.shift() ?? ""));
      it.setProperty(
        globalObject,
        "alert",
        it.createNativeFunction((value: unknown) => {
          output.push(String(value));
        }),
      );
      const consoleObject = it.nativeToPseudo({});
      it.setProperty(globalObject, "console", consoleObject);
      it.setProperty(
        consoleObject,
        "log",
        it.createNativeFunction((...values: unknown[]) => {
          output.push(values.map(String).join(" "));
        }),
      );
    });
  } catch (error) {
    return { output: "", error: `程式無法解析：${error instanceof Error ? error.message : String(error)}`, steps: 0 };
  }

  try {
    while (interpreter.step()) {
      steps += 1;
      if (steps > options.maxSteps) {
        return { output: joinOutput(output, options.maxOutputLength), error: "執行超時，可能發生無限迴圈。", steps };
      }
    }
  } catch (error) {
    return {
      output: joinOutput(output, options.maxOutputLength),
      error: error instanceof Error ? error.message : String(error),
      steps,
    };
  }

  return { output: joinOutput(output, options.maxOutputLength), steps };
}

function joinOutput(parts: string[], maxLength: number) {
  const joined = parts.join(" ").trim();
  return joined.length > maxLength ? `${joined.slice(0, maxLength)}...(輸出過長，已截斷)` : joined;
}

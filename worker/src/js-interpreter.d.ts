declare module "js-interpreter" {
  interface InterpreterObject {
    [key: string]: unknown;
  }
  class Interpreter {
    constructor(code: string, initFunc?: (interpreter: Interpreter, globalObject: InterpreterObject) => void);
    step(): boolean;
    run(): boolean;
    value: unknown;
    setProperty(object: InterpreterObject, name: string, value: unknown): void;
    createNativeFunction(fn: (...args: any[]) => unknown, isConstructor?: boolean): unknown;
    nativeToPseudo(value: unknown): InterpreterObject;
    pseudoToNative(value: unknown): unknown;
  }
  export default Interpreter;
}

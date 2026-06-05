import { useEffect, useRef } from "react";
import * as Blockly from "blockly";
import "blockly/blocks";
import { javascriptGenerator } from "blockly/javascript";
import * as ZhHant from "blockly/msg/zh-hant";
import type { WorkspaceMode } from "../types";

const zhHantMessages = Object.fromEntries(
  Object.entries(ZhHant).filter(([, value]) => typeof value === "string"),
) as Record<string, string>;

Blockly.setLocale(zhHantMessages);

interface BlocklyWorkspaceProps {
  mode: WorkspaceMode;
  storageKey: string;
  fallbackStorageKeys?: string[];
  recordXml: string;
  zoomScale?: number;
  onChange: (payload: { code: string; xml: string }) => void;
}

const DEFAULT_XML = `<xml xmlns="https://developers.google.com/blockly/xml"></xml>`;

let customBlocksRegistered = false;

export default function BlocklyWorkspace({
  mode,
  storageKey,
  fallbackStorageKeys = [],
  recordXml,
  zoomScale = 1,
  onChange,
}: BlocklyWorkspaceProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const workspaceRef = useRef<Blockly.WorkspaceSvg | null>(null);
  const fallbackKeySignature = fallbackStorageKeys.join("\u0000");

  useEffect(() => {
    registerCustomBlocks();
  }, []);

  useEffect(() => {
    if (!containerRef.current || workspaceRef.current) {
      return;
    }

    const workspace = Blockly.inject(containerRef.current, {
      toolbox: createToolbox(),
      renderer: mode === "Scratch" ? "zelos" : "geras",
      theme: mode === "Scratch" ? Blockly.Themes.Zelos : Blockly.Themes.Classic,
      grid: { spacing: 24, length: 3, colour: "#d7dee8", snap: true },
      trashcan: true,
      zoom: {
        controls: true,
        wheel: true,
        startScale: zoomScale,
        maxScale: 1.5,
        minScale: 0.45,
        scaleSpeed: 1.08,
      },
    });

    workspaceRef.current = workspace;
    loadXml(workspace, readInitialWorkspaceXml(storageKey, fallbackStorageKeys));
    emitWorkspace(workspace, onChange, storageKey);

    const listener = () => emitWorkspace(workspace, onChange, storageKey);
    workspace.addChangeListener(listener);

    const resize = () => Blockly.svgResize(workspace);
    window.addEventListener("resize", resize);
    window.setTimeout(resize, 0);

    return () => {
      window.removeEventListener("resize", resize);
      workspace.removeChangeListener(listener);
      workspace.dispose();
      workspaceRef.current = null;
    };
  }, [fallbackKeySignature, mode, onChange, storageKey]);

  useEffect(() => {
    const workspace = workspaceRef.current;
    if (!workspace || !recordXml) {
      return;
    }
    loadXml(workspace, recordXml);
    emitWorkspace(workspace, onChange, storageKey);
  }, [onChange, recordXml, storageKey]);

  useEffect(() => {
    const workspace = workspaceRef.current;
    if (workspace) {
      workspace.updateToolbox(createToolbox());
    }
  }, [mode]);

  useEffect(() => {
    const workspace = workspaceRef.current;
    if (!workspace) {
      return;
    }
    (workspace as Blockly.WorkspaceSvg & { setScale?: (scale: number) => void }).setScale?.(zoomScale);
    Blockly.svgResize(workspace);
  }, [zoomScale]);

  return <div className="blockly-host" ref={containerRef} />;
}

function emitWorkspace(
  workspace: Blockly.WorkspaceSvg,
  onChange: BlocklyWorkspaceProps["onChange"],
  storageKey: string,
) {
  try {
    javascriptGenerator.init(workspace);
    const code = javascriptGenerator.workspaceToCode(workspace);
    const xml = Blockly.Xml.domToText(Blockly.Xml.workspaceToDom(workspace));
    localStorage.setItem(storageKey, xml);
    onChange({ code, xml });
  } catch (error) {
    console.warn("Blockly 產碼失敗。", error);
  }
}

function loadXml(workspace: Blockly.WorkspaceSvg, xmlText: string) {
  try {
    workspace.clear();
    const dom = parseXml(xmlText);
    Blockly.Xml.domToWorkspace(dom, workspace);
  } catch {
    workspace.clear();
    const dom = parseXml(DEFAULT_XML);
    Blockly.Xml.domToWorkspace(dom, workspace);
  }
}

function parseXml(xmlText: string) {
  const document = new DOMParser().parseFromString(xmlText, "text/xml");
  return document.documentElement;
}

function readInitialWorkspaceXml(storageKey: string, fallbackStorageKeys: string[]) {
  const primaryXml = localStorage.getItem(storageKey);
  if (isMeaningfulXml(primaryXml)) {
    return primaryXml;
  }

  const fallbackXml = fallbackStorageKeys
    .map((key) => localStorage.getItem(key))
    .find((xml) => isMeaningfulXml(xml));

  if (fallbackXml) {
    localStorage.setItem(storageKey, fallbackXml);
    return fallbackXml;
  }

  return primaryXml || DEFAULT_XML;
}

function isMeaningfulXml(xml: string | null): xml is string {
  return Boolean(xml && (xml.includes("<block") || xml.includes("<variables")));
}

function createToolbox(): Blockly.utils.toolbox.ToolboxDefinition {
  const block = (
    type: string,
    inputs?: Record<string, unknown>,
    fields?: Record<string, string>,
    extraState?: unknown,
  ) =>
    ({
      kind: "block" as const,
      type,
      ...(inputs ? { inputs } : {}),
      ...(fields ? { fields } : {}),
      ...(extraState ? { extraState } : {}),
    }) as unknown as Blockly.utils.toolbox.BlockInfo;
  const value = (type: string, fields?: Record<string, string>) => ({
    shadow: {
      type,
      ...(fields ? { fields } : {}),
    },
  });
  const numberValue = (num: number) => value("math_number", { NUM: String(num) });
  const textValue = (text: string) => value("text", { TEXT: text });

  return {
    kind: "categoryToolbox",
    contents: [
      {
        kind: "category",
        name: "邏輯",
        colour: "#5C81A6",
        contents: [
          block("controls_if"),
          block("logic_compare"),
          block("logic_operation"),
          block("logic_negate"),
          block("logic_boolean"),
          block("logic_null"),
          block("logic_ternary"),
        ],
      },
      {
        kind: "category",
        name: "迴圈",
        colour: "#5CA65C",
        contents: [
          block("controls_repeat_ext", { TIMES: numberValue(10) }),
          block("controls_whileUntil"),
          block("controls_for", {
            FROM: numberValue(1),
            TO: numberValue(10),
            BY: numberValue(1),
          }),
          block("controls_forEach"),
          block("controls_flow_statements"),
        ],
      },
      {
        kind: "category",
        name: "數學",
        colour: "#5C68A6",
        contents: [
          block("math_number", undefined, { NUM: "0" }),
          block("math_arithmetic", { A: numberValue(1), B: numberValue(1) }),
          block("math_single", { NUM: numberValue(9) }),
          block("math_trig", { NUM: numberValue(45) }),
          block("math_constant"),
          block("math_number_property", { NUMBER_TO_CHECK: numberValue(0) }),
          block("math_round", { NUM: numberValue(3.1) }),
          block("math_on_list"),
          block("math_modulo", { DIVIDEND: numberValue(64), DIVISOR: numberValue(10) }),
          block("math_constrain", {
            VALUE: numberValue(50),
            LOW: numberValue(1),
            HIGH: numberValue(100),
          }),
          block("math_random_int", { FROM: numberValue(1), TO: numberValue(100) }),
          block("math_random_float"),
        ],
      },
      {
        kind: "category",
        name: "文字",
        colour: "#5CA68D",
        contents: [
          block("text"),
          block("text_join"),
          block("text_append", { TEXT: textValue("") }),
          block("text_length1", { VALUE: textValue("abc") }),
          block("text_isEmpty", { VALUE: textValue("") }),
          block("text_indexOf", { VALUE: textValue("abc"), FIND: textValue("b") }),
          block("text_charAt", { VALUE: textValue("abc") }),
          block("text_getSubstring", { STRING: textValue("abc") }),
          block("text_changeCase", { TEXT: textValue("abc") }),
          block("text_trim", { TEXT: textValue("abc") }),
          block("text_print", { TEXT: textValue("abc") }),
          block("text_prompt_ext", { TEXT: textValue("abc") }),
        ],
      },
      {
        kind: "category",
        name: "清單",
        colour: "#745CA6",
        contents: [
          block("lists_create_with", undefined, undefined, { itemCount: 0 }),
          block("lists_create_with"),
          block("lists_repeat", { NUM: numberValue(5) }),
          block("lists_length"),
          block("lists_isEmpty"),
          block("lists_indexOf"),
          block("lists_getIndex"),
          block("lists_setIndex"),
          block("lists_getSublist"),
          block("lists_sort"),
          block("lists_split"),
          block("lists_reverse"),
        ],
      },
      {
        kind: "category",
        name: "變數",
        custom: "VARIABLE",
        colour: "#A65C81",
      },
      {
        kind: "category",
        name: "函式",
        custom: "PROCEDURE",
        colour: "#995BA5",
      },
    ],
  };
}

function registerCustomBlocks() {
  if (customBlocksRegistered) {
    return;
  }

  Blockly.defineBlocksWithJsonArray([
    {
      type: "event_whenflagclicked",
      message0: "當綠旗被點擊 %1 %2",
      args0: [
        {
          type: "field_label_serializable",
          name: "FLAG",
          text: "⚑",
        },
        {
          type: "input_statement",
          name: "DO",
        },
      ],
      colour: "#F6B73C",
      tooltip: "Scratch 風格的起始事件。",
    },
    {
      type: "io_print",
      message0: "說出 %1",
      args0: [
        {
          type: "input_value",
          name: "TEXT",
        },
      ],
      previousStatement: null,
      nextStatement: null,
      colour: "#8B5CF6",
      tooltip: "輸出一段文字或數值。",
    },
    {
      type: "io_input",
      message0: "讀取文字",
      output: null,
      colour: "#0EA5E9",
      tooltip: "讀取下一筆輸入資料。",
    },
    {
      type: "io_input_number",
      message0: "讀取數字",
      output: "Number",
      colour: "#0EA5E9",
      tooltip: "讀取下一筆輸入資料，並轉成數字。",
    },
    {
      type: "text_length1",
      message0: "字串長度 %1",
      args0: [
        {
          type: "input_value",
          name: "VALUE",
          check: "String",
        },
      ],
      output: "Number",
      colour: "#5CA68D",
      tooltip: "回傳文字長度。",
    },
  ]);

  javascriptGenerator.forBlock.event_whenflagclicked = (block, generator) =>
    generator.statementToCode(block, "DO");
  javascriptGenerator.forBlock.io_print = (block, generator) => {
    const value = generator.valueToCode(block, "TEXT", 0) || "''";
    return `window.alert(${value});\n`;
  };
  javascriptGenerator.forBlock.io_input = () => ["window.prompt('')", 0];
  javascriptGenerator.forBlock.io_input_number = () => ["Number(window.prompt(''))", 0];
  javascriptGenerator.forBlock.text_length1 = (block, generator) => {
    const value = generator.valueToCode(block, "VALUE", 0) || "''";
    return [`String(${value}).length`, 0];
  };

  customBlocksRegistered = true;
}

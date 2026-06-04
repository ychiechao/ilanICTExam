import { useEffect, useRef } from "react";
import * as Blockly from "blockly";
import "blockly/blocks";
import { javascriptGenerator } from "blockly/javascript";
import type { WorkspaceMode } from "../types";

interface BlocklyWorkspaceProps {
  mode: WorkspaceMode;
  storageKey: string;
  recordXml: string;
  onChange: (payload: { code: string; xml: string }) => void;
}

const DEFAULT_XML = `<xml xmlns="https://developers.google.com/blockly/xml">
  <block type="event_whenflagclicked" x="32" y="32"></block>
</xml>`;

let customBlocksRegistered = false;

export default function BlocklyWorkspace({
  mode,
  storageKey,
  recordXml,
  onChange,
}: BlocklyWorkspaceProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const workspaceRef = useRef<Blockly.WorkspaceSvg | null>(null);

  useEffect(() => {
    registerCustomBlocks();
  }, []);

  useEffect(() => {
    if (!containerRef.current || workspaceRef.current) {
      return;
    }

    const workspace = Blockly.inject(containerRef.current, {
      toolbox: createToolbox(mode),
      renderer: mode === "Scratch" ? "zelos" : "geras",
      theme: mode === "Scratch" ? Blockly.Themes.Zelos : Blockly.Themes.Classic,
      grid: { spacing: 24, length: 3, colour: "#d7dee8", snap: true },
      trashcan: true,
      zoom: {
        controls: true,
        wheel: true,
        startScale: 0.9,
        maxScale: 1.5,
        minScale: 0.45,
        scaleSpeed: 1.08,
      },
    });

    workspaceRef.current = workspace;
    loadXml(workspace, localStorage.getItem(storageKey) || DEFAULT_XML);
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
  }, [mode, onChange, storageKey]);

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
      workspace.updateToolbox(createToolbox(mode));
    }
  }, [mode]);

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

function createToolbox(mode: WorkspaceMode): Blockly.utils.toolbox.ToolboxDefinition {
  const scratchOnly =
    mode === "Scratch"
      ? [
          {
            kind: "block",
            type: "event_whenflagclicked",
          },
          {
            kind: "block",
            type: "io_print",
          },
          {
            kind: "block",
            type: "io_input",
          },
        ]
      : [
          {
            kind: "block",
            type: "io_print",
          },
          {
            kind: "block",
            type: "io_input",
          },
        ];

  return {
    kind: "categoryToolbox",
    contents: [
      {
        kind: "category",
        name: "事件",
        colour: "#F6B73C",
        contents: scratchOnly,
      },
      {
        kind: "category",
        name: "控制",
        colour: "#3B82F6",
        contents: [
          { kind: "block", type: "controls_if" },
          { kind: "block", type: "controls_repeat_ext" },
          { kind: "block", type: "controls_whileUntil" },
          { kind: "block", type: "controls_for" },
          { kind: "block", type: "controls_forEach" },
          { kind: "block", type: "controls_flow_statements" },
        ],
      },
      {
        kind: "category",
        name: "運算",
        colour: "#10B981",
        contents: [
          { kind: "block", type: "logic_compare" },
          { kind: "block", type: "logic_operation" },
          { kind: "block", type: "logic_negate" },
          { kind: "block", type: "logic_boolean" },
          { kind: "block", type: "math_number" },
          { kind: "block", type: "math_arithmetic" },
          { kind: "block", type: "math_modulo" },
          { kind: "block", type: "math_round" },
        ],
      },
      {
        kind: "category",
        name: "文字",
        colour: "#8B5CF6",
        contents: [
          { kind: "block", type: "text" },
          { kind: "block", type: "text_join" },
          { kind: "block", type: "text_length" },
          { kind: "block", type: "text_isEmpty" },
        ],
      },
      {
        kind: "category",
        name: "清單",
        colour: "#EC4899",
        contents: [
          { kind: "block", type: "lists_create_empty" },
          { kind: "block", type: "lists_create_with" },
          { kind: "block", type: "lists_length" },
          { kind: "block", type: "lists_isEmpty" },
          { kind: "block", type: "lists_indexOf" },
          { kind: "block", type: "lists_getIndex" },
          { kind: "block", type: "lists_setIndex" },
          { kind: "block", type: "lists_sort" },
        ],
      },
      {
        kind: "category",
        name: "變數",
        custom: "VARIABLE",
        colour: "#F97316",
      },
      {
        kind: "category",
        name: "函式",
        custom: "PROCEDURE",
        colour: "#14B8A6",
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
      message0: "詢問並取得答案",
      output: null,
      colour: "#0EA5E9",
      tooltip: "讀取下一筆輸入資料。",
    },
  ]);

  javascriptGenerator.forBlock.event_whenflagclicked = (block, generator) =>
    generator.statementToCode(block, "DO");
  javascriptGenerator.forBlock.io_print = (block, generator) => {
    const value = generator.valueToCode(block, "TEXT", 0) || "''";
    return `window.alert(${value});\n`;
  };
  javascriptGenerator.forBlock.io_input = () => ["window.prompt('')", 0];

  customBlocksRegistered = true;
}

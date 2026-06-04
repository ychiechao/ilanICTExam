import type { Problem } from "../types";

export const sampleProblems: Problem[] = [
  {
    id: "lunch-order",
    title: "可口便當",
    description:
      "可口便當主廚每天早上會先檢視每筆訂單上的套餐，再列出當天套餐應該烹煮的先後順序。請依據訂單資訊與主廚準備便當的順序，列舉出所有套餐被處理的順序。",
    inputFormat:
      "第一個數字為訂單數量 N，接著輸入 N 筆套餐編號。再輸入主廚準備順序數量 M，最後輸入 M 筆套餐編號。",
    outputFormat:
      "依照主廚準備順序輸出所有出現在訂單中的套餐編號，相同套餐需依訂單數量重複輸出，以空白分隔。",
    difficulty: "easy",
    category: "清單",
    status: "published",
    examples: [
      {
        title: "範例一",
        input: "5\n8 9 9 9 8\n2\n9 8",
        output: "9 9 9 8 8",
        description: "先處理 9 號套餐，再處理 8 號套餐。",
      },
      {
        title: "範例二",
        input: "7\n3 1 4 1 5 9 3\n5\n1 9 4 3 5",
        output: "1 1 9 4 3 3 5",
      },
    ],
    cases: [
      {
        groupTitle: "公開測資",
        caseTitle: "C1",
        input: "5 8 9 9 9 8 2 9 8",
        output: "9 9 9 8 8",
        score: 10,
        visibility: "public",
      },
      {
        groupTitle: "公開測資",
        caseTitle: "C2",
        input: "7 3 1 4 1 5 9 3 5 1 9 4 3 5",
        output: "1 1 9 4 3 3 5",
        score: 10,
        visibility: "public",
      },
      {
        groupTitle: "練習測資",
        caseTitle: "C3",
        input: "6 2 2 1 3 2 1 3 1 2 3",
        output: "1 1 2 2 2 3",
        score: 10,
        visibility: "hidden",
      },
      {
        groupTitle: "練習測資",
        caseTitle: "C4",
        input: "4 5 5 5 5 1 5",
        output: "5 5 5 5",
        score: 10,
        visibility: "hidden",
      },
    ],
  },
  {
    id: "number-filter",
    title: "偶數整理",
    description:
      "輸入一串數字，請依照原本順序輸出所有偶數。如果沒有偶數，請輸出 0。",
    inputFormat: "第一個數字為 N，後面接著 N 個整數。",
    outputFormat: "輸出所有偶數，以空白分隔；若沒有偶數輸出 0。",
    difficulty: "easy",
    category: "迴圈",
    status: "published",
    examples: [
      {
        title: "範例一",
        input: "5\n1 2 3 4 5",
        output: "2 4",
      },
    ],
    cases: [
      {
        groupTitle: "公開測資",
        caseTitle: "C1",
        input: "5 1 2 3 4 5",
        output: "2 4",
        score: 10,
        visibility: "public",
      },
      {
        groupTitle: "公開測資",
        caseTitle: "C2",
        input: "4 7 9 11 13",
        output: "0",
        score: 10,
        visibility: "public",
      },
      {
        groupTitle: "練習測資",
        caseTitle: "C3",
        input: "6 8 6 4 2 1 3",
        output: "8 6 4 2",
        score: 10,
        visibility: "hidden",
      },
    ],
  },
  {
    id: "blank-practice",
    title: "空白題",
    description:
      "本題供自由練習使用。你可以自行設計輸入資料，透過自行測試功能觀察程式輸出。",
    inputFormat: "自由輸入。",
    outputFormat: "自由輸出。",
    difficulty: "easy",
    category: "練習",
    status: "published",
    examples: [],
    cases: [],
  },
];

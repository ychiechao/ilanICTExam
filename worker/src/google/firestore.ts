/**
 * Firestore REST 客戶端（服務帳號身分）。只實作 Worker 需要的操作：
 * 讀單一文件、寫入／合併、批次寫入、簡單查詢。
 *
 * 值的編碼遵循 Firestore REST 的 Value 格式：
 * https://firebase.google.com/docs/firestore/reference/rest/v1/Value
 */
import { getAccessToken, type ServiceAccount } from "./serviceAccount";

export type FirestoreData = Record<string, unknown>;

export interface FirestoreDocument<T = FirestoreData> {
  name: string;
  id: string;
  data: T;
  updateTime?: string;
}

/** 寫入時代表「伺服器時間」的哨兵值。 */
export const SERVER_TIMESTAMP = Symbol("serverTimestamp");

export class FirestoreClient {
  private readonly base: string;
  private readonly docsRoot: string;

  constructor(
    private readonly account: ServiceAccount,
    private readonly projectId: string,
  ) {
    this.base = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)`;
    this.docsRoot = `projects/${projectId}/databases/(default)/documents`;
  }

  async getDoc<T = FirestoreData>(path: string): Promise<FirestoreDocument<T> | null> {
    const response = await this.request(`${this.base}/documents/${path}`);
    if (response.status === 404) {
      return null;
    }
    await assertOk(response, `讀取 ${path}`);
    return decodeDocument<T>(await response.json());
  }

  /** 取代整份文件（merge=false）或只合併給定欄位（merge=true）。 */
  async setDoc(path: string, data: FirestoreData, options: { merge?: boolean } = {}): Promise<void> {
    const { fields, transforms } = encodeFields(data);
    const writes: unknown[] = [
      {
        update: { name: `${this.docsRoot}/${path}`, fields },
        ...(options.merge ? { updateMask: { fieldPaths: Object.keys(fields) } } : {}),
        ...(transforms.length > 0 ? { updateTransforms: transforms } : {}),
      },
    ];
    await this.commit(writes);
  }

  /** 一次寫多份文件（最多 500 筆），全部成功或全部失敗。 */
  async batchSet(items: Array<{ path: string; data: FirestoreData; merge?: boolean }>): Promise<void> {
    for (let index = 0; index < items.length; index += 500) {
      const chunk = items.slice(index, index + 500);
      await this.commit(
        chunk.map((item) => {
          const { fields, transforms } = encodeFields(item.data);
          return {
            update: { name: `${this.docsRoot}/${item.path}`, fields },
            ...(item.merge ? { updateMask: { fieldPaths: Object.keys(fields) } } : {}),
            ...(transforms.length > 0 ? { updateTransforms: transforms } : {}),
          };
        }),
      );
    }
  }

  async deleteDoc(path: string): Promise<void> {
    await this.commit([{ delete: `${this.docsRoot}/${path}` }]);
  }

  /**
   * 簡單查詢：單一集合、等值或比較條件、可選排序與筆數上限。
   * where 的 op 使用 REST 的名稱：EQUAL、LESS_THAN、ARRAY_CONTAINS…
   */
  async query<T = FirestoreData>(
    collection: string,
    options: {
      where?: Array<{ field: string; op: string; value: unknown }>;
      orderBy?: Array<{ field: string; direction?: "ASCENDING" | "DESCENDING" }>;
      limit?: number;
    } = {},
  ): Promise<Array<FirestoreDocument<T>>> {
    const filters = (options.where ?? []).map((item) => ({
      fieldFilter: { field: { fieldPath: item.field }, op: item.op, value: encodeValue(item.value) },
    }));
    const structuredQuery: Record<string, unknown> = {
      from: [{ collectionId: collection }],
      ...(filters.length === 1
        ? { where: filters[0] }
        : filters.length > 1
          ? { where: { compositeFilter: { op: "AND", filters } } }
          : {}),
      ...(options.orderBy
        ? { orderBy: options.orderBy.map((item) => ({ field: { fieldPath: item.field }, direction: item.direction ?? "ASCENDING" })) }
        : {}),
      ...(options.limit ? { limit: options.limit } : {}),
    };
    const response = await this.request(`${this.base}/documents:runQuery`, {
      method: "POST",
      body: JSON.stringify({ structuredQuery }),
    });
    await assertOk(response, `查詢 ${collection}`);
    const rows = (await response.json()) as Array<{ document?: unknown }>;
    return rows.filter((row) => row.document).map((row) => decodeDocument<T>(row.document));
  }

  /** 只算筆數，不抓內容（提交次數檢查用）。 */
  async count(collection: string, where: Array<{ field: string; op: string; value: unknown }>): Promise<number> {
    const filters = where.map((item) => ({
      fieldFilter: { field: { fieldPath: item.field }, op: item.op, value: encodeValue(item.value) },
    }));
    const response = await this.request(`${this.base}/documents:runAggregationQuery`, {
      method: "POST",
      body: JSON.stringify({
        structuredAggregationQuery: {
          structuredQuery: {
            from: [{ collectionId: collection }],
            where: filters.length === 1 ? filters[0] : { compositeFilter: { op: "AND", filters } },
          },
          aggregations: [{ alias: "total", count: {} }],
        },
      }),
    });
    await assertOk(response, `計數 ${collection}`);
    const rows = (await response.json()) as Array<{ result?: { aggregateFields?: { total?: { integerValue?: string } } } }>;
    return Number(rows[0]?.result?.aggregateFields?.total?.integerValue ?? 0);
  }

  private async commit(writes: unknown[]): Promise<void> {
    const response = await this.request(`${this.base}/documents:commit`, {
      method: "POST",
      body: JSON.stringify({ writes }),
    });
    await assertOk(response, "寫入 Firestore");
  }

  private async request(url: string, init: RequestInit = {}): Promise<Response> {
    const token = await getAccessToken(this.account);
    return fetch(url, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        ...(init.headers ?? {}),
      },
    });
  }
}

async function assertOk(response: Response, label: string) {
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`${label}失敗：${response.status} ${text.slice(0, 300)}`);
  }
}

// ---- 編碼 ----

function encodeFields(data: FirestoreData) {
  const fields: Record<string, unknown> = {};
  const transforms: unknown[] = [];
  for (const [key, value] of Object.entries(data)) {
    if (value === undefined) {
      continue;
    }
    if (value === SERVER_TIMESTAMP) {
      transforms.push({ fieldPath: key, setToServerValue: "REQUEST_TIME" });
      continue;
    }
    fields[key] = encodeValue(value);
  }
  return { fields, transforms };
}

export function encodeValue(value: unknown): unknown {
  if (value === null || value === undefined) {
    return { nullValue: null };
  }
  if (typeof value === "string") {
    return { stringValue: value };
  }
  if (typeof value === "boolean") {
    return { booleanValue: value };
  }
  if (typeof value === "number") {
    return Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value };
  }
  if (value instanceof Date) {
    return { timestampValue: value.toISOString() };
  }
  if (Array.isArray(value)) {
    return { arrayValue: { values: value.map(encodeValue) } };
  }
  if (typeof value === "object") {
    const fields: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as FirestoreData)) {
      if (item !== undefined) {
        fields[key] = encodeValue(item);
      }
    }
    return { mapValue: { fields } };
  }
  throw new Error(`無法編碼的值：${typeof value}`);
}

// ---- 解碼 ----

function decodeDocument<T>(raw: unknown): FirestoreDocument<T> {
  const doc = raw as { name: string; fields?: Record<string, unknown>; updateTime?: string };
  const data: FirestoreData = {};
  for (const [key, value] of Object.entries(doc.fields ?? {})) {
    data[key] = decodeValue(value);
  }
  return {
    name: doc.name,
    id: doc.name.slice(doc.name.lastIndexOf("/") + 1),
    data: data as T,
    updateTime: doc.updateTime,
  };
}

export function decodeValue(value: unknown): unknown {
  const item = value as Record<string, unknown>;
  if ("stringValue" in item) return item.stringValue;
  if ("booleanValue" in item) return item.booleanValue;
  if ("integerValue" in item) return Number(item.integerValue);
  if ("doubleValue" in item) return item.doubleValue;
  if ("timestampValue" in item) return item.timestampValue; // ISO 字串
  if ("nullValue" in item) return null;
  if ("arrayValue" in item) {
    const values = (item.arrayValue as { values?: unknown[] }).values ?? [];
    return values.map(decodeValue);
  }
  if ("mapValue" in item) {
    const fields = (item.mapValue as { fields?: Record<string, unknown> }).fields ?? {};
    const out: FirestoreData = {};
    for (const [key, inner] of Object.entries(fields)) {
      out[key] = decodeValue(inner);
    }
    return out;
  }
  return null;
}

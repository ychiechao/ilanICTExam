import { addDoc, collection, serverTimestamp } from "firebase/firestore";
import { db } from "../firebase";
import type { AppUser, AuditAction } from "../types";

interface AuditInput {
  action: AuditAction;
  targetType: string;
  targetId: string;
  summary: string;
}

/**
 * 寫一筆超管操作紀錄。失敗不阻斷主要操作，只留 console 訊息；
 * 正式競賽相關的關鍵操作（模式切換、作廢）由呼叫端決定是否要等待。
 */
export async function writeAuditLog(input: AuditInput, actor: AppUser | null) {
  if (!db) {
    console.info("[audit]", input);
    return;
  }
  try {
    await addDoc(collection(db, "auditLogs"), {
      ...input,
      actorUid: actor?.uid || "unknown",
      actorName: actor?.displayName || "unknown",
      createdAt: serverTimestamp(),
    });
  } catch (error) {
    console.warn("稽核紀錄寫入失敗", input.action, error);
  }
}

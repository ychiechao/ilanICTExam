import { useEffect, useState } from "react";
import type { OnlinePresenceState } from "../../shared/sitePresence";
import { auth } from "../firebase";
import { GRADER_URL } from "../services/grader";
import { connectSitePresence } from "../services/sitePresenceClient";

export function useOnlinePresence(uid: string | null): OnlinePresenceState {
  const [state, setState] = useState<OnlinePresenceState>({ status: "connecting", count: null });
  useEffect(() => {
    if (!uid || !auth || !GRADER_URL) {
      setState({ status: "unavailable", count: null });
      return;
    }
    return connectSitePresence(GRADER_URL, async () => {
      if (auth?.currentUser?.uid !== uid) throw new Error("Account changed");
      return auth.currentUser.getIdToken();
    }, setState);
  }, [uid]);
  return state;
}

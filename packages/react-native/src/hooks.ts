import { useEffect, useSyncExternalStore } from "react";
import { AppState } from "react-native";
import type { RespondKitStore } from "./store";

export function useRespondKit(store: RespondKitStore) {
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
}
/** Mount once at the host root so unread replies refresh while the chat screen is closed. */
export function RespondKitLifecycle({ store }: { readonly store: RespondKitStore }) {
  useEffect(() => {
    store.setForeground(AppState.currentState === "active");
    const subscription = AppState.addEventListener("change", (state) =>
      store.setForeground(state === "active"),
    );
    return () => {
      subscription.remove();
      store.setForeground(false);
    };
  }, [store]);
  return null;
}

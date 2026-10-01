import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Button, Modal, Text, View } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  createRespondKitStore,
  RespondKitLifecycle,
  RespondKitScreen,
  storagePersistence,
  useRespondKit,
  type RespondKitStore,
} from "@respondkit/react-native";
import { demoClient } from "./demo-client";

function Host({ store }: { readonly store: RespondKitStore }) {
  const [open, setOpen] = useState(true);
  const state = useRespondKit(store);
  const close = useCallback(() => setOpen(false), []);
  return (
    <>
      <RespondKitLifecycle store={store} />
      <View
        style={{
          flex: 1,
          justifyContent: "center",
          alignItems: "center",
          gap: 20,
          backgroundColor: "white",
        }}
      >
        <Text style={{ fontSize: 24, color: "#171717" }}>RespondKit Native</Text>
        <Button
          title={state.unreadThreadIds.size ? "Support · Unread reply" : "Open support"}
          onPress={() => setOpen(true)}
        />
      </View>
      <Modal visible={open} animationType="slide" onRequestClose={close}>
        <SafeAreaProvider>
          <RespondKitScreen
            store={store}
            onClose={close}
            title="Example Support"
            greeting="Hi! How can we help you today?"
          />
        </SafeAreaProvider>
      </Modal>
    </>
  );
}
export default function App() {
  const [store, setStore] = useState<RespondKitStore>();
  const [error, setError] = useState<string>();
  useEffect(() => {
    let mounted = true;
    let current: RespondKitStore | undefined;
    void createRespondKitStore({
      apiBaseUrl: "https://api.example.com",
      inboxId: "inbox_demo",
      origin: "https://demo.example.com",
      context: { locale: "en" },
      persistence: storagePersistence(AsyncStorage, "respondkit:demo:v1"),
      pollIntervalMs: 1000,
      client: demoClient(),
    })
      .then((value) => {
        current = value;
        if (mounted) setStore(value);
        else value.dispose();
      })
      .catch((cause) => {
        if (mounted) setError(String(cause));
      });
    return () => {
      mounted = false;
      current?.dispose();
    };
  }, []);
  return (
    <SafeAreaProvider>
      {store ? (
        <Host store={store} />
      ) : (
        <View style={{ flex: 1, justifyContent: "center", alignItems: "center" }}>
          {error ? <Text>{error}</Text> : <ActivityIndicator />}
        </View>
      )}
    </SafeAreaProvider>
  );
}

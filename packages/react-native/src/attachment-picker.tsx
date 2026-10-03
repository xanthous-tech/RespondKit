import { useEffect, useRef, useState } from "react";
import { Alert, Pressable, ScrollView, Text, View } from "react-native";
import type { AttachmentV1 } from "@respondkit/api-client";
import { nativeFileSource, pickSupportFiles, type NativeFile } from "./files";
import type { RespondKitStore } from "./store";
interface Picked {
  id: string;
  file: NativeFile;
  progress: number;
  attachment?: AttachmentV1;
  error?: string | undefined;
}
export function AttachmentPicker({
  store,
  onChange,
}: {
  readonly store: RespondKitStore;
  readonly onChange: (files: AttachmentV1[], busy: boolean) => void;
}) {
  const [files, setFiles] = useState<Picked[]>([]);
  const [error, setError] = useState<string>();
  const controllers = useRef(new Map<string, AbortController>());
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      for (const controller of controllers.current.values()) controller.abort();
    };
  }, []);
  useEffect(
    () =>
      onChange(
        files.flatMap((f) => (f.attachment ? [f.attachment] : [])),
        files.some((f) => !f.attachment),
      ),
    [files, onChange],
  );
  function update(id: string, patch: Partial<Picked>) {
    if (alive.current)
      setFiles((current) => current.map((f) => (f.id === id ? { ...f, ...patch } : f)));
  }
  async function upload(item: Picked) {
    const controller = new AbortController();
    controllers.current.set(item.id, controller);
    update(item.id, { error: undefined });
    try {
      const attachment = await store.upload(
        nativeFileSource(item.file),
        item.id,
        controller.signal,
        (sent, total) =>
          update(item.id, { progress: total ? Math.round((sent / total) * 100) : 100 }),
      );
      update(item.id, { attachment });
    } catch (cause) {
      if (!controller.signal.aborted)
        update(item.id, { error: cause instanceof Error ? cause.message : "Upload failed" });
    } finally {
      controllers.current.delete(item.id);
    }
  }
  async function pick(kind: "photos" | "files") {
    try {
      setError(undefined);
      const selected = await pickSupportFiles(kind);
      if (!alive.current) return;
      const incoming = selected.map((file) => ({
        file,
        progress: 0,
        id: Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) =>
          b.toString(16).padStart(2, "0"),
        ).join(""),
      }));
      setFiles((current) => [...current, ...incoming]);
      incoming.forEach((item) => void upload(item));
    } catch (cause) {
      if (alive.current)
        setError(cause instanceof Error ? cause.message : "Cannot open file picker");
    }
  }
  return (
    <View style={{ paddingHorizontal: 12, paddingTop: 6 }}>
      <Pressable
        accessibilityRole="button"
        onPress={() =>
          Alert.alert("Attach files", undefined, [
            { text: "Photo library", onPress: () => void pick("photos") },
            { text: "Files", onPress: () => void pick("files") },
            { text: "Cancel", style: "cancel" },
          ])
        }
        style={{ paddingVertical: 8 }}
      >
        <Text>📎 Attach files</Text>
      </Pressable>
      {error ? (
        <Text accessibilityRole="alert" style={{ color: "#b91c1c" }}>
          {error}
        </Text>
      ) : null}
      <ScrollView style={{ maxHeight: 128 }} keyboardShouldPersistTaps="handled">
        {files.map((item) => (
          <View key={item.id} style={{ paddingVertical: 5 }}>
            <Text numberOfLines={1}>
              {item.file.name} ·{" "}
              {item.attachment ? "Ready" : item.error ? "Upload failed" : `${item.progress}%`}
            </Text>
            {item.error ? <Text style={{ color: "#b91c1c" }}>{item.error}</Text> : null}
            <View style={{ flexDirection: "row", gap: 20 }}>
              {item.error ? (
                <Pressable accessibilityRole="button" onPress={() => void upload(item)}>
                  <Text>Retry</Text>
                </Pressable>
              ) : null}
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Remove ${item.file.name}`}
                onPress={() => {
                  controllers.current.get(item.id)?.abort();
                  setFiles((current) => current.filter((f) => f.id !== item.id));
                }}
              >
                <Text>Remove</Text>
              </Pressable>
            </View>
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

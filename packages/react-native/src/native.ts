import "react-native-get-random-values";
import { Platform } from "react-native";
import DeviceInfo from "react-native-device-info";
import type { DeviceContextV1 } from "@respondkit/protocol";
import { RespondKitStore, type StoreOptions } from "./store";

export function nativeDeviceContext(): DeviceContextV1 {
  if (Platform.OS !== "ios" && Platform.OS !== "android")
    throw new Error("RespondKit native supports iOS and Android.");
  return {
    platform: Platform.OS,
    model: DeviceInfo.getModel(),
    osVersion: DeviceInfo.getSystemVersion(),
    appVersion: DeviceInfo.getVersion(),
    sdk: "react-native",
  };
}
function nativeId(prefix: string) {
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  return `${prefix}_${Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")}`;
}
export type NativeStoreOptions = Omit<StoreOptions, "createId">;
export function createRespondKitStore(options: NativeStoreOptions): Promise<RespondKitStore> {
  return RespondKitStore.create({
    ...options,
    createId: nativeId,
    context: { ...options.context, device: options.context?.device ?? nativeDeviceContext() },
  });
}

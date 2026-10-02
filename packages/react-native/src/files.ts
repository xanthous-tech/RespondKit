import { NativeModules } from "react-native";
import type { UploadSource } from "@respondkit/api-client";
export interface NativeFile {
  uri: string;
  name: string;
  contentType: string;
  size: number;
}
interface FilesModule {
  pick(kind: "photos" | "files"): Promise<NativeFile[]>;
  readChunk(uri: string, offset: number, length: number): Promise<string>;
}
function bridge(): FilesModule {
  const module = NativeModules.RespondKitFiles as FilesModule | undefined;
  if (!module)
    throw new Error("Rebuild the app with the RespondKit native file module to attach files.");
  return module;
}
export function pickSupportFiles(kind: "photos" | "files"): Promise<NativeFile[]> {
  return bridge().pick(kind);
}
function decode(value: string): Uint8Array<ArrayBuffer> {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  const bytes = new Uint8Array(
    Math.floor((value.length * 3) / 4) - (value.endsWith("==") ? 2 : value.endsWith("=") ? 1 : 0),
  );
  let buffer = 0,
    bits = 0,
    index = 0;
  for (const char of value) {
    if (char === "=") break;
    const n = alphabet.indexOf(char);
    if (n < 0) continue;
    buffer = (buffer << 6) | n;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes[index++] = (buffer >> bits) & 255;
    }
  }
  return bytes;
}
export function nativeFileSource(file: NativeFile): UploadSource {
  return {
    ...file,
    read: async (offset, length) => decode(await bridge().readChunk(file.uri, offset, length)),
  };
}

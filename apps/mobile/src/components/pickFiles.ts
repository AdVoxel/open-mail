import { Platform } from "react-native";
import * as DocumentPicker from "expo-document-picker";
import { File } from "expo-file-system";
import type { OutgoingAttachment } from "@mail-app/api-client";

export interface PickedFile extends OutgoingAttachment {
  size: number;
}

/** Let the user choose files to attach; returns them base64-encoded for the API. */
export async function pickFiles(): Promise<PickedFile[]> {
  const result = await DocumentPicker.getDocumentAsync({ multiple: true, copyToCacheDirectory: true });
  if (result.canceled) return [];
  return Promise.all(
    result.assets.map(async (asset) => {
      let content: string;
      if (Platform.OS === "web") {
        // On web the picker returns a data: URL (or bare base64).
        const data = asset.base64 ?? asset.uri;
        content = data.includes("base64,") ? data.slice(data.indexOf("base64,") + 7) : data;
      } else {
        content = await new File(asset.uri).base64();
      }
      return {
        filename: asset.name,
        contentType: asset.mimeType ?? undefined,
        content,
        size: asset.size ?? Math.floor((content.length * 3) / 4),
      };
    }),
  );
}

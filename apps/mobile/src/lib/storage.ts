import AsyncStorage from "@react-native-async-storage/async-storage";

/** Small JSON wrapper over AsyncStorage (localStorage on web). Never throws. */
export async function loadJson<T>(key: string): Promise<T | null> {
  try {
    const raw = await AsyncStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

export async function saveJson(key: string, value: unknown): Promise<void> {
  try {
    await AsyncStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage can be unavailable (private browsing); settings then last for this session only.
  }
}

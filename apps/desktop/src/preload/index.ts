import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("mailDesktopNotifications", {
  isSupported: (): Promise<boolean> => ipcRenderer.invoke("mail:notifications-supported"),
  show: (title: string, body: string, tag: string): void => {
    ipcRenderer.send("mail:show-notification", { title, body, tag });
  },
  onClick: (callback: (tag: string) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, tag: string) => callback(tag);
    ipcRenderer.on("mail:notification-click", listener);
    return () => ipcRenderer.removeListener("mail:notification-click", listener);
  },
});

import { contextBridge, ipcRenderer } from 'electron'

const electronAPI = {
  getAppInfo: () => ipcRenderer.invoke('get-app-info'),
  getEnv: (key: string) => ipcRenderer.invoke('get-env', key),
  notifications: {
    show: (title: string, body: string) => {
      ipcRenderer.invoke('show-notification', title, body)
    },
  },
  dialog: {
    openFile: (options?: { filters?: { name: string; extensions: string[] }[] }) =>
      ipcRenderer.invoke('open-file-dialog', options),
    saveFile: (options?: { defaultName?: string; filters?: { name: string; extensions: string[] }[] }) =>
      ipcRenderer.invoke('save-file-dialog', options),
  },
  print: () => ipcRenderer.invoke('print'),
  autoUpdater: {
    checkForUpdates: () => ipcRenderer.invoke('check-for-updates'),
    onUpdateAvailable: (callback: (info: any) => void) => {
      ipcRenderer.on('update-available', (_event, info) => callback(info))
    },
    onUpdateDownloaded: (callback: (info: any) => void) => {
      ipcRenderer.on('update-downloaded', (_event, info) => callback(info))
    },
    quitAndInstall: () => ipcRenderer.invoke('quit-and-install'),
  },
  platform: process.platform,
}

contextBridge.exposeInMainWorld('electronAPI', electronAPI)

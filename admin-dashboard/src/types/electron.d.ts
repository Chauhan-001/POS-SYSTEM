interface ElectronAPI {
  getAppInfo: () => Promise<{
    version: string
    name: string
    platform: string
    arch: string
    electron: string
    node: string
  }>
  getEnv: (key: string) => Promise<string | undefined>
  notifications: {
    show: (title: string, body: string) => void
  }
  dialog: {
    openFile: (options?: { filters?: { name: string; extensions: string[] }[] }) => Promise<any>
    saveFile: (options?: { defaultName?: string; filters?: { name: string; extensions: string[] }[] }) => Promise<any>
  }
  print: () => Promise<void>
  autoUpdater: {
    checkForUpdates: () => Promise<any>
    onUpdateAvailable: (callback: (info: any) => void) => void
    onUpdateDownloaded: (callback: (info: any) => void) => void
    quitAndInstall: () => Promise<void>
  }
  platform: string
}

interface Window {
  electronAPI?: ElectronAPI
}

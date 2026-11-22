export interface LauncherState {
  status: string; notice: string; port: string; address: string; build: string; busy: boolean; servicePID: number;
  tosuPath: string; osuPath: string; tosuStatus: string; tosuPort: string; canStartTosu: boolean;
  portableStorage: boolean; storagePath: string;
}
export interface OverlayRendering {
  highResolution: boolean;
  applied: boolean;
  error: string;
}
interface Launcher {
  Snapshot(): Promise<LauncherState>;
  GetOverlayRendering(): Promise<OverlayRendering>;
  SetOverlayRendering(highResolution: boolean): Promise<OverlayRendering>;
  Restart(port: string): Promise<void>;
  ChangeStorage(enabled: boolean): Promise<boolean>;
  ChooseTool(kind: 'tosu' | 'osu'): Promise<void>;
  StartTosu(): Promise<void>;
  Tourney(launch: boolean): Promise<void>;
  OpenBrowser(destination: string, edition: string): Promise<void>;
  CopyAddresses(all: boolean): Promise<void>;
  LogPreview(): Promise<string>;
  OpenLog(): Promise<void>;
  OpenProject(): Promise<void>;
  Quit(): Promise<void>;
}
declare global { interface Window { go: { main: { Launcher: Launcher } } } }
export const launcher = (): Launcher => window.go.main.Launcher;

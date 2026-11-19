export interface LauncherState {
  status: string; notice: string; port: string; address: string; build: string; busy: boolean;
  tosuPath: string; osuPath: string; tosuStatus: string; tosuPort: string; canStartTosu: boolean;
}
interface Launcher {
  Snapshot(): Promise<LauncherState>;
  Restart(port: string): Promise<void>;
  ChooseTool(kind: 'tosu' | 'osu'): Promise<void>;
  StartTosu(): Promise<void>;
  Tourney(launch: boolean): Promise<void>;
  OpenControl(): Promise<void>;
  CopyAddresses(all: boolean): Promise<void>;
  LogPreview(): Promise<string>;
  OpenLog(): Promise<void>;
  OpenProject(): Promise<void>;
  Quit(): Promise<void>;
}
declare global { interface Window { go: { main: { Launcher: Launcher } } } }
export const launcher = (): Launcher => window.go.main.Launcher;

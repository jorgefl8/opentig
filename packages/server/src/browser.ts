import { spawn, type ChildProcess } from 'node:child_process';

export interface BrowserCommand {
  executable: string;
  args: string[];
}

export function browserCommand(url: string, platform: NodeJS.Platform = process.platform): BrowserCommand {
  if (platform === 'win32') return { executable: 'rundll32.exe', args: ['url.dll,FileProtocolHandler', url] };
  if (platform === 'darwin') return { executable: 'open', args: [url] };
  return { executable: 'xdg-open', args: [url] };
}

export function openSystemBrowser(
  url: string,
  launch: typeof spawn = spawn,
  platform: NodeJS.Platform = process.platform,
): Promise<void> {
  const command = browserCommand(url, platform);
  return new Promise((resolve, reject) => {
    let child: ChildProcess;
    try {
      child = launch(command.executable, command.args, {
        detached: true,
        shell: false,
        stdio: 'ignore',
        windowsHide: true,
      });
    } catch (error) {
      reject(error);
      return;
    }
    child.once('error', reject);
    child.once('spawn', () => {
      child.unref();
      resolve();
    });
  });
}

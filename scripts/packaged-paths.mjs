import path from 'node:path';
import { fileURLToPath } from 'node:url';

export function packagedPaths(args = process.argv.slice(2)) {
  const profile = args.includes('--dev') ? 'dev' : 'production';
  const platform = args.find((arg) => arg.startsWith('--platform='))?.slice(11) ?? process.platform;
  const arch = args.find((arg) => arg.startsWith('--arch='))?.slice(7) ?? process.arch;
  const productName = profile === 'dev' ? 'OpenTig Dev' : 'OpenTig';
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'out', `${productName}-${platform}-${arch}`);
  const resources = platform === 'darwin' ? path.join(root, `${productName}.app`, 'Contents', 'Resources') : path.join(root, 'resources');
  const executable = platform === 'darwin' ? path.join(root, `${productName}.app`, 'Contents', 'MacOS', productName) : path.join(root, `${productName}${platform === 'win32' ? '.exe' : ''}`);
  return { profile, platform, arch, productName, root, resources, executable };
}

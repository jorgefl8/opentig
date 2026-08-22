import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { verifyServerBuild } from '../packages/server/scripts/verify-build.mjs';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const packagedServer = path.join(repositoryRoot, 'out', 'OpenTig-win32-x64', 'resources', 'opentig-server');

await verifyServerBuild(packagedServer);
process.stdout.write('PACKAGED_SERVER_BUILD_OK\n');

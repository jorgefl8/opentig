import { describe, expect, it } from 'vitest';
import { renderSystemdUnit } from './cli-service';

describe('OpenTig systemd service', () => {
  it('pins the staged Node CLI and keeps startup configuration explicit', () => {
    const unit = renderSystemdUnit({
      nodeExecutable: '/usr/bin/node',
      cliEntrypoint: '/home/me/.opentig/service/app-0.1.0/dist/bin.mjs',
      cwd: '/home/me/My Repo',
      host: '127.0.0.1',
      port: 6767,
      home: '/home/me/.opentig',
    });
    expect(unit).toContain('ExecStart="/usr/bin/node" "/home/me/.opentig/service/app-0.1.0/dist/bin.mjs" "serve" "/home/me/My Repo" "--host" "127.0.0.1" "--port" "6767" "--home" "/home/me/.opentig"');
    expect(unit).toContain('KillSignal=SIGTERM');
    expect(unit).not.toContain('token');
  });

  it('escapes systemd specifiers and quotes', () => {
    const unit = renderSystemdUnit({
      nodeExecutable: '/opt/node', cliEntrypoint: '/tmp/open%tig/bin.mjs', cwd: '/tmp/a"b',
      host: '127.0.0.1', port: 6767, home: '/tmp/home',
    });
    expect(unit).toContain('/tmp/open%%tig/bin.mjs');
    expect(unit).toContain('/tmp/a\\"b');
  });
});

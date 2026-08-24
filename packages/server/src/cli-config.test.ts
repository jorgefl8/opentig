import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { CliUsageError, parseCliArguments } from './cli-config';

const cwd = path.resolve('C:/work/project');
const home = path.resolve('C:/Users/test');

describe('OpenTig CLI arguments', () => {
  it('defaults to start with the current directory and loopback endpoint', () => {
    expect(parseCliArguments([], {}, cwd, home)).toEqual({
      command: 'start', serviceAction: null, cwd, host: '127.0.0.1', port: 6767,
      home: path.join(home, '.opentig'), openBrowser: true,
    });
  });

  it('supports implicit cwd, explicit start, and headless serve', () => {
    expect(parseCliArguments(['repo'], {}, cwd, home)).toMatchObject({ command: 'start', cwd: path.join(cwd, 'repo'), openBrowser: true });
    expect(parseCliArguments(['start', 'repo', '--no-browser'], {}, cwd, home)).toMatchObject({ command: 'start', openBrowser: false });
    expect(parseCliArguments(['serve', 'repo'], {}, cwd, home)).toMatchObject({ command: 'serve', cwd: path.join(cwd, 'repo'), openBrowser: false });
  });

  it('gives flags precedence over environment', () => {
    expect(parseCliArguments(
      ['--host=192.168.1.4', '--port', '7000', '--home', 'state'],
      { OPENTIG_HOST: '10.0.0.2', OPENTIG_PORT: '7001', OPENTIG_HOME: 'other' }, cwd, home,
    )).toMatchObject({ host: '192.168.1.4', port: 7000, home: path.join(cwd, 'state') });
    expect(parseCliArguments([], { OPENTIG_PORT: '7001' }, cwd, home)).toMatchObject({ port: 7001 });
  });

  it('limits pair to its home selector', () => {
    expect(parseCliArguments(['pair', '--home', 'state'], { OPENTIG_PORT: 'invalid' }, cwd, home)).toMatchObject({ command: 'pair', home: path.join(cwd, 'state') });
    expect(() => parseCliArguments(['pair', cwd], {}, cwd, home)).toThrow(CliUsageError);
    expect(() => parseCliArguments(['pair', '--port', '7000'], {}, cwd, home)).toThrow(CliUsageError);
  });

  it('parses explicit service management without silently enabling it', () => {
    expect(parseCliArguments(['service', 'install', 'repo'], {}, cwd, home)).toMatchObject({
      command: 'service', serviceAction: 'install', cwd: path.join(cwd, 'repo'), host: '127.0.0.1', port: 6767,
    });
    expect(parseCliArguments(['service', 'status', '--home', 'state'], {}, cwd, home)).toMatchObject({
      command: 'service', serviceAction: 'status', home: path.join(cwd, 'state'),
    });
    expect(() => parseCliArguments(['service'], {}, cwd, home)).toThrow('requires install, status, or uninstall');
    expect(() => parseCliArguments(['service', 'uninstall', 'repo'], {}, cwd, home)).toThrow('does not accept a working directory');
  });

  it.each([
    [['--port', '0'], 'Port'],
    [['--port', '70000'], 'Port'],
    [['--host', 'bad host'], 'host'],
    [['--wat'], 'Missing value'],
    [['one', 'two'], 'Only one'],
  ] as const)('rejects invalid input %j', (args, message) => {
    expect(() => parseCliArguments(args, {}, cwd, home)).toThrow(message);
  });

  it('recognizes help and version without evaluating unrelated environment', () => {
    expect(parseCliArguments(['--help'], { OPENTIG_PORT: 'bad' }, cwd, home).command).toBe('help');
    expect(parseCliArguments(['--version'], { OPENTIG_PORT: 'bad' }, cwd, home).command).toBe('version');
  });
});

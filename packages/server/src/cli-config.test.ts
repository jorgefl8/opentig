import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { CliUsageError, parseCliArguments } from './cli-config';

const cwd = path.resolve('C:/work/project');
const home = path.resolve('C:/Users/test');

describe('OpenTig CLI arguments', () => {
  it('defaults to a project-independent server on the loopback endpoint', () => {
    expect(parseCliArguments([], {}, cwd, home)).toEqual({
      command: 'start', serviceAction: null, host: '127.0.0.1', port: 6767,
      home: path.join(home, '.opentig'), openBrowser: true, modifyPath: false,
    });
  });

  it('supports explicit start and headless serve without a repository argument', () => {
    expect(parseCliArguments(['start', '--no-browser'], {}, cwd, home)).toMatchObject({ command: 'start', openBrowser: false });
    expect(parseCliArguments(['serve'], {}, cwd, home)).toMatchObject({ command: 'serve', openBrowser: false });
    expect(() => parseCliArguments(['repo'], {}, cwd, home)).toThrow('Add and select repositories from the OpenTig web UI');
    expect(() => parseCliArguments(['serve', 'repo'], {}, cwd, home)).toThrow('Add and select repositories from the OpenTig web UI');
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
    expect(parseCliArguments(['service', 'install'], {}, cwd, home)).toMatchObject({
      command: 'service', serviceAction: 'install', host: '127.0.0.1', port: 6767,
    });
    expect(parseCliArguments(['service', 'status', '--home', 'state'], {}, cwd, home)).toMatchObject({
      command: 'service', serviceAction: 'status', home: path.join(cwd, 'state'),
    });
    expect(parseCliArguments(['service', 'restart'], {}, cwd, home).serviceAction).toBe('restart');
    expect(() => parseCliArguments(['service'], {}, cwd, home)).toThrow('requires install, status, restart, or uninstall');
    expect(() => parseCliArguments(['service', 'install', 'repo'], {}, cwd, home)).toThrow('Add and select repositories from the OpenTig web UI');
    expect(parseCliArguments(['service', 'install'], {}, cwd, home).modifyPath).toBe(true);
    expect(parseCliArguments(['service', 'install', '--no-modify-path'], {}, cwd, home).modifyPath).toBe(false);
    expect(() => parseCliArguments(['serve', '--no-modify-path'], {}, cwd, home)).toThrow('only supported by service install');
    expect(() => parseCliArguments(['service', 'status', '--no-modify-path'], {}, cwd, home)).toThrow('only supported by service install');
  });

  it.each([
    [['--port', '0'], 'Port'],
    [['--port', '70000'], 'Port'],
    [['--host', 'bad host'], 'host'],
    [['--wat'], 'Unknown option'],
    [['one'], 'Unexpected argument'],
  ] as const)('rejects invalid input %j', (args, message) => {
    expect(() => parseCliArguments(args, {}, cwd, home)).toThrow(message);
  });

  it('recognizes help and version without evaluating unrelated environment', () => {
    expect(parseCliArguments(['--help'], { OPENTIG_PORT: 'bad' }, cwd, home).command).toBe('help');
    expect(parseCliArguments(['--version'], { OPENTIG_PORT: 'bad' }, cwd, home).command).toBe('version');
    expect(parseCliArguments(['help'], { OPENTIG_PORT: 'bad' }, cwd, home).command).toBe('help');
    expect(parseCliArguments(['version'], { OPENTIG_PORT: 'bad' }, cwd, home).command).toBe('version');
  });
  it.each(['status', 'restart', 'uninstall'])('does not evaluate irrelevant listener environment for service %s', action => {
    expect(parseCliArguments(['service', action], { OPENTIG_PORT: 'invalid', OPENTIG_HOST: 'bad host' }, cwd, home).serviceAction).toBe(action);
  });
  it.each([
    [['service', 'statuz'], 'Unknown service action'],
    [['--port'], 'Missing value for --port'],
    [['--port='], 'Missing value for --port'],
    [['--port', '--host', '127.0.0.1'], 'Missing value for --port'],
    [['serve', '--no-browser'], '--no-browser is only supported by start'],
    [['service', 'install', '--no-browser'], '--no-browser is only supported by start'],
  ] as const)('explains invalid command usage %j', (args, expected) => {
    expect(() => parseCliArguments(args, {}, cwd, home)).toThrow(expected);
  });

});

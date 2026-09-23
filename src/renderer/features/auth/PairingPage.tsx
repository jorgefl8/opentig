import { appDisplayName, isDevProfile } from '@/lib/app-identity';
import { useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import {
  consumePairingFragment,
  defaultDeviceName,
  exchangePairingToken,
  type PairingExchangeResult,
} from './pairing';

const messages: Record<Exclude<PairingExchangeResult, 'paired'>, string> = {
  rejected: 'This code is invalid, expired, or already used. Create a new one from OpenTig.',
  unavailable: 'OpenTig could not complete pairing. Check the server and try again.',
};

export default function PairingPage() {
  const [token, setToken] = useState(() => consumePairingFragment(window.location, window.history));
  const [clientName, setClientName] = useState(() => defaultDeviceName(window.navigator.userAgent));
  const [status, setStatus] = useState<'idle' | 'pairing' | Exclude<PairingExchangeResult, 'paired'>>('idle');

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const name = clientName.trim();
    const code = token.trim();
    if (!name || !code || name.length > 64) return;
    setStatus('pairing');
    const result = await exchangePairingToken(code, name);
    if (result === 'paired') window.location.replace('/');
    else setStatus(result);
  };

  return (
    <main className="access-page pairing-page flex min-h-dvh items-center justify-center bg-background px-4 py-6 text-foreground">
      <section className="w-full max-w-md rounded-xl border border-border bg-card p-6 shadow-sm">
        <h1 className="text-lg font-semibold">Pair this browser</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Enter the one-use code shown by the {appDisplayName} desktop app or <code>{isDevProfile ? 'npm run pair:web:dev' : 'opentig pair'}</code>. It expires after five minutes.
        </p>
        <form className="mt-5 grid gap-4" onSubmit={(event) => void submit(event)}>
          <label className="grid gap-1.5 text-sm" htmlFor="pairing-code">
            <span className="font-medium">Pairing code</span>
            <input
              id="pairing-code"
              className="h-10 w-full min-w-0 rounded-md border border-input bg-background px-3 font-mono text-base outline-none focus:border-ring focus:ring-2 focus:ring-ring/20"
              value={token}
              onChange={(event) => setToken(event.target.value)}
              autoComplete="off"
              spellCheck={false}
              required
            />
          </label>
          <label className="grid gap-1.5 text-sm" htmlFor="device-name">
            <span className="font-medium">Device name</span>
            <input
              id="device-name"
              className="h-10 w-full min-w-0 rounded-md border border-input bg-background px-3 text-base outline-none focus:border-ring focus:ring-2 focus:ring-ring/20"
              value={clientName}
              onChange={(event) => setClientName(event.target.value)}
              maxLength={64}
              autoComplete="off"
              required
            />
          </label>
          <Button type="submit" disabled={status === 'pairing' || !token.trim() || !clientName.trim()}>
            {status === 'pairing' ? 'Pairing…' : 'Pair browser'}
          </Button>
        </form>
        {(status === 'rejected' || status === 'unavailable') && (
          <p className="mt-4 text-sm text-destructive" role="alert">{messages[status]}</p>
        )}
        <p className="mt-4 text-xs text-muted-foreground">The code is removed from the address bar immediately and is never stored by the browser.</p>
      </section>
    </main>
  );
}

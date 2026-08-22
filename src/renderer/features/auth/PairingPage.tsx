import { useEffect, useRef, useState } from 'react';
import { exchangePairingFragment, type PairingExchangeResult } from './pairing';

const messages: Record<Exclude<PairingExchangeResult, 'paired'>, string> = {
  'missing-token': 'This pairing link is incomplete. Create a new link from OpenTig.',
  rejected: 'This pairing link is invalid, expired, or already used. Create a new link from OpenTig.',
  unavailable: 'OpenTig could not complete pairing. Check the server and create a new link.',
};

export default function PairingPage() {
  const started = useRef(false);
  const [status, setStatus] = useState<'pairing' | Exclude<PairingExchangeResult, 'paired'>>('pairing');

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void exchangePairingFragment(window.location, window.history).then((result) => {
      if (result === 'paired') window.location.replace('/');
      else setStatus(result);
    });
  }, []);

  return (
    <main className="flex min-h-screen items-center justify-center bg-background p-6 text-foreground">
      <section className="w-full max-w-md rounded-xl border border-border bg-card p-6 shadow-sm" aria-live="polite">
        <h1 className="text-lg font-semibold">Connect to OpenTig</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {status === 'pairing' ? 'Authorising this browser…' : messages[status]}
        </p>
      </section>
    </main>
  );
}

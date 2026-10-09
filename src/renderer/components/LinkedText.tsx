import { Lexer } from 'marked';
import { normalizeExternalUrl } from '@shared/external-url';
import { ExternalLink } from './ExternalLink';

/** Keep commit messages as plain text, making only web/mail links interactive. */
export function LinkedText({ text }: { text: string }) {
  return <>{Lexer.lexInline(text, { gfm: true }).map((token, index) => token.type === 'link' && normalizeExternalUrl(token.href)
    ? <ExternalLink key={index} href={token.href}>{token.text}</ExternalLink>
    : token.raw)}</>;
}

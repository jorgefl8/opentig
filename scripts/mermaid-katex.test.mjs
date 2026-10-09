import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

// Resolve from Mermaid so these checks exercise its installed dependency,
// including a nested copy if a future dependency update reintroduces one.
const require = createRequire(import.meta.url);
const mermaidRequire = createRequire(require.resolve('mermaid'));
const katex = mermaidRequire('katex');

describe.each(['mathml', 'htmlAndMathml'])('Mermaid KaTeX (%s)', (output) => {
  it('renders display math in the native and legacy output modes', () => {
    const html = katex.renderToString(String.raw`\frac{a^2}{b}`, {
      throwOnError: true,
      displayMode: true,
      output,
    });

    expect(html).toContain('<math');
    expect(html).toContain('<mfrac>');
    expect(html).toContain('<msup>');
    if (output === 'htmlAndMathml') expect(html).toContain('katex-html');
  });

  it('does not enable trusted links through inherited renderer options', () => {
    // GHSA-238p-pmpm-9mq7: a polluted prototype must not enable trust.
    // Use an options prototype to reproduce it without mutating Object.prototype.
    const options = Object.assign(Object.create({ trust: true }), {
      throwOnError: true,
      displayMode: true,
      output,
    });
    const expression = String.raw`\href{https://example.com}{x}`;
    const html = katex.renderToString(expression, options);

    expect(html).toContain('<math');
    expect(html).not.toContain('href="https://example.com"');
    // Ensure the same expression really does create a link with explicit trust.
    expect(katex.renderToString(expression, { ...options, trust: true }))
      .toContain('href="https://example.com"');
  });
});

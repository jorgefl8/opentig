export const sampleHtml = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Launchpad | Release board</title>
  <style>
    * { box-sizing: border-box; }
    body { margin: 0; padding: clamp(20px, 5vw, 48px); background: #101116; color: #f0f1f5; font: 15px/1.6 system-ui, sans-serif; }
    main { max-width: 900px; margin: auto; }
    header { border-bottom: 1px solid #30323d; padding-bottom: 24px; margin-bottom: 28px; }
    .eyebrow { color: #9da8ff; font-size: 12px; font-weight: 700; letter-spacing: .15em; text-transform: uppercase; }
    h1 { font-size: clamp(28px, 6vw, 44px); letter-spacing: -.04em; line-height: 1.15; margin: 12px 0; }
    p { color: #a9adbd; margin: 0; }
    .progress { margin-top: 22px; display: flex; gap: 16px; align-items: center; }
    progress { width: 180px; height: 8px; accent-color: #9da8ff; }
    .board { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 16px; }
    h2 { font-size: 12px; text-transform: uppercase; letter-spacing: .08em; color: #a9adbd; }
    article { background: #1a1c24; border: 1px solid #30323d; border-radius: 12px; padding: 18px; margin-bottom: 12px; }
    h3 { font-size: 15px; line-height: 1.45; margin: 12px 0; }
    .tag { font-size: 11px; color: #bbc2ff; background: #292c46; border-radius: 5px; padding: 3px 7px; }
    .done .tag { color: #9ce6c3; background: #19382d; }
    .owner { font-size: 12px; color: #9399ad; }
    footer { margin-top: 24px; font-size: 12px; color: #9399ad; }
    @media (max-width: 560px) { .board { grid-template-columns: 1fr; } }
  </style>
</head>
<body>
  <main>
    <header>
      <span class="eyebrow">Launchpad / v1.0</span>
      <h1>A small team. A big launch.</h1>
      <p>One board for everything between an idea and a release.</p>
      <div class="progress"><progress value="2" max="4" aria-label="Release progress"></progress><span>2 of 4 complete</span></div>
    </header>
    <div class="board">
      <section><h2>Up next · 1</h2>
        <article><span class="tag">Design</span><h3>Design the landing page</h3><span class="owner">Alex · Website</span></article>
      </section>
      <section><h2>In progress · 1</h2>
        <article><span class="tag">Feature</span><h3>Filter tasks by status</h3><span class="owner">Sam · Product</span></article>
      </section>
      <section class="done"><h2>Shipped · 2</h2>
        <article><span class="tag">Done</span><h3>Write the release notes</h3><span class="owner">Alex · Docs</span></article>
        <article><span class="tag">Done</span><h3>Set up the test suite</h3><span class="owner">Sam · Engineering</span></article>
      </section>
    </div>
    <footer>Launchpad release board</footer>
  </main>
</body>
</html>
`;

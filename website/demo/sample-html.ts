// The Launchpad release manifest. Self-contained, without scripts: the demo previews it in a sandboxed frame.
// Sample pull requests edit the headline, the compact breakpoint and column padding, and the #9da8ff accent.
export const sampleHtml = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Launchpad | Release manifest</title>
  <style>
    :root {
      --paper: #f4f1ea; --ink: #1b1a17; --soft: #6d675c; --rule: #1b1a1726; --accent: #9da8ff; --done: #2f7d55;
      --serif: "Iowan Old Style", "Palatino Linotype", Palatino, Georgia, serif;
      --mono: ui-monospace, "SF Mono", "Cascadia Mono", Consolas, "Liberation Mono", monospace;
    }
    * { box-sizing: border-box; }
    body { margin: 0; background: var(--paper); color: var(--ink); font: 16px/1.5 var(--serif); }
    main { max-width: 980px; margin: auto; padding: clamp(20px, 5vw, 56px); }
    .column { padding: 18px; border-left: 1px solid var(--rule); }
    .label, code, time, .masthead, h2, .count, .meta { font-family: var(--mono); font-size: 11.5px; letter-spacing: .08em; text-transform: uppercase; }

    .masthead { display: flex; align-items: center; gap: 10px; padding-bottom: 12px; border-bottom: 2px solid var(--ink); }
    .masthead svg { width: 18px; height: 18px; }
    .masthead span:last-child { margin-left: auto; color: var(--soft); }

    .title { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 32px; align-items: end; padding: 40px 0 32px; border-bottom: 1px solid var(--rule); }
    .label { color: var(--soft); }
    h1 { margin: 14px 0 12px; font-size: clamp(36px, 7vw, 64px); font-weight: 400; line-height: 1; letter-spacing: -.025em; }
    .lede { margin: 0; max-width: 34ch; color: var(--soft); font-size: 18px; font-style: italic; }
    .countdown { text-align: right; }
    .countdown strong { display: block; font: 400 clamp(64px, 12vw, 104px)/.85 var(--mono); letter-spacing: -.06em; }

    .progress { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 24px; align-items: center; padding: 22px 0; border-bottom: 1px solid var(--rule); }
    .segments { display: grid; grid-template-columns: repeat(4, 1fr); gap: 4px; }
    .segments i { height: 10px; border: 1px solid var(--ink); }
    .segments .done { background: var(--ink); }
    .segments .active { background: repeating-linear-gradient(135deg, var(--accent) 0 4px, transparent 4px 8px); }
    .progress p { margin: 0; font-size: 15px; }

    .board { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); margin: 0 -18px; }
    .board .column:first-child { border-left: 0; }
    h2 { display: flex; align-items: center; gap: 8px; margin: 6px 0 4px; font-weight: 600; }
    h2::before { content: ""; width: 9px; height: 9px; border: 1.5px solid var(--ink); border-radius: 50%; }
    .doing h2::before { background: linear-gradient(90deg, var(--accent) 50%, transparent 50%); }
    .shipped h2::before { background: var(--done); border-color: var(--done); }
    .count { margin-left: auto; color: var(--soft); }
    .task { padding: 16px 0; border-top: 1px solid var(--rule); }
    .task:first-of-type { margin-top: 10px; }
    h3 { margin: 6px 0 8px; font-size: 21px; font-weight: 400; line-height: 1.2; }
    .meta { color: var(--soft); letter-spacing: .04em; }
    .meta b { color: var(--ink); font-weight: 600; }
    .shipped h3 { color: var(--soft); text-decoration: line-through; text-decoration-thickness: 1px; }

    .milestones { margin-top: 8px; padding-top: 20px; border-top: 2px solid var(--ink); }
    .milestones ol { display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; margin: 14px 0 0; padding: 0; list-style: none; }
    .milestones li { padding-top: 12px; border-top: 3px solid var(--rule); font-size: 17px; }
    .milestones .done { border-color: var(--ink); }
    .milestones .now { border-color: var(--accent); }
    .milestones time { display: block; margin-bottom: 4px; color: var(--soft); }
    footer { margin-top: 40px; color: var(--soft); font: 11.5px var(--mono); }
    ::selection { background: var(--accent); }
    @media (max-width: 560px) { .title, .progress { grid-template-columns: 1fr; } .countdown { text-align: left; } .board { grid-template-columns: 1fr; margin: 0; } .column { padding-inline: 0; border-left: 0; } .milestones ol { grid-template-columns: 1fr 1fr; } }
  </style>
</head>
<body>
  <main>
    <header class="masthead">
      <svg viewBox="0 0 64 64" aria-hidden="true"><path d="M20 34 13 45l7-1.5zM44 34l7 11-7-1.5z" fill="#1b1a17"/><path d="M32 9c8 5 12 13 12 23v9l-5 5H25l-5-5v-9c0-10 4-18 12-23z" fill="#1b1a17"/><circle cx="32" cy="27" r="5" fill="#9da8ff"/><path d="M26.5 47h11L32 57.5z" fill="#e2603f"/></svg>
      <span>Launchpad</span><span>Release manifest · v1.0</span>
    </header>

    <section class="title">
      <div>
        <span class="label">Release 1.0 · Launch</span>
        <h1>A small team. A big launch.</h1>
        <p class="lede">One board for everything between an idea and a release.</p>
      </div>
      <div class="countdown"><strong>19</strong><span class="label">days to Feb 3</span></div>
    </section>

    <section class="progress" aria-label="Release progress">
      <div class="segments"><i class="done"></i><i class="done"></i><i class="active"></i><i></i></div>
      <p><b>2 of 4</b> shipped · 1 in progress · 1 up next</p>
    </section>

    <div class="board">
      <section class="column">
        <h2>Up next<span class="count">1</span></h2>
        <article class="task"><code>LP-14</code><h3>Design the landing page</h3><div class="meta"><b>Alex</b> · Design · due Jan 28</div></article>
      </section>
      <section class="column doing">
        <h2>In progress<span class="count">1</span></h2>
        <article class="task"><code>LP-12</code><h3>Filter tasks by status</h3><div class="meta"><b>Sam</b> · Feature · due Jan 22</div></article>
      </section>
      <section class="column shipped">
        <h2>Shipped<span class="count">2</span></h2>
        <article class="task"><code>LP-9</code><h3>Write the release notes</h3><div class="meta"><b>Alex</b> · Docs · done</div></article>
        <article class="task"><code>LP-7</code><h3>Set up the test suite</h3><div class="meta"><b>Sam</b> · Engineering · done</div></article>
      </section>
    </div>

    <section class="milestones">
      <span class="label">Milestones</span>
      <ol>
        <li class="done"><time>Jan 05</time>Kickoff</li>
        <li class="done"><time>Jan 15</time>Beta</li>
        <li class="now"><time>Jan 27</time>Code freeze</li>
        <li><time>Feb 03</time>Launch</li>
      </ol>
    </section>

    <footer>Generated from data/tasks.json</footer>
  </main>
</body>
</html>
`;

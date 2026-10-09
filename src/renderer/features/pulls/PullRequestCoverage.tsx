import type { PullRequestContextCoverage } from '@shared/pull-request-context';
import './pull-request-coverage.css';

export function PullRequestCoverage({ coverage, stale }: { coverage: PullRequestContextCoverage; stale: boolean }) {
  const partial = coverage.files.filter(file => file.detail === 'partial');
  const inventoryOnly = coverage.files.filter(file => file.detail === 'inventory-only');
  const complete = coverage.files.length - partial.length - inventoryOnly.length;
  const omitted = coverage.files.filter(file => file.detail !== 'complete');
  const historyPartial = coverage.commitsIncluded < coverage.commitsTotal;
  const limited = omitted.length > 0 || historyPartial || coverage.summaryTruncated;
  return (
    <section className="pr-context-coverage" data-warning={stale || limited || undefined} aria-label="Draft context coverage">
      <div role="status">
        <strong>{stale ? 'Draft context is outdated' : limited ? 'Partial draft context' : coverage.contextLines === 1 ? 'Compact diff, all changes included' : 'All changes included'}</strong>
        <p>{stale ? 'The repository, branch, base or commit changed. Regenerate the draft or review it manually against the new comparison.' : 'This describes the input supplied to the AI. Review the draft before publishing.'}</p>
      </div>
      <p>{coverage.files.length} files inventoried · {complete} complete · {partial.length} partial · {inventoryOnly.length} inventory only</p>
      <p>{coverage.commitsIncluded} of {coverage.commitsTotal} commit subjects included · {coverage.summaryTruncated ? 'Summary shortened' : 'Summary complete'}</p>
      <details>
        <summary>{omitted.length > 0 || historyPartial || coverage.summaryTruncated ? 'Review omitted information' : 'Context details'}</summary>
        <div className="pr-context-details">
          {historyPartial && <p>{coverage.commitsTotal - coverage.commitsIncluded} commit subjects omitted. This does not mean those changes are missing from the final diff.</p>}
          {coverage.summaryTruncated && <p>The display summary was shortened. The separate file inventory remains complete.</p>}
          {omitted.map(file => <div className="pr-context-file" key={file.path}>
            <code>{file.oldPath ? `${file.oldPath} → ${file.path}` : file.path}</code>
            <span>{file.detail === 'inventory-only' ? 'Inventory only' : 'Partial detail'} · {file.omittedChangedLines} changed lines omitted · {file.omittedHunks} hunks incomplete or omitted</span>
          </div>)}
          <p>Binary entries describe metadata, not binary contents. Reduced context keeps fewer surrounding lines.</p>
          <p>{coverage.contextLines} context {coverage.contextLines === 1 ? 'line' : 'lines'} · {coverage.suppliedPatchCharacters.toLocaleString()} patch characters · {coverage.promptCharacters.toLocaleString()} / {coverage.promptCharacterLimit.toLocaleString()} prompt characters. Character counts are not token counts.</p>
          <p>Compared head <code>{coverage.headOid.slice(0, 12)}</code> with base <code>{coverage.baseOid.slice(0, 12)}</code>, from merge-base <code>{coverage.mergeBaseOid.slice(0, 12)}</code>.</p>
        </div>
      </details>
    </section>
  );
}

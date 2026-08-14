import type { DiffResult, DiffViewPreference, ThemePreference } from '@shared/contracts';
import { DiffWorkspace } from '@/features/viewer/DiffWorkspace';
import { PierreWorkerPool } from '@/features/viewer/PierreWorkerPool';

interface PullRequestDiffProps {
  diff: DiffResult;
  prNumber: number;
  diffView: DiffViewPreference;
  themeType: ThemePreference;
  wrapLines: boolean;
  onDiffViewChange(value: DiffViewPreference): void;
  onWrapLinesChange(value: boolean): void;
  onClose(): void;
}

export default function PullRequestDiff({ diff, prNumber, diffView, themeType, wrapLines, onDiffViewChange, onWrapLinesChange, onClose }: PullRequestDiffProps) {
  if (!diff.patch) return <div className="viewer-message">No differences to show.</div>;
  return (
    <PierreWorkerPool>
      <DiffWorkspace
        contentKey={`pull:${prNumber}`}
        diff={diff}
        diffView={diffView}
        themeType={themeType}
        wrapLines={wrapLines}
        onDiffViewChange={onDiffViewChange}
        onWrapLinesChange={onWrapLinesChange}
        onClose={onClose}
      />
    </PierreWorkerPool>
  );
}

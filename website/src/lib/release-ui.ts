import type { WindowsDownload } from './downloads.ts';
import { installerScan, type ScanStatistics } from './installer-scan.ts';

const labels: Record<keyof ScanStatistics, string> = {
  malicious: 'Malicious', suspicious: 'Suspicious', harmless: 'Harmless', undetected: 'Undetected',
  timeout: 'Timeout', 'confirmed-timeout': 'Confirmed timeout', failure: 'Failure', 'type-unsupported': 'Unsupported file type',
};

/** Keep every download, version and scan on the page on the same resolved release. */
export function updateRelease(root: Document, download: WindowsDownload): void {
  root.querySelectorAll<HTMLAnchorElement>('[data-windows-download]').forEach(link => { link.href = download.url; });
  root.querySelectorAll('[data-release-version]').forEach(label => { label.textContent = download.version; });
  // Revalidate at the presentation boundary so a stale result cannot label a different asset.
  const scan = installerScan(download.scan, download);
  root.querySelectorAll<HTMLElement>('[data-installer-scan]').forEach(host => {
    const status = host.querySelector<HTMLElement>('[data-scan-status]')!;
    const details = host.querySelector<HTMLElement>('[data-scan-details]')!;
    // Remove old links, counts and dates even when the next release has no usable metadata.
    details.replaceChildren();
    host.dataset.state = scan?.state ?? 'unavailable';
    const paragraph = (text: string) => {
      const p = root.createElement('p');
      p.textContent = text;
      details.append(p);
      return p;
    };
    paragraph(`Windows installer ${download.version}`);
    if (download.identity) {
      paragraph(download.identity.name);
      const hash = root.createElement('code');
      hash.textContent = download.identity.sha256;
      paragraph('SHA-256: ').append(hash);
    }
    if (!scan || scan.state === 'unavailable') {
      status.textContent = 'Scan status unavailable';
      paragraph('No verified scan result is available for this installer. Try reloading later.');
      return;
    }
    if (scan.state === 'pending') {
      status.textContent = 'Scan pending';
      paragraph('The scan is pending. No final engine results are available.');
    } else if (scan.state === 'queued') {
      status.textContent = 'Scan queued';
      paragraph('The installer is queued for analysis. No final engine results are available.');
    } else if (scan.state === 'in-progress') {
      status.textContent = 'Scan in progress';
      paragraph('Analysis is running. No final engine results are available.');
    } else if (scan.state === 'completed') {
      const stats = scan.analysis.statistics;
      const assessed = stats.malicious + stats.suspicious + stats.harmless + stats.undetected;
      const unassessed = stats.timeout + stats['confirmed-timeout'] + stats.failure + stats['type-unsupported'];
      status.textContent = assessed ? `${stats.malicious} malicious · ${stats.suspicious} suspicious` : 'No engines assessed the file';
      if (stats.malicious || stats.suspicious) host.dataset.state = 'flagged';
      paragraph(`${assessed} engines assessed the file; ${unassessed} did not assess it.`);
      const time = root.createElement('time');
      time.dateTime = scan.analysis.analysisAt;
      time.textContent = `${scan.analysis.analysisAt.slice(0, 10)} ${scan.analysis.analysisAt.slice(11, 16)} UTC`;
      paragraph('Analysis date: ').append(time);
      const list = root.createElement('dl');
      for (const [key, label] of Object.entries(labels)) {
        const term = root.createElement('dt');
        term.textContent = label;
        const count = root.createElement('dd');
        count.textContent = String(stats[key as keyof ScanStatistics]);
        list.append(term, count);
      }
      details.append(list);
      paragraph('Undetected means no detection was reported, not that the file is known to be safe.');
    }
    const observed = root.createElement('time');
    observed.dateTime = scan.updatedAt;
    observed.textContent = `${scan.updatedAt.slice(0, 10)} ${scan.updatedAt.slice(11, 16)} UTC`;
    paragraph('Status updated: ').append(observed);
    if ('report' in scan && scan.report) {
      const link = root.createElement('a');
      link.href = scan.report.url;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.textContent = 'View VirusTotal report ↗';
      link.setAttribute('aria-label', `View VirusTotal report for ${download.identity!.name} (opens in a new tab)`);
      paragraph('').append(link);
    } else {
      paragraph('Public report link not available yet.');
    }
  });
}

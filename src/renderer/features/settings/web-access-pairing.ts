/** Dismiss the display independently of the single outstanding token request. */
export class PairingRequests {
  private generation = 0;
  private pending = false;

  begin(): number | null {
    if (this.pending) return null;
    this.pending = true;
    return ++this.generation;
  }

  dismiss(): void { this.generation++; }
  isCurrent(request: number): boolean { return request === this.generation; }
  finish(request: number): boolean {
    this.pending = false;
    return this.isCurrent(request);
  }
}

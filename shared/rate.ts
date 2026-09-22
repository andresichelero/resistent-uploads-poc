export class TransferRate {
  private samples: { bytes: number; at: number }[] = [];
  reset() { this.samples = []; }
  add(bytes: number, at = performance.now()) {
    if (this.samples.length && bytes < this.samples.at(-1)!.bytes) this.reset();
    if (this.samples.at(-1)?.bytes === bytes) return;
    this.samples.push({ bytes, at });
    this.samples = this.samples.filter(s => at - s.at <= 5000);
  }
  estimate(total: number, now = performance.now()): { bytesPerSecond: number; seconds: number | null } {
    const first = this.samples[0], last = this.samples.at(-1);
    if (!first || !last || now - last.at > 3000 || last.at - first.at < 500) return { bytesPerSecond: 0, seconds: null };
    const bytesPerSecond = (last.bytes - first.bytes) * 1000 / (last.at - first.at);
    return { bytesPerSecond, seconds: bytesPerSecond > 0 ? Math.ceil(Math.max(0, total - last.bytes) / bytesPerSecond) : null };
  }
}

export interface CiV1Frame {
  hex: string;
  command: number;
  semanticId: number;
}

/** A diagnostic probe, not a claim that the connected firmware uses V1. */
export class CiV1FrameProbe {
  private pending = Buffer.alloc(0);

  feed(chunk: Buffer): CiV1Frame[] {
    this.pending = Buffer.concat([this.pending, chunk]);
    const frames: CiV1Frame[] = [];
    while (this.pending.length >= 2) {
      const header = this.pending.indexOf(Buffer.from([0xa5, 0xfa]));
      if (header < 0) {
        this.pending = this.pending.subarray(this.pending.at(-1) === 0xa5 ? -1 : this.pending.length);
        break;
      }
      if (header > 0) this.pending = this.pending.subarray(header);
      if (this.pending.length < 8) break;
      const candidate = this.pending.subarray(0, 8);
      let sum = 0;
      for (let index = 0; index < 6; index += 1) sum = (sum + candidate[index]!) & 0xff;
      if (candidate[6] === sum && candidate[7] === 0xfb) {
        frames.push({
          hex: candidate.toString('hex').toUpperCase().replace(/../g, '$& ').trim(),
          command: candidate[3]!,
          semanticId: candidate[4]! | (candidate[5]! << 8),
        });
        this.pending = this.pending.subarray(8);
      } else {
        this.pending = this.pending.subarray(1);
      }
    }
    return frames;
  }
}

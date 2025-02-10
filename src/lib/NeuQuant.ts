function toInt(v: number): number {
  return ~~v;
}

export class NeuQuant {
  private pixels: Uint8Array;
  private samplefac: number;
  private network: number[][] = []; // each entry: [b,g,r,c]
  private netindex: number[] = [];
  private bias: number[] = [];
  private freq: number[] = [];
  private radpower: number[] = [];

  private static ncycles = 100;
  private static netsize = 256;
  private static maxnetpos = NeuQuant.netsize - 1;
  private static netbiasshift = 4;
  private static intbiasshift = 16;
  private static intbias = 1 << NeuQuant.intbiasshift;
  private static gammashift = 10;
  private static gamma = 1 << NeuQuant.gammashift;
  private static betashift = 10;
  private static beta = NeuQuant.intbias >> NeuQuant.betashift;
  private static betagamma =
    NeuQuant.intbias << (NeuQuant.gammashift - NeuQuant.betashift);
  private static initrad = NeuQuant.netsize >> 3;
  private static radiusbiasshift = 6;
  private static radiusbias = 1 << NeuQuant.radiusbiasshift;
  private static initradius = NeuQuant.initrad * NeuQuant.radiusbias;
  private static radiusdec = 30;
  private static alphabiasshift = 10;
  private static initalpha = 1 << NeuQuant.alphabiasshift;
  private alphadec = 0;
  private static radbiasshift = 8;
  private static radbias = 1 << NeuQuant.radbiasshift;
  private static alpharadbshift =
    NeuQuant.alphabiasshift + NeuQuant.radbiasshift;
  private static alpharadbias = 1 << NeuQuant.alpharadbshift;
  private static prime1 = 499;
  private static prime2 = 491;
  private static prime3 = 487;
  private static prime4 = 503;
  private static minpicturebytes = 3 * NeuQuant.prime4;

  constructor(pixels: Uint8Array, samplefac: number) {
    this.pixels = pixels;
    this.samplefac = samplefac;
  }

  private init(): void {
    for (let i = 0; i < NeuQuant.netsize; i++) {
      const v = (i << (NeuQuant.netbiasshift + 8)) / NeuQuant.netsize;
      this.network[i] = [v, v, v, i];
      this.freq[i] = NeuQuant.intbias / NeuQuant.netsize;
      this.bias[i] = 0;
    }
  }

  private unbiasnet(): void {
    for (let i = 0; i < NeuQuant.netsize; i++) {
      this.network[i][0] >>= NeuQuant.netbiasshift;
      this.network[i][1] >>= NeuQuant.netbiasshift;
      this.network[i][2] >>= NeuQuant.netbiasshift;
      this.network[i][3] = i;
    }
  }

  private altersingle(
    alpha: number,
    i: number,
    b: number,
    g: number,
    r: number
  ): void {
    this.network[i][0] -=
      (alpha * (this.network[i][0] - b)) / NeuQuant.initalpha;
    this.network[i][1] -=
      (alpha * (this.network[i][1] - g)) / NeuQuant.initalpha;
    this.network[i][2] -=
      (alpha * (this.network[i][2] - r)) / NeuQuant.initalpha;
  }

  private alterneigh(
    radius: number,
    i: number,
    b: number,
    g: number,
    r: number
  ): void {
    const lo = Math.max(i - radius, 0);
    const hi = Math.min(i + radius, NeuQuant.netsize);
    let m = 1;
    for (let j = i + 1; j < hi; j++) {
      const a = this.radpower[m++];
      this.network[j][0] -=
        (a * (this.network[j][0] - b)) / NeuQuant.alpharadbias;
      this.network[j][1] -=
        (a * (this.network[j][1] - g)) / NeuQuant.alpharadbias;
      this.network[j][2] -=
        (a * (this.network[j][2] - r)) / NeuQuant.alpharadbias;
    }
    m = 1;
    for (let j = i - 1; j >= lo; j--) {
      const a = this.radpower[m++];
      this.network[j][0] -=
        (a * (this.network[j][0] - b)) / NeuQuant.alpharadbias;
      this.network[j][1] -=
        (a * (this.network[j][1] - g)) / NeuQuant.alpharadbias;
      this.network[j][2] -=
        (a * (this.network[j][2] - r)) / NeuQuant.alpharadbias;
    }
  }

  private contest(b: number, g: number, r: number): number {
    let bestd = Number.MAX_SAFE_INTEGER;
    let bestbiasd = bestd;
    let bestpos = -1;
    let bestbiaspos = -1;
    for (let i = 0; i < NeuQuant.netsize; i++) {
      const n = this.network[i];
      const dist = Math.abs(n[0] - b) + Math.abs(n[1] - g) + Math.abs(n[2] - r);
      if (dist < bestd) {
        bestd = dist;
        bestpos = i;
      }
      const biasdist =
        dist -
        (this.bias[i] >> (NeuQuant.intbiasshift - NeuQuant.netbiasshift));
      if (biasdist < bestbiasd) {
        bestbiasd = biasdist;
        bestbiaspos = i;
      }
      const betafreq = this.freq[i] >> NeuQuant.betashift;
      this.freq[i] -= betafreq;
      this.bias[i] += betafreq << NeuQuant.gammashift;
    }
    this.freq[bestpos] += NeuQuant.beta;
    this.bias[bestpos] -= NeuQuant.betagamma;
    return bestbiaspos;
  }

  private inxbuild(): void {
    let previouscol = 0;
    let startpos = 0;
    this.netindex = new Array(256);
    for (let i = 0; i < NeuQuant.netsize; i++) {
      let p = this.network[i];
      let smallpos = i;
      let smallval = p[1];
      for (let j = i + 1; j < NeuQuant.netsize; j++) {
        const q = this.network[j];
        if (q[1] < smallval) {
          smallpos = j;
          smallval = q[1];
        }
      }
      const q = this.network[smallpos];
      if (i !== smallpos) {
        [this.network[i], this.network[smallpos]] = [
          this.network[smallpos],
          this.network[i],
        ];
      }
      if (smallval !== previouscol) {
        this.netindex[previouscol] = Math.floor((startpos + i) / 2);
        for (let j = previouscol + 1; j < smallval; j++) {
          this.netindex[j] = i;
        }
        previouscol = smallval;
        startpos = i;
      }
    }
    this.netindex[previouscol] = Math.floor(
      (startpos + NeuQuant.maxnetpos) / 2
    );
    for (let j = previouscol + 1; j < 256; j++) {
      this.netindex[j] = NeuQuant.maxnetpos;
    }
  }

  private inxsearch(b: number, g: number, r: number): number {
    let bestd = 1000;
    let best = -1;
    let i = this.netindex[g];
    let j = i - 1;
    while (i < NeuQuant.netsize || j >= 0) {
      if (i < NeuQuant.netsize) {
        const p = this.network[i];
        let dist = p[1] - g;
        if (dist >= bestd) {
          i = NeuQuant.netsize;
        } else {
          i++;
          if (dist < 0) dist = -dist;
          let a = p[0] - b;
          if (a < 0) a = -a;
          dist += a;
          if (dist < bestd) {
            a = p[2] - r;
            if (a < 0) a = -a;
            dist += a;
            if (dist < bestd) {
              bestd = dist;
              best = p[3];
            }
          }
        }
      }
      if (j >= 0) {
        const p = this.network[j];
        let dist = g - p[1];
        if (dist >= bestd) {
          j = -1;
        } else {
          j--;
          if (dist < 0) dist = -dist;
          let a = p[0] - b;
          if (a < 0) a = -a;
          dist += a;
          if (dist < bestd) {
            a = p[2] - r;
            if (a < 0) a = -a;
            dist += a;
            if (dist < bestd) {
              bestd = dist;
              best = p[3];
            }
          }
        }
      }
    }
    return best;
  }

  private learn(): void {
    const lengthcount = this.pixels.length;
    const samplepixels = Math.floor(lengthcount / (3 * this.samplefac));
    const delta = Math.floor(samplepixels / NeuQuant.ncycles);
    let alpha = NeuQuant.initalpha;
    let radius = NeuQuant.initradius;
    let rad = radius >> NeuQuant.radiusbiasshift;
    if (rad <= 1) rad = 0;
    this.radpower = new Array(rad);
    for (let i = 0; i < rad; i++) {
      this.radpower[i] = toInt(
        alpha * (((rad * rad - i * i) * NeuQuant.radbias) / (rad * rad))
      );
    }
    let step: number;
    if (lengthcount < NeuQuant.minpicturebytes) {
      this.samplefac = 1;
      step = 3;
    } else if (lengthcount % NeuQuant.prime1 !== 0) {
      step = 3 * NeuQuant.prime1;
    } else if (lengthcount % NeuQuant.prime2 !== 0) {
      step = 3 * NeuQuant.prime2;
    } else if (lengthcount % NeuQuant.prime3 !== 0) {
      step = 3 * NeuQuant.prime3;
    } else {
      step = 3 * NeuQuant.prime4;
    }
    let pix = 0;
    for (let i = 0; i < samplepixels; i++) {
      const b = (this.pixels[pix] & 0xff) << NeuQuant.netbiasshift;
      const g = (this.pixels[pix + 1] & 0xff) << NeuQuant.netbiasshift;
      const r = (this.pixels[pix + 2] & 0xff) << NeuQuant.netbiasshift;
      const j = this.contest(b, g, r);
      this.altersingle(alpha, j, b, g, r);
      if (rad !== 0) this.alterneigh(rad, j, b, g, r);
      pix += step;
      if (pix >= lengthcount) pix -= lengthcount;
      if (delta === 0) delta;
      if (i % delta === 0) {
        alpha -= alpha / (30 + (this.samplefac - 1) / 3);
        radius -= radius / NeuQuant.radiusdec;
        rad = radius >> NeuQuant.radiusbiasshift;
        if (rad <= 1) rad = 0;
        this.radpower = new Array(rad);
        for (let j = 0; j < rad; j++) {
          this.radpower[j] = toInt(
            alpha * (((rad * rad - j * j) * NeuQuant.radbias) / (rad * rad))
          );
        }
      }
    }
  }

  public buildColormap(): void {
    this.init();
    this.learn();
    this.unbiasnet();
    this.inxbuild();
  }

  public getColormap(): number[] {
    const map: number[] = [];
    const index: number[] = new Array(NeuQuant.netsize);
    for (let i = 0; i < NeuQuant.netsize; i++) {
      index[this.network[i][3]] = i;
    }
    let k = 0;
    for (let l = 0; l < NeuQuant.netsize; l++) {
      const j = index[l];
      map[k++] = this.network[j][0];
      map[k++] = this.network[j][1];
      map[k++] = this.network[j][2];
    }
    return map;
  }

  public lookupRGB(r: number, g: number, b: number): number {
    return this.inxsearch(r, g, b);
  }
}

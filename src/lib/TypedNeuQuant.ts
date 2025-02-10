/**
 * TypedNeuQuant Neural-Net Quantization Algorithm
 * -----------------------------------------------
 *
 * This is a TypeScript conversion of the original NeuQuant algorithm
 * (with the “typed” optimizations using Float64Array and Int32Array).
 *
 * Copyright (c) 1994 Anthony Dekker
 * (JavaScript port 2012 by Johan Nordberg, further converted to strict TypeScript)
 */

export class TypedNeuQuant {
  // Static constants for the algorithm
  private static readonly ncycles = 100; // number of learning cycles
  private static readonly netsize = 256; // number of colors used
  private static readonly maxnetpos = TypedNeuQuant.netsize - 1;
  private static readonly netbiasshift = 4; // bias for colour values
  private static readonly intbiasshift = 16; // bias for fractions
  private static readonly intbias = 1 << TypedNeuQuant.intbiasshift;
  private static readonly gammashift = 10;
  private static readonly betashift = 10;
  private static readonly beta =
    TypedNeuQuant.intbias >> TypedNeuQuant.betashift; // beta = 1/1024
  private static readonly betagamma =
    TypedNeuQuant.intbias <<
    (TypedNeuQuant.gammashift - TypedNeuQuant.betashift);

  // Decreasing radius factor
  private static readonly initrad = TypedNeuQuant.netsize >> 3; // for 256 cols, radius starts
  private static readonly radiusbiasshift = 6; // at 32.0 biased by 6 bits
  private static readonly radiusbias = 1 << TypedNeuQuant.radiusbiasshift;
  private static readonly initradius =
    TypedNeuQuant.initrad * TypedNeuQuant.radiusbias;
  private static readonly radiusdec = 30; // factor of 1/30 each cycle

  // Decreasing alpha factor
  private static readonly alphabiasshift = 10; // alpha starts at 1.0
  private static readonly initalpha = 1 << TypedNeuQuant.alphabiasshift;

  // For radpower calculation
  private static readonly radbiasshift = 8;
  private static readonly radbias = 1 << TypedNeuQuant.radbiasshift;
  private static readonly alpharadbshift =
    TypedNeuQuant.alphabiasshift + TypedNeuQuant.radbiasshift;
  private static readonly alpharadbias = 1 << TypedNeuQuant.alpharadbshift;

  // Four primes near 500 – assume no image is so large that its length is divisible by all
  private static readonly prime1 = 499;
  private static readonly prime2 = 491;
  private static readonly prime3 = 487;
  private static readonly prime4 = 503;
  private static readonly minpicturebytes = 3 * TypedNeuQuant.prime4;

  // Instance variables
  private pixels: Uint8Array;
  private samplefac: number;
  // The network: an array of 256 neurons, each represented as a Float64Array of length 4:
  // [blue, green, red, index]
  private network: Float64Array[] = [];
  // netindex will be built later for lookup
  private netindex: Int32Array = new Int32Array(256);
  // Bias and frequency arrays for learning
  private bias: Int32Array = new Int32Array(TypedNeuQuant.netsize);
  private freq: Int32Array = new Int32Array(TypedNeuQuant.netsize);
  // radpower array used during neighborhood adjustment
  private radpower: Int32Array = new Int32Array(TypedNeuQuant.netsize >> 3);

  /**
   * Constructor.
   * @param pixels – an array of RGB pixels (format: [r, g, b, r, g, b, …])
   * @param samplefac – sampling factor: 1 to 30 (lower is better quality)
   */
  constructor(pixels: Uint8Array, samplefac: number) {
    this.pixels = pixels;
    this.samplefac = samplefac;
  }

  /**
   * Initialize the network and support arrays.
   */
  private init(): void {
    for (let i = 0; i < TypedNeuQuant.netsize; i++) {
      // Set up each neuron to [v, v, v, 0] where v = (i << (netbiasshift+8))/netsize.
      const v = (i << (TypedNeuQuant.netbiasshift + 8)) / TypedNeuQuant.netsize;
      this.network[i] = new Float64Array([v, v, v, 0]);
      this.freq[i] = TypedNeuQuant.intbias / TypedNeuQuant.netsize;
      this.bias[i] = 0;
    }
  }

  /**
   * Unbias the network so that each neuron’s values are in the range 0..255.
   * Also record the neuron’s index in the fourth element.
   */
  private unbiasnet(): void {
    for (let i = 0; i < TypedNeuQuant.netsize; i++) {
      // The original code uses bit shifting; here we use the >> operator.
      this.network[i][0] = this.network[i][0] >> TypedNeuQuant.netbiasshift;
      this.network[i][1] = this.network[i][1] >> TypedNeuQuant.netbiasshift;
      this.network[i][2] = this.network[i][2] >> TypedNeuQuant.netbiasshift;
      this.network[i][3] = i; // record color number
    }
  }

  /**
   * Moves neuron i towards the given color (b, g, r) by a factor proportional to alpha.
   */
  private altersingle(
    alpha: number,
    i: number,
    b: number,
    g: number,
    r: number
  ): void {
    this.network[i][0] -=
      (alpha * (this.network[i][0] - b)) / TypedNeuQuant.initalpha;
    this.network[i][1] -=
      (alpha * (this.network[i][1] - g)) / TypedNeuQuant.initalpha;
    this.network[i][2] -=
      (alpha * (this.network[i][2] - r)) / TypedNeuQuant.initalpha;
  }

  /**
   * Moves neurons in the neighbourhood of neuron i (within the given radius)
   * towards the given color (b, g, r) by a factor that decreases with distance.
   */
  private alterneigh(
    radius: number,
    i: number,
    b: number,
    g: number,
    r: number
  ): void {
    const lo = Math.max(i - radius, 0);
    const hi = Math.min(i + radius, TypedNeuQuant.netsize);
    let m = 1;
    for (let j = i + 1; j < hi; j++) {
      const a = this.radpower[m++];
      this.network[j][0] -=
        (a * (this.network[j][0] - b)) / TypedNeuQuant.alpharadbias;
      this.network[j][1] -=
        (a * (this.network[j][1] - g)) / TypedNeuQuant.alpharadbias;
      this.network[j][2] -=
        (a * (this.network[j][2] - r)) / TypedNeuQuant.alpharadbias;
    }
    m = 1;
    for (let j = i - 1; j >= lo; j--) {
      const a = this.radpower[m++];
      this.network[j][0] -=
        (a * (this.network[j][0] - b)) / TypedNeuQuant.alpharadbias;
      this.network[j][1] -=
        (a * (this.network[j][1] - g)) / TypedNeuQuant.alpharadbias;
      this.network[j][2] -=
        (a * (this.network[j][2] - r)) / TypedNeuQuant.alpharadbias;
    }
  }

  /**
   * Searches for the neuron whose (biased) color is closest to (b, g, r)
   * and returns its index (the “contest”).
   */
  private contest(b: number, g: number, r: number): number {
    let bestd = Number.MAX_SAFE_INTEGER;
    let bestbiasd = bestd;
    let bestpos = -1;
    let bestbiaspos = -1;
    for (let i = 0; i < TypedNeuQuant.netsize; i++) {
      const n = this.network[i];
      const dist = Math.abs(n[0] - b) + Math.abs(n[1] - g) + Math.abs(n[2] - r);
      if (dist < bestd) {
        bestd = dist;
        bestpos = i;
      }
      const biasdist =
        dist -
        (this.bias[i] >>
          (TypedNeuQuant.intbiasshift - TypedNeuQuant.netbiasshift));
      if (biasdist < bestbiasd) {
        bestbiasd = biasdist;
        bestbiaspos = i;
      }
      const betafreq = this.freq[i] >> TypedNeuQuant.betashift;
      this.freq[i] -= betafreq;
      this.bias[i] += betafreq << TypedNeuQuant.gammashift;
    }
    this.freq[bestpos] += TypedNeuQuant.beta;
    this.bias[bestpos] -= TypedNeuQuant.betagamma;
    return bestbiaspos;
  }

  /**
   * Sorts the network and builds the netindex array for faster color lookup.
   */
  private inxbuild(): void {
    let previouscol = 0;
    let startpos = 0;
    for (let i = 0; i < TypedNeuQuant.netsize; i++) {
      const p = this.network[i];
      let smallpos = i;
      let smallval = p[1];
      for (let j = i + 1; j < TypedNeuQuant.netsize; j++) {
        const q = this.network[j];
        if (q[1] < smallval) {
          smallpos = j;
          smallval = q[1];
        }
      }
      // Swap network[i] and network[smallpos]
      if (i !== smallpos) {
        const temp = this.network[i];
        this.network[i] = this.network[smallpos];
        this.network[smallpos] = temp;
      }
      if (smallval !== previouscol) {
        this.netindex[previouscol] = ((startpos + i) / 2) | 0;
        for (let j = previouscol + 1; j < smallval; j++) {
          this.netindex[j] = i;
        }
        previouscol = smallval;
        startpos = i;
      }
    }
    this.netindex[previouscol] = ((startpos + TypedNeuQuant.maxnetpos) / 2) | 0;
    for (let j = previouscol + 1; j < 256; j++) {
      this.netindex[j] = TypedNeuQuant.maxnetpos;
    }
  }

  /**
   * Searches for the best matching neuron for the color (b, g, r) by scanning
   * outward from netindex[g].
   */
  private inxsearch(b: number, g: number, r: number): number {
    let bestd = 1000;
    let best = -1;
    let i = this.netindex[g] | 0;
    let j = i - 1;
    while (i < TypedNeuQuant.netsize || j >= 0) {
      if (i < TypedNeuQuant.netsize) {
        const p = this.network[i];
        let dist = (p[1] | 0) - g;
        dist = dist < 0 ? -dist : dist;
        if (dist < bestd) {
          let a = (p[0] | 0) - b;
          a = a < 0 ? -a : a;
          dist += a;
          if (dist < bestd) {
            a = (p[2] | 0) - r;
            a = a < 0 ? -a : a;
            dist += a;
            if (dist < bestd) {
              bestd = dist;
              best = p[3] | 0;
            }
          }
        }
        i++;
      }
      if (j >= 0) {
        const p = this.network[j];
        let dist = g - (p[1] | 0);
        dist = dist < 0 ? -dist : dist;
        if (dist < bestd) {
          let a = (p[0] | 0) - b;
          a = a < 0 ? -a : a;
          dist += a;
          if (dist < bestd) {
            a = (p[2] | 0) - r;
            a = a < 0 ? -a : a;
            dist += a;
            if (dist < bestd) {
              bestd = dist;
              best = p[3] | 0;
            }
          }
        }
        j--;
      }
    }
    return best;
  }

  /**
   * The main learning loop.
   */
  private learn(): void {
    const lengthcount = this.pixels.length;
    let samplepixels = lengthcount / (3 * this.samplefac);
    let delta = Math.floor(samplepixels / TypedNeuQuant.ncycles);
    let alpha = TypedNeuQuant.initalpha;
    let radius = TypedNeuQuant.initradius;
    let rad = radius >> TypedNeuQuant.radiusbiasshift;
    if (rad <= 1) rad = 0;
    for (let i = 0; i < rad; i++) {
      // Pre-calculate radpower for each distance in the neighbourhood
      this.radpower[i] =
        ((alpha * ((rad * rad - i * i) * TypedNeuQuant.radbias)) /
          (rad * rad)) |
        0;
    }
    let step: number;
    if (lengthcount < TypedNeuQuant.minpicturebytes) {
      samplepixels = 1;
      step = 3;
    } else if (lengthcount % TypedNeuQuant.prime1 !== 0) {
      step = 3 * TypedNeuQuant.prime1;
    } else if (lengthcount % TypedNeuQuant.prime2 !== 0) {
      step = 3 * TypedNeuQuant.prime2;
    } else if (lengthcount % TypedNeuQuant.prime3 !== 0) {
      step = 3 * TypedNeuQuant.prime3;
    } else {
      step = 3 * TypedNeuQuant.prime4;
    }
    let pix = 0;
    for (let i = 0; i < samplepixels; i++) {
      const b = (this.pixels[pix] & 0xff) << TypedNeuQuant.netbiasshift;
      const g = (this.pixels[pix + 1] & 0xff) << TypedNeuQuant.netbiasshift;
      const r = (this.pixels[pix + 2] & 0xff) << TypedNeuQuant.netbiasshift;
      const j = this.contest(b, g, r);
      this.altersingle(alpha, j, b, g, r);
      if (rad !== 0) {
        this.alterneigh(rad, j, b, g, r);
      }
      pix += step;
      if (pix >= lengthcount) pix -= lengthcount;
      if (delta === 0) delta = 1;
      if (i % delta === 0) {
        alpha -= alpha / (30 + (this.samplefac - 1) / 3);
        radius -= radius / TypedNeuQuant.radiusdec;
        rad = radius >> TypedNeuQuant.radiusbiasshift;
        if (rad <= 1) rad = 0;
        for (let j = 0; j < rad; j++) {
          this.radpower[j] =
            ((alpha * ((rad * rad - j * j) * TypedNeuQuant.radbias)) /
              (rad * rad)) |
            0;
        }
      }
    }
  }

  /**
   * Public method to build (train) the color map.
   */
  public buildColormap(): void {
    this.init();
    this.learn();
    this.unbiasnet();
    this.inxbuild();
  }

  /**
   * Public method to get the resulting color map.
   * Returns an array of numbers in the format: [r, g, b, r, g, b, …]
   */
  public getColormap(): number[] {
    const map: number[] = [];
    const index: number[] = new Array(TypedNeuQuant.netsize);
    for (let i = 0; i < TypedNeuQuant.netsize; i++) {
      index[this.network[i][3]] = i;
    }
    let k = 0;
    for (let l = 0; l < TypedNeuQuant.netsize; l++) {
      const j = index[l];
      map[k++] = this.network[j][0];
      map[k++] = this.network[j][1];
      map[k++] = this.network[j][2];
    }
    return map;
  }

  /**
   * Given an RGB triple, return the index of the best matching color in the color map.
   */
  public lookupRGB(r: number, g: number, b: number): number {
    return this.inxsearch(r, g, b);
  }
}

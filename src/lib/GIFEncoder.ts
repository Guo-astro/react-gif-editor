import { LZWEncoder } from "./LZWEncoder";
import { NeuQuant } from "./NeuQuant";

/**
 * A simple ByteArray class that writes bytes into fixed–size pages.
 */
class ByteArray {
  public static pageSize = 4096;
  public static charMap: { [key: number]: string } = {};
  public page = -1;
  public pages: Uint8Array[] = [];
  public cursor = 0;

  constructor() {
    this.newPage();
  }

  public newPage(): void {
    this.pages[++this.page] = new Uint8Array(ByteArray.pageSize);
    this.cursor = 0;
  }

  public getData(): string {
    let rv = "";
    for (let p = 0; p < this.pages.length; p++) {
      for (let i = 0; i < ByteArray.pageSize; i++) {
        rv += ByteArray.charMap[this.pages[p][i]];
      }
    }
    return rv;
  }

  public writeByte(val: number): void {
    if (this.cursor >= ByteArray.pageSize) {
      this.newPage();
    }
    this.pages[this.page][this.cursor++] = val;
  }

  public writeUTFBytes(str: string): void {
    for (let i = 0; i < str.length; i++) {
      this.writeByte(str.charCodeAt(i));
    }
  }

  public writeBytes(
    array: Uint8Array,
    offset: number = 0,
    length: number = array.length
  ): void {
    for (let i = offset; i < length; i++) {
      this.writeByte(array[i]);
    }
  }
}

// Pre‐fill the char map.
for (let i = 0; i < 256; i++) {
  ByteArray.charMap[i] = String.fromCharCode(i);
}

/**
 * GIFEncoder – creates an animated GIF.
 */
export class GIFEncoder {
  public width: number;
  public height: number;
  public transparent: number | null = null;
  public transIndex = 0;
  public repeat = -1;
  public delay = 0;
  public image: Uint8Array | null = null;
  public pixels: Uint8Array | null = null;
  public indexedPixels: Uint8Array | null = null;
  public colorDepth: number | null = null;
  public colorTab: Uint8Array | null = null;
  public neuQuant: NeuQuant | null = null;
  public usedEntry: boolean[] = [];
  public palSize = 7;
  public dispose = -1;
  public firstFrame = true;
  public sample = 10;
  public dither: boolean | string = false;
  public globalPalette: boolean | Uint8Array | null = false;
  public out = new ByteArray();

  constructor(width: number, height: number) {
    this.width = Math.floor(width);
    this.height = Math.floor(height);
  }

  public setDelay(milliseconds: number): void {
    this.delay = Math.round(milliseconds / 10);
  }

  public setFrameRate(fps: number): void {
    this.delay = Math.round(100 / fps);
  }

  public setDispose(disposalCode: number): void {
    if (disposalCode >= 0) this.dispose = disposalCode;
  }

  public setRepeat(repeat: number): void {
    this.repeat = repeat;
  }

  public setTransparent(color: number | null): void {
    this.transparent = color;
  }

  public addFrame(imageData: Uint8Array): void {
    this.image = imageData;
    // Use the global palette if already calculated.
    if (this.globalPalette && this.globalPalette instanceof Uint8Array) {
      this.colorTab = this.globalPalette.slice();
    } else {
      this.colorTab = null;
    }

    this.getImagePixels();
    this.analyzePixels();

    if (this.globalPalette === true) {
      this.globalPalette = this.colorTab;
    }

    if (this.firstFrame) {
      this.writeLSD();
      this.writePalette();
      if (this.repeat >= 0) {
        this.writeNetscapeExt();
      }
    }

    this.writeGraphicCtrlExt();
    this.writeImageDesc();
    if (!this.firstFrame && !this.globalPalette) {
      this.writePalette();
    }
    this.writePixels();

    this.firstFrame = false;
  }

  public finish(): void {
    this.out.writeByte(0x3b); // GIF trailer
  }

  public setQuality(quality: number): void {
    this.sample = quality < 1 ? 1 : quality;
  }

  public setDither(dither: boolean | string): void {
    this.dither = dither === true ? "FloydSteinberg" : dither;
  }

  public setGlobalPalette(palette: boolean | Uint8Array): void {
    this.globalPalette = palette;
  }

  public getGlobalPalette(): Uint8Array | boolean | null {
    if (this.globalPalette && (this.globalPalette as Uint8Array).slice) {
      return (this.globalPalette as Uint8Array).slice(0);
    }
    return this.globalPalette;
  }

  public writeHeader(): void {
    this.out.writeUTFBytes("GIF89a");
  }

  public analyzePixels(): void {
    if (!this.colorTab) {
      this.neuQuant = new NeuQuant(this.pixels as Uint8Array, this.sample);
      this.neuQuant.buildColormap();
      this.colorTab = new Uint8Array(this.neuQuant.getColormap());
    }
    if (this.dither) {
      // Remove '-serpentine' if present and check for serpentine scanning.
      const kernelStr = typeof this.dither === "string" ? this.dither : "";
      const serpentine = kernelStr.indexOf("-serpentine") !== -1;
      const kernel = kernelStr.replace("-serpentine", "");
      this.ditherPixels(kernel, serpentine);
    } else {
      this.indexPixels();
    }
    this.pixels = null;
    this.colorDepth = 8;
    this.palSize = 7;
    if (this.transparent !== null) {
      this.transIndex = this.findClosest(this.transparent, true);
    }
  }

  public indexPixels(): void {
    if (!this.pixels) return;
    const nPix = this.pixels.length / 3;
    this.indexedPixels = new Uint8Array(nPix);
    let k = 0;
    for (let j = 0; j < nPix; j++) {
      const index = this.findClosestRGB(
        this.pixels[k++] & 0xff,
        this.pixels[k++] & 0xff,
        this.pixels[k++] & 0xff
      );
      this.usedEntry[index] = true;
      this.indexedPixels[j] = index;
    }
  }

  public ditherPixels(kernel: string, serpentine: boolean): void {
    const kernels: { [key: string]: [number, number, number][] } = {
      FalseFloydSteinberg: [
        [3 / 8, 1, 0],
        [3 / 8, 0, 1],
        [2 / 8, 1, 1],
      ],
      FloydSteinberg: [
        [7 / 16, 1, 0],
        [3 / 16, -1, 1],
        [5 / 16, 0, 1],
        [1 / 16, 1, 1],
      ],
      Stucki: [
        [8 / 42, 1, 0],
        [4 / 42, 2, 0],
        [2 / 42, -2, 1],
        [4 / 42, -1, 1],
        [8 / 42, 0, 1],
        [4 / 42, 1, 1],
        [2 / 42, 2, 1],
        [1 / 42, -2, 2],
        [2 / 42, -1, 2],
        [4 / 42, 0, 2],
        [2 / 42, 1, 2],
        [1 / 42, 2, 2],
      ],
      Atkinson: [
        [1 / 8, 1, 0],
        [1 / 8, 2, 0],
        [1 / 8, -1, 1],
        [1 / 8, 0, 1],
        [1 / 8, 1, 1],
        [1 / 8, 0, 2],
      ],
    };

    if (!kernel || !(kernel in kernels)) {
      throw new Error("Unknown dithering kernel: " + kernel);
    }

    const ds = kernels[kernel];
    const height = this.height;
    const width = this.width;
    const data = this.pixels as Uint8Array;
    let direction = serpentine ? -1 : 1;
    this.indexedPixels = new Uint8Array(data.length / 3);

    for (let y = 0; y < height; y++) {
      if (serpentine) direction = -direction;
      const xStart = direction === 1 ? 0 : width - 1;
      const xEnd = direction === 1 ? width : -1;
      for (let x = xStart; x !== xEnd; x += direction) {
        const index = y * width + x;
        const idx = index * 3;
        const r1 = data[idx];
        const g1 = data[idx + 1];
        const b1 = data[idx + 2];
        const paletteIndex = this.findClosestRGB(r1, g1, b1);
        this.usedEntry[paletteIndex] = true;
        this.indexedPixels[index] = paletteIndex;
        const colorIdx = paletteIndex * 3;
        const r2 = (this.colorTab as Uint8Array)[colorIdx];
        const g2 = (this.colorTab as Uint8Array)[colorIdx + 1];
        const b2 = (this.colorTab as Uint8Array)[colorIdx + 2];
        const er = r1 - r2;
        const eg = g1 - g2;
        const eb = b1 - b2;
        const dsLength = ds.length;
        const startI = direction === 1 ? 0 : dsLength - 1;
        const endI = direction === 1 ? dsLength : -1;
        for (let i = startI; i !== endI; i += direction) {
          const x1 = ds[i][1];
          const y1 = ds[i][2];
          if (x + x1 >= 0 && x + x1 < width && y + y1 >= 0 && y + y1 < height) {
            const d = ds[i][0];
            let idx2 = index + x1 + y1 * width;
            idx2 *= 3;
            data[idx2] = Math.max(0, Math.min(255, data[idx2] + er * d));
            data[idx2 + 1] = Math.max(
              0,
              Math.min(255, data[idx2 + 1] + eg * d)
            );
            data[idx2 + 2] = Math.max(
              0,
              Math.min(255, data[idx2 + 2] + eb * d)
            );
          }
        }
      }
    }
  }

  public findClosest(c: number, used: boolean): number {
    return this.findClosestRGB(
      (c & 0xff0000) >> 16,
      (c & 0x00ff00) >> 8,
      c & 0x0000ff,
      used
    );
  }

  public findClosestRGB(
    r: number,
    g: number,
    b: number,
    used?: boolean
  ): number {
    if (!this.colorTab) return -1;
    if (this.neuQuant && !used) {
      return this.neuQuant.lookupRGB(r, g, b);
    }
    let minpos = 0;
    let dmin = 256 * 256 * 256;
    const len = this.colorTab.length;
    for (let i = 0, index = 0; i < len; index++) {
      const dr = r - (this.colorTab[i++] & 0xff);
      const dg = g - (this.colorTab[i++] & 0xff);
      const db = b - (this.colorTab[i++] & 0xff);
      const d = dr * dr + dg * dg + db * db;
      if ((!used || this.usedEntry[index]) && d < dmin) {
        dmin = d;
        minpos = index;
      }
    }
    return minpos;
  }

  public getImagePixels(): void {
    const w = this.width;
    const h = this.height;
    this.pixels = new Uint8Array(w * h * 3);
    if (!this.image) return;
    const data = this.image;
    let srcPos = 0;
    let count = 0;
    for (let i = 0; i < h; i++) {
      for (let j = 0; j < w; j++) {
        this.pixels[count++] = data[srcPos++];
        this.pixels[count++] = data[srcPos++];
        this.pixels[count++] = data[srcPos++];
        srcPos++; // skip alpha
      }
    }
  }

  public writeGraphicCtrlExt(): void {
    this.out.writeByte(0x21);
    this.out.writeByte(0xf9);
    this.out.writeByte(4);
    let transp: number, disp: number;
    if (this.transparent === null) {
      transp = 0;
      disp = 0;
    } else {
      transp = 1;
      disp = 2;
    }
    if (this.dispose >= 0) {
      disp = this.dispose & 7;
    }
    disp <<= 2;
    this.out.writeByte(0 | disp | 0 | transp);
    this.writeShort(this.delay);
    this.out.writeByte(this.transIndex);
    this.out.writeByte(0);
  }

  public writeImageDesc(): void {
    this.out.writeByte(0x2c);
    this.writeShort(0);
    this.writeShort(0);
    this.writeShort(this.width);
    this.writeShort(this.height);
    if (this.firstFrame || this.globalPalette) {
      this.out.writeByte(0);
    } else {
      this.out.writeByte(0x80 | 0 | 0 | 0 | this.palSize);
    }
  }

  public writeLSD(): void {
    this.writeShort(this.width);
    this.writeShort(this.height);
    this.out.writeByte(0x80 | 0x70 | 0x00 | this.palSize);
    this.out.writeByte(0);
    this.out.writeByte(0);
  }

  public writeNetscapeExt(): void {
    this.out.writeByte(0x21);
    this.out.writeByte(0xff);
    this.out.writeByte(11);
    this.out.writeUTFBytes("NETSCAPE2.0");
    this.out.writeByte(3);
    this.out.writeByte(1);
    this.writeShort(this.repeat);
    this.out.writeByte(0);
  }

  public writePalette(): void {
    if (!this.colorTab) return;
    this.out.writeBytes(this.colorTab);
    const n = 3 * 256 - this.colorTab.length;
    for (let i = 0; i < n; i++) {
      this.out.writeByte(0);
    }
  }

  public writeShort(pValue: number): void {
    this.out.writeByte(pValue & 0xff);
    this.out.writeByte((pValue >> 8) & 0xff);
  }

  public writePixels(): void {
    const enc = new LZWEncoder(
      this.width,
      this.height,
      this.indexedPixels as Uint8Array,
      this.colorDepth as number
    );
    enc.encode(this.out);
  }

  public stream(): ByteArray {
    return this.out;
  }
}

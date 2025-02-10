import { EventEmitter } from "events";

interface GIFOptions {
  workerScript?: string;
  workers?: number;
  repeat?: number;
  background?: string;
  quality?: number;
  width?: number | null;
  height?: number | null;
  transparent?: any;
  debug?: boolean;
  globalPalette?: boolean | Uint8Array;
  dither?: boolean | string;
}

interface FrameOptions {
  delay?: number;
  copy?: boolean;
}

interface Frame {
  transparent?: any;
  delay?: number;
  copy?: boolean;
  data?: Uint8Array;
  context?: CanvasRenderingContext2D | WebGLRenderingContext;
  image?: HTMLElement;
}

export class GIF extends EventEmitter {
  private running = false;
  private options: GIFOptions = {};
  private frames: Frame[] = [];
  private groups: Map<any, number[]> = new Map();
  private freeWorkers: Worker[] = [];
  private activeWorkers: Worker[] = [];
  private nextFrame = 0;
  private finishedFrames = 0;
  private imageParts: any[] = [];
  private _canvas?: HTMLCanvasElement;

  private static readonly defaults: GIFOptions = {
    workerScript: "gif.worker.js",
    workers: 2,
    repeat: 0,
    background: "#fff",
    quality: 10,
    width: null,
    height: null,
    transparent: null,
    debug: false,
  };

  private static readonly frameDefaults: FrameOptions = {
    delay: 500,
    copy: false,
  };

  constructor(options: GIFOptions) {
    super();
    this.running = false;
    this.options = {};
    this.frames = [];
    this.groups = new Map();
    this.freeWorkers = [];
    this.activeWorkers = [];
    this.setOptions(options);
    for (const key in GIF.defaults) {
      if (this.options[key as keyof GIFOptions] === undefined) {
        this.options[key as keyof GIFOptions] =
          GIF.defaults[key as keyof GIFOptions];
      }
    }
  }

  public setOption(key: keyof GIFOptions, value: any): void {
    this.options[key] = value;
    if (this._canvas && (key === "width" || key === "height")) {
      (this._canvas as any)[key] = value;
    }
  }

  public setOptions(options: GIFOptions): void {
    for (const key in options) {
      if (options.hasOwnProperty(key)) {
        this.setOption(
          key as keyof GIFOptions,
          options[key as keyof GIFOptions]
        );
      }
    }
  }

  public addFrame(image: any, options: FrameOptions = {}): void {
    const frame: Frame = {};
    frame.transparent = this.options.transparent;
    for (const key in GIF.frameDefaults) {
      frame[key as keyof FrameOptions] =
        (options[key as keyof FrameOptions] as any) ??
        (GIF.frameDefaults[key as keyof FrameOptions] as any);
    }
    if (!this.options.width && image.width) {
      this.setOption("width", image.width);
    }
    if (!this.options.height && image.height) {
      this.setOption("height", image.height);
    }
    if (typeof ImageData !== "undefined" && image instanceof ImageData) {
      frame.data = new Uint8Array(image.data.buffer);
    } else if (
      ((typeof CanvasRenderingContext2D !== "undefined" &&
        image instanceof CanvasRenderingContext2D) ||
        (typeof WebGLRenderingContext !== "undefined" &&
          image instanceof WebGLRenderingContext)) &&
      !options.copy
    ) {
      frame.context = image;
    } else if (image.childNodes) {
      if (options.copy) {
        frame.data = new Uint8Array(this.getImageData(image).buffer);
      } else {
        frame.image = image;
      }
    } else {
      throw new Error("Invalid image");
    }
    const index = this.frames.length;
    if (index > 0 && frame.data) {
      if (this.groups.has(frame.data)) {
        this.groups.get(frame.data)!.push(index);
      } else {
        this.groups.set(frame.data, [index]);
      }
    }
    this.frames.push(frame);
  }

  public render(): void {
    if (this.running) throw new Error("Already running");
    if (!this.options.width || !this.options.height) {
      throw new Error("Width and height must be set prior to rendering");
    }
    this.running = true;
    this.nextFrame = 0;
    this.finishedFrames = 0;
    this.imageParts = new Array(this.frames.length).fill(null);
    const numWorkers = this.spawnWorkers();
    if (this.options.globalPalette === true) {
      this.renderNextFrame();
    } else {
      for (let i = 0; i < numWorkers; i++) {
        this.renderNextFrame();
      }
    }
    this.emit("start");
    this.emit("progress", 0);
  }

  public abort(): void {
    while (this.activeWorkers.length) {
      const worker = this.activeWorkers.shift();
      if (worker) {
        this.log("killing active worker");
        worker.terminate();
      }
    }
    this.running = false;
    this.emit("abort");
  }

  private spawnWorkers(): number {
    const numWorkers = Math.min(this.options.workers || 1, this.frames.length);
    for (let i = this.freeWorkers.length; i < numWorkers; i++) {
      this.log(`spawning worker ${i}`);
      const worker = new Worker(this.options.workerScript as string);
      worker.onmessage = (event: MessageEvent) => {
        const idx = this.activeWorkers.indexOf(worker);
        if (idx !== -1) this.activeWorkers.splice(idx, 1);
        this.freeWorkers.push(worker);
        this.frameFinished(event.data, false);
      };
      this.freeWorkers.push(worker);
    }
    return numWorkers;
  }

  private frameFinished(frame: any, duplicate: boolean): void {
    this.finishedFrames++;
    if (!duplicate) {
      this.log(
        `frame ${frame.index + 1} finished - ${
          this.activeWorkers.length
        } active`
      );
      this.emit("progress", this.finishedFrames / this.frames.length);
      this.imageParts[frame.index] = frame;
    } else {
      const indexOfDuplicate = this.frames.indexOf(frame);
      const group = this.groups.get(frame.data);
      const indexOfFirstInGroup = group ? group[0] : 0;
      this.log(
        `frame ${
          indexOfDuplicate + 1
        } is duplicate of ${indexOfFirstInGroup} - ${
          this.activeWorkers.length
        } active`
      );
      this.imageParts[indexOfDuplicate] = {
        indexOfFirstInGroup: indexOfFirstInGroup,
      };
    }
    if (this.options.globalPalette === true && !duplicate) {
      this.options.globalPalette = frame.globalPalette;
      this.log("global palette analyzed");
      if (this.frames.length > 2) {
        for (let i = 1; i < this.freeWorkers.length; i++) {
          this.renderNextFrame();
        }
      }
    }
    if (this.imageParts.includes(null)) {
      this.renderNextFrame();
    } else {
      this.finishRendering();
    }
  }

  private finishRendering(): void {
    for (let i = 0; i < this.imageParts.length; i++) {
      const frame = this.imageParts[i];
      if (frame && frame.indexOfFirstInGroup !== undefined) {
        this.imageParts[i] = this.imageParts[frame.indexOfFirstInGroup];
      }
    }
    let len = 0;
    for (const frame of this.imageParts) {
      if (
        frame &&
        frame.data &&
        frame.pageSize !== undefined &&
        frame.cursor !== undefined
      ) {
        len += (frame.data.length - 1) * frame.pageSize + frame.cursor;
      }
    }
    this.log(`rendering finished - filesize ${Math.round(len / 1000)}kb`);
    const data = new Uint8Array(len);
    let offset = 0;
    for (const frame of this.imageParts) {
      if (
        frame &&
        frame.data &&
        frame.pageSize !== undefined &&
        frame.cursor !== undefined
      ) {
        for (let i = 0; i < frame.data.length; i++) {
          data.set(frame.data[i], offset);
          offset += i === frame.data.length - 1 ? frame.cursor : frame.pageSize;
        }
      }
    }
    const image = new Blob([data], { type: "image/gif" });
    this.emit("finished", image, data);
  }

  private renderNextFrame(): void {
    if (this.freeWorkers.length === 0) throw new Error("No free workers");
    if (this.nextFrame >= this.frames.length) return;
    const frame = this.frames[this.nextFrame++];
    const index = this.frames.indexOf(frame);
    if (
      index > 0 &&
      frame.data &&
      this.groups.has(frame.data) &&
      this.groups.get(frame.data)![0] !== index
    ) {
      setTimeout(() => {
        this.frameFinished(frame, true);
      }, 0);
      return;
    }
    const worker = this.freeWorkers.shift()!;
    const task = this.getTask(frame);
    this.log(`starting frame ${task.index + 1} of ${this.frames.length}`);
    this.activeWorkers.push(worker);
    worker.postMessage(task);
  }

  private getContextData(ctx: CanvasRenderingContext2D): Uint8ClampedArray {
    return ctx.getImageData(
      0,
      0,
      this.options.width as number,
      this.options.height as number
    ).data;
  }

  private getImageData(image: HTMLElement): Uint8ClampedArray {
    if (!this._canvas) {
      this._canvas = document.createElement("canvas");
      this._canvas.width = this.options.width as number;
      this._canvas.height = this.options.height as number;
    }
    const ctx = this._canvas.getContext("2d");
    if (!ctx) throw new Error("Failed to get 2d context");
    ctx.fillStyle = this.options.background || "#fff";
    ctx.fillRect(
      0,
      0,
      this.options.width as number,
      this.options.height as number
    );
    ctx.drawImage(image as any, 0, 0);
    return this.getContextData(ctx);
  }

  private getTask(frame: Frame): any {
    const index = this.frames.indexOf(frame);
    const task: any = {
      index: index,
      last: index === this.frames.length - 1,
      delay: frame.delay,
      transparent: frame.transparent,
      width: this.options.width,
      height: this.options.height,
      quality: this.options.quality,
      dither: this.options.dither,
      globalPalette: this.options.globalPalette,
      repeat: this.options.repeat,
      canTransfer: true,
    };
    if (frame.data) {
      task.data = frame.data;
    } else if (frame.context) {
      task.data = this.getContextData(
        frame.context as CanvasRenderingContext2D
      );
    } else if (frame.image) {
      task.data = this.getImageData(frame.image);
    } else {
      throw new Error("Invalid frame");
    }
    return task;
  }

  private log(msg: string): void {
    if (this.options.debug) {
      console.log(msg);
    }
  }
}

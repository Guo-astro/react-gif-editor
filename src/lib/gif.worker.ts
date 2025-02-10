import { GIFEncoder } from "./GIFEncoder";

const renderFrame = (frame: any): void => {
  const encoder = new GIFEncoder(frame.width, frame.height);
  if (frame.index === 0) {
    encoder.writeHeader();
  } else {
    encoder.firstFrame = false;
  }
  encoder.setTransparent(frame.transparent);
  encoder.setRepeat(frame.repeat);
  encoder.setDelay(frame.delay);
  encoder.setQuality(frame.quality);
  encoder.setDither(frame.dither);
  encoder.setGlobalPalette(frame.globalPalette);
  encoder.addFrame(frame.data);
  if (frame.last) {
    encoder.finish();
  }
  if (frame.globalPalette === true) {
    frame.globalPalette = encoder.getGlobalPalette();
  }
  const stream = encoder.stream();
  frame.data = stream.pages;
  frame.cursor = stream.cursor;
  // (Assuming ByteArray is available from encoder)
  frame.pageSize = (stream.constructor as any).pageSize;
  if (frame.canTransfer) {
    const transfer = stream.pages.map((page: Uint8Array) => page.buffer);
    (self as any).postMessage(frame, transfer);
  } else {
    (self as any).postMessage(frame);
  }
};

(self as any).onmessage = (event: MessageEvent) => renderFrame(event.data);

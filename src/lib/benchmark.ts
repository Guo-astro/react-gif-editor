import { TypedNeuQuant } from "./TypedNeuQuant";

const quality: number = 10; // pixel sample interval (lower is better)
const runs: number = 100;

const now: () => number =
  window.performance && window.performance.now
    ? () => window.performance.now()
    : Date.now;

window.addEventListener("load", () => {
  const img = document.getElementById("image") as HTMLImageElement;
  const canvas = document.getElementById("canvas") as HTMLCanvasElement;
  if (!img || !canvas) return;
  canvas.width = img.width;
  canvas.height = img.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.drawImage(img, 0, 0);
  const imdata = ctx.getImageData(0, 0, img.width, img.height);
  const rgba = imdata.data;
  const w = canvas.width;
  const h = canvas.height;
  const rgb = new Uint8Array(w * h * 3);
  let rgb_idx = 0;
  for (let i = 0; i < rgba.length; i += 4) {
    rgb[rgb_idx++] = rgba[i];
    rgb[rgb_idx++] = rgba[i + 1];
    rgb[rgb_idx++] = rgba[i + 2];
  }

  const runtimes: number[] = [];
  const imgq = new TypedNeuQuant(rgb, quality);
  for (let run = 0; run < runs; run++) {
    const start = now();
    imgq.buildColormap();
    const end = now();
    runtimes.push(end - start);
  }
  console.log(runtimes.join("\n"));

  const map = imgq.getColormap();
  const avg = runtimes.reduce((p, n) => p + n, 0) / runtimes.length;
  const median = runtimes.slice().sort((a, b) => a - b)[Math.floor(runs / 2)];
  console.log(
    `run finished at q${quality}\navg: ${avg.toFixed(
      2
    )}ms median: ${median.toFixed(2)}ms`
  );

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = (y * w + x) * 4;
      const r = rgba[idx];
      const g = rgba[idx + 1];
      const b = rgba[idx + 2];
      const map_idx = imgq.lookupRGB(r, g, b) * 3;
      rgba[idx] = map[map_idx];
      rgba[idx + 1] = map[map_idx + 1];
      rgba[idx + 2] = map[map_idx + 2];
    }
  }
  ctx.putImageData(imdata, 0, 0);

  for (let i = 0; i < map.length; i += 3) {
    const color = [map[i], map[i + 1], map[i + 2]];
    const el = document.createElement("span");
    el.style.display = "inline-block";
    el.style.height = "1em";
    el.style.width = "1em";
    el.style.background = `rgb(${color.join(",")})`;
    document.body.appendChild(el);
  }
});

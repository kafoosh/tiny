// The glyph recogniser: a small convolutional network run in plain JavaScript, entirely on
// the phone. Input is a 28×28 picture of one handwritten character; output is a probability
// for each of 51 classes (digits, capitals, the lowercase letters that differ from their
// capitals, and the four card suits). The weights come from model-data.js.

import { LAYERS, WEIGHTS } from './model-data.js';

export const CLASSES = 51;

let net = null;
function load() {
  const bin = atob(WEIGHTS), raw = new Int8Array(bin.length);
  for (let i = 0; i < bin.length; i++) raw[i] = (bin.charCodeAt(i) << 24) >> 24;
  net = {};
  for (const l of LAYERS) {
    const n = l.shape.reduce((a, b) => a * b, 1), w = new Float32Array(n);
    for (let i = 0; i < n; i++) w[i] = raw[l.offset + i] * l.scale;
    net[l.name] = { w, shape: l.shape };
  }
}

/// 3×3 convolution (padding 1) + ReLU + 2×2 max-pool. Channels-first flat arrays.
function convPool(x, C, H, W, weight, bias) {
  const O = weight.shape[0], w = weight.w, y = new Float32Array(O * H * W);
  for (let o = 0; o < O; o++) {
    const yo = o * H * W, b = bias.w[o];
    for (let i = 0; i < H * W; i++) y[yo + i] = b;
    for (let c = 0; c < C; c++) {
      const xc = c * H * W, wb = (o * C + c) * 9;
      for (let ky = 0; ky < 3; ky++) for (let kx = 0; kx < 3; kx++) {
        const k = w[wb + ky * 3 + kx];
        if (k === 0) continue;
        const y0 = Math.max(0, 1 - ky), y1 = Math.min(H, H + 1 - ky);
        const x0 = Math.max(0, 1 - kx), x1 = Math.min(W, W + 1 - kx);
        for (let r = y0; r < y1; r++) {
          const src = xc + (r + ky - 1) * W + kx - 1, dst = yo + r * W;
          for (let q = x0; q < x1; q++) y[dst + q] += k * x[src + q];
        }
      }
    }
  }
  const h = H >> 1, v = W >> 1, out = new Float32Array(O * h * v);
  for (let o = 0; o < O; o++) for (let r = 0; r < h; r++) for (let q = 0; q < v; q++) {
    const i = o * H * W + 2 * r * W + 2 * q;
    out[o * h * v + r * v + q] = Math.max(0, y[i], y[i + 1], y[i + W], y[i + W + 1]);
  }
  return out;
}

function dense(x, weight, bias, relu) {
  const [O, I] = weight.shape, y = new Float32Array(O);
  for (let o = 0; o < O; o++) {
    let s = bias.w[o];
    for (let i = 0, b = o * I; i < I; i++) s += weight.w[b + i] * x[i];
    y[o] = relu && s < 0 ? 0 : s;
  }
  return y;
}

/// Raw scores for a 784-value image (0 = paper, 1 = ink).
export function logits(img) {
  if (!net) load();
  let x = convPool(img, 1, 28, 28, net['c1.weight'], net['c1.bias']);
  x = convPool(x, 16, 14, 14, net['c2.weight'], net['c2.bias']);
  x = convPool(x, 32, 7, 7, net['c3.weight'], net['c3.bias']);
  return dense(dense(x, net['f1.weight'], net['f1.bias'], true), net['f2.weight'], net['f2.bias'], false);
}

/// Class probabilities for a 784-value image.
export function classify(img) {
  const z = logits(img);
  let m = -Infinity;
  for (const v of z) if (v > m) m = v;
  let s = 0;
  for (let i = 0; i < z.length; i++) { z[i] = Math.exp(z[i] - m); s += z[i]; }
  for (let i = 0; i < z.length; i++) z[i] /= s;
  return z;
}

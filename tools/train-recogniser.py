# Run from a directory containing EMNIST's gzip/ folder (emnist-balanced-*): python3 train-recogniser.py
# Writes model-data.js, to be copied to src/hand/model-data.js. Needs torch, numpy, pillow.
# Trains the glyph recogniser shipped in src/hand/model-data.js.
# Classes: EMNIST "balanced" (0-9, A-Z, a b d e f g h n q r t = 47) + 4 synthetic card suits.
import gzip, numpy as np, torch, torch.nn as nn, torch.nn.functional as F, math, json, base64, sys, time
from PIL import Image, ImageDraw, ImageFilter
torch.manual_seed(1); np.random.seed(1); torch.set_num_threads(4)

def idx(path, off):
    with gzip.open(path) as f: return np.frombuffer(f.read(), np.uint8, offset=off)
def load(split):
    x = idx(f'gzip/emnist-balanced-{split}-images-idx3-ubyte.gz', 16).reshape(-1, 28, 28).transpose(0, 2, 1)
    y = idx(f'gzip/emnist-balanced-{split}-labels-idx1-ubyte.gz', 8)
    return x.copy(), y.astype(np.int64)
xtr, ytr = load('train'); xte, yte = load('test')
print('emnist', xtr.shape, xte.shape, flush=True)

# ---- synthetic suits: outline or filled, wobbly, drawn the ways people draw them ----
def heart(n=60):
    t = np.linspace(0, 2*np.pi, n); x = 16*np.sin(t)**3; y = -(13*np.cos(t)-5*np.cos(2*t)-2*np.cos(3*t)-np.cos(4*t))
    return [np.stack([x, y], 1)]
def diamond():
    w = np.random.uniform(0.55, 0.85)
    return [np.array([[0,-1],[w,0],[0,1],[-w,0],[0,-1]], float)]
def circ(cx, cy, r, n=24, a0=0):
    t = np.linspace(a0, a0+2*np.pi, n); return np.stack([cx+r*np.cos(t), cy+r*np.sin(t)], 1)
def stem(y0, y1, w):
    k = np.random.rand()
    if k < 0.4: return [np.array([[0,y0],[0,y1]], float)]
    if k < 0.75: return [np.array([[0,y0],[-w,y1],[w,y1],[0,y0]], float)]
    return [np.array([[0,y0],[0,y1]], float), np.array([[-w,y1],[w,y1]], float)]
def club():
    r = np.random.uniform(0.3, 0.42); d = np.random.uniform(0.34, 0.46)
    if np.random.rand() < 0.5:
        parts = [circ(0,-d,r), circ(-d,0.12,r), circ(d,0.12,r)]
    else:  # one continuous trefoil outline
        t = np.linspace(0, 2*np.pi, 90); rr = 0.55+0.38*np.cos(3*(t+np.pi/2)); parts = [np.stack([rr*np.sin(t), -rr*np.cos(t)*1.0-0.05], 1)]
    return parts + stem(0.25, 1.0, np.random.uniform(0.15, 0.3))
def spade():
    h = heart()[0] / 17.0; h[:,1] = -h[:,1]*np.random.uniform(0.8, 1.05) - 0.1; h[:,0] *= np.random.uniform(0.85, 1.1)
    if np.random.rand() < 0.35:   # pointier, flatter-shouldered spade drawn as a leaf
        t = np.linspace(0, 2*np.pi, 60); r = 0.55+0.25*np.cos(t); h = np.stack([r*np.sin(t)*np.random.uniform(0.9,1.2), -np.cos(t)*0.62-0.1+0.25*np.abs(np.sin(t))**3], 1)
    y0 = np.random.uniform(0.2, 0.45)
    return [h] + stem(y0, np.random.uniform(0.85, 1.05), np.random.uniform(0.15, 0.38))
SUITS = [club, heart, spade, diamond]   # CHaSeD order: classes 47,48,49,50
def render(parts, fill):
    pts = np.concatenate(parts); mn, mx = pts.min(0), pts.max(0); size = (mx-mn).max()+1e-6
    sx, sy = np.random.uniform(0.85, 1.15, 2); ang = np.random.uniform(-0.25, 0.25); sh = np.random.uniform(-0.2, 0.2)
    c = (mn+mx)/2; R = np.array([[math.cos(ang), -math.sin(ang)], [math.sin(ang), math.cos(ang)]])
    out = []
    for p in parts:
        q = (p-c)/size; q = q + np.random.normal(0, 0.012, q.shape)
        # low-frequency wobble
        k = np.arange(len(q))/max(len(q)-1, 1); q = q + 0.03*np.stack([np.sin(k*6.3*np.random.uniform(0.5,2)+np.random.rand()*6), np.cos(k*6.3*np.random.uniform(0.5,2)+np.random.rand()*6)], 1)
        q = q*[sx, sy]; q[:,0] += sh*q[:,1]; q = q@R.T
        out.append(q)
    allp = np.concatenate(out); mn, mx = allp.min(0), allp.max(0); s = 80/((mx-mn).max()+1e-6); c = (mn+mx)/2
    im = Image.new('L', (112, 112), 0); d = ImageDraw.Draw(im); lw = int(np.random.uniform(7, 13))
    for q in out:
        xy = [tuple(v) for v in ((q-c)*s+56)]
        if fill and len(xy) > 3: d.polygon(xy, fill=255)
        d.line(xy, fill=255, width=lw, joint='curve')
    im = im.filter(ImageFilter.GaussianBlur(2.5)).resize((28, 28), Image.BILINEAR)
    a = np.asarray(im, np.float32); return np.clip(a*255/max(a.max(), 1), 0, 255).astype(np.uint8)
def suits(n):
    xs, ys = [], []
    for k, fn in enumerate(SUITS):
        for _ in range(n):
            xs.append(render(fn(), np.random.rand() < 0.4)); ys.append(47+k)
    return np.stack(xs), np.array(ys)
xs, ys = suits(3600); xst, yst = suits(400)
Image.fromarray(np.concatenate([np.concatenate(list(xs[k*3600:k*3600+12]), 1) for k in range(4)], 0)).resize((672, 224)).save('suits.png')
xtr = np.concatenate([xtr, xs]); ytr = np.concatenate([ytr, ys]); xte = np.concatenate([xte, xst]); yte = np.concatenate([yte, yst])
NC = 51
Xtr = torch.tensor(xtr, dtype=torch.float32).unsqueeze(1)/255; Ytr = torch.tensor(ytr)
Xte = torch.tensor(xte, dtype=torch.float32).unsqueeze(1)/255; Yte = torch.tensor(yte)

class Net(nn.Module):
    def __init__(s):
        super().__init__()
        s.c1 = nn.Conv2d(1, 16, 3, padding=1); s.c2 = nn.Conv2d(16, 32, 3, padding=1); s.c3 = nn.Conv2d(32, 64, 3, padding=1)
        s.f1 = nn.Linear(64*3*3, 128); s.f2 = nn.Linear(128, NC); s.drop = nn.Dropout(0.3)
    def forward(s, x):
        x = F.max_pool2d(F.relu(s.c1(x)), 2); x = F.max_pool2d(F.relu(s.c2(x)), 2); x = F.max_pool2d(F.relu(s.c3(x)), 2)
        return s.f2(s.drop(F.relu(s.f1(x.flatten(1)))))

def augment(x):
    n = x.shape[0]
    ang = (torch.rand(n)-0.5)*0.5; sc = 0.8+torch.rand(n)*0.35; sh = (torch.rand(n)-0.5)*0.5
    asp = 0.85+torch.rand(n)*0.3
    cos, sin = torch.cos(ang)/sc, torch.sin(ang)/sc
    theta = torch.zeros(n, 2, 3)
    theta[:,0,0] = cos*asp; theta[:,0,1] = -sin+sh; theta[:,1,0] = sin; theta[:,1,1] = cos/asp
    theta[:,:,2] = (torch.rand(n, 2)-0.5)*0.22
    x = F.grid_sample(x, F.affine_grid(theta, x.shape, align_corners=False), align_corners=False)
    r = torch.rand(n, 1, 1, 1)
    thick = F.max_pool2d(x, 3, 1, 1); thin = -F.max_pool2d(-x, 3, 1, 1)
    x = torch.where(r < 0.25, thick, torch.where(r > 0.85, 0.5*thin+0.5*x, x))
    g = 0.6+torch.rand(n, 1, 1, 1)*0.9
    return x.clamp(0, 1)**g

net = Net(); EPOCHS = int(sys.argv[1]) if len(sys.argv) > 1 else 14; BS = 256
opt = torch.optim.AdamW(net.parameters(), 3e-3, weight_decay=1e-4)
steps = EPOCHS*math.ceil(len(Xtr)/BS); sched = torch.optim.lr_scheduler.OneCycleLR(opt, 4e-3, total_steps=steps)
def evaluate():
    net.eval(); ok = 0; conf = None
    with torch.no_grad():
        P = torch.cat([net(Xte[i:i+2000]).argmax(1) for i in range(0, len(Xte), 2000)])
    net.train(); return P
for ep in range(EPOCHS):
    t0 = time.time(); perm = torch.randperm(len(Xtr)); tot = 0
    for i in range(0, len(Xtr), BS):
        b = perm[i:i+BS]; loss = F.cross_entropy(net(augment(Xtr[b])), Ytr[b], label_smoothing=0.05)
        opt.zero_grad(); loss.backward(); opt.step(); sched.step(); tot += loss.item()*len(b)
    P = evaluate(); print(f'ep {ep} loss {tot/len(Xtr):.3f} acc {(P==Yte).float().mean():.4f} {time.time()-t0:.0f}s', flush=True)

# ---- case-merged letter accuracy, restricted the way the app restricts it ----
LOWER = 'abdefghnqrt'
def letter(c): return c-10 if 10 <= c < 36 else ('abcdefghijklmnopqrstuvwxyz'.index(LOWER[c-36]) if 36 <= c < 47 else -1)
net.eval()
with torch.no_grad(): logits = torch.cat([net(Xte[i:i+2000]) for i in range(0, len(Xte), 2000)])
prob = logits.softmax(1); L = torch.zeros(len(Xte), 26)
for c in range(10, 47): L[:, letter(c)] += prob[:, c]
ytl = torch.tensor([letter(int(c)) for c in Yte]); m = ytl >= 0
print('letters-only acc', (L[m].argmax(1) == ytl[m]).float().mean().item())
print('top3', (L[m].topk(3, 1).indices == ytl[m, None]).any(1).float().mean().item())
sm = Yte >= 47; print('suit acc (masked)', (prob[sm][:, 47:].argmax(1)+47 == Yte[sm]).float().mean().item())
VAL = [10, 2, 3, 4, 5, 6, 7, 8, 9, 1, 0, 19, 26, 20]   # A 2-9 1 0 J Q K
vm = torch.tensor([int(c) in VAL for c in Yte]); pv = prob[vm][:, VAL].argmax(1); print('card-value acc (masked)', (torch.tensor(VAL)[pv] == Yte[vm]).float().mean().item())

# ---- export: int8 weights + per-tensor scale, base64 in a JS module ----
blobs, meta = [], []
for name, p in net.state_dict().items():
    a = p.detach().numpy().astype(np.float32); s = float(np.abs(a).max())/127 or 1.0
    q = np.clip(np.round(a/s), -127, 127).astype(np.int8); meta.append({'name': name, 'shape': list(a.shape), 'scale': s, 'offset': sum(len(b) for b in blobs)}); blobs.append(q.tobytes())
raw = b''.join(blobs)
open('model-data.js', 'w').write('// Generated by the training script (see README): int8 weights of the glyph recogniser.\n// Trained on EMNIST Balanced (Cohen et al., 2017) plus synthetic card suits.\nexport const LAYERS = ' + json.dumps(meta) + ';\nexport const WEIGHTS = "' + base64.b64encode(raw).decode() + '";\n')
# sanity: quantised accuracy
sd = {m['name']: torch.tensor(np.frombuffer(raw, np.int8, count=int(np.prod(m['shape'])), offset=m['offset']).astype(np.float32).reshape(m['shape'])*m['scale']) for m in meta}
net.load_state_dict(sd); P = evaluate(); print('quantised acc', (P == Yte).float().mean().item(), 'bytes', len(raw))
np.save('probe_x.npy', xte[:64]); json.dump([[float(v) for v in r] for r in net(Xte[:64]).detach()], open('probe_logits.json', 'w'))

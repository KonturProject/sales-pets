"""Музыка и звуки трейлера: чиптюн, синтезированный numpy (без сэмплов и загрузок, CC0).

python tools/trailer/music.py <cues.json> <out.wav>
cues.json — {"duration": сек, "sfx": [{"t": сек, "kind": "coin"|...}]} из window.TRAILER (render.mjs).
"""
import json
import sys
import wave

import numpy as np

SR = 44100
BPM = 112
BEAT = 60 / BPM
BAR = 4 * BEAT
rng = np.random.default_rng(7)


def hz(midi):
    return 440.0 * 2 ** ((midi - 69) / 12)


def osc(kind, freq, dur, duty=0.5):
    t = np.arange(int(dur * SR)) / SR
    f = np.broadcast_to(np.asarray(freq, dtype=float), t.shape)
    ph = np.cumsum(f) / SR
    if kind == 'square':
        return np.where(ph % 1 < duty, 1.0, -1.0)
    if kind == 'tri':
        return 2 * np.abs(2 * (ph % 1) - 1) - 1
    if kind == 'noise':
        return rng.uniform(-1, 1, t.size)
    return np.sin(2 * np.pi * ph)


def env(n, attack=0.005, decay=0.3, release=0.03):
    t = np.arange(n) / SR
    dur = n / SR
    return np.minimum(t / attack, 1) * np.exp(-t / decay) * np.clip((dur - t) / release, 0, 1)


def note(kind, freq, dur, attack=0.005, decay=0.3, release=0.03, duty=0.5):
    x = osc(kind, freq, dur, duty)
    return x * env(x.size, attack, decay, release)


def sweep(f0, f1, dur, kind='sine'):
    n = int(dur * SR)
    return osc(kind, np.geomspace(f0, f1, n), dur)


def smooth(x, k):
    return np.convolve(x, np.ones(k) / k, mode='same')


def add(buf, t, x, gain=1.0):
    i = int(t * SR)
    if i >= buf.size:
        return
    x = x[: buf.size - i]
    buf[i : i + x.size] += x * gain


# ---------- музыка ----------
MAIN = [(60, [0, 4, 7]), (55, [0, 4, 7]), (57, [0, 3, 7]), (53, [0, 4, 7])]  # C G Am F
SAD = [(57, [0, 3, 7]), (53, [0, 4, 7]), (50, [0, 3, 7]), (52, [0, 4, 7])]  # Am F Dm E
END = [(53, [0, 4, 7]), (55, [0, 4, 7]), (60, [0, 4, 7]), (60, [0, 4, 7])]  # F G C C
MELODY = [[0, 2, 1, 2, 3, 2, 1, 0], [2, 1, 0, 1, 2, 3, 2, -1], [0, 1, 2, 3, 2, 1, 2, 1], [3, 2, 1, 0, 1, -1, 0, -1]]


def section(t):
    if 45.0 <= t < 57.0:
        return 'sad'
    if t >= 86.0:
        return 'end'
    return 'intro' if t < 2.2 else 'main'


def music(duration):
    buf = np.zeros(int((duration + 2) * SR))
    bars = int(duration / BAR) + 1
    for b in range(bars):
        t0 = b * BAR
        sec = section(t0)
        prog = SAD if sec == 'sad' else END if sec == 'end' else MAIN
        root, triad = prog[b % 4]
        # пэд: мягкий треугольник на весь такт
        for iv in triad:
            add(buf, t0, note('tri', hz(root + iv), BAR, attack=0.25, decay=6, release=0.3), 0.045)
        if sec == 'intro':
            for k in range(8):
                add(buf, t0 + k * BEAT / 2, note('tri', hz(root + 12 + triad[k % 3]), BEAT / 2, decay=0.15), 0.08)
            continue
        # бас
        hits = [0, 2] if sec == 'sad' else [0, 1.5, 2, 3.5]
        for h in hits:
            add(buf, t0 + h * BEAT, note('tri', hz(root - 12), BEAT * 0.9, decay=0.35), 0.22)
        # ударные
        if sec != 'sad':
            for k in (0, 2):
                add(buf, t0 + k * BEAT, sweep(140, 45, 0.16) * env(int(0.16 * SR), 0.001, 0.07), 0.55)
            for k in (1, 3):
                sn = smooth(osc('noise', 0, 0.14), 3) * env(int(0.14 * SR), 0.001, 0.05)
                add(buf, t0 + k * BEAT, sn + 0.4 * note('sine', 190, 0.14, decay=0.04), 0.2)
        for k in range(8 if sec != 'sad' else 4):
            step = BEAT / 2 if sec != 'sad' else BEAT
            hat = np.diff(osc('noise', 0, 0.05), prepend=0) * env(int(0.05 * SR), 0.001, 0.012)
            add(buf, t0 + k * step, hat, 0.06)
        # мелодия: в основной части через такт, в грустной — редкие ноты
        tones = [root + 12 + iv for iv in triad] + [root + 24]
        if sec == 'sad':
            for k in (0, 2):
                add(buf, t0 + k * BEAT, note('tri', hz(tones[(b + k) % 3] + 12), BEAT * 1.6, attack=0.02, decay=0.6), 0.09)
        elif b % 2 == 0 or sec == 'end':
            pat = MELODY[(b // 2) % 4]
            for k, d in enumerate(pat):
                if d < 0:
                    continue
                n = note('square', hz(tones[d] + 12), BEAT / 2 * 0.9, decay=0.18, duty=0.25)
                add(buf, t0 + k * BEAT / 2, smooth(n, 4), 0.07)
    return buf[: int(duration * SR)]


# ---------- звуки ----------
def arp(notes, step, kind='tri', decay=0.15, tail=0.25):
    out = np.zeros(int((len(notes) * step + tail) * SR))
    for i, m in enumerate(notes):
        x = note(kind, hz(m), step + tail, decay=decay, duty=0.25)
        i0 = int(i * step * SR)
        out[i0 : i0 + x.size] += x[: out.size - i0]
    return out


def layer(*parts):
    """Складывает звуки разной длины: части — (сдвиг в секундах, сигнал)."""
    out = np.zeros(max(int(off * SR) + x.size for off, x in parts))
    for off, x in parts:
        out[int(off * SR) : int(off * SR) + x.size] += x
    return out


def sfx(kind):
    if kind == 'pop':
        return 0.5 * sweep(380, 1000, 0.11) * env(int(0.11 * SR), 0.002, 0.06)
    if kind == 'coin':
        a = note('square', hz(83), 0.07, decay=1, duty=0.5)
        b = note('square', hz(88), 0.32, decay=0.14, duty=0.5)
        return 0.16 * smooth(np.concatenate([a, b]), 3)
    if kind == 'hatch':
        crack = smooth(osc('noise', 0, 0.18), 2) * env(int(0.18 * SR), 0.001, 0.04)
        rise = arp([72, 76, 79, 84, 88], 0.07, 'square', decay=0.2)
        out = np.zeros(int(1.2 * SR))
        out[: crack.size] += 0.5 * crack
        out[int(0.06 * SR) : int(0.06 * SR) + rise.size] += 0.22 * smooth(rise, 4)
        sp = note('sine', hz(100), 0.8, decay=0.3) + note('sine', hz(103), 0.8, decay=0.3)
        out[int(0.38 * SR) : int(0.38 * SR) + sp.size] += 0.12 * sp
        return out
    if kind == 'level':
        return 0.3 * arp([67, 72, 76, 79], 0.065)
    if kind == 'ding':
        return 0.22 * (note('sine', 1568, 0.9, decay=0.35) + 0.4 * note('sine', 3136, 0.9, decay=0.2))
    if kind == 'splat':
        n = smooth(osc('noise', 0, 0.3), 40) * env(int(0.3 * SR), 0.002, 0.1)
        return 2.2 * n + 0.45 * sweep(240, 60, 0.3) * env(int(0.3 * SR), 0.002, 0.12)
    if kind == 'sad':
        a = note('tri', hz(67), 0.32, attack=0.02, decay=1)
        f = hz(63) * (1 + 0.012 * np.sin(2 * np.pi * 5 * np.arange(int(0.75 * SR)) / SR))
        b = osc('tri', f, 0.75) * env(int(0.75 * SR), 0.02, 0.6, 0.1)
        return 0.32 * np.concatenate([a, b])
    if kind == 'thud':
        return layer((0, 0.7 * sweep(120, 38, 0.45) * env(int(0.45 * SR), 0.002, 0.18)),
                     (0, 0.6 * smooth(osc('noise', 0, 0.2), 60) * env(int(0.2 * SR), 0.001, 0.05)))
    if kind == 'heal':
        return 0.22 * arp([72, 76, 79, 84, 88, 91], 0.055, 'sine', decay=0.4, tail=0.6)
    if kind == 'joy':
        return layer((0, 0.14 * smooth(arp([72, 76, 79, 84, 79, 84], 0.06, 'square', decay=0.12), 4)),
                     (0.36, 0.12 * note('sine', 2093, 0.5, decay=0.2)))
    if kind == 'tick':
        return 0.25 * note('sine', 1800, 0.06, decay=0.02)
    if kind == 'whoosh':
        n = smooth(osc('noise', 0, 0.7), 10)
        t = np.arange(n.size) / n.size
        return 0.35 * n * np.sin(np.pi * t) ** 2
    if kind == 'fanfare':
        out = np.zeros(int(2.0 * SR))
        for i, chord in enumerate([[60, 64, 67], [65, 69, 72], [67, 71, 74], [72, 76, 79, 84]]):
            dur = 1.4 if i == 3 else 0.2
            for m in chord:
                x = smooth(note('square', hz(m), dur, decay=0.6 if i == 3 else 0.15, duty=0.25), 4)
                i0 = int(i * 0.18 * SR)
                out[i0 : i0 + x.size] += 0.07 * x[: out.size - i0]
        return out
    raise ValueError(f'неизвестный звук: {kind}')


def main():
    cues = json.load(open(sys.argv[1], encoding='utf-8'))
    duration = float(cues['duration'])
    mus = music(duration)
    fx = np.zeros_like(mus)
    for c in cues['sfx']:
        add(fx, c['t'], sfx(c['kind']))
    mix = 0.55 * mus / max(1e-9, np.abs(mus).max()) + 0.75 * fx
    n = mix.size
    t = np.arange(n) / SR
    mix *= np.clip(t / 0.3, 0, 1) * np.clip((duration - t) / 1.6, 0, 1)
    mix = np.tanh(1.2 * mix) / np.tanh(1.2)
    mix *= 0.89 / max(1e-9, np.abs(mix).max())
    pcm = (mix * 32767).astype('<i2')
    stereo = np.repeat(pcm[:, None], 2, axis=1)
    with wave.open(sys.argv[2], 'wb') as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(stereo.tobytes())
    print(f'звук: {duration:.1f} с, эффектов {len(cues["sfx"])}')


if __name__ == '__main__':
    main()

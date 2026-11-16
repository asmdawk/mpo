"""Create Neon Skyline, an original procedural instrumental for ZigZak Player.

All notes, synthesis, rhythm and effects are generated here. No sampled or
third-party copyrighted recordings are used. Requires numpy; writes stereo WAV.
"""
from pathlib import Path
import wave
import numpy as np

RATE = 44100
DURATION = 24.0
BEAT = 0.6
root = Path(__file__).resolve().parents[1]
rng = np.random.default_rng(2081)
mix = np.zeros((int(RATE * DURATION), 2), dtype=np.float64)


def frequency(note):
    return 440 * 2 ** ((note - 69) / 12)


def envelope(length, attack=.012, release=.2):
    env = np.ones(length)
    a = min(int(attack * RATE), length)
    r = min(int(release * RATE), length - a)
    if a:
        env[:a] = np.sin(np.linspace(0, np.pi / 2, a)) ** 2
    if r:
        env[-r:] = np.cos(np.linspace(0, np.pi / 2, r)) ** 2
    return env


def add(signal, start, level=1, pan=0):
    offset = int(start * RATE)
    if offset >= len(mix):
        return
    signal = signal[:len(mix) - offset] * level
    mix[offset:offset + len(signal), 0] += signal * np.sqrt((1 - pan) / 2)
    mix[offset:offset + len(signal), 1] += signal * np.sqrt((1 + pan) / 2)


def tone(note, duration, voice='keys'):
    t = np.arange(int(duration * RATE)) / RATE
    f = frequency(note)
    if voice == 'pad':
        signal = np.zeros_like(t)
        for detune in [-.0018, .0018]:
            signal += .4 * np.sin(2 * np.pi * f * (1 + detune) * t)
            signal += .11 * np.sin(4 * np.pi * f * (1 + detune) * t)
            signal += .04 * np.sin(6 * np.pi * f * (1 + detune) * t)
        return signal * envelope(len(t), .14, .6)
    if voice == 'bass':
        signal = .85 * np.sin(2 * np.pi * f * t) + .13 * np.sin(4 * np.pi * f * t)
        return signal * np.exp(-t * .8) * envelope(len(t), .012, .11)
    signal = np.sin(2 * np.pi * f * t) + .2 * np.sin(4 * np.pi * f * t) + .035 * np.sin(6 * np.pi * f * t)
    return signal * np.exp(-t * 5) * envelope(len(t), .009, .12)


# Ten bars, 100 BPM. Am9 -> Fmaj9 -> Cmaj9 -> G6, with a quiet final turnaround.
chords = [
    [57, 60, 64, 67, 71], [53, 57, 60, 64, 67],
    [48, 55, 59, 62, 64], [55, 59, 62, 64, 69],
    [57, 60, 64, 67, 71], [53, 57, 60, 64, 67],
    [48, 55, 59, 62, 64], [55, 59, 62, 64, 69],
    [53, 57, 60, 64, 67], [52, 56, 59, 62, 64],
]
arp_pattern = [1, 2, 4, 2, 3, 2, 4, 2]
for bar, chord in enumerate(chords):
    start = bar * 4 * BEAT
    for position, note in enumerate(chord[1:]):
        add(tone(note, 2.9, 'pad'), start, .047, -.55 + position * .36)
    for step, position in enumerate(arp_pattern):
        swing = .018 if step % 2 else 0
        add(tone(chord[position] + 12, .75), start + step * BEAT / 2 + swing,
            .079 if step % 2 == 0 else .06, -.4 if step % 2 == 0 else .4)
    for beat in range(4):
        bass_note = chord[0] - 12 + (7 if beat == 3 and bar % 2 == 0 else 0)
        add(tone(bass_note, .52, 'bass'), start + beat * BEAT, .22)

        # Rounded analog-style kick with a downward pitch sweep.
        if beat in [0, 2] or (bar % 2 == 1 and beat == 3):
            t = np.arange(int(.32 * RATE)) / RATE
            phase = 2 * np.pi * (46 * t + 32 * .035 * (1 - np.exp(-t / .035)))
            kick = np.sin(phase) * np.exp(-t * 15) * envelope(len(t), .002, .03)
            add(kick, start + beat * BEAT, .31)

        # Soft filtered clap/snare on the backbeat.
        if beat in [1, 3]:
            t = np.arange(int(.18 * RATE)) / RATE
            noise = rng.normal(0, 1, len(t))
            smooth = np.convolve(noise, np.ones(9) / 9, mode='same')
            snare = (noise * .17 + smooth * .58 + .16 * np.sin(2 * np.pi * 178 * t))
            snare *= np.exp(-t * 23) * envelope(len(t), .002, .03)
            add(snare, start + beat * BEAT + .014, .23, .08)

    for step in range(8):
        t = np.arange(int(.09 * RATE)) / RATE
        noise = rng.normal(0, 1, len(t))
        high = noise - np.convolve(noise, np.ones(15) / 15, mode='same')
        hat = high * np.exp(-t * 60) * envelope(len(t), .001, .015)
        add(hat, start + step * BEAT / 2 + (.018 if step % 2 else 0),
            .022 if step % 2 else .03, -.3 if step % 2 else .3)

# Cross-channel echoes and a short diffuse room.
dry = mix.copy()
for seconds, strength in [(0.3, .16), (.6, .08), (.071, .1), (.113, .065)]:
    delay = int(seconds * RATE)
    mix[delay:] += dry[:-delay, ::-1] * strength
mix *= envelope(len(mix), .35, 1.8)[:, None]
mix = np.tanh(mix * 1.35)
mix *= .86 / np.max(np.abs(mix))
pcm = np.round(mix * 32767).astype('<i2')
target = root / 'renderer' / 'assets' / 'demo.wav'
target.parent.mkdir(parents=True, exist_ok=True)
with wave.open(str(target), 'wb') as output:
    output.setnchannels(2)
    output.setsampwidth(2)
    output.setframerate(RATE)
    output.writeframes(pcm.tobytes())
print(f'{target}: {DURATION:.2f}s, stereo {RATE} Hz, {target.stat().st_size:,} bytes')

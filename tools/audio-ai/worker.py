"""Local, JSON-lines AI worker. Audio is never sent to a network service."""
from __future__ import annotations
import argparse
import hashlib
import json
import math
import os
from pathlib import Path
import subprocess
import sys
import urllib.request


def emit(event, **data):
    print(json.dumps(dict(event=event, **data), allow_nan=False), flush=True)


def sha256(path):
    digest = hashlib.sha256()
    with Path(path).open('rb') as stream:
        while block := stream.read(1024 * 1024):
            digest.update(block)
    return digest.hexdigest()


def prepare(root, pack):
    if pack not in ('auto', 'music', 'sound', 'identify', 'transients'):
        raise ValueError('Unknown model pack.')
    python = root / 'venv' / ('Scripts/python.exe' if os.name == 'nt' else 'bin/python')
    if Path(sys.executable).resolve() != python.resolve():
        if not python.exists():
            emit('progress', message='Creating the local AI environment…')
            subprocess.run([sys.executable, '-m', 'venv', str(root / 'venv')], check=True)
        # Run pip in the isolated environment. Forward output without polluting JSON stdout.
        emit('progress', message='Installing the local inference runtime…')
        subprocess.run([str(python), '-m', 'pip', 'install', '--disable-pip-version-check', '-r', str(root / 'requirements.txt')], stdout=sys.stderr, check=True)
        child = subprocess.run([str(python), str(root / 'worker.py'), '--root', str(root)], input=json.dumps({'operation': 'prepare', 'pack': pack}), text=True)
        if child.returncode:
            raise RuntimeError('Model installation did not finish. Retry installation.')
        return
    assets = json.loads((root / 'models.json').read_text())
    (root / 'runtime.ready').write_text('1')
    chosen = [item for item in assets if pack == 'auto' or item['pack'] == pack]
    folder = root / 'models'
    folder.mkdir(parents=True, exist_ok=True)
    for i, asset in enumerate(chosen):
        dest = folder / asset['name']
        if dest.exists() and dest.stat().st_size == asset['size'] and sha256(dest) == asset['sha256']:
            continue
        emit('progress', message=f"Downloading {asset['name']}…", progress=i / len(chosen))
        temp = dest.with_suffix('.download')
        try:
            with urllib.request.urlopen(asset['url'], timeout=90) as response, temp.open('wb') as out:
                downloaded = 0
                previous = -1
                while block := response.read(1024 * 1024):
                    out.write(block)
                    downloaded += len(block)
                    percent = int(downloaded / asset['size'] * 100)
                    if percent >= previous + 5:
                        emit('progress', message=f"Downloading {asset['name']} · {percent}%", progress=(i + min(1, downloaded / asset['size'])) / len(chosen))
                        previous = percent
            if temp.stat().st_size != asset['size'] or sha256(temp) != asset['sha256']:
                raise RuntimeError('Model checksum mismatch. Retry the download.')
            temp.replace(dest)
        finally:
            temp.unlink(missing_ok=True)
    for installed_pack in ('music', 'sound', 'identify') if pack == 'auto' else (pack,):
        (root / f'{installed_pack}.ready').write_text(pack_digest(assets, installed_pack))
    emit('result', result={'installed': pack})


def session(path):
    import onnxruntime as ort
    options = ort.SessionOptions()
    options.intra_op_num_threads = max(1, min(6, (os.cpu_count() or 2) - 1))
    options.inter_op_num_threads = 1
    options.log_severity_level = 3
    return ort.InferenceSession(str(path), sess_options=options, providers=['CPUExecutionProvider'])


def run_model(model, *arrays):
    return model.run(None, {node.name: value for node, value in zip(model.get_inputs(), arrays)})[0]


def resample(audio, source_rate, target_rate, length=None):
    import numpy as np
    from scipy.signal import resample_poly
    if source_rate != target_rate:
        divisor = math.gcd(source_rate, target_rate)
        audio = resample_poly(audio, target_rate // divisor, source_rate // divisor, axis=-1)
    if length is not None:
        audio = audio[..., :length]
        if audio.shape[-1] < length:
            audio = np.pad(audio, [(0, 0)] * (audio.ndim - 1) + [(0, length - audio.shape[-1])])
    return np.asarray(audio, dtype=np.float32)


def transients(audio, rate, sensitivity=0.5):
    """Find abrupt, short broadband changes; these are candidates, never object IDs."""
    import numpy as np
    if not 0 <= sensitivity <= 1:
        raise ValueError('Transient sensitivity must be between 0 and 1.')
    # Max across channels avoids stereo phase cancellation.
    difference = np.max(np.abs(np.diff(audio, axis=-1, prepend=audio[..., :1])), axis=0)
    window = max(8, round(rate * .001))
    size = math.ceil(len(difference) / window)
    padded = np.pad(difference, (0, size * window - len(difference)))
    peaks = padded.reshape(-1, window).max(axis=1)
    from scipy.ndimage import median_filter
    baseline = median_filter(peaks, size=101, mode='nearest')
    threshold = np.maximum(1e-5, baseline * (14 - sensitivity * 10))
    candidates = np.flatnonzero(peaks > threshold)
    groups = []
    for index in candidates:
        at = int(index * window)
        if groups and at - groups[-1][-1] < rate * .02:
            groups[-1].append(at)
        else:
            groups.append([at])
    events = []
    for group in groups:
        if group[-1] - group[0] > rate * .035:
            continue
        at = max(group, key=lambda p: peaks[min(len(peaks) - 1, p // window)])
        events.append({'start': max(0, at / rate - .005), 'end': min(audio.shape[-1] / rate, (at + window) / rate + .025), 'label': 'Brief transient', 'kind': 'transient', 'matches': []})
    return events[:500]


def pack_digest(assets, pack):
    # Stable across changes to unrelated packs; shared with the native host.
    return hashlib.sha256('\n'.join(f"{a['name']}:{a['sha256']}:{a['size']}" for a in assets if a['pack'] == pack).encode()).hexdigest()


def detector_metadata(models):
    import csv
    with (models / 'audioset-labels.csv').open(encoding='utf-8') as stream:
        labels = sorted(csv.DictReader(stream), key=lambda row: int(row['index']))
    ontology = json.loads((models / 'audioset-ontology.json').read_text(encoding='utf-8'))
    children = {node['id']: node['child_ids'] for node in ontology}
    def descendants(key, seen=None):
        seen = set() if seen is None else seen
        for child in children.get(key, []):
            if child not in seen:
                seen.add(child)
                descendants(child, seen)
        return seen
    return labels, {row['mid']: descendants(row['mid']) for row in labels}


def detected_sources(events, descendants, limit=8):
    """Select evidenced, nonredundant source classes, never example descriptions."""
    summary = {}
    for event in events:
        key = event['classId']
        item = summary.setdefault(key, {'classId': key, 'label': event['label'], 'confidence': 0., 'seconds': 0.})
        item['confidence'] = max(item['confidence'], event['confidence'])
        item['seconds'] += event['end'] - event['start']
    # Scene descriptions and abstract taxonomy roots are context, not separable objects.
    excluded = {'Silence', 'Human sounds', 'Animal', 'Natural sounds', 'Sounds of things', 'Source-ambiguous sounds', 'Channel, environment and background'}
    candidates = [s for s in summary.values() if s['label'] not in excluded and not s['label'].startswith(('Inside,', 'Outside,'))]
    # A musical passage gets the dedicated instrument separator. Avoid extracting both
    # Music and its instrument/genre children as overlapping copies of that passage.
    music = next((s for s in candidates if s['label'] == 'Music'), None)
    if music:
        candidates = [s for s in candidates if s is music or s['classId'] not in descendants[music['classId']]]
    # If a broad class still has its own detected regions, it covers audio beyond
    # any specific child. Group that family under the observed parent instead of
    # dropping its uncovered regions or extracting duplicate parent/child tracks.
    candidates = [s for s in candidates if not any(other is not s and s['classId'] in descendants[other['classId']] for other in candidates)]
    for source in candidates:
        accepted = descendants[source['classId']] | {source['classId']}
        intervals = sorted((e['start'], e['end']) for e in events if e['classId'] in accepted)
        joined = []
        for start, end in intervals:
            if joined and start <= joined[-1][1]:
                joined[-1][1] = max(joined[-1][1], end)
            else:
                joined.append([start, end])
        source['seconds'] = sum(end - start for start, end in joined)
    return sorted(candidates, key=lambda item: item['confidence'], reverse=True)[:limit]


def identify(audio, rate, models, prompt='', sensitivity=.5, threshold=.35):
    """PANNs framewise AudioSet classifier. No user-written candidate vocabulary."""
    import numpy as np
    labels, descendants = detector_metadata(models)
    emit('progress', message='Loading the 527-class sound detector…')
    model = session(models / 'panns_sound_event_detection.onnx')
    # Analyse channels independently and pool scores. Averaging can erase antiphase
    # sounds; choosing only the louder channel can discard quieter stereo sources.
    source = resample(audio, rate, 32000)
    input_samples = int(model.get_inputs()[0].shape[-1])
    context = 32000
    block = max(32000, input_samples - 2 * context)
    events = []
    for index, start in enumerate(range(0, source.shape[-1], block)):
        emit('progress', message=f'Analysing recorded sounds · {min((start + block) / 32000, source.shape[-1] / 32000):.1f}s / {source.shape[-1] / 32000:.1f}s', progress=start / max(1, source.shape[-1]))
        left = max(0, start - context)
        right = min(source.shape[-1], left + input_samples)
        clip = source[:, left:right]
        if np.max(np.abs(clip), initial=0) < 1e-6:
            continue
        channel_scores = []
        for mono in clip:
            if np.max(np.abs(mono), initial=0) < 1e-6:
                continue
            rms = float(np.sqrt(np.mean(mono ** 2)))
            gain = min(20., max(1., .05 / max(rms, 1e-12)))
            waveform = np.pad(mono * gain, (0, max(0, input_samples - len(mono))))[None].astype(np.float32)
            channel_scores.append(np.asarray(run_model(model, waveform))[0])
        scores = np.max(channel_scores, axis=0)
        if scores.ndim != 2 or scores.shape[1] != len(labels) or not np.isfinite(scores).all():
            raise RuntimeError('Unexpected sound detector output. No suggestions were generated.')
        # PANNs outputs interpolated frames at a 320-sample hop (100 frames/s).
        for k in np.flatnonzero(np.max(scores, axis=0) >= threshold):
            active = np.flatnonzero(scores[:, k] >= threshold)
            groups = np.split(active, np.flatnonzero(np.diff(active) > 21) + 1)
            for group in groups:
                if not len(group):
                    continue
                a = max(start / 32000, left / 32000 + int(group[0]) / 100)
                b = min((start + block) / 32000, source.shape[-1] / 32000, left / 32000 + (int(group[-1]) + 1) / 100)
                if b <= a:
                    continue
                row = labels[int(k)]
                confidence = float(np.max(scores[group, k]))
                events.append({'start': a, 'end': b, 'classId': row['mid'], 'label': row['display_name'], 'confidence': confidence, 'kind': 'sound', 'matches': []})
    # Join matching detections across chunk boundaries, then remove parent duplicates
    # only when a more specific detection actually overlaps their time span.
    merged = []
    for event in sorted(events, key=lambda e: (e['classId'], e['start'])):
        if merged and event['classId'] == merged[-1]['classId'] and event['start'] <= merged[-1]['end'] + .25:
            merged[-1]['end'] = max(merged[-1]['end'], event['end'])
            merged[-1]['confidence'] = max(merged[-1]['confidence'], event['confidence'])
        else:
            merged.append(event.copy())
    final = [event for event in merged if event['label'] == 'Music' or not any(other['classId'] in descendants[event['classId']] and other['confidence'] >= event['confidence'] * .65 and min(event['end'], other['end']) - max(event['start'], other['start']) >= .5 * (event['end'] - event['start']) for other in merged)]
    return sorted(final, key=lambda e: e['start'])[:4000]


def apply_detected_activity(pcm, rate, events, source, descendants):
    """Use measured event timing as a soft prior, without sharp time cuts."""
    import numpy as np
    envelope = np.full(pcm.shape[-1], .1, np.float32)
    accepted = descendants[source['classId']] | {source['classId']}
    fade = max(1, round(rate * .15))
    for event in events:
        if event.get('classId') not in accepted:
            continue
        a = max(0, round((event['start'] - .2) * rate))
        b = min(pcm.shape[-1], round((event['end'] + .2) * rate))
        if b <= a:
            continue
        weight = np.ones(b - a, np.float32)
        ramp = min(fade, (b - a) // 2)
        if ramp:
            if a > 0:
                weight[:ramp] = np.linspace(.1, 1, ramp)
            if b < pcm.shape[-1]:
                weight[-ramp:] = np.linspace(1, .1, ramp)
        envelope[a:b] = np.maximum(envelope[a:b], weight)
    pcm *= envelope
    return pcm


def clean_spectral_tracks(audio, tracks, rate, strength=.55):
    """Joint soft masks follow estimated sources in time/frequency, with linked stereo.

    Reassign shared bins competitively and put unsupported energy in the residual.
    Bounded blocks retain unmodified context so seams don't depend on block order.
    """
    import numpy as np
    import librosa
    from scipy.ndimage import gaussian_filter
    if not tracks or strength <= 0:
        return tracks
    n_fft = min(8192, max(512, 2 ** round(math.log2(rate * .046))))
    hop, block = n_fft // 4, rate * 4
    context = n_fft
    tails = [None for _ in tracks]
    for start in range(0, audio.shape[-1], block):
        end = min(audio.shape[-1], start + block)
        left, right = max(0, start - context), min(audio.shape[-1], end + context)
        mixed = librosa.stft(audio[:, left:right], n_fft=n_fft, hop_length=hop)
        powers = []
        for k, (_, pcm) in enumerate(tracks):
            clip = np.concatenate((tails[k], pcm[:, start:right]), axis=-1) if start else pcm[:, :right].copy()
            tails[k] = pcm[:, max(start, end - context):end].copy()
            estimated = librosa.stft(clip, n_fft=n_fft, hop_length=hop)
            powers.append(np.mean(np.abs(estimated) ** 2, axis=0))
        powers = gaussian_filter(np.asarray(powers), sigma=(0, .6, .6))
        mixture_power = np.mean(np.abs(mixed) ** 2, axis=0)
        residual = np.maximum(mixture_power - powers.sum(axis=0), 0)
        budget = np.maximum(mixture_power, powers.sum(axis=0))
        normalized = powers / np.maximum(budget, 1e-20)
        exponent = 1 + 1.5 * strength
        weights = normalized ** exponent
        remaining = (residual / np.maximum(budget, 1e-20)) ** exponent
        denominator = np.maximum(weights.sum(axis=0) + remaining, 1e-20)
        for k, (_, pcm) in enumerate(tracks):
            mask = weights[k] / denominator
            recovered = librosa.istft(mixed * mask[None], n_fft=n_fft, hop_length=hop, length=right - left)
            cleaned = recovered[:, start - left:end - left]
            # At recording edges the FFT sees reflected padding, not recorded context.
            # Fade from/to the model estimate over half a window to avoid edge ringing.
            fade = min(n_fft // 2, end - start)
            ramp = np.sin(np.linspace(0, np.pi / 2, fade)) ** 2
            if start == 0:
                cleaned[:, :fade] = pcm[:, :fade] * (1 - ramp) + cleaned[:, :fade] * ramp
            if end == audio.shape[-1]:
                cleaned[:, -fade:] = pcm[:, end - fade:end] * ramp + cleaned[:, -fade:] * (1 - ramp)
            pcm[:, start:end] = cleaned
        emit('progress', message='Cleaning spectral bleed between tracks…', progress=end / audio.shape[-1])
    return tracks


def transient_tracks(audio, rate, events):
    """Extract transient spectral excess, rather than copying every frequency in a box."""
    import numpy as np
    import librosa
    from scipy.ndimage import median_filter
    n_fft = min(2048, max(256, 2 ** round(math.log2(rate * .012))))
    hop = n_fft // 4
    output = np.zeros_like(audio)
    # Work on bounded event crops; overlapping events have already been grouped.
    for event in events:
        a, b = round(event['start'] * rate), round(event['end'] * rate)
        left, right = max(0, a - round(rate * .15)), min(audio.shape[-1], b + round(rate * .15))
        spectrum = librosa.stft(audio[:, left:right], n_fft=n_fft, hop_length=hop)
        power = np.mean(np.abs(spectrum) ** 2, axis=0)
        baseline = median_filter(power, size=(1, max(3, round(.12 * rate / hop) | 1)), mode='nearest')
        excess = np.maximum(power - baseline * 1.5, 0) / np.maximum(power, 1e-20)
        times = left / rate + np.arange(power.shape[-1]) * hop / rate
        envelope = np.clip((times - event['start']) / .002, 0, 1) * np.clip((event['end'] - times) / .002, 0, 1)
        recovered = librosa.istft(spectrum * (excess * envelope)[None], n_fft=n_fft, hop_length=hop, length=right - left)
        output[:, a:b] += recovered[:, a - left:b - left]
    return [('Brief transients', output)] if events else []


def music(audio, rate, models):
    import numpy as np
    model = session(models / 'htdemucs_6s.onnx')
    length = 343980
    # Model expects stereo at 44.1 kHz. Keep amplitudes and restore source layout/rate.
    source = resample(audio, rate, 44100)
    stereo = np.repeat(source, 2, axis=0) if len(source) == 1 else source
    gain = max(1.0, float(np.max(np.abs(stereo), initial=0)))
    stereo = stereo / gain
    hop = length // 2
    total = stereo.shape[-1]
    output = np.zeros((6, 2, total), np.float32)
    weights = np.zeros(total, np.float32)
    # Half-sample raised cosine avoids a zero-weight first/last sample.
    window = np.sin(np.pi * (np.arange(length) + .5) / length).astype(np.float32) ** 2
    starts = list(range(0, total, hop))
    for i, start in enumerate(starts):
        emit('progress', message=f'Separating instruments · {i + 1}/{len(starts)}', progress=i / len(starts))
        count = min(length, total - start)
        block = np.pad(stereo[:, start:start + count], ((0, 0), (0, length - count)))
        stems = run_model(model, block[None].astype(np.float32))[0]
        if stems.shape != (6, 2, length):
            raise RuntimeError('Unexpected music model output shape.')
        output[:, :, start:start + count] += stems[:, :, :count] * window[:count]
        weights[start:start + count] += window[:count]
    output = output / np.maximum(weights, 1e-12) * gain
    if len(audio) == 1:
        output = output.mean(axis=1, keepdims=True)
    output = resample(output, 44100, rate, audio.shape[-1])
    names = ['Drums', 'Bass', 'Other instruments', 'Vocals', 'Guitar', 'Piano']
    tracks = [(name, stem) for name, stem in zip(names, output)]
    # Keep a residual rather than silently forcing imperfect stems to sum to the source.
    tracks.append(('Unassigned residual', audio - output.sum(axis=0)))
    return tracks


def audiosep_block(clip, query, model):
    import numpy as np
    import librosa
    spectrum = librosa.stft(clip, n_fft=2048, hop_length=320, center=True, pad_mode='reflect')
    magnitude = np.maximum(np.abs(spectrum), 1e-10).T[None, None]
    phase = spectrum.T[None, None] / magnitude
    normalized = magnitude.transpose(0, 3, 2, 1)
    normalized = (normalized - normalized.mean(axis=(2, 3), keepdims=True)) / (normalized.std(axis=(2, 3), keepdims=True) + 1e-5)
    normalized = normalized.transpose(0, 3, 2, 1)
    frames = magnitude.shape[2]
    normalized = np.pad(normalized, ((0, 0), (0, 0), (0, (-frames) % 32), (0, 0)))[:, :, :, :-1]
    prediction = run_model(model, query, normalized.astype(np.float32))[:, :, :frames]
    # The export includes the restored Nyquist bin; inspect this rather than inventing it.
    if prediction.shape[-1] != magnitude.shape[-1]:
        raise RuntimeError('Unexpected target-sound model frequency layout.')
    masks = prediction.reshape(1, 1, 1, 3, frames, 1025)[0, 0, 0]
    amplitude = 1 / (1 + np.exp(-np.clip(masks[0], -80, 80)))
    rotation = np.tanh(masks[1]) + 1j * np.tanh(masks[2])
    rotation /= np.maximum(np.abs(rotation), 1e-10)
    separated = magnitude[0, 0] * amplitude * phase[0, 0] * rotation
    return librosa.istft(separated.T.astype(np.complex64), n_fft=2048, hop_length=320, length=len(clip))


def target_sound(audio, rate, models, prompt, runtime=None):
    import numpy as np
    from tokenizers import Tokenizer
    if runtime is None:
        runtime = {}
    if not runtime:
        runtime.update(tokenizer=Tokenizer.from_file(str(models / 'roberta-tokenizer.json')), text=session(models / 'audiosep_text.onnx'), separator=session(models / 'audiosep_resunet.onnx'))
    tokenizer = runtime['tokenizer']
    tokenizer.enable_truncation(max_length=77)
    encoded = tokenizer.encode(prompt)
    ids = np.asarray([encoded.ids], np.int64)
    query = run_model(runtime['text'], ids, np.ones_like(ids))
    model = runtime['separator']
    source = resample(audio, rate, 32000)
    length, hop = 160000, 80000
    total = source.shape[-1]
    output = np.zeros_like(source)
    weights = np.zeros(total, np.float32)
    window = np.sin(np.pi * (np.arange(length) + .5) / length).astype(np.float32) ** 2
    starts = list(range(0, total, hop))
    for i, start in enumerate(starts):
        count = min(length, total - start)
        for ch in range(len(source)):
            emit('progress', message=f'Isolating “{prompt}” · {i + 1}/{len(starts)} · channel {ch + 1}', progress=(i * len(source) + ch) / (len(starts) * len(source)))
            clip = np.pad(source[ch, start:start + count], (0, length - count))
            output[ch, start:start + count] += audiosep_block(clip, query, model)[:count] * window[:count]
        weights[start:start + count] += window[:count]
    output /= np.maximum(weights, 1e-12)
    output = resample(output, 32000, rate, audio.shape[-1])
    return [(prompt, output), ('Everything else', audio - output)]


def save_tracks(tracks, folder, rate, frames, channels):
    import numpy as np
    import soundfile as sf
    result = []
    for index, (name, pcm) in enumerate(tracks):
        if pcm.shape != (channels, frames) or not np.isfinite(pcm).all():
            raise RuntimeError('The model produced invalid audio. No completed tracks were saved.')
        path = folder / f'track-{index + 1:02}.wav'
        sf.write(str(path), pcm.T, rate, subtype='FLOAT')
        result.append({'id': str(index), 'name': name, 'path': str(path), 'peak': float(np.max(np.abs(pcm), initial=0)), 'frames': frames, 'sampleRate': rate, 'channels': channels})
    return result


def run(request, root):
    import numpy as np
    import soundfile as sf
    mode = request['mode']
    if mode not in ('auto', 'music', 'sound', 'identify', 'transients'):
        raise ValueError('Unknown separation operation.')
    prompt = request.get('prompt', '').strip()
    prompts = list(dict.fromkeys(request.get('prompts', []) or ([prompt] if prompt else [])))
    if len(prompt) > 200 or (mode == 'sound' and not prompt):
        raise ValueError('Describe the sound to isolate (1–200 characters).')
    if len(prompts) > 8 or any(not p.strip() or len(p) > 200 for p in prompts):
        raise ValueError('Use up to eight sound descriptions, each at most 200 characters.')
    start, end = int(request['start']), int(request['end'])
    with sf.SoundFile(request['sourcePath']) as source:
        rate, channels = source.samplerate, source.channels
        if channels not in (1, 2) or start < 0 or start >= end or end > len(source):
            raise ValueError('Invalid audio range or channel layout.')
        if end - start > rate * 600:
            raise ValueError('Choose a range of at most 10 minutes. Split longer recordings into sections.')
        source.seek(start)
        audio = source.read(end - start, dtype='float32', always_2d=True).T
    if not np.isfinite(audio).all():
        raise ValueError('Source contains nonfinite audio.')
    models = root / 'models'
    output = Path(request['output'])
    output.mkdir(parents=True, exist_ok=False)
    emit('progress', message='Reading source audio…')
    try:
        tracks, events, sources = [], [], []
        cleanup = float(request.get('cleanup', .55))
        confidence = float(request.get('confidence', .35))
        if not 0 <= cleanup <= 1 or not .1 <= confidence <= .95:
            raise ValueError('Invalid cleanup or detection confidence setting.')
        if mode in ('auto', 'identify'):
            events = identify(audio, rate, models, threshold=confidence)
            _, descendants = detector_metadata(models)
            sources = detected_sources(events, descendants)
        if mode == 'music':
            tracks = music(audio, rate, models)[:-1]
        elif mode in ('auto', 'sound'):
            runtime = {}
            targets = [source['label'] for source in sources] if mode == 'auto' else prompts
            for description in targets:
                measured = next((source for source in sources if source['label'] == description), None) if mode == 'auto' else None
                if mode == 'auto' and description == 'Music':
                    for name, pcm in music(audio, rate, models)[:-1]:
                        tracks.append((name, apply_detected_activity(pcm, rate, events, measured, descendants)))
                else:
                    name, pcm = target_sound(audio, rate, models, description, runtime)[0]
                    if measured:
                        pcm = apply_detected_activity(pcm, rate, events, measured, descendants)
                    tracks.append((name, pcm))
        elif mode == 'transients':
            events = transients(audio, rate, request.get('sensitivity', .5))
            tracks = transient_tracks(audio, rate, events)
        if tracks:
            # Work jointly, so a frequency shared by several estimated sources is
            # allocated competitively instead of duplicated in multiple WAVs.
            if mode != 'transients':
                tracks = clean_spectral_tracks(audio, tracks, rate, cleanup)
            tracks.append(('Unassigned residual' if mode in ('auto', 'music') else 'Everything else', audio - sum(pcm for _, pcm in tracks)))
        elif mode == 'auto':
            tracks = [('Unassigned residual', audio)]
        result = {'schema': 2, 'engine': 'local-onnx-v2', 'id': request['jobId'], 'mode': mode, 'sourceHash': request.get('sourceHash', ''), 'sourceName': Path(request['sourcePath']).name, 'sourcePath': request['sourcePath'], 'offsetSeconds': start / rate, 'duration': (end - start) / rate, 'tracks': save_tracks(tracks, output, rate, end - start, channels), 'events': events, 'sources': sources, 'cleanup': cleanup if mode != 'transients' else 0, 'confidenceThreshold': confidence}
        manifest_path = root / 'models.json'
        result['modelAssets'] = [{'name': item['name'], 'sha256': item['sha256']} for item in json.loads(manifest_path.read_text()) if mode == 'auto' or item['pack'] == mode] if manifest_path.exists() else []
        (output / 'result.json').write_text(json.dumps(result, allow_nan=False), encoding='utf-8')
        emit('result', result=result)
    except BaseException:
        # Incomplete jobs are never exposed as finished results.
        import shutil
        shutil.rmtree(output, ignore_errors=True)
        raise


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--root', type=Path, required=True)
    args = parser.parse_args()
    request = json.load(sys.stdin)
    if request['operation'] == 'prepare':
        prepare(args.root, request['pack'])
    else:
        run(request, args.root)


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        emit('error', message=str(error))
        sys.exit(1)

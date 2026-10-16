import importlib.util
import json
import os
from pathlib import Path
import tempfile
import unittest
import numpy as np
import soundfile as sf

spec = importlib.util.spec_from_file_location('worker', Path(__file__).with_name('worker.py'))
worker = importlib.util.module_from_spec(spec)
spec.loader.exec_module(worker)

class AudioAiContracts(unittest.TestCase):
    def test_resampling_restores_exact_length_and_preserves_channel_polarity(self):
        t = np.arange(16000) / 16000
        x = np.array([np.sin(t * 330 * 2 * np.pi), -np.sin(t * 330 * 2 * np.pi)], np.float32)
        y = worker.resample(worker.resample(x, 16000, 44100), 44100, 16000, x.shape[-1])
        self.assertEqual(y.shape, x.shape)
        np.testing.assert_allclose(y[0], -y[1], atol=1e-7)
        self.assertLess(np.mean((x[:, 100:-100] - y[:, 100:-100]) ** 2), 1e-5)

    def test_quiet_click_is_detected_without_stereo_cancellation(self):
        x = np.zeros((2, 48000), np.float32)
        x[:, 24000] = [0.0003, -0.0003]
        events = worker.transients(x, 48000)
        self.assertEqual(len(events), 1)
        self.assertLessEqual(events[0]['start'], .5)
        self.assertGreater(events[0]['end'], .5)
        self.assertEqual(events[0]['label'], 'Brief transient')
        self.assertEqual(events[0]['matches'], [])

    def test_steady_tone_and_silence_do_not_become_click_candidates(self):
        self.assertEqual(worker.transients(np.zeros((2, 48000), np.float32), 48000), [])
        t = np.arange(48000) / 48000
        self.assertEqual(worker.transients(np.array([.1 * np.sin(t * 1000 * 2 * np.pi)], np.float32), 48000), [])

    def test_transient_spectrum_and_residual_reconstruct_original_with_source_rate(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            rate = 22050
            x = np.zeros((rate, 2), np.float32)
            x[rate // 2] = [.02, -.01]
            source = root / 'source.wav'
            sf.write(source, x, rate, subtype='FLOAT')
            output = root / 'output'
            worker.run({'operation': 'run', 'mode': 'transients', 'sourcePath': str(source), 'sourceHash': 'a' * 64, 'start': 0, 'end': len(x), 'jobId': 'test', 'output': str(output)}, root)
            result = json.loads((output / 'result.json').read_text())
            self.assertEqual(len(result['tracks']), 2)
            stems = [sf.read(t['path'], always_2d=True)[0] for t in result['tracks']]
            np.testing.assert_allclose(sum(stems), x, atol=1e-8)
            self.assertTrue(all(t['sampleRate'] == rate and t['channels'] == 2 for t in result['tracks']))

    @unittest.skipUnless(os.getenv('TONALIA_TEST_AI_MODELS'), 'Set TONALIA_TEST_AI_MODELS for downloaded-model integration.')
    def test_multi_sound_job_writes_separate_tracks_and_a_reconstructing_residual(self):
        root = Path(os.environ['TONALIA_TEST_AI_MODELS'])
        with tempfile.TemporaryDirectory() as directory:
            folder = Path(directory)
            rate = 16000
            t = np.arange(rate) / rate
            x = (.2 * np.sin(t * 440 * 2 * np.pi)).astype(np.float32)
            source = folder / 'source.wav'
            sf.write(source, x, rate, subtype='FLOAT')
            output = folder / 'separated'
            worker.run({'mode': 'sound', 'sourcePath': str(source), 'start': 1600, 'end': 14400, 'prompt': 'a piano playing', 'prompts': ['a piano playing', 'bird chirping'], 'jobId': 'batch-test', 'output': str(output)}, root)
            result = json.loads((output / 'result.json').read_text())
            self.assertEqual(len(result['tracks']), 3)
            self.assertEqual(result['offsetSeconds'], .1)
            self.assertEqual([track['name'] for track in result['tracks']], ['a piano playing', 'bird chirping', 'Everything else'])
            pcm = [sf.read(track['path'])[0] for track in result['tracks']]
            np.testing.assert_allclose(sum(pcm), x[1600:14400], atol=1e-7)
            self.assertGreater(float(np.mean(np.abs(pcm[0] - pcm[1]))), 1e-5)

    @unittest.skipUnless(os.getenv('TONALIA_TEST_AI_MODELS'), 'Set TONALIA_TEST_AI_MODELS for downloaded-model integration.')
    def test_real_models_make_distinct_finite_tracks_and_sound_matches(self):
        root = Path(os.environ['TONALIA_TEST_AI_MODELS'])
        models = root / 'models'
        rate = 22050
        t = np.arange(rate * 2) / rate
        x = np.array([.2 * np.sin(t * 440 * 2 * np.pi) + .05 * np.sin(t * 2200 * 2 * np.pi), .12 * np.sin(t * 330 * 2 * np.pi)], np.float32)
        music = worker.music(x, rate, models)
        self.assertEqual(len(music), 7)
        self.assertTrue(all(pcm.shape == x.shape and np.isfinite(pcm).all() for _, pcm in music))
        np.testing.assert_allclose(sum(pcm for _, pcm in music), x, atol=2e-7)
        self.assertGreater(len({pcm.tobytes() for _, pcm in music}), 4)
        target = worker.target_sound(x, rate, models, 'a piano playing')
        other = worker.target_sound(x, rate, models, 'bird chirping')
        np.testing.assert_allclose(target[0][1] + target[1][1], x, atol=1e-7)
        self.assertEqual(target[0][1].shape, x.shape)
        self.assertTrue(np.isfinite(target[0][1]).all())
        self.assertGreater(float(np.mean(np.abs(target[0][1] - other[0][1]))), 1e-5)
        events = worker.identify(np.zeros((2, rate), np.float32), rate, models)
        self.assertEqual(events, [])

    def test_parent_source_covers_its_distinct_regions_and_child_activity_without_duplicates(self):
        events = [
            {'classId': 'speech', 'label': 'Speech', 'confidence': .9, 'start': 0, 'end': 20},
            {'classId': 'conversation', 'label': 'Conversation', 'confidence': .85, 'start': 22, 'end': 24},
            {'classId': 'bell', 'label': 'Bell', 'confidence': .8, 'start': 0, 'end': 1},
        ]
        descendants = {'speech': {'conversation'}, 'conversation': set(), 'bell': set()}
        sources = worker.detected_sources(events, descendants)
        self.assertEqual({source['label'] for source in sources}, {'Speech', 'Bell'})
        pcm = np.ones((2, 26000), np.float32)
        voice = next(source for source in sources if source['label'] == 'Speech')
        self.assertEqual(voice['seconds'], 22)
        worker.apply_detected_activity(pcm, 1000, events, voice, descendants)
        self.assertEqual(pcm[0, 10000], 1)
        self.assertEqual(pcm[0, 23000], 1)
        self.assertLess(pcm[0, 25500], .2)

    def test_spectral_cleanup_removes_cross_bleed_and_preserves_stereo_and_block_seams(self):
        rate = 16000
        t = np.arange(rate * 5 + 371) / rate
        a, b = .2 * np.sin(t * 440 * 2 * np.pi), .2 * np.sin(t * 1900 * 2 * np.pi)
        stereo = lambda x: np.array([x, -x], np.float32)
        original = stereo(a + b)
        tracks = [('First', stereo(a + .2 * b)), ('Second', stereo(b + .2 * a))]
        cleaned = worker.clean_spectral_tracks(original, tracks, rate, .55)
        for index, (_, pcm) in enumerate(cleaned):
            np.testing.assert_allclose(pcm[0], -pcm[1], atol=1e-6)
            self.assertTrue(np.isfinite(pcm).all())
            unwanted = b if index == 0 else a
            wanted = a if index == 0 else b
            leakage = abs(np.dot(pcm[0], unwanted) / np.dot(unwanted, unwanted))
            retained = abs(np.dot(pcm[0], wanted) / np.dot(wanted, wanted))
            self.assertLess(leakage, .04)
            self.assertGreater(retained, .85)
            self.assertLess(np.max(np.abs(pcm[0] - wanted)), .055)
        residual = original - sum(pcm for _, pcm in cleaned)
        np.testing.assert_allclose(sum(pcm for _, pcm in cleaned) + residual, original, atol=1e-7)

    def test_transient_extraction_suppresses_continuous_tone_in_the_event(self):
        rate = 16000
        t = np.arange(rate) / rate
        tone = .05 * np.sin(t * 1000 * 2 * np.pi)
        x = np.array([tone, -tone], np.float32)
        x[:, rate // 2] += [.2, -.2]
        events = worker.transients(x, rate)
        self.assertTrue(events)
        extracted = worker.transient_tracks(x, rate, events)[0][1]
        self.assertGreater(abs(extracted[0, rate // 2]), .1)
        region = slice(rate // 2 + 90, rate // 2 + 300)
        self.assertLess(np.sqrt(np.mean(extracted[0, region] ** 2)), np.sqrt(np.mean(x[0, region] ** 2)) * .35)
        np.testing.assert_allclose(extracted[0], -extracted[1], atol=1e-7)

    @unittest.skipUnless(os.getenv('TONALIA_TEST_AI_MODELS') and os.getenv('TONALIA_TEST_AI_FIXTURE'), 'Set model root and telephone/speech fixture for real detection and automatic extraction.')
    def test_actual_analysis_discovers_telephone_and_speech_and_auto_extracts_wavs(self):
        root = Path(os.environ['TONALIA_TEST_AI_MODELS'])
        fixture = Path(os.environ['TONALIA_TEST_AI_FIXTURE'])
        with tempfile.TemporaryDirectory() as directory:
            folder = Path(directory)
            x, rate = sf.read(fixture, dtype='float32', always_2d=True)
            worker.run({'mode': 'auto', 'sourcePath': str(fixture), 'sourceHash': worker.sha256(fixture), 'start': 0, 'end': len(x), 'jobId': 'auto-contract', 'cleanup': .55, 'output': str(folder / 'output')}, root)
            result = json.loads((folder / 'output/result.json').read_text())
            self.assertTrue({'Speech', 'Telephone bell ringing'}.issubset({s['label'] for s in result['sources']}))
            self.assertNotIn('bird chirping', {s['label'] for s in result['sources']})
            self.assertEqual(len(result['tracks']), len(result['sources']) + 1)
            pcm = [sf.read(track['path'], always_2d=True, dtype='float32')[0] for track in result['tracks']]
            np.testing.assert_allclose(sum(pcm), x, atol=2e-7)
            self.assertGreater(np.mean(np.abs(pcm[0] - pcm[1])), 1e-4)
            self.assertEqual(worker.identify(x.T, rate, root / 'models', threshold=.95), [])

    @unittest.skipUnless(os.getenv('TONALIA_TEST_AI_MODELS') and os.getenv('TONALIA_TEST_AI_FIXTURE'), 'Set model root and telephone/speech fixture for stereo detection.')
    def test_detector_finds_sources_in_the_quieter_stereo_channel(self):
        root = Path(os.environ['TONALIA_TEST_AI_MODELS'])
        fixture, rate = sf.read(os.environ['TONALIA_TEST_AI_FIXTURE'], dtype='float32')
        time = np.arange(len(fixture)) / rate
        stereo = np.array([.65 * np.sin(2 * np.pi * 440 * time), fixture * .15], np.float32)
        self.assertGreater(np.mean(stereo[0] ** 2), np.mean(stereo[1] ** 2) * 20)
        events = worker.identify(stereo, rate, root / 'models')
        labels = {event['label'] for event in events}
        self.assertTrue({'Speech', 'Telephone bell ringing'}.issubset(labels))

if __name__ == '__main__':
    unittest.main()

import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const messages = [];
let Player;
const context = vm.createContext({
  sampleRate: 48000,
  AudioWorkletProcessor: class {
    constructor() {
      this.port = { postMessage: (message) => messages.push(message) };
    }
  },
  registerProcessor: (_name, ctor) => {
    Player = ctor;
  },
});
vm.runInContext(await readFile('apps/web/public/audio-processor.js', 'utf8'), context);
const player = new Player();
const send = (data) => player.port.onmessage({ data });
const process = () => {
  const output = [new Float32Array(128), new Float32Array(128)];
  player.process([], [output]);
  return output;
};
send({ type: 'chunk', channels: 2, samples: new Float32Array([0.2, -0.2, 0.4, -0.4]) });
send({ type: 'run' });
process();
assert.equal(player.frames, 2);
assert.equal(player.running, true);
assert.equal(
  messages.some((m) => m.type === 'underrun'),
  false,
);
send({ type: 'chunk', channels: 2, samples: new Float32Array([0.6, -0.6]) });
const resumed = process();
assert(Math.abs(resumed[0][0] - 0.6) < 1e-6);
assert.equal(player.frames, 3);
send({ type: 'end' });
process();
assert(messages.some((m) => m.type === 'ended' && m.frames === 3));
assert.equal(
  messages.some((m) => m.type === 'underrun'),
  false,
);
const stalled = new Player();
stalled.port.onmessage({ data: { type: 'run' } });
for (let i = 0; i < 751; i++) stalled.process([], [[new Float32Array(128), new Float32Array(128)]]);
assert.equal(stalled.running, false);
assert.equal(messages.filter((m) => m.type === 'underrun').length, 1);
console.log(
  'Browser playback recovers short stalls without losing samples; sustained starvation still stops.',
);

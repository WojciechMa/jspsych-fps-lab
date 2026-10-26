// Plays the engine's sound effects with the Web Audio API. Doom hands over DMX lumps: an 8-byte
// header, then unsigned 8-bit mono samples padded with 16 samples at both ends.

interface Channel {
  source: AudioBufferSourceNode;
  gain: GainNode;
  panner: StereoPannerNode;
}

export class EngineAudio {
  private context: AudioContext | null = null;
  private output: GainNode | null = null;
  private readonly buffers = new Map<number, AudioBuffer | null>();
  private readonly channels = new Map<number, Channel>();

  /** Creates or resumes the audio context; browsers only allow that during a user gesture. */
  unlock(): Promise<void> {
    if (!this.context) {
      this.context = new AudioContext();
      this.output = this.context.createGain();
      this.output.connect(this.context.destination);
    }
    return this.context.state === 'running' ? Promise.resolve() : this.context.resume();
  }

  setMuted(muted: boolean): void {
    if (this.output) this.output.gain.value = muted ? 0 : 1;
  }

  suspend(): void {
    void this.context?.suspend();
  }

  start(channel: number, lump: number, readLump: () => Uint8Array, vol: number, sep: number): void {
    const { context, output } = this;
    if (!context || !output) return;

    let buffer = this.buffers.get(lump);
    if (buffer === undefined) {
      buffer = decodeDmx(context, readLump());
      this.buffers.set(lump, buffer);
    }
    this.stop(channel);
    if (!buffer) return;

    const playing: Channel = {
      source: context.createBufferSource(),
      gain: context.createGain(),
      panner: context.createStereoPanner(),
    };
    playing.source.buffer = buffer;
    playing.source.connect(playing.gain).connect(playing.panner).connect(output);
    setParams(playing, vol, sep);
    playing.source.onended = () => {
      if (this.channels.get(channel) === playing) this.channels.delete(channel);
    };
    this.channels.set(channel, playing);
    playing.source.start();
  }

  update(channel: number, vol: number, sep: number): void {
    const playing = this.channels.get(channel);
    if (playing) setParams(playing, vol, sep);
  }

  stop(channel: number): void {
    const playing = this.channels.get(channel);
    if (!playing) return;
    this.channels.delete(channel);
    playing.source.onended = null;
    playing.source.stop();
  }

  stopAll(): void {
    for (const channel of [...this.channels.keys()]) this.stop(channel);
  }

  isPlaying(channel: number): boolean {
    return this.channels.has(channel);
  }
}

/** vol is 0–127; sep is Doom's stereo separation, 0 = left, 128 = centre, 254 = right. */
function setParams(playing: Channel, vol: number, sep: number): void {
  playing.gain.gain.value = vol / 127;
  playing.panner.pan.value = Math.max(-1, Math.min(1, (sep - 127) / 127));
}

function decodeDmx(context: BaseAudioContext, lump: Uint8Array): AudioBuffer | null {
  if (lump.length < 8) return null;
  const header = new DataView(lump.buffer, lump.byteOffset, 8);
  if (header.getUint16(0, true) !== 3) return null;
  const rate = header.getUint16(2, true);
  const length = header.getUint32(4, true);
  // Same sanity check as Chocolate Doom: the length includes 32 padding samples.
  if (length <= 48 || length > lump.length - 8) return null;

  const samples = lump.subarray(8 + 16, 8 + length - 16);
  const buffer = context.createBuffer(1, samples.length, rate);
  const out = buffer.getChannelData(0);
  for (let i = 0; i < samples.length; i++) out[i] = (samples[i] - 128) / 128;
  return buffer;
}

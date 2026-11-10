// a steady 6 kHz tone: narrow enough to measure apart from the voice
export default ({ Tone }) => { const o = new Tone.Oscillator(6000, 'sine').toDestination(); o.volume.value = -14; o.start(0); };

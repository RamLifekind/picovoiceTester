/**
 * Start mic capture, return PCM Int16 buffers via onData callback.
 * Tries AudioWorklet first, falls back to ScriptProcessorNode.
 */
export async function startMic(onData) {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { sampleRate: 16000, channelCount: 1, echoCancellation: true, noiseSuppression: true }
  });

  const audioContext = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 16000 });
  const source = audioContext.createMediaStreamSource(stream);
  let processor;

  try {
    await audioContext.audioWorklet.addModule(`${process.env.PUBLIC_URL || ''}/pcm-processor.js`);
    processor = new AudioWorkletNode(audioContext, 'pcm-processor');
    processor.port.onmessage = (e) => onData(e.data);
    source.connect(processor);
    processor.connect(audioContext.destination);
  } catch {
    // Fallback: ScriptProcessorNode
    processor = audioContext.createScriptProcessor(4096, 1, 1);
    processor.onaudioprocess = (e) => {
      const float32 = e.inputBuffer.getChannelData(0);
      const int16 = new Int16Array(float32.length);
      for (let i = 0; i < float32.length; i++) {
        const s = Math.max(-1, Math.min(1, float32[i]));
        int16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
      }
      onData(int16.buffer);
    };
    source.connect(processor);
    processor.connect(audioContext.destination);
  }

  return { stream, audioContext, processor };
}

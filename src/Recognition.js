import React, { useState, useRef, useCallback, useEffect } from 'react';
import { VOICE_BACKEND_WS } from './config';
import { startMic } from './mic-helper';

function Recognition() {
  const [status, setStatus] = useState({ type: 'info', text: 'Click Start to begin recognition' });
  const [isRunning, setIsRunning] = useState(false);
  const [verified, setVerified] = useState([]);
  const [liveScores, setLiveScores] = useState([]);
  const [threshold, setThreshold] = useState(0.75);
  const [logs, setLogs] = useState([]);

  const wsRef = useRef(null);
  const mediaStreamRef = useRef(null);
  const processorRef = useRef(null);
  const audioContextRef = useRef(null);
  const audioQueueRef = useRef([]);
  const isPlayingRef = useRef(false);

  const addLog = useCallback((text, type = 'info') => {
    setLogs(prev => [...prev.slice(-100), { text: `[${new Date().toLocaleTimeString()}] ${text}`, type }]);
  }, []);

  const playNextAudio = useCallback(() => {
    if (audioQueueRef.current.length === 0) {
      isPlayingRef.current = false;
      return;
    }
    isPlayingRef.current = true;
    const base64 = audioQueueRef.current.shift();

    try {
      const binary = atob(base64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

      const sampleRate = 24000;
      const wavBuffer = new ArrayBuffer(44 + bytes.length);
      const view = new DataView(wavBuffer);

      const writeString = (offset, str) => { for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i)); };
      writeString(0, 'RIFF');
      view.setUint32(4, 36 + bytes.length, true);
      writeString(8, 'WAVE');
      writeString(12, 'fmt ');
      view.setUint32(16, 16, true);
      view.setUint16(20, 1, true);
      view.setUint16(22, 1, true);
      view.setUint32(24, sampleRate, true);
      view.setUint32(28, sampleRate * 2, true);
      view.setUint16(32, 2, true);
      view.setUint16(34, 16, true);
      writeString(36, 'data');
      view.setUint32(40, bytes.length, true);
      new Uint8Array(wavBuffer, 44).set(bytes);

      const blob = new Blob([wavBuffer], { type: 'audio/wav' });
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      audio.onended = () => { URL.revokeObjectURL(url); playNextAudio(); };
      audio.onerror = () => { URL.revokeObjectURL(url); playNextAudio(); };
      audio.play().catch(() => playNextAudio());
    } catch {
      playNextAudio();
    }
  }, []);

  const queueAudio = useCallback((base64) => {
    audioQueueRef.current.push(base64);
    if (!isPlayingRef.current) playNextAudio();
  }, [playNextAudio]);

  const handleThresholdChange = useCallback((newValue) => {
    const clamped = Math.max(0.1, Math.min(1.0, parseFloat(newValue)));
    setThreshold(clamped);
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'set_threshold', value: clamped }));
    }
  }, []);

  const stop = useCallback(() => {
    if (processorRef.current) { processorRef.current.disconnect(); processorRef.current = null; }
    if (audioContextRef.current) { audioContextRef.current.close(); audioContextRef.current = null; }
    if (mediaStreamRef.current) { mediaStreamRef.current.getTracks().forEach(t => t.stop()); mediaStreamRef.current = null; }
    if (wsRef.current) { wsRef.current.close(); wsRef.current = null; }
    setIsRunning(false);
    setStatus({ type: 'info', text: 'Stopped' });
  }, []);

  // Cleanup on unmount (tab switch)
  useEffect(() => stop, [stop]);

  const start = useCallback(async () => {
    setIsRunning(true);
    setVerified([]);
    setLiveScores([]);
    setLogs([]);
    audioQueueRef.current = [];
    isPlayingRef.current = false;
    setStatus({ type: 'info', text: 'Connecting...' });

    try {
      const ws = new WebSocket(`${VOICE_BACKEND_WS}/test/recognize`);
      wsRef.current = ws;

      ws.onopen = async () => {
        addLog('WebSocket connected', 'success');
        setStatus({ type: 'connected', text: 'Connected — speak to identify' });

        // Send initial threshold
        ws.send(JSON.stringify({ type: 'set_threshold', value: threshold }));

        try {
          const mic = await startMic((buffer) => {
            if (ws.readyState === WebSocket.OPEN) ws.send(buffer);
          });
          mediaStreamRef.current = mic.stream;
          audioContextRef.current = mic.audioContext;
          processorRef.current = mic.processor;
          addLog('Microphone streaming started', 'success');
        } catch (micErr) {
          addLog(`Microphone error: ${micErr.message}`, 'error');
          setStatus({ type: 'error', text: `Mic error: ${micErr.message}` });
          stop();
        }
      };

      ws.binaryType = 'arraybuffer';

      ws.onmessage = (event) => {
        // Skip binary frames (shouldn't happen but guard against it)
        if (event.data instanceof ArrayBuffer) return;
        const msg = JSON.parse(event.data);

        if (msg.type === 'scores') {
          setLiveScores(msg.scores);
          if (msg.threshold !== undefined) setThreshold(msg.threshold);
        } else if (msg.type === 'verified') {
          addLog(`Verified: ${msg.firstName} (score: ${msg.score})`, 'success');
          setVerified(prev => [...prev, {
            userNum: msg.userNum,
            firstName: msg.firstName,
            imageURL: msg.imageURL,
            score: msg.score,
            timestamp: msg.timestamp
          }]);
        } else if (msg.type === 'tts_audio') {
          addLog(`TTS: ${msg.text}`, 'success');
          queueAudio(msg.audio);
        } else if (msg.type === 'threshold_updated') {
          addLog(`Threshold updated to ${(msg.value * 100).toFixed(0)}%`, 'info');
        } else if (msg.type === 'error') {
          addLog(`Error: ${msg.message}`, 'error');
        }
      };

      ws.onerror = () => {
        addLog('WebSocket error', 'error');
        setStatus({ type: 'error', text: 'Connection error' });
        stop();
      };

      ws.onclose = () => {
        addLog('WebSocket closed');
        stop();
      };

    } catch (err) {
      addLog(`Error: ${err.message}`, 'error');
      setStatus({ type: 'error', text: err.message });
      stop();
    }
  }, [addLog, stop, queueAudio, threshold]);

  const getScoreColor = (score) => {
    if (score >= threshold) return '#95d5b2';
    if (score >= threshold * 0.7) return '#f9c74f';
    return '#ff6b6b';
  };

  return (
    <div>
      {/* Threshold control */}
      <div className="section">
        <label>Confidence Threshold: {(threshold * 100).toFixed(0)}%</label>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ color: '#666', fontSize: 12 }}>10%</span>
          <input
            type="range"
            min="0.1"
            max="1.0"
            step="0.05"
            value={threshold}
            onChange={e => handleThresholdChange(e.target.value)}
            style={{ flex: 1, accentColor: '#e94560' }}
          />
          <span style={{ color: '#666', fontSize: 12 }}>100%</span>
        </div>
      </div>

      <button className={`btn ${isRunning ? 'btn-stop' : 'btn-start'}`} onClick={isRunning ? stop : start}>
        {isRunning ? 'Stop' : 'Start Recognition'}
      </button>

      <div className={`status ${status.type}`}>{status.text}</div>

      {/* Live scores */}
      {liveScores.length > 0 && (
        <div style={{ marginTop: 16, background: '#0a0a1a', borderRadius: 8, padding: 16 }}>
          <label style={{ color: '#ccc', fontWeight: 600, marginBottom: 10, display: 'block' }}>
            Live Confidence Scores
          </label>
          {liveScores.map((s, i) => (
            <div key={i} style={{ marginBottom: 8 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
                <span style={{ color: '#aaa', fontSize: 13 }}>
                  {s.name || `${s.speaker?.substring(0, 8)}...`}
                </span>
                <span style={{ color: getScoreColor(s.score), fontSize: 13, fontWeight: 600 }}>
                  {(s.score * 100).toFixed(1)}%
                </span>
              </div>
              <div style={{ position: 'relative', height: 12, background: '#1a1a2e', borderRadius: 6, overflow: 'hidden' }}>
                {/* Threshold marker */}
                <div style={{
                  position: 'absolute', left: `${threshold * 100}%`, top: 0, bottom: 0,
                  width: 2, background: '#e94560', zIndex: 2
                }} />
                {/* Score bar */}
                <div style={{
                  height: '100%', width: `${Math.min(s.score * 100, 100)}%`,
                  background: getScoreColor(s.score), borderRadius: 6,
                  transition: 'width 0.2s, background 0.2s'
                }} />
              </div>
            </div>
          ))}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8, fontSize: 11, color: '#666' }}>
            <div style={{ width: 12, height: 2, background: '#e94560' }} />
            <span>Threshold ({(threshold * 100).toFixed(0)}%)</span>
          </div>
        </div>
      )}

      {/* Verified speakers */}
      {verified.length > 0 && (
        <div className="verified-list" style={{ marginTop: 16 }}>
          <label style={{ color: '#ccc', fontWeight: 600, marginBottom: 8, display: 'block' }}>
            Verified Speakers ({verified.length})
          </label>
          {verified.map((v, i) => (
            <div key={i} className="verified-card">
              {v.imageURL ? (
                <img src={v.imageURL} alt={v.firstName} />
              ) : (
                <div style={{
                  width: 60, height: 60, borderRadius: '50%', background: '#0f3460',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 24, fontWeight: 700, color: '#fff', border: '2px solid #95d5b2'
                }}>
                  {v.firstName?.[0] || '?'}
                </div>
              )}
              <div className="info">
                <div className="name">{v.firstName}</div>
                <div className="score">Confidence: {(v.score * 100).toFixed(1)}%</div>
                <div style={{ color: '#666', fontSize: 11, fontFamily: 'monospace', wordBreak: 'break-all' }}>{v.userNum}</div>
              </div>
            </div>
          ))}
        </div>
      )}

      {logs.length > 0 && (
        <div className="log">
          {logs.map((log, i) => (
            <div key={i} className={`log-entry ${log.type}`}>{log.text}</div>
          ))}
        </div>
      )}
    </div>
  );
}

export default Recognition;

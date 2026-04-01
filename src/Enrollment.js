import React, { useState, useRef, useCallback, useEffect } from 'react';
import { VOICE_BACKEND, VOICE_BACKEND_WS } from './config';

const PROVIDERS = [
  { displayName: 'Andrew Park', id: '91393876-7762-4492-a07a-3620b5c7d09f', mail: 'Andrew.Park@lifekindconcepts.com' },
  { displayName: 'Benjamin Lee', id: 'd68fb5fc-bd9b-4e33-8ef5-184ca5f3333b', mail: 'Benjamin.Lee@lifekindconcepts.com' },
  { displayName: 'Beth Johnson', id: '71817244-bc04-462a-9739-a26dea0d6b6c', mail: 'Beth.Johnson@lifekindconcepts.com' },
  { displayName: 'Connie Alarcon', id: 'e7cafc0f-5a53-48d0-8417-cefa892b539d', mail: 'Connie.Alarcon@lifekindconcepts.com' },
  { displayName: 'Felix Lee', id: '9d378f9d-11ad-404a-b877-799ca0ac8ed9', mail: 'Felix.Lee@lifekindconcepts.com' },
  { displayName: 'Jay Marshall', id: '13daf816-e6b9-43fd-aba9-affa034f6ec7', mail: 'Jay.Marshall@lifekindconcepts.com' },
  { displayName: 'Jennifer Chiriano', id: '5bb2d266-76fb-4922-85b7-3066656973d1', mail: 'Jennifer.Chiriano@lifekindconcepts.com' },
  { displayName: 'Justina Guirguis', id: 'a072f860-843b-4f3e-8342-e1defef105f9', mail: 'Justina.Guirguis@lifekindconcepts.com' },
  { displayName: 'Olivia Meza', id: 'e7ef2029-d0d2-4ee4-97f3-cf6eecf9a528', mail: 'Olivia.Meza@lifekindconcepts.com' },
  { displayName: 'Paul Mitchell', id: '1e009eb0-e3bd-4cee-a1be-b8b20a80bda0', mail: 'Paul.Mitchell@lifekindconcepts.com' },
  { displayName: 'UAT-Test-AK', id: 'a63ec38a-18f9-406e-bc3d-6fa45c983e35', mail: 'UAT-Test-AK@lifekindconcepts.com' },
  { displayName: 'UAT-Test001', id: '33adf184-5a9e-404a-8759-7928f7d43963', mail: 'UAT-Test001@lifekindconcepts.com' },
  { displayName: 'Yu Ping Garthwaite', id: '105f18a4-35a7-41f1-88ab-45505a670141', mail: 'Yu.Ping.Garthwaite@lifekindconcepts.com' },
  { displayName: 'Zoey Megard', id: 'bb8f2fff-a303-429d-abad-fee378c66adc', mail: 'Zoey.Megard@lifekindconcepts.com' },
  { displayName: 'Sedipeh Parandeh', id: 'AA27CE8E-0BAA-4170-A2A1-B4DE5ADC927F', mail: 'Sedipeh.Parandeh@lifekindconcepts.com' },
  { displayName: 'Mischa UAT Test', id: '01d630cf-732f-41d9-9b58-44a89e27bb8d', mail: 'mischa_uat_test@lifekindconcepts.com' },
];

function Enrollment() {
  const [selectedProvider, setSelectedProvider] = useState(null);
  const [status, setStatus] = useState({ type: 'info', text: 'Select a provider to enroll' });
  const [progress, setProgress] = useState(0);
  const [feedback, setFeedback] = useState('');
  const [isRunning, setIsRunning] = useState(false);
  const [logs, setLogs] = useState([]);
  const [customId, setCustomId] = useState('');
  const [deleteId, setDeleteId] = useState('');
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [deleteResult, setDeleteResult] = useState(null);

  const wsRef = useRef(null);
  const mediaStreamRef = useRef(null);
  const processorRef = useRef(null);
  const audioContextRef = useRef(null);
  const logsEndRef = useRef(null);

  const addLog = useCallback((text, type = 'info') => {
    setLogs(prev => [...prev.slice(-100), { text: `[${new Date().toLocaleTimeString()}] ${text}`, type }]);
    setTimeout(() => logsEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 50);
  }, []);

  const stop = useCallback(() => {
    if (processorRef.current) { processorRef.current.disconnect(); processorRef.current = null; }
    if (audioContextRef.current) { audioContextRef.current.close(); audioContextRef.current = null; }
    if (mediaStreamRef.current) { mediaStreamRef.current.getTracks().forEach(t => t.stop()); mediaStreamRef.current = null; }
    if (wsRef.current) { wsRef.current.close(); wsRef.current = null; }
    setIsRunning(false);
  }, []);

  // Cleanup on unmount (tab switch)
  useEffect(() => stop, [stop]);

  const startEnrollment = useCallback(async (provider) => {
    setSelectedProvider(provider);
    setIsRunning(true);
    setProgress(0);
    setFeedback('');
    setLogs([]);
    setStatus({ type: 'info', text: `Connecting for ${provider.displayName}...` });

    try {
      const ws = new WebSocket(`${VOICE_BACKEND_WS}/enroll`);
      wsRef.current = ws;

      ws.onopen = async () => {
        addLog('WebSocket connected', 'success');
        setStatus({ type: 'connected', text: `Recording — ${provider.displayName}` });

        ws.send(JSON.stringify({ type: 'start', userNum: provider.id }));
        addLog(`Sent enrollment start for ${provider.displayName} (${provider.id})`);

        try {
          const stream = await navigator.mediaDevices.getUserMedia({
            audio: { sampleRate: 16000, channelCount: 1, echoCancellation: true, noiseSuppression: true }
          });
          mediaStreamRef.current = stream;

          const audioContext = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 16000 });
          audioContextRef.current = audioContext;
          const source = audioContext.createMediaStreamSource(stream);

          await audioContext.audioWorklet.addModule('/pcm-processor.js');
          const processor = new AudioWorkletNode(audioContext, 'pcm-processor');
          processorRef.current = processor;

          processor.port.onmessage = (e) => {
            if (ws.readyState === WebSocket.OPEN) ws.send(e.data);
          };

          source.connect(processor);
          processor.connect(audioContext.destination);
          addLog('Microphone streaming started', 'success');
        } catch (micErr) {
          addLog(`Microphone error: ${micErr.message}`, 'error');
          setStatus({ type: 'error', text: `Mic error: ${micErr.message}` });
          stop();
        }
      };

      ws.onmessage = (event) => {
        const msg = JSON.parse(event.data);
        addLog(`${msg.type} ${msg.percentage !== undefined ? msg.percentage + '%' : ''} ${msg.feedback || ''}`.trim(),
          msg.type === 'error' ? 'error' : 'success');

        if (msg.type === 'progress') {
          setProgress(msg.percentage || 0);
          setFeedback(msg.feedback || '');
        } else if (msg.type === 'complete') {
          setProgress(100);
          setStatus({ type: 'connected', text: `Enrollment complete — ${provider.displayName}` });
          addLog('Enrollment complete!', 'success');
          stop();
        } else if (msg.type === 'error') {
          setStatus({ type: 'error', text: msg.message || 'Enrollment error' });
          stop();
        }
      };

      ws.onerror = () => {
        addLog('WebSocket error', 'error');
        setStatus({ type: 'error', text: 'Connection error' });
        stop();
      };

      ws.onclose = () => {
        addLog('WebSocket closed');
        if (isRunning) stop();
      };
    } catch (err) {
      addLog(`Error: ${err.message}`, 'error');
      setStatus({ type: 'error', text: err.message });
      stop();
    }
  }, [addLog, stop, isRunning]);

  const deleteVoiceProfile = async () => {
    if (!deleteId.trim()) return;
    setDeleteLoading(true);
    setDeleteResult(null);
    try {
      const res = await fetch(`${VOICE_BACKEND}/api/voice-profiles/${deleteId.trim()}`, { method: 'DELETE' });
      const data = await res.json();
      setDeleteResult(data);
    } catch (err) {
      setDeleteResult({ success: false, message: err.message });
    } finally {
      setDeleteLoading(false);
    }
  };

  const getInitials = (name) => name.split(' ').map(n => n[0]).join('').substring(0, 2);

  return (
    <div>
      {/* Provider Grid */}
      <div style={{ marginBottom: 16 }}>
        <label style={{ display: 'block', color: '#ccc', fontWeight: 600, marginBottom: 10 }}>
          Select Provider to Enroll
        </label>
        <div style={{
          display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
          gap: 10
        }}>
          {PROVIDERS.map(provider => (
            <button
              key={provider.id}
              onClick={() => !isRunning && startEnrollment(provider)}
              disabled={isRunning}
              style={{
                display: 'flex', alignItems: 'center', gap: 12, padding: 12,
                background: selectedProvider?.id === provider.id ? '#0f3460' : '#1a1a2e',
                border: selectedProvider?.id === provider.id ? '1px solid #e94560' : '1px solid #333',
                borderRadius: 10, cursor: isRunning ? 'not-allowed' : 'pointer',
                opacity: isRunning && selectedProvider?.id !== provider.id ? 0.4 : 1,
                transition: 'all 0.2s', textAlign: 'left', color: '#fff', width: '100%'
              }}
            >
              <div style={{
                width: 40, height: 40, borderRadius: '50%', background: '#0f3460',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 14, fontWeight: 700, color: '#e94560', flexShrink: 0,
                border: '2px solid #333'
              }}>
                {getInitials(provider.displayName)}
              </div>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 600, fontSize: 14, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {provider.displayName}
                </div>
                <div style={{ fontSize: 11, color: '#666', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {provider.mail}
                </div>
                <div style={{ fontSize: 10, color: '#444', fontFamily: 'monospace' }}>
                  {provider.id.substring(0, 8)}...
                </div>
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Custom ID Enrollment */}
      <div style={{
        background: '#1a1a2e', borderRadius: 10, padding: 16, marginBottom: 16,
        border: '1px solid #333'
      }}>
        <label style={{ display: 'block', color: '#ccc', fontWeight: 600, marginBottom: 8 }}>
          Enroll with Custom ID
        </label>
        <div style={{ display: 'flex', gap: 8 }}>
          <input
            value={customId}
            onChange={e => setCustomId(e.target.value)}
            placeholder="Enter provider GUID or custom ID"
            disabled={isRunning}
            style={{
              flex: 1, padding: 10, border: '1px solid #333', borderRadius: 6,
              background: '#0f3460', color: '#fff', fontSize: 14, fontFamily: 'monospace'
            }}
          />
          <button
            onClick={() => {
              const id = customId.trim();
              if (id && !isRunning) startEnrollment({ id, displayName: id, mail: '' });
            }}
            disabled={!customId.trim() || isRunning}
            style={{
              padding: '10px 20px', border: 'none', borderRadius: 6, cursor: 'pointer',
              background: !customId.trim() || isRunning ? '#333' : '#e94560', color: '#fff',
              fontWeight: 600, fontSize: 14, opacity: !customId.trim() || isRunning ? 0.5 : 1,
              whiteSpace: 'nowrap'
            }}
          >
            Start Enrollment
          </button>
        </div>
      </div>

      {/* Active enrollment status */}
      {selectedProvider && (
        <div style={{
          background: '#0f3460', borderRadius: 10, padding: 16, marginBottom: 16,
          border: '1px solid #333'
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <div>
              <div style={{ fontSize: 16, fontWeight: 700, color: '#fff' }}>{selectedProvider.displayName}</div>
              <div style={{ fontSize: 12, color: '#aaa', fontFamily: 'monospace' }}>{selectedProvider.id}</div>
            </div>
            {isRunning && (
              <button className="btn btn-stop" onClick={stop} style={{ width: 'auto', padding: '8px 20px' }}>
                Stop
              </button>
            )}
          </div>

          <div className={`status ${status.type}`}>{status.text}</div>

          {(progress > 0 || isRunning) && (
            <div>
              <div className="progress-bar">
                <div className="progress-fill" style={{ width: `${progress}%` }} />
              </div>
              <div style={{ textAlign: 'center', marginTop: 6, color: '#aaa', fontSize: 13 }}>
                {progress}% {feedback && `— ${feedback}`}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Delete Voice Profile */}
      <div style={{
        background: '#1a1a2e', borderRadius: 10, padding: 16, marginBottom: 16,
        border: '1px solid #333'
      }}>
        <label style={{ display: 'block', color: '#ccc', fontWeight: 600, marginBottom: 8 }}>
          Delete Voice Profile
        </label>
        <div style={{ display: 'flex', gap: 8 }}>
          <select
            value={deleteId}
            onChange={e => { setDeleteId(e.target.value); setDeleteResult(null); }}
            style={{
              flex: 1, padding: 10, border: '1px solid #333', borderRadius: 6,
              background: '#0f3460', color: '#fff', fontSize: 14
            }}
          >
            <option value="">Select provider to delete...</option>
            {PROVIDERS.map(p => (
              <option key={p.id} value={p.id}>{p.displayName} ({p.id.substring(0, 8)}...)</option>
            ))}
          </select>
          <button
            onClick={deleteVoiceProfile}
            disabled={!deleteId || deleteLoading}
            style={{
              padding: '10px 20px', border: 'none', borderRadius: 6, cursor: 'pointer',
              background: !deleteId || deleteLoading ? '#333' : '#e94560', color: '#fff',
              fontWeight: 600, fontSize: 14, opacity: !deleteId || deleteLoading ? 0.5 : 1
            }}
          >
            {deleteLoading ? 'Deleting...' : 'Delete'}
          </button>
        </div>
        {deleteResult && (
          <div style={{
            marginTop: 8, padding: 8, borderRadius: 6, fontSize: 13,
            background: deleteResult.success ? '#1b4332' : '#3d0000',
            color: deleteResult.success ? '#95d5b2' : '#ff6b6b'
          }}>
            {deleteResult.success
              ? `Profile deleted. Profiles remaining: ${deleteResult.profilesLoaded}`
              : `Error: ${deleteResult.message}`}
          </div>
        )}
      </div>

      {/* Logs */}
      {logs.length > 0 && (
        <div className="log" style={{ maxHeight: 300, overflowY: 'auto' }}>
          {logs.map((log, i) => (
            <div key={i} className={`log-entry ${log.type}`}>{log.text}</div>
          ))}
          <div ref={logsEndRef} />
        </div>
      )}
    </div>
  );
}

export default Enrollment;

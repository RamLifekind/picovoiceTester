import React, { useState } from 'react';
import Enrollment from './Enrollment';
import Recognition from './Recognition';
import './App.css';

function App() {
  const [tab, setTab] = useState('recognition');

  return (
    <div className="app">
      <h1>Project FOCUS Voice Verification Tester</h1>
      <div className="tabs">
        <button className={tab === 'enrollment' ? 'active' : ''} onClick={() => setTab('enrollment')}>
          Enrollment
        </button>
        <button className={tab === 'recognition' ? 'active' : ''} onClick={() => setTab('recognition')}>
          Recognition
        </button>
      </div>
      <div className="tab-content">
        {tab === 'enrollment' && <Enrollment />}
        {tab === 'recognition' && <Recognition />}
      </div>
    </div>
  );
}

export default App;

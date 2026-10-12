import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { AppProvider } from './state';
import { GccEngine } from './lib/engine';
import './index.css';

const engine = new GccEngine();
// started before the first render: a sign-in gate (or the home team's check) is there from the first
// frame, with no app shell behind it
engine.load();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppProvider engine={engine}>
      <App />
    </AppProvider>
  </StrictMode>,
);

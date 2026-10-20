import { createRoot } from 'react-dom/client';
import './base.css';
import './app.css';
import { App } from './App';
import { init } from './store';

// Dateien, die neben die Bereiche fallen, sollen nicht die Seite ersetzen
addEventListener('dragover', (e) => e.preventDefault());
addEventListener('drop', (e) => e.preventDefault());

init().then(() => createRoot(document.getElementById('root')!).render(<App />));

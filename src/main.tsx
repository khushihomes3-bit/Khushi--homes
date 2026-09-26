import { createRoot } from 'react-dom/client';
import App from './App';
import './index.css';

window.onerror = function(message, source, line, column, error) {
  document.body.innerHTML =
    '<pre style="padding:20px;white-space:pre-wrap;color:red">' +
    'ERROR:\\n' + message + '\\n\\n' +
    (error?.stack || '') +
    '</pre>';
};

try {
  createRoot(document.getElementById('root')!).render(<App />);
} catch (e) {
  document.body.innerHTML =
    '<pre style="padding:20px;white-space:pre-wrap;color:red">' +
    'RENDER ERROR:\\n' + String(e) +
    '</pre>';
}

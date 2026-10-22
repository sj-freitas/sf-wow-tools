import { StrictMode } from 'react';
import { BrowserRouter } from 'react-router-dom';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './index.css';

/**
 * After a deploy, a page left open still asks for the old version's code (its files are named by
 * their contents, so each version has new names) and those are gone: opening another page then
 * fails. Vite says so with `vite:preloadError`: reload once, to get the new version. Not again
 * within a minute, so a page that fails for another reason shows its error instead of looping.
 */
const RELOADED_AT = 'reloaded-for-new-version';
window.addEventListener('vite:preloadError', (event) => {
  try {
    const last = Number(sessionStorage.getItem(RELOADED_AT) ?? 0);
    if (Date.now() - last < 60_000) return;
    sessionStorage.setItem(RELOADED_AT, String(Date.now()));
  } catch {
    return; // no storage: can't tell whether it already tried, so it doesn't
  }
  event.preventDefault();
  window.location.reload();
});

const container = document.getElementById('root');
if (!container) {
  throw new Error('Root element not found');
}

createRoot(container).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
);

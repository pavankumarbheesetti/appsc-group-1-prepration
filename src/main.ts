// Application entry point: import the design-system style layers (order matters:
// tokens → base → components) and mount the app.
import './styles/tokens.css';
import './styles/telugu-font.css';
import './styles/base.css';
import './styles/components.css';
import './styles/timeline.css';
import { renderApp } from './app';

const root = document.querySelector<HTMLElement>('#app');
if (!root) {
  throw new Error('Root element #app not found');
}

renderApp(root);

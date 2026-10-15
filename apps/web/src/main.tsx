import { createRoot } from 'react-dom/client';
import App from './App';
import '@fontsource-variable/dm-sans';
import './styles.css';
import { verifyInstallation } from './installation-check';
createRoot(document.getElementById('root')!).render(<App />);
void verifyInstallation().catch(console.error);

import '@fontsource/pixelify-sans/400.css';
import '@fontsource/pixelify-sans/600.css';
import './ui/ui.css';
import { render } from 'preact';
import { App } from './ui/App.tsx';

render(<App />, document.getElementById('app')!);

import React from 'react';
import ReactDOM from 'react-dom/client';
import { Provider, getDefaultStore } from 'jotai';
import App from './App';
import './print/print.css';

const store = getDefaultStore();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Provider store={store}>
      <App />
    </Provider>
  </React.StrictMode>
);

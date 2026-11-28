import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import { applyZoom, getStoredZoom } from "./lib/app-zoom";
import { startAppUpdates } from './lib/app-updates';
import { primeP2PAlarmAudio } from './features/exchanges/p2p-alarm-sound';

applyZoom(getStoredZoom());
// Installed before the login screen so the sign-in click unlocks later alerts.
primeP2PAlarmAudio();

if (import.meta.env.PROD) startAppUpdates(__APP_BUILD_ID__);

const root = document.getElementById("root");
if (root) {
  createRoot(root).render(
    <React.StrictMode><App /></React.StrictMode>
  );
}

import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import { applyZoom, getStoredZoom } from "./lib/app-zoom";

import { startAppUpdates } from './lib/app-updates';

applyZoom(getStoredZoom());

if (import.meta.env.PROD) startAppUpdates(__APP_BUILD_ID__);

const root = document.getElementById("root");
if (root) {
  createRoot(root).render(
    <React.StrictMode><App /></React.StrictMode>
  );
}

import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import AppCrashBoundary from "./components/AppCrashBoundary";
import "./styles/app.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <AppCrashBoundary>
      <App />
    </AppCrashBoundary>
  </React.StrictMode>,
);

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { AuthGate, AuthProvider } from "./auth";
import { ErrorBoundary } from "./error-boundary";
import "./styles.css";

const container = document.getElementById("root");

if (container === null) {
  throw new Error("ไม่พบองค์ประกอบรากของแอป");
}

createRoot(container).render(
  <StrictMode>
    <ErrorBoundary>
      <AuthProvider>
        <AuthGate>
          <App />
        </AuthGate>
      </AuthProvider>
    </ErrorBoundary>
  </StrictMode>,
);

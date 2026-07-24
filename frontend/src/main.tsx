import { createRoot } from "react-dom/client";
import App from "./app/App";
import "./index.css";
import { registerServiceWorker } from "@/lib/pwa/registerServiceWorker";
import { installGlobalErrorHandlers } from "@/lib/diagnostics";

registerServiceWorker();
installGlobalErrorHandlers();

createRoot(document.getElementById("root")!).render(<App />);

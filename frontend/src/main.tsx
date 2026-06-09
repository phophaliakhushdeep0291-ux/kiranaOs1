import { createRoot } from "react-dom/client";
import App from "./app/App";
import "./index.css";
import { registerServiceWorker } from "@/lib/pwa/registerServiceWorker";

registerServiceWorker();

createRoot(document.getElementById("root")!).render(<App />);

import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./styles.css";

const container = document.getElementById("root");
if (!container) throw new Error("Root container #root is missing from index.html.");

// React 19: `createRoot` is the only supported entry point. The legacy
// `ReactDOM.render` was removed, and the default namespace import is no longer
// needed now that only `createRoot` is used.
createRoot(container).render(<App />);

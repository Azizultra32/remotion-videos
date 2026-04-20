import { createRoot } from "react-dom/client";
import { App } from "./App";

// biome-ignore lint/style/noNonNullAssertion: #root is the hard-coded mount div in index.html; absence is a fatal app-configuration bug, not a runtime condition to guard
createRoot(document.getElementById("root")!).render(<App />);

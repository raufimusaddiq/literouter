import { createRoot } from "react-dom/client";
import App from "./App.jsx";
import { watchBuild } from "./buildWatch.js";

watchBuild();
createRoot(document.getElementById("root")).render(<App />);

import { createRoot } from "react-dom/client";
import "@fontsource-variable/geist";
import "@fontsource-variable/geist-mono";
import "@fontsource-variable/source-serif-4";
import "./styles.css";
import { App } from "./App";

createRoot(document.getElementById("root")!).render(<App />);

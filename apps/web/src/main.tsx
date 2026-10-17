import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./style.css";
import "./interface/interface.css";
document.documentElement.className =
  localStorage.getItem("memlia-theme") === "dark" ? "dark" : "light";
createRoot(document.getElementById("root")!).render(<App />);

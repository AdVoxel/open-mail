import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createMailApi } from "@mail-app/api-client";
import { App } from "./App";
import "./styles.css";

const params = new URLSearchParams(window.location.search);
const api = createMailApi(params.get("api") ?? "http://127.0.0.1:8787", params.get("token") ?? "");

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App api={api} />
  </StrictMode>,
);

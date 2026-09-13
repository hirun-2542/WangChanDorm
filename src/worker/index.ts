import { Hono } from "hono";
import health from "./routes/health";
import api from "./routes/seam-probe";

const app = new Hono<{ Bindings: Env }>();

app.route("/health", health);
app.route("/api", api);

export default app;

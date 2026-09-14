import { Hono } from "hono";
import health from "./routes/health";
import rooms from "./routes/rooms";
import api from "./routes/seam-probe";

const app = new Hono<{ Bindings: Env }>();

app.route("/health", health);
app.route("/api", api);
app.route("/api/rooms", rooms);

export default app;

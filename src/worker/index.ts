import { Hono } from "hono";
import health from "./routes/health";
import rooms from "./routes/rooms";
import api from "./routes/seam-probe";
import settings from "./routes/settings";
import tenants from "./routes/tenants";

const app = new Hono<{ Bindings: Env }>();

app.route("/health", health);
app.route("/api", api);
app.route("/api/rooms", rooms);
app.route("/api/settings", settings);
app.route("/api/tenants", tenants);

export default app;

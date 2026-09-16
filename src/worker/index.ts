import { Hono } from "hono";
import bills from "./routes/bills";
import { invoiceRoute, qrRoute } from "./routes/bills-render";
import health from "./routes/health";
import line, { lineAdmin } from "./routes/line";
import rooms from "./routes/rooms";
import api from "./routes/seam-probe";
import settings from "./routes/settings";
import slips from "./routes/slips";
import tenants from "./routes/tenants";

const app = new Hono<{ Bindings: Env }>();

app.route("/health", health);
app.route("/api", api);
app.route("/api/bills", bills);
app.route("/api/line", lineAdmin);
app.route("/api/rooms", rooms);
app.route("/api/settings", settings);
app.route("/api/tenants", tenants);
app.route("/webhook/line", line);
app.route("/qr", qrRoute);
app.route("/slips", slips);
app.route("/invoices", invoiceRoute);

export default app;

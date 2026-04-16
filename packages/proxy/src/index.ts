import { loadConfig } from "./config.js";
import { createServer } from "./server.js";

const config = loadConfig();
const app = createServer(config);

app.listen(config.port, () => {
  console.log(
    `[proxy] listening on :${config.port} (mockAuth=${config.mockAuth}, region=${config.region})`
  );
});

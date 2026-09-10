import "dotenv/config";

import { buildApp } from "./app";
import { connectDB } from "./db";
import { config } from "./config";

async function main() {
  await connectDB(config.mongodbUri);
  const app = buildApp();
  app.listen(config.port, () => {
    console.log("API listening on port " + config.port);
  });
}

main().catch((err) => {
  console.error("Fatal startup error:", err);
  process.exit(1);
});

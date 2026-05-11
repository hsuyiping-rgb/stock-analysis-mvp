import { onRequest } from "firebase-functions/v2/https";
import { handleRequest } from "./api-core.js";

export const api = onRequest(
  {
    region: "asia-east1",
    timeoutSeconds: 60,
    memory: "512MiB",
    cors: true
  },
  (request, response) => {
    return handleRequest(request, response, { apiOnly: true });
  }
);

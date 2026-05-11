import { createServer } from "node:http";
import { handleRequest } from "./api-core.js";

const PORT = Number(process.env.PORT || 8787);

createServer((request, response) => {
  handleRequest(request, response);
}).listen(PORT, () => {
  console.log(`Stock MVP running at http://127.0.0.1:${PORT}`);
});

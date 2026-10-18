// Stand-in for the service-fallback engine: answers /readyz on argv[2] with the status in argv[3] (200 when omitted).
const http = require("node:http");
const port = Number(process.argv[2]);
const status = Number(process.argv[3] || 200);
http.createServer((req, res) => {
  res.statusCode = req.url === "/readyz" ? status : 404;
  res.end();
}).listen(port, "127.0.0.1");

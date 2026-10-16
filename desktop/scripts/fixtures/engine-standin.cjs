// Test stand-in for the engine: serves /readyz on the port in argv[2] until it is signalled.
const http = require('node:http');
const port = Number(process.argv[2]);
http.createServer((request, response) => {
  response.writeHead(request.url === '/readyz' ? 200 : 404);
  response.end();
}).listen(port, '127.0.0.1', () => process.stdout.write('listening\n'));

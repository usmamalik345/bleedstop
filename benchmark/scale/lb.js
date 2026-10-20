/** Minimal round-robin HTTP load balancer (keep-alive) for local multi-instance runs. */
import http from "node:http";
const port = Number(process.argv[2]);
const targets = process.argv.slice(3).map((p) => Number(p));
const agent = new http.Agent({ keepAlive: true, maxSockets: 512 });
let i = 0;
http.createServer((req, res) => {
  const target = targets[i++ % targets.length];
  const up = http.request({ host: "127.0.0.1", port: target, path: req.url, method: req.method, headers: req.headers, agent }, (r) => {
    res.writeHead(r.statusCode, r.headers);
    r.pipe(res);
  });
  up.on("error", (e) => { res.writeHead(502); res.end(JSON.stringify({ error: e.message })); });
  req.pipe(up);
}).listen(port, () => console.log(`lb :${port} -> ${targets.join(",")}`));

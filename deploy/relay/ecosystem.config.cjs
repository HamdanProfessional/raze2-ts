/**
 * pm2 config for the Raze multiplayer relay.
 *
 * Before this existed the relay ran as a bare `node` process: it survived until
 * the next reboot or stray kill and then the lobby was simply down, with nothing
 * to notice or restart it. Under pm2 (plus `pm2 save`) it comes back on its own.
 *
 * HOST is 127.0.0.1 deliberately — nginx terminates TLS and proxies
 * `/raze-ws` to this port, so 8788 must not be reachable from outside.
 *
 *   pm2 start ecosystem.config.cjs && pm2 save
 */
module.exports = {
  apps: [
    {
      name: "raze-relay",
      script: "server.mjs",
      cwd: __dirname,
      env: {
        NODE_ENV: "production",
        HOST: "127.0.0.1",
        PORT: "8788",
      },
      autorestart: true,
      max_restarts: 20,
      restart_delay: 1000,
      max_memory_restart: "256M",
      time: true,
    },
  ],
};

/**
 * PM2 Ecosystem Configuration — PetChain Backend
 *
 * Manages the Node.js backend in cluster mode so all available CPU cores
 * are utilised. Sessions are stored in Redis, so every instance is
 * stateless and the load balancer can route to any worker.
 *
 * Usage:
 *   # Start / restart in cluster mode
 *   pm2 start ecosystem.config.js --env production
 *
 *   # Zero-downtime reload (graceful)
 *   pm2 reload ecosystem.config.js --env production
 *
 *   # Stop all workers
 *   pm2 stop petchain-api
 *
 *   # Save process list so it survives reboots
 *   pm2 save && pm2 startup
 */

'use strict';

module.exports = {
  apps: [
    {
      // ---- Identity -------------------------------------------------------
      name: 'petchain-api',
      script: 'backend/server/index.ts',
      interpreter: 'node',
      interpreter_args: '--import tsx',

      // ---- Clustering -----------------------------------------------------
      instances: 'max', // one worker per logical CPU core
      exec_mode: 'cluster',

      // ---- Graceful shutdown ----------------------------------------------
      // Milliseconds to wait for in-flight requests to drain before SIGKILL.
      kill_timeout: 10_000,
      // PM2 waits this long after the process becomes "online" before
      // considering the reload successful.
      wait_ready: true,
      listen_timeout: 15_000,

      // ---- Auto-restart policy --------------------------------------------
      watch: false, // never watch in production
      max_restarts: 10,
      min_uptime: '5s',
      restart_delay: 1_000,

      // ---- Log management -------------------------------------------------
      error_file: 'logs/petchain-error.log',
      out_file: 'logs/petchain-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true,

      // ---- Environment: production ----------------------------------------
      env_production: {
        NODE_ENV: 'production',
        APP_ENV: 'production',
        PORT: 3000,
      },

      // ---- Environment: staging -------------------------------------------
      env_staging: {
        NODE_ENV: 'production',
        APP_ENV: 'staging',
        PORT: 3001,
      },

      // ---- Environment: development ----------------------------------------
      env_development: {
        NODE_ENV: 'development',
        APP_ENV: 'development',
        PORT: 3000,
        instances: 1, // single worker is easier to debug
        exec_mode: 'fork',
      },
    },
  ],
};

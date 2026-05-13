module.exports = {
  apps: [
    {
      name: 'ad-studio-web',
      script: 'npm',
      args: 'start',
      env: {
        NODE_ENV: 'production',
        QUEUE_DRIVER: 'worker',
      },
      autorestart: true,
      max_restarts: 10,
      restart_delay: 3000,
      out_file: './logs/web-out.log',
      error_file: './logs/web-error.log',
    },
    {
      name: 'ad-studio-worker',
      script: 'npm',
      args: 'run worker',
      env: {
        NODE_ENV: 'production',
        QUEUE_DRIVER: 'worker',
      },
      autorestart: true,
      max_restarts: 10,
      restart_delay: 3000,
      out_file: './logs/worker-out.log',
      error_file: './logs/worker-error.log',
    },
  ],
};

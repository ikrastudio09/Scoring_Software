// pm2 start infrastructure/ecosystem.config.cjs   (from the repository root)
// ONE instance on purpose: match state is serialised in-process (see docs/ARCHITECTURE.md).
module.exports = {
  apps: [{
    name: 'cricket',
    cwd: './server',
    script: 'src/index.js',
    node_args: '--env-file=.env',
    instances: 1,
    exec_mode: 'fork',
    autorestart: true,
    max_restarts: 50,
    restart_delay: 1000,
    max_memory_restart: '700M',
    kill_timeout: 12000,
    time: true,
    out_file: '/var/log/cricket/out.log',
    error_file: '/var/log/cricket/error.log',
    merge_logs: true,
  }],
};

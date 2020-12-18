const logger = {
  debug() {
    if (process.env.DEBUG) {
      this._log('debug', arguments);
    }
  },
  info() {
    this._log('log', arguments);
  },
  warn() {
    this._log('warn', arguments);
  },
  error() {
    this._log('error', arguments);
  },
  _log(fxn, args) {
    const expanded = [
      (fxn === 'log' ? 'info' : fxn).toUpperCase(),
      ...args
    ];
    if (!process.env.OMIT_LOG_TIMESTAMP) {
      expanded.unshift(new Date().toISOString());
    }
    console[fxn].apply(console, expanded);
  }
};

module.exports = logger;
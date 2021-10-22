import logger, { LogLevels } from "npmlog";

export function debug(message: string, ...args: any[]) {
    if (process.env.DEBUG) {
      _log("verbose", message, args);
    }
}

export function info(message: string, ...args: any[]) {
    _log("info", message, args);
}

export function warn(message: string, ...args: any[]) {
    _log("warn", message, args);
}

export function error(message: string, ...args: any[]) {
    _log("error", message, args);
}

function _log(level: LogLevels, message: string, args: any[]) {
    const prefix = process.env.OMIT_LOG_TIMESTAMP ? "" :
        new Date().toISOString();
    logger.log(level, prefix, message, ...args);
}
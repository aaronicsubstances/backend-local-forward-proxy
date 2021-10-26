import logger, { LogLevels } from "npmlog";

let _enableVerboseLogs: boolean | undefined;
let _omitLogTimestamps: boolean | undefined;

export function setLoggerOptions(enableVerboseLogs?: boolean, omitLogTimestamps?: boolean) {
    _enableVerboseLogs = enableVerboseLogs;
    _omitLogTimestamps = omitLogTimestamps;
}

export function debug(message: string, ...args: any[]) {
    if (_enableVerboseLogs) {
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
    const prefix = _omitLogTimestamps ? "" : new Date().toISOString();
    logger.log(level, prefix, message, ...args);
}
#!/usr/bin/env node

const dotenv = require("dotenv");
const nconf = require("nconf");

const { DuplexAgent, /*PollingAgent,*/ setLoggerOptions } = require('../dist');

dotenv.config();
nconf.argv({ parseValues: true })
   .env({ parseValues: true })
   .file({ file: '.env.json' });

setLoggerOptions(nconf.get("DEBUG"), nconf.get("OMIT_LOG_TIMESTAMP"));

const requestTimeoutMillis = nconf.get("REQUEST_TIMEOUT_MILLIS");
console.log(`Target app request timeout: ${requestTimeoutMillis} ms`);
//const maxLongPollingConnectionCount = nconf.get("MAX_LONG_POLLING_CONNECTION_COUNT");
//console.log(`Max long polling connection count: ${maxLongPollingConnectionCount}`);

let connInfoList = nconf.get("CONNECTION_INFO_LIST");
if (!connInfoList) {
    connInfoList = [];
}
else if (typeof connInfoList === "string") {
    connInfoList = JSON.parse(connInfoList);
}

let activeConnCnt = 0;
for (const connInfo of connInfoList) {
    if (connInfo.exclude) {
        continue;
    }

    /*new PollingAgent(connInfo.targetAppId,
        connInfo.reverseProxyBaseUrl,
        connInfo.targetAppBaseUrl,
        maxLongPollingConnectionCount,
        requestTimeoutMillis).start();*/
    new DuplexAgent(connInfo.targetAppId,
        connInfo.reverseProxyBaseUrl,
        connInfo.targetAppBaseUrl,
        requestTimeoutMillis).start();
    activeConnCnt++;
}

console.log(`${activeConnCnt} target app proxy connection${activeConnCnt === 1 ? '' : 's'} started:`,
    JSON.stringify(connInfoList.map(item => item.targetAppId)));

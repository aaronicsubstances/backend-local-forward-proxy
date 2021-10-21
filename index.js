const dotenv = require('dotenv')

const logger = require("./logger");
const utils = require("./utils");
//const { PollingAgent } = require("./http-long-polling");
const { DuplexAgent } = require('./web-socket/duplex-agent');

dotenv.config();

const connInfoList = utils.getConnectionInfoList();
let activeConnCnt = 0;
for (const connInfo of connInfoList) {
    if (connInfo.targetAppId.startsWith("#")) {
        logger.warn("This connection configuration item looks commented out,",
            "and hence will be skipped:", connInfo);
        continue;
    }
    //new PollingAgent(connInfo.targetAppId,
    new DuplexAgent(connInfo.targetAppId,
        connInfo.reverseProxyBaseUrl,
        connInfo.targetAppBaseUrl).start();
    activeConnCnt++;
}
logger.info(`${activeConnCnt} target receiver${activeConnCnt === 1 ? '' : 's'} started with max`,
    `client connection count of ${utils.getMaxTargetConnectionCount()} each`);

if (activeConnCnt > 0) {
    // prevent script from exiting.
    const SOME_HUGE_INTERVAL = 1 << 30;
    setInterval(() => {}, SOME_HUGE_INTERVAL);
}
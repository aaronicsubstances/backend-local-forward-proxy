const dotenv = require('dotenv')
const fetch = require("node-fetch");

const logger = require("./logger");
const utils = require("./utils");
const RequestTransferHandler = require("./request-transfer-handler");

dotenv.config();

class RemoteProxyConnection {
    constructor(connInfo) {
        this.connectionCount = 1;
        this.failureCount = 0;
        this.targetAppId = connInfo.targetAppId;
        this.reverseProxyBaseUrl = connInfo.reverseProxyBaseUrl;
        this.targetAppBaseUrl = connInfo.targetAppBaseUrl;
    }

    start() {
        this._nextRun();
    }

    _nextRun() {
        /*
        idea is that as long as we find work to do, increase number of connections to remote proxy.
        else maintain just one connection.

        do this repeatedly till program exits:
        
            fire multiple connections determined by current/last success count.
            wait for them,
            analyze: did all succeed? 
            if yes, reset failure count, increase success count for next iteration, capped by max count, and 
            try firing multiple connections again with new number and with no reconnection interval.

            if failure. reset success cnt, and increment failure count.
            calculate reconnection interval. and fire single connection
            unless it didn't find work. in which case reset both success and failure cnt
            and fire single connection with no reconnection interval
        */
        this._createNextRoundOfMultipleConnections()
            .then(result => {
                if (result.allConnectionsPickedUpWork) {
                    this.failureCount = 0;
                    // increment connectionCount, but cap by configured maximum.
                    this.connectionCount = Math.min(this.connectionCount + 1,
                        utils.getMaxTargetConnectionCount());
                    this._nextRun();
                }
                else {
                    this.connectionCount = 1; // reset.
                    if (result.someFailed) {
                        this.failureCount++;
            
                        // delay for some time before reconnecting.
                        setTimeout(() => this._nextRun(), 
                            utils.calculateReconnectInterval(this.failureCount));
                    }
                    else {
                        this.failureCount = 0;
                        this._nextRun();
                    }
                }
            });
    }

    _createNextRoundOfMultipleConnections() {
        return new Promise((resolutionFunc, rejectionFunc) => {
            let interimSuccessCount = 0, interimFailureCount = 0, returnCount = 0;
            for (let i = 0; i < this.connectionCount; i++) {
                this._connectToRemoteProxy()
                    .then(result => {
                        returnCount++;
                        if (result.foundWorkToDo) {
                            interimSuccessCount++;
                        }
                        if (result.failed) {
                            interimFailureCount++;
                        }
                        if (returnCount === this.connectionCount) {
                            resolutionFunc({
                                allConnectionsPickedUpWork: interimSuccessCount === this.connectionCount, 
                                someFailed: interimFailureCount > 0
                            });
                        }
                    });
            }
        });
    }

    _connectToRemoteProxy() {
        const fetchUrl = `${this.reverseProxyBaseUrl}/req-h/${this.targetAppId}`;
        return fetch(fetchUrl)
            .then(utils.checkFetchResponseStatus)
            .then(res => res.json())
            .then(res => {
                if (res.id) {
                    logger.debug(`pending request found for target ${this.targetAppId} with id ${res.id}`);
                    new RequestTransferHandler(this.targetAppId,
                        this.reverseProxyBaseUrl, this.targetAppBaseUrl, res).start();
                    return {
                        foundWorkToDo: true
                    };
                }
                else {
                    // no work found.
                    logger.debug(`no pending request found for target ${this.targetAppId}`);
                    return {
                        // neither succeeded nor failed.
                    };
                }
            })
            .catch(err => {
                if (err.name === 'FetchError') {
                    logger.warn(`Unsuccessful fetch for target ${this.targetAppId}:`, err.message);
                }
                else {
                    logger.error(`An error occured during fetch for target ${this.targetAppId}`, err);
                }
                return {
                    failed: true,
                };
            });
    }
}

const connInfoList = utils.getConnectionInfoList();
let activeConnCnt = 0;
for (const connInfo of connInfoList) {
    if (connInfo.targetAppId.startsWith("#")) {
        logger.warn("This connection configuration item looks commented out,",
            "and hence will be skipped:", connInfo);
        continue;
    }
    new RemoteProxyConnection(connInfo).start();
    activeConnCnt++;
}
logger.info(`${activeConnCnt} target receiver${activeConnCnt === 1 ? '' : 's'} started with max`,
    `long polling connection count of ${utils.getMaxTargetConnectionCount()} each`);

if (activeConnCnt > 0) {
    // prevent script from exiting.
    const SOME_HUGE_INTERVAL = 1 << 30;
    setInterval(() => {}, SOME_HUGE_INTERVAL);
}